"""Turn CubiCasa5K predictions into ArchNext geometry (AI mode) or combine them with OpenCV (Hybrid mode).

Both modes produce the same ``WallDetection`` that the OpenCV parser produces, so wall vectorisation,
opening detection, room extraction, TopologyGuard, ScaleLock, the 3D model and GLB export are unchanged and
the coordinates stay those of the working image.

AI mode     walls = predicted Wall pixels with predicted door / window spans cut out (so they become gaps that
            the opening detector turns into doors and windows).
Hybrid mode walls = OpenCV wall mask, plus AI wall pieces that OpenCV missed when they are backed by ink in
            the drawing, minus OpenCV pieces the AI confidently calls non-wall (furniture, symbols, text).
In both modes door / window types come from the AI icon map, and unnamed rooms take the AI room class.
"""
from __future__ import annotations

import cv2
import numpy as np

from . import cubicasa as cc
from .structure import MIN_OPENING, classify_gap, find_gaps, opening_polygon
from .walls import WallDetection, vectorise

# AI room class -> ArchNext room type (for rooms without a readable name on the plan).
AI_ROOM_TYPE = {3: "kitchen", 4: "living", 5: "bedroom", 6: "bathroom", 7: "circulation", 9: "utility",
                10: "garage", 1: "outdoor"}
AI_ROOM_NAME = {3: "Kitchen", 4: "Living", 5: "Bedroom", 6: "Bath", 7: "Entry", 9: "Storage", 10: "Garage",
                1: "Outdoor"}


def _mask_thickness(mask: np.ndarray) -> tuple[float, float]:
    """Typical and maximum wall thickness of a clean wall mask (px)."""
    dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    ridge = (dt >= cv2.dilate(dt, np.ones((3, 3), np.float32))) & (dt > 1.0)
    w = 2 * dt[ridge]
    if w.size < 20:
        return 0.0, 0.0
    # The lower quartile, not the median: thick exterior walls and junction blobs would otherwise push the
    # typical thickness up and make the vectoriser drop thin interior walls the model did predict.
    # It must also stay above a third of the thick end, because walls thicker than 3x are treated as massive
    # elements (columns, chimneys) that cannot frame doors or windows.
    p25, p90 = float(np.percentile(w, 25)), float(np.percentile(w, 90))
    return max(p25, p90 / 2.9), p90


def _cut_openings(wall: np.ndarray, icons: np.ndarray, t: float) -> np.ndarray:
    """Remove predicted door / window spans from the wall mask across the full wall thickness."""
    out = wall.copy()
    op = np.isin(icons, (cc.DOOR, cc.WINDOW)).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(op, connectivity=8)
    pad = int(round(1.2 * t)) + 2
    H, W = wall.shape
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 6 or max(w, h) < 0.8 * t:
            continue
        if w >= h:   # horizontal opening: cut through the wall vertically
            out[max(0, y - pad):min(H, y + h + pad), x:x + w] = 0
        else:
            out[y:y + h, max(0, x - pad):min(W, x + w + pad)] = 0
    return out


def _drop_small(mask: np.ndarray, t: float) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        keep[i] = max(w, h) >= 2.0 * t and area >= 1.5 * t * t
    return np.where(keep[labels], 255, 0).astype(np.uint8)


def ai_walls(pred: cc.AIPrediction, thin_width: float = 2.0) -> WallDetection:
    """AI-only wall geometry."""
    raw = pred.wall_mask
    t, t_max = _mask_thickness(raw)
    if t <= 0:
        raise ValueError("The AI model found no walls in this image.")
    mask = _drop_small(_cut_openings(raw, pred.icons, t), t)
    walls, solids = vectorise(mask, t, max(t_max, t), min_thick=0.3)
    if len(walls) < 4:
        raise ValueError("The AI model found too few walls to reconstruct a building.")
    return WallDetection(mask=mask, thickness=t, max_thickness=max(t_max, t), thin_width=thin_width, kernel=0,
                         walls=walls, solids=solids, warnings=[])


def hybrid_walls(pred: cc.AIPrediction, cv_det: WallDetection | None, soft: np.ndarray,
                 add_missing: bool = True, drop_false: bool = True, cut_ai_openings: bool = False) -> WallDetection:
    """OpenCV walls completed and cleaned with the AI prediction."""
    if cv_det is None:              # OpenCV found no wall strokes at all: the AI geometry is all we have.
        return ai_walls(pred)
    t = cv_det.thickness
    ai = _cut_openings(pred.wall_mask, pred.icons, t)
    cv_mask = cv_det.mask

    # 1. Add AI wall pieces OpenCV missed, only where the drawing has ink (walls drawn as thin double lines,
    #    hatched or grey walls). A piece counts as backed by ink when most of it lies near drawn lines.
    k = int(max(3, round(t)))
    near_ink = cv2.dilate(soft, np.ones((k, k), np.uint8)) > 0
    missing = cv2.bitwise_and(ai, cv2.bitwise_not(cv2.dilate(cv_mask, np.ones((3, 3), np.uint8))))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(missing, connectivity=8)
    add = np.zeros(n, bool)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if max(w, h) < 2.0 * t or area < 1.5 * t * t:
            continue
        comp = labels[y:y + h, x:x + w] == i
        add[i] = add_missing and near_ink[y:y + h, x:x + w][comp].mean() >= 0.6
    added = add[labels]

    # 2. Drop OpenCV pieces that the AI confidently sees as non-wall (furniture, symbols, text, hatching).
    ai_any = cv2.dilate((pred.wall_prob > 0.2).astype(np.uint8), np.ones((k, k), np.uint8)) > 0
    n2, labels2, stats2, _ = cv2.connectedComponentsWithStats(cv_mask, connectivity=8)
    drop = np.zeros(n2, bool)
    for i in range(1, n2):
        x, y, w, h, area = stats2[i]
        comp = labels2[y:y + h, x:x + w] == i
        drop[i] = drop_false and ai_any[y:y + h, x:x + w][comp].mean() < 0.2
    kept = (cv_mask > 0) & ~drop[labels2]

    # 3. Optionally open AI-detected door / window spans that OpenCV drew as solid wall.
    mask = np.where(kept | added, 255, 0).astype(np.uint8)
    if cut_ai_openings:
        mask = _cut_openings(mask, pred.icons, t)
    mask = _drop_small(mask, t)
    walls, solids = vectorise(mask, t, cv_det.max_thickness)
    if len(walls) < 4:
        raise ValueError("Too few walls after combining OpenCV and AI detections.")
    return WallDetection(mask=mask, thickness=t, max_thickness=cv_det.max_thickness, thin_width=cv_det.thin_width,
                         kernel=cv_det.kernel, walls=walls, solids=solids, warnings=list(cv_det.warnings))


def hybrid_ai_base(pred: cc.AIPrediction, cv_det: WallDetection | None, min_support: float = 0.3) -> WallDetection:
    """AI walls first; OpenCV adds only wall pieces that the AI also partly sees as wall (it under-segmented
    them). Thickness follows the AI walls so thin and thick walls both survive."""
    if cv_det is None:
        return ai_walls(pred)
    raw = pred.wall_mask
    t, t_max = _mask_thickness(raw)
    if t <= 0:
        raise ValueError("The AI model found no walls in this image.")
    ai = _cut_openings(raw, pred.icons, t)
    k = int(max(3, round(t)))
    weak = cv2.dilate((pred.wall_prob > 0.05).astype(np.uint8), np.ones((k, k), np.uint8)) > 0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cv_det.mask, connectivity=8)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        comp = labels[y:y + h, x:x + w] == i
        keep[i] = weak[y:y + h, x:x + w][comp].mean() >= min_support
    cv_part = keep[labels] & (_cut_openings(np.full_like(raw, 255), pred.icons, t) > 0)
    mask = _drop_small(np.where((ai > 0) | cv_part, 255, 0).astype(np.uint8), t)
    walls, solids = vectorise(mask, t, max(t_max, t), min_thick=0.3)
    if len(walls) < 4:
        raise ValueError("Too few walls after combining OpenCV and AI detections.")
    return WallDetection(mask=mask, thickness=t, max_thickness=max(t_max, t), thin_width=cv_det.thin_width,
                         kernel=cv_det.kernel, walls=walls, solids=solids, warnings=list(cv_det.warnings))


def retype_openings(openings: list[dict], pred: cc.AIPrediction, t: float) -> None:
    """Use the AI icon map to decide door vs window for every detected gap opening (in place)."""
    for o in openings:
        door, window = _icon_share(o, pred.icons, t)
        if max(door, window) >= 0.15:
            o["type"] = "door" if door >= window else "window"
            o["confidence"] = "high"
            o["source"] = "ai"


def _icon_share(o: dict, icons: np.ndarray, t: float) -> tuple[float, float]:
    """Share of door / window pixels in the opening's footprint (padded to at least the wall thickness)."""
    L = max(o["width"], 1.0)
    ux, uy = (o["x2"] - o["x1"]) / L, (o["y2"] - o["y1"]) / L
    nx, ny = -uy, ux
    h = max(o["thickness"], t) / 2 + 2
    poly = np.array([[o["x1"] + nx * h, o["y1"] + ny * h], [o["x2"] + nx * h, o["y2"] + ny * h],
                     [o["x2"] - nx * h, o["y2"] - ny * h], [o["x1"] - nx * h, o["y1"] - ny * h]], np.int32)
    m = np.zeros(icons.shape, np.uint8)
    cv2.fillPoly(m, [poly], 1)
    sel = icons[m > 0]
    if sel.size == 0:
        return 0.0, 0.0
    return float((sel == cc.DOOR).mean()), float((sel == cc.WINDOW).mean())


def ai_gap_openings(walls, t: float, ink: np.ndarray, pred: cc.AIPrediction, existing: list[dict]) -> list[dict]:
    """Openings for wall gaps that the AI clearly marks as a door or window, including wide window bands
    that the size-based rules alone would treat as open space."""
    ink_dil = cv2.dilate(ink, np.ones((5, 5), np.uint8))
    have = [opening_polygon(o) for o in existing]
    out = []
    for g in find_gaps(walls, t, max_mult=80):
        if g.kind == "oblique" or g.dist < MIN_OPENING * t or walls[g.b].thickness > 3 * t:
            continue
        o = classify_gap(g, walls, ink, ink_dil)
        door, window = _icon_share(o, pred.icons, t)
        if max(door, window) < 0.35:
            continue
        op = opening_polygon(o)
        if any(op.intersection(h).area > 0.3 * min(op.area, h.area) for h in have):
            continue
        o.update(type="door" if door >= window else "window", confidence="high", source="ai",
                 hosts=[walls[g.a].id, walls[g.b].id], host_kind=g.kind, corner=g.corner)
        have.append(op)
        out.append(o)
    return out


def label_rooms(rooms: list[dict], labels: np.ndarray, pred: cc.AIPrediction) -> None:
    """Give rooms without a readable name the AI room class (majority vote inside the room)."""
    for k, r in enumerate(rooms, start=1):
        if r.get("name"):
            continue
        cls = pred.rooms[labels == k]
        cls = cls[(cls != cc.WALL) & (cls != 0) & (cls != cc.RAILING) & (cls != 11)]
        if cls.size < 50:
            continue
        top = int(np.bincount(cls, minlength=cc.N_ROOMS).argmax())
        if top in AI_ROOM_TYPE and (cls == top).mean() >= 0.5:
            r["type"] = AI_ROOM_TYPE[top]
            r["ai_name"] = AI_ROOM_NAME[top]


def cv_detection_or_none(dark: np.ndarray, text_boxes) -> WallDetection | None:
    from .walls import detect_walls  # noqa: PLC0415

    try:
        return detect_walls(dark, text_boxes)
    except ValueError:
        return None

