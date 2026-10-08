"""End-to-end floor plan reconstruction pipeline.

upload -> preprocessing -> wall / opening / room detection -> TopologyGuard -> ScaleLock -> result

Two geometry versions are always produced from the same parser output:
  * ``original``  – parser + basic post-processing (the controlled baseline)
  * ``corrected`` – the same, plus TopologyGuard corrections (used for 3D)
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import scalelock as sl
from . import fixes as fx
from . import topology as tg
from .ocr import TextItem, read_text
from .preprocess import PreparedImage, prepare
from .rooms import extract_rooms
from .structure import MAX_OPENING, detect_openings, find_gaps, opening_polygon, wall_polygon
from .walls import Wall, WallDetection, detect_walls

PARSER_ID = "opencv-structural-v1"


@dataclass
class GeometryVersion:
    walls: list[Wall]
    openings: list[dict]
    rooms: list[dict]
    labels: np.ndarray
    exterior: np.ndarray
    dangling: list
    endpoints_total: int
    endpoints_ok: int
    solids: list[dict]

    def stats(self) -> dict:
        return {
            "walls": len(self.walls),
            "exterior_walls": sum(1 for w in self.walls if w.exterior),
            "doors": sum(1 for o in self.openings if o["type"] == "door"),
            "windows": sum(1 for o in self.openings if o["type"] == "window"),
            "openings": len(self.openings),
            "rooms": len(self.rooms),
            "dangling_endpoints": len(self.dangling),
            "connected_endpoint_ratio": round(self.endpoints_ok / max(self.endpoints_total, 1), 4),
        }


@dataclass
class PlanInputs:
    """Configuration-independent stages (preprocessing, OCR, wall parsing), computed once per upload."""
    img: PreparedImage
    png: bytes
    texts: list[TextItem]
    ocr_ok: bool
    det: WallDetection
    timings: dict


@dataclass
class PlanSession:
    id: str
    filename: str
    image: PreparedImage
    png: bytes
    texts: list[TextItem]
    ocr_available: bool
    thickness: float
    wall_mask: np.ndarray
    original: GeometryVersion
    corrected: GeometryVersion
    issues: list[tg.Issue]
    measurements: list[dict]
    auto_scale: dict
    scale: dict
    warnings: list[str]
    timings: dict = field(default_factory=dict)
    edited: bool = False   # True once the user applied a geometry fix
    data: bytes = b""
    config: dict = field(default_factory=dict)
    auto_version: "GeometryVersion | None" = None   # automatic result, used for evaluation
    auto_issues: list = field(default_factory=list)
    auto_scale_initial: dict = field(default_factory=dict)
    fix_specs: dict = field(default_factory=dict)
    fix_log: list = field(default_factory=list)
    history: list = field(default_factory=list)
    created: float = field(default_factory=time.time)
    inputs: "PlanInputs | None" = None
    variants: dict = field(default_factory=dict)   # (topology_guard, scale_lock) -> saved state
    lock: threading.Lock = field(default_factory=threading.Lock)


# Everything that differs between pipeline configurations; switching swaps these as a unit.
VARIANT_FIELDS = ("original", "corrected", "issues", "measurements", "auto_scale", "scale", "warnings", "edited",
                  "config", "auto_version", "auto_issues", "auto_scale_initial", "fix_specs", "fix_log", "history")


def _mark_exterior(walls: list[Wall], exterior: np.ndarray, t: float) -> None:
    H, W = exterior.shape
    for w in walls:
        L = max(w.length, 1e-6)
        ux, uy = (w.x2 - w.x1) / L, (w.y2 - w.y1) / L
        nx, ny = -uy, ux
        off = w.thickness / 2 + max(3.0, 0.5 * t)
        ext = False
        for f in (0.15, 0.3, 0.5, 0.7, 0.85):
            px, py = w.x1 + (w.x2 - w.x1) * f, w.y1 + (w.y2 - w.y1) * f
            for s in (1, -1):
                xi, yi = int(round(px + nx * off * s)), int(round(py + ny * off * s))
                if not (0 <= xi < W and 0 <= yi < H) or exterior[yi, xi]:
                    ext = True
        w.exterior = ext


def _build_version(walls: list[Wall], solids: list[dict], openings: list[dict], shape, t: float,
                   texts: list[TextItem]) -> GeometryVersion:
    rooms, labels, exterior = extract_rooms(shape, walls, openings, solids, t, texts)
    _mark_exterior(walls, exterior, t)
    # Conservative classification: glazing-like gaps on purely interior walls are far more often
    # sliding doors, glazed partitions or door frames than windows, so they are not called windows.
    ext = {w.id for w in walls if w.exterior}
    for o in openings:
        if o["type"] == "window" and not any(h in ext for h in o["hosts"]):
            o["type"], o["confidence"] = "opening", "low"
    dangling, total, ok = tg.endpoint_report(walls, t, openings)
    return GeometryVersion(walls, openings, rooms, labels, exterior, dangling, total, ok, solids)


def _auto_scale(texts, version: GeometryVersion, img: PreparedImage, wall_mask, t: float):
    measurements = sl.collect_measurements(texts, version.rooms, version.labels, img.soft, wall_mask)
    cons = sl.consensus(measurements, _extent_px(version.walls))
    return measurements, {"scale": cons["scale"], "confidence": cons["confidence"], "accepted": cons["accepted"]}


def _scale_from(auto_scale: dict, version: GeometryVersion, t: float) -> dict:
    if auto_scale["scale"]:
        return {"status": "auto", "meters_per_px": auto_scale["scale"], "confidence": auto_scale["confidence"],
                "basis": f"{len(auto_scale['accepted'])} agreeing dimension label(s) read from the plan"}
    est = sl.estimate_fallback(version.openings, t)
    return {"status": "estimated", "meters_per_px": est["scale"], "confidence": None, "basis": est["basis"]}


def prepare_inputs(data: bytes) -> PlanInputs:
    timings = {}
    t0 = time.time()
    img = prepare(data)
    timings["preprocess"] = time.time() - t0
    t1 = time.time()
    texts, ocr_ok = read_text(img.rgb)
    timings["ocr"] = time.time() - t1
    text_boxes = [(int(tx.x), int(tx.y), int(tx.w), int(tx.h)) for tx in texts]
    t2 = time.time()
    det = detect_walls(img.dark, text_boxes)
    timings["walls"] = time.time() - t2
    ok, buf = cv2.imencode(".png", cv2.cvtColor(img.rgb, cv2.COLOR_RGB2BGR))
    return PlanInputs(img, buf.tobytes(), texts, ocr_ok, det, timings)


def process_plan(data: bytes, filename: str = "plan", topology_guard: bool = True,
                 scale_lock: bool = True, inputs: PlanInputs | None = None) -> PlanSession:
    """Run the reconstruction pipeline.

    ``topology_guard`` and ``scale_lock`` switch the two contributions on or off independently; the
    parser, preprocessing and OCR are identical in every configuration (used by the ablation study).
    Passing ``inputs`` reuses those shared stages instead of recomputing them.
    """
    if inputs is None:
        inputs = prepare_inputs(data)
    img, texts, det = inputs.img, inputs.texts, inputs.det
    timings = dict(inputs.timings)
    t = det.thickness
    shape = img.dark.shape
    warnings = list(img.warnings) + list(det.warnings)
    if not inputs.ocr_ok:
        warnings.append("Text recognition is unavailable, so room names and automatic scale could not be read.")

    # Baseline: parser output with its own opening detection, no TopologyGuard.
    t2 = time.time()
    raw = [w.copy() for w in det.walls]
    raw_openings = detect_openings(raw, find_gaps(raw, t, MAX_OPENING), t, img.soft)
    original = _build_version(raw, det.solids, raw_openings, shape, t, texts)
    timings["parse"] = time.time() - t2

    # TopologyGuard (automatic, conservative corrections).
    t3 = time.time()
    auto_issues: list[tg.Issue] = []
    if topology_guard:
        corr_walls, issues = tg.run_corrections(det.walls, t)
        openings = detect_openings(corr_walls, find_gaps(corr_walls, t, MAX_OPENING), t, img.soft)
        openings, op_issues = tg.validate_openings(corr_walls, openings, t)
        auto_issues = [i for i in issues + op_issues if i.status == "corrected"]
        corrected = _build_version(corr_walls, det.solids, openings, shape, t, texts)
    else:
        corrected = original
    timings["topologyguard"] = time.time() - t3

    # ScaleLock.
    t4 = time.time()
    if scale_lock:
        measurements, auto_scale = _auto_scale(texts, corrected, img, det.mask, t)
    else:
        measurements, auto_scale = [], {"scale": None, "confidence": None, "accepted": []}
    scale = _scale_from(auto_scale, corrected, t)
    if scale["status"] == "estimated":
        warnings.append("No reliable dimension labels were found. Dimensions are estimated; calibrate manually for accurate sizes.")
    timings["scalelock"] = time.time() - t4

    sess = PlanSession(id=uuid.uuid4().hex[:12], filename=filename, image=img, png=inputs.png, texts=texts,
                       ocr_available=inputs.ocr_ok, thickness=t, wall_mask=det.mask, original=original,
                       corrected=corrected, issues=[], measurements=measurements, auto_scale=auto_scale,
                       scale=scale, warnings=warnings, timings=timings)
    sess.data = data
    sess.inputs = inputs
    sess.config = {"topology_guard": topology_guard, "scale_lock": scale_lock}
    sess.auto_version = corrected
    sess.auto_issues = auto_issues
    sess.auto_scale_initial = dict(auto_scale)
    refresh_issues(sess)
    if not corrected.rooms:
        warnings.append("No enclosed rooms were found; the model shows walls only.")
    return sess


# ------------------------------------------------------------- pipeline configuration (live ablation)

CONFIG_KEYS = {(False, False): "baseline", (True, False): "topologyguard_only",
               (False, True): "scalelock_only", (True, True): "full"}


def _cfg_key(sess: PlanSession) -> tuple[bool, bool]:
    return bool(sess.config.get("topology_guard", True)), bool(sess.config.get("scale_lock", True))


def _variant_state(sess: PlanSession, key: tuple[bool, bool]) -> dict:
    """Saved state of a configuration, computing its automatic result on first use."""
    if key == _cfg_key(sess):
        return {f: getattr(sess, f) for f in VARIANT_FIELDS}
    if key not in sess.variants:
        fresh = process_plan(sess.data, sess.filename, key[0], key[1], inputs=sess.inputs)
        sess.variants[key] = {f: getattr(fresh, f) for f in VARIANT_FIELDS}
    return sess.variants[key]


def set_config(sess: PlanSession, topology_guard: bool, scale_lock: bool) -> None:
    """Switch the uploaded plan to another pipeline configuration.

    Each configuration keeps its own geometry, fixes, undo history and calibration, so switching back
    restores exactly what was there before.
    """
    new = (bool(topology_guard), bool(scale_lock))
    cur = _cfg_key(sess)
    if new == cur:
        return
    state = _variant_state(sess, new)
    sess.variants[cur] = {f: getattr(sess, f) for f in VARIANT_FIELDS}
    sess.variants.pop(new, None)
    for f, v in state.items():
        setattr(sess, f, v)


def _size_check(sess: PlanSession, version: GeometryVersion, scale: dict, measurements: list[dict],
                auto_scale: dict) -> dict:
    """Compare sizes measured with ``scale`` against the dimensions written on the plan.

    With automatic ScaleLock calibration each label is predicted from the others only (hold-out), so a
    label never grades itself. Otherwise the written labels are read for checking only.
    """
    s = scale["meters_per_px"]
    errs: list[float] = []
    if scale["status"] == "auto" and auto_scale.get("scale"):
        errs = [r["error_pct"] for r in sl.leave_one_out(measurements, auto_scale["accepted"])]
    else:
        ms = sl.collect_measurements(sess.texts, version.rooms, version.labels, sess.image.soft, sess.wall_mask)
        cons = sl.consensus(ms, _extent_px(version.walls))
        for mi in cons["accepted"]:
            m = ms[mi]
            for lab, p in zip(m["chosen"]["meters"], sorted(m["px"], reverse=True)):
                errs.append(abs(p * s - lab) / lab * 100)
    return {"size_error_pct": round(float(np.mean(errs)), 2) if errs else None, "size_checks": len(errs)}


def _summary(sess: PlanSession, version: GeometryVersion, scale: dict, measurements: list[dict],
             auto_scale: dict) -> dict:
    st = version.stats()
    return {"connected": st["connected_endpoint_ratio"], "open_ends": st["dangling_endpoints"],
            "rooms": st["rooms"], "walls": st["walls"], "doors": st["doors"], "windows": st["windows"],
            "scale_status": scale["status"], **_size_check(sess, version, scale, measurements, auto_scale)}


def compare_configs(sess: PlanSession) -> dict:
    """Measured indicators for this plan (no ground truth): the automatic output of all four
    configurations, plus the current state including the user's own fixes and calibration."""
    out = {}
    for key, name in CONFIG_KEYS.items():
        st = _variant_state(sess, key)
        v = st["auto_version"]
        auto = st["auto_scale_initial"]
        scale = _scale_from(auto, v, sess.thickness)
        out[name] = _summary(sess, v, scale, st["measurements"] if auto.get("scale") else [], auto)
    return _plain({"configs": out, "config": dict(sess.config), "config_key": CONFIG_KEYS[_cfg_key(sess)],
                   "current": _summary(sess, sess.corrected, sess.scale, sess.measurements, sess.auto_scale)})


# ------------------------------------------------------------- user fixes (Fix2Build, step 1)

def refresh_issues(sess: PlanSession) -> None:
    """Recompute the remaining (review) issues on the current geometry."""
    v = sess.corrected
    if sess.config.get("topology_guard", True):
        live, specs = fx.detect_review_issues(v.walls, v.openings, sess.thickness, sess.image.soft,
                                              v.labels, v.exterior, v.rooms)
    else:
        live, specs = [], {}
    sess.fix_specs = specs
    fixed = [tg.Issue(f["check"], "fixed", f["message"], f["at"], f["walls"], "info") for f in sess.fix_log]
    sess.issues = list(sess.auto_issues) + fixed + live


def _rebuild(sess: PlanSession, walls: list[Wall]) -> GeometryVersion:
    t = sess.thickness
    img = sess.image
    openings = detect_openings(walls, find_gaps(walls, t, MAX_OPENING), t, img.soft)
    if sess.config.get("topology_guard", True):
        openings, _ = tg.validate_openings(walls, openings, t)
    return _build_version(walls, sess.corrected.solids, openings, img.dark.shape, t, sess.texts)


def _commit(sess: PlanSession, version: GeometryVersion, log: dict) -> None:
    """Make ``version`` the current geometry, keeping an undo snapshot and refreshing scale and checks."""
    sess.history.append((sess.corrected, list(sess.fix_log), sess.measurements, dict(sess.auto_scale), dict(sess.scale)))
    del sess.history[:-20]
    sess.corrected = version
    if sess.config.get("scale_lock", True):
        sess.measurements, sess.auto_scale = _auto_scale(sess.texts, sess.corrected, sess.image, sess.wall_mask,
                                                         sess.thickness)
    if sess.scale["status"] != "manual":
        sess.scale = _scale_from(sess.auto_scale, sess.corrected, sess.thickness)
    sess.fix_log.append(log)
    sess.edited = True
    refresh_issues(sess)


def apply_user_fix(sess: PlanSession, key: str) -> dict:
    """Apply the fix attached to a review issue. Returns a short report."""
    issue = next((i for i in sess.issues if i.key == key and i.status == "review"), None)
    spec = sess.fix_specs.get(key)
    if issue is None or spec is None:
        raise KeyError("This issue has no safe fix available (it may already be resolved).")
    new_walls = fx.apply_fix(sess.corrected.walls, spec)
    label = fx.FIX_LABEL[spec["kind"]]
    _commit(sess, _rebuild(sess, new_walls),
            {"check": issue.check, "message": f"{label}: {issue.message.split(' Manual')[0]}",
             "at": issue.at, "walls": issue.walls, "kind": spec["kind"]})
    still = any(i.key == key and i.status == "review" for i in sess.issues)
    return {"applied": label, "resolved": not still}


# ------------------------------------------------------------- manual wall-end editing

def _snap_end(walls: list[Wall], w: Wall, x: float, y: float, t: float) -> tuple[float, float, str | None]:
    """Snap a dragged wall end to the nearest wall end or wall centre line within reach.

    Straight (horizontal / vertical) walls stay straight: the end only moves along the wall's axis.
    """
    reach = max(2.0 * t, 10.0)
    best = (reach, x, y, None)
    for v in walls:
        if v.id == w.id:
            continue
        cands = [((v.x1 + 0.0, v.y1 + 0.0), "wall end"), ((v.x2 + 0.0, v.y2 + 0.0), "wall end")]
        # Closest point on the other wall's centre line (T-junction or corner).
        dx, dy = v.x2 - v.x1, v.y2 - v.y1
        L2 = dx * dx + dy * dy
        if L2 > 0:
            if w.orient == "h" and v.orient == "v":
                k = (y - v.y1) / dy if dy else -1
                if -0.02 <= k <= 1.02:
                    cands.append(((v.x1 + dx * k, y), "wall"))
            elif w.orient == "v" and v.orient == "h":
                k = (x - v.x1) / dx if dx else -1
                if -0.02 <= k <= 1.02:
                    cands.append(((x, v.y1 + dy * k), "wall"))
            elif w.orient == "d":
                k = max(0.0, min(1.0, ((x - v.x1) * dx + (y - v.y1) * dy) / L2))
                cands.append(((v.x1 + dx * k, v.y1 + dy * k), "wall"))
        for (cx, cy), kind in cands:
            if w.orient == "h":
                if abs(cy - y) > max(t, v.thickness):
                    continue
                cy = y
            elif w.orient == "v":
                if abs(cx - x) > max(t, v.thickness):
                    continue
                cx = x
            d = float(np.hypot(cx - x, cy - y))
            if d < best[0]:
                best = (d, cx, cy, kind)
    return best[1], best[2], best[3]


def _lost_openings(before: list[dict], after: list[dict], t: float) -> list[dict]:
    """Openings from ``before`` that no longer exist at the same place in ``after``."""
    lost = []
    for o in before:
        cx, cy = (o["x1"] + o["x2"]) / 2, (o["y1"] + o["y2"]) / 2
        tol = max(t, 0.35 * o["width"])
        if not any(np.hypot((n["x1"] + n["x2"]) / 2 - cx, (n["y1"] + n["y2"]) / 2 - cy) <= tol for n in after):
            lost.append(o)
    return lost


OPENING_NAME = {"door": "door", "window": "window", "opening": "opening"}


def edit_wall_end(sess: PlanSession, wall_id: str, end: int, x: float, y: float, dry_run: bool = False) -> dict:
    """Move one end of a wall (with snapping). Rejects edits that would cover or remove a door, window
    or other opening, collapse the wall, or leave the drawing. ``dry_run`` only validates."""
    walls = sess.corrected.walls
    w = next((v for v in walls if v.id == wall_id), None)
    if w is None:
        raise KeyError("That wall no longer exists.")
    if end not in (0, 1):
        raise ValueError("Unknown wall end.")
    t = sess.thickness
    H, W = sess.image.dark.shape
    x, y = float(min(max(x, 0.0), W - 1.0)), float(min(max(y, 0.0), H - 1.0))
    if w.orient == "h":
        y = w.y1 if end == 0 else w.y2
    elif w.orient == "v":
        x = w.x1 if end == 0 else w.x2
    x, y, snapped = _snap_end(walls, w, x, y, t)

    new = [v.copy() for v in walls]
    nw = next(v for v in new if v.id == wall_id)
    if end == 0:
        nw.x1, nw.y1 = x, y
    else:
        nw.x2, nw.y2 = x, y
    nw.source = "edited"
    ox, oy = w.x2 - w.x1, w.y2 - w.y1
    nx, ny = nw.x2 - nw.x1, nw.y2 - nw.y1

    reason = None
    if nw.length < max(1.5 * t, 6.0):
        reason = "The wall would be too short."
    elif w.orient in "hv" and ox * nx + oy * ny <= 0:
        reason = "The wall would flip direction."
    else:
        added = wall_polygon(nw).difference(wall_polygon(w))
        for o in sess.corrected.openings:
            op = opening_polygon(o)
            if added.intersection(op).area > 0.15 * op.area:
                reason = f"This would block a {OPENING_NAME[o['type']]}."
                break
    version = None
    if reason is None:
        version = _rebuild(sess, new)
        lost = _lost_openings(sess.corrected.openings, version.openings, t)
        if lost:
            reason = f"This would remove a {OPENING_NAME[lost[0]['type']]}."
    out = {"ok": reason is None, "reason": reason, "snapped": snapped,
           "before": w.to_dict(), "after": nw.to_dict()}
    if version is not None:
        out["rooms_after"] = len(version.rooms)
    out = _plain(out)
    if dry_run or reason:
        return out
    _commit(sess, version, {"check": "manual", "message": "Wall end moved by hand", "at": [x, y],
                            "walls": [wall_id], "kind": "manual"})
    return out


def undo_user_fix(sess: PlanSession) -> None:
    if not sess.history:
        raise KeyError("There is nothing to undo.")
    sess.corrected, sess.fix_log, sess.measurements, sess.auto_scale, scale = sess.history.pop()
    if sess.scale["status"] != "manual":
        sess.scale = scale
    sess.edited = bool(sess.fix_log)
    refresh_issues(sess)


def _extent_px(walls: list[Wall]) -> float:
    xs = [v for w in walls for v in (w.x1, w.x2)]
    ys = [v for w in walls for v in (w.y1, w.y2)]
    return float(max(max(xs) - min(xs), max(ys) - min(ys))) if xs else 0.0


def apply_manual_scale(sess: PlanSession, p1, p2, meters: float) -> None:
    s = sl.manual_scale(p1, p2, meters)
    sess.scale = {"status": "manual", "meters_per_px": s, "confidence": None,
                  "basis": f"two points {np.hypot(p2[0]-p1[0], p2[1]-p1[1]):.0f}px apart set to {meters:.3f} m",
                  "points": [p1, p2], "meters": meters}


def reset_scale(sess: PlanSession) -> None:
    sess.scale = _scale_from(sess.auto_scale, sess.corrected, sess.thickness)


def _scale_checks(sess: PlanSession) -> tuple[list[dict], list[str]]:
    """Written-vs-predicted label comparison for the CURRENT calibration method, plus warnings."""
    s = sess.scale["meters_per_px"]
    status = sess.scale["status"]
    rows: list[dict] = []
    if status == "auto":
        rows = [{**r, "method": "automatic"} for r in sl.leave_one_out(sess.measurements, sess.auto_scale["accepted"])]
    elif status == "manual":
        for m in sess.measurements:
            if "chosen" not in m:
                continue
            for lab, p in zip(m["chosen"]["meters"], sorted(m["px"], reverse=True)):
                pred = p * s
                rows.append({"text": m["text"], "labelled_m": round(lab, 3), "predicted_m": round(pred, 3),
                             "error_pct": round(abs(pred - lab) / lab * 100, 2), "method": "manual"})
    warns = []
    th = sess.thickness * s
    if not (0.05 <= th <= 0.6):
        warns.append(f"The resulting wall thickness ({th:.2f} m) is unrealistic; check the calibration.")
    ext = _extent_px(sess.corrected.walls) * s
    if ext > 150 or ext < 3:
        warns.append(f"The resulting building size ({ext:.1f} m across) is implausible for a floor plan.")
    if status == "manual":
        p1, p2 = sess.scale["points"]
        px = float(np.hypot(p2[0] - p1[0], p2[1] - p1[1]))
        if px < 60:
            warns.append("The two reference points are very close together; small click errors cause large scale errors.")
        if sess.scale["meters"] < 0.5:
            warns.append("The reference distance is very short; use a full wall length for a more accurate scale.")
    return rows, warns


# ---------------------------------------------------------------- serialisation

def _room_out(r: dict, s: float) -> dict:
    out = {k: r[k] for k in ("id", "name", "type", "polygon", "centroid", "rectangularity", "label_texts")}
    out["name"] = r["name"] or f"Room {r['id'][1:]}"
    out["named"] = r["name"] is not None
    out["area_m2"] = round(r["area_px"] * s * s, 2)
    out["length_m"] = round(r["rect_px"][0] * s, 2)
    out["width_m"] = round(r["rect_px"][1] * s, 2)
    out["label_dims"] = r["label_dims"]["text"] if r["label_dims"] else None
    return out


def _version_out(v: GeometryVersion, s: float) -> dict:
    return {
        "walls": [w.to_dict() for w in v.walls],
        "openings": [{k: o[k] for k in ("id", "type", "confidence", "x1", "y1", "x2", "y2", "width", "thickness", "hosts")}
                     for o in v.openings],
        "rooms": [_room_out(r, s) for r in v.rooms],
        "solids": v.solids,
        "dangling": [[round(x, 1), round(y, 1)] for (_, _, x, y) in v.dangling],
        "stats": v.stats(),
    }


def _plain(o):
    if isinstance(o, dict):
        return {k: _plain(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_plain(v) for v in o]
    if isinstance(o, np.generic):
        return o.item()
    return o


def session_result(sess: PlanSession) -> dict:
    return _plain(_session_result(sess))


def _session_result(sess: PlanSession) -> dict:
    s = sess.scale["meters_per_px"]
    H, W = sess.image.dark.shape
    issues = [i.to_dict(k + 1) for k, i in enumerate(sess.issues)]
    measurements = []
    for m in sess.measurements:
        measurements.append({
            "text": m["text"], "kind": m["kind"], "bbox": m["bbox"], "status": m["status"], "reason": m["reason"],
            "room": m["room"], "line": m["line"],
            "meters": m.get("chosen", {}).get("meters"),
            "unit": m.get("chosen", {}).get("unit"),
            "scale": m.get("chosen", {}).get("scale"),
        })
    loo, scale_warnings = _scale_checks(sess)
    return {
        "id": sess.id,
        "filename": sess.filename,
        "image": {"width": W, "height": H, "url": f"/api/plans/{sess.id}/image"},
        "wall_thickness_px": round(sess.thickness, 2),
        "scale": {**{k: v for k, v in sess.scale.items()}, "meters_per_px": s,
                  "wall_thickness_m": round(sess.thickness * s, 3),
                  "extent_m": [round(W * s, 2), round(H * s, 2)],
                  "auto_available": bool(sess.auto_scale["scale"]),
                  "auto_meters_per_px": sess.auto_scale["scale"],
                  "measurements": measurements, "holdout": loo, "warnings": scale_warnings,
                  "assumptions": {"wall_height_m": sl.DEFAULT_WALL_HEIGHT_M, "door_height_m": sl.DEFAULT_DOOR_HEIGHT_M,
                                  "window_sill_m": sl.DEFAULT_SILL_M, "window_head_m": sl.DEFAULT_HEAD_M}},
        "geometry": {"original": _version_out(sess.original, s), "corrected": _version_out(sess.corrected, s)},
        "topology": {"checks": tg.summarise(sess.issues), "issues": issues,
                     "corrected": sum(1 for i in sess.issues if i.status == "corrected"),
                     "fixed": sum(1 for i in sess.issues if i.status == "fixed"),
                     "review": sum(1 for i in sess.issues if i.status == "review"),
                     "fixable": sum(1 for i in sess.issues if i.status == "review" and i.fix),
                     "can_undo": bool(sess.history), "edited": sess.edited},
        "texts": [t.to_dict() for t in sess.texts],
        "config": dict(sess.config),
        "warnings": [w for w in sess.warnings
                     if not (sess.scale["status"] != "estimated" and w.startswith("No reliable dimension labels"))],
        "ocr_available": sess.ocr_available,
    }
