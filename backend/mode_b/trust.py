"""VisionTrust (evidence classes + room completion) and GeometryTrust (confidence) on the room layout.

Each surface of the room (floor, ceiling, four walls) is divided into cells. For every cell:
  points   sparse 3D points within the plane tolerance inside the cell (reconstruction evidence)
  views    frames that observed those points (their SfM tracks): the supporting frames
  visible  frames whose field of view contains the cell centre at a usable viewing angle
  rmse     distance of the cell's points to the plane

Classes (VisionTrust):
  OBSERVED   points >= 3 seen in >= 3 different frames, within the plane tolerance (multi-view consistent)
  UNCERTAIN  inside at least one frame's view but without that evidence (textureless, sparse, inconsistent)
  GENERATED  inside no frame's view at all: geometry inferred from the architectural constraints below

Completion (``completion=True``, VisionTrust): the room is closed as an axis-aligned (Manhattan) box: walls are
vertical planes extended floor-to-ceiling and to their intersections, floor and ceiling are continuous horizontal
planes, and a wall/ceiling without any point layer is placed at the bound recorded in the layout (the farthest /
highest observed point), never at an invented size. ``completion=False`` (baseline A) keeps only cells that
contain reconstructed points on planes that have evidence.

GeometryTrust score (0..1, a documented heuristic, NOT a calibrated probability):
  observed / uncertain cells: 0.30 f_views + 0.20 f_points + 0.20 f_residual + 0.15 f_pose + 0.15 f_visibility
     f_views = 1 - exp(-views/4)        f_points = 1 - exp(-points/6)      f_residual = exp(-(rmse/tau)^2) (0 if none)
     f_pose  = mean exp(-err/1.5px) over the supporting frames' reprojection errors
     f_visibility = 1 - exp(-visible/5)
  generated cells: 0.15 when the plane's position is measured (only its extent is inferred), 0.05 when the
     position itself is a bound.
"""
from __future__ import annotations

import numpy as np

from .layout import Layout

CONF_METHOD = {
    "name": "GeometryTrust v1",
    "formula": "0.30*f_views + 0.20*f_points + 0.20*f_residual + 0.15*f_pose + 0.15*f_visibility",
    "terms": {
        "f_views": "1 - exp(-supporting_frames / 4)",
        "f_points": "1 - exp(-points / 6)",
        "f_residual": "exp(-(plane_rmse / tau)^2), 0 without points",
        "f_pose": "mean of exp(-reprojection_error_px / 1.5) over supporting frames",
        "f_visibility": "1 - exp(-frames_seeing_the_cell / 5)",
        "generated": "0.15 if the plane position is measured, 0.05 if it is a bound",
    },
    "calibrated": False,
    "note": "A relative evidence score for ranking and display; it is not a probability of being correct.",
}
INWARD = {"floor": (1, 1), "ceiling": (1, -1), "wall-x+": (0, -1), "wall-x-": (0, 1), "wall-z+": (2, -1), "wall-z-": (2, 1)}


def _rect(sid: str, box: dict):
    """Corners (u0v0, u1v0, u1v1, u0v1), u axis, v axis of a surface of the room box."""
    (x0, x1), (y0, y1), (z0, z1) = box["x"], box["y"], box["z"]
    if sid in ("floor", "ceiling"):
        y = y0 if sid == "floor" else y1
        o, u, v = np.array([x0, y, z0]), np.array([x1 - x0, 0, 0]), np.array([0, 0, z1 - z0])
    elif sid.startswith("wall-x"):
        x = x1 if sid == "wall-x+" else x0
        o, u, v = np.array([x, y0, z0]), np.array([0, 0, z1 - z0]), np.array([0, y1 - y0, 0])
    else:
        z = z1 if sid == "wall-z+" else z0
        o, u, v = np.array([x0, y0, z]), np.array([x1 - x0, 0, 0]), np.array([0, y1 - y0, 0])
    return o, u, v


def visibility_from(C: np.ndarray, R: np.ndarray, f: float, w: int, h: int, X: np.ndarray, normal,
                    near: float, cx: float | None = None, cy: float | None = None, max_angle: float = 80.0) -> np.ndarray:
    """(n_cameras, n_points) bool: point in front of the camera (beyond ``near``), inside its image (2 % margin)
    and seen at less than ``max_angle`` from the surface normal (pinhole model, distortion ignored)."""
    cx = w / 2 if cx is None else cx
    cy = h / 2 if cy is None else cy
    D = X[None, :, :] - C[:, None, :]                               # camera -> point
    Xc = np.einsum("cij,cnj->cni", R, D)
    z = Xc[..., 2]
    front = z > near
    zs = np.where(front, z, 1.0)
    u = f * Xc[..., 0] / zs + cx
    v = f * Xc[..., 1] / zs + cy
    inside = (u > 0.02 * w) & (u < 0.98 * w) & (v > 0.02 * h) & (v < 0.98 * h)
    dist = np.linalg.norm(D, axis=2)
    cosang = -(D @ np.asarray(normal, float)) / np.maximum(dist, 1e-9)
    return front & inside & (cosang > np.cos(np.radians(max_angle)))


def visibility(lay: Layout, X: np.ndarray, normal: np.ndarray) -> np.ndarray:
    """Which recorded frames see each point (see ``visibility_from``)."""
    S = lay.sfm
    p = S.intrinsics["params"]
    w, h = S.intrinsics["width"], S.intrinsics["height"]
    cx, cy = (p[1], p[2]) if len(p) >= 3 else (w / 2, h / 2)
    return visibility_from(S.centers, S.rotations, S.focal(), w, h, X, normal, 0.02 * lay.scale_ref, cx, cy)


def build_surfaces(lay: Layout, completion: bool, cell_target: int = 12) -> list[dict]:
    S = lay.sfm
    P = S.points[lay.keep]
    tracks = [S.tracks[i] for i in np.flatnonzero(lay.keep)]
    img_err = np.nan_to_num(S.image_errors, nan=3.0)
    box = lay.box()
    size = max(np.ptp(box["x"]), np.ptp(box["y"]), np.ptp(box["z"]))
    cs = size / cell_target
    # Each point is evidence for at most one surface: the nearest plane of the room box (so the top of a wall
    # is not counted as ceiling evidence, nor a corner twice).
    ids = [sid for sid in INWARD if sid in lay.planes]
    dist = np.stack([np.abs(P[:, lay.planes[sid].axis] - lay.planes[sid].offset) for sid in ids], axis=1)
    nearest = np.array(ids)[np.argmin(dist, axis=1)] if len(P) else np.array([])
    surfaces = []
    for sid, (axis, nsign) in INWARD.items():
        plane = lay.planes.get(sid)
        if plane is None:
            continue
        has_ev = plane.evidence is not None
        if not completion and not has_ev:
            continue
        if not lay.reliable and not has_ev:
            continue
        o, u, v = _rect(sid, box)
        lu, lv = np.linalg.norm(u), np.linalg.norm(v)
        nu, nv = int(np.clip(round(lu / cs), 2, 24)), int(np.clip(round(lv / cs), 2, 24))
        normal = np.zeros(3)
        normal[axis] = nsign
        tol = max(lay.tau, 2 * (plane.evidence or {}).get("rmse") or 0) if has_ev else lay.tau
        # Points on this plane, binned into cells.
        d = P[:, axis] - plane.offset
        a = (P - o) @ (u / lu ** 2)
        b = (P - o) @ (v / lv ** 2)
        on = (np.abs(d) < tol) & (a >= -0.02) & (a <= 1.02) & (b >= -0.02) & (b <= 1.02) & (nearest == sid)
        iu = np.clip((a[on] * nu).astype(int), 0, nu - 1)
        iv = np.clip((b[on] * nv).astype(int), 0, nv - 1)
        idx_on = np.flatnonzero(on)
        n_pts = np.zeros((nu, nv), int)
        sq = np.zeros((nu, nv))
        views = [[set() for _ in range(nv)] for _ in range(nu)]
        for k, (i, j) in enumerate(zip(iu, iv)):
            n_pts[i, j] += 1
            sq[i, j] += d[idx_on[k]] ** 2
            views[i][j].update(tracks[idx_on[k]].tolist())
        centers = np.array([o + (i + 0.5) / nu * u + (j + 0.5) / nv * v for i in range(nu) for j in range(nv)])
        vis = visibility(lay, centers, normal) if len(S.centers) else np.zeros((0, len(centers)), bool)
        cells = []
        area = lu * lv / (nu * nv)
        for k, (i, j) in enumerate((i, j) for i in range(nu) for j in range(nv)):
            npt, vw = int(n_pts[i, j]), views[i][j]
            seen = np.flatnonzero(vis[:, k])
            rmse = float(np.sqrt(sq[i, j] / npt)) if npt else None
            if npt >= 3 and len(vw) >= 3 and rmse <= tol:
                cls = "observed"
            elif len(seen) > 0 or npt > 0:
                cls = "uncertain"
            else:
                cls = "generated"
            if not completion and npt == 0:
                continue
            if cls == "generated":
                conf = 0.15 if has_ev else 0.05
            else:
                f_views = 1 - np.exp(-len(vw) / 4)
                f_points = 1 - np.exp(-npt / 6)
                f_res = float(np.exp(-(rmse / lay.tau) ** 2)) if rmse is not None else 0.0
                f_pose = float(np.mean(np.exp(-img_err[sorted(vw)] / 1.5))) if vw else 0.0
                f_vis = 1 - np.exp(-len(seen) / 5)
                conf = 0.30 * f_views + 0.20 * f_points + 0.20 * f_res + 0.15 * f_pose + 0.15 * f_vis
            frames = sorted(vw) if vw else seen.tolist()
            cells.append({"i": i, "j": j, "cls": cls, "area": round(area, 5), "points": npt, "views": len(vw),
                          "visible": int(len(seen)), "rmse": None if rmse is None else round(rmse, 5),
                          "confidence": round(float(conf), 3),
                          "frames": [S.names[f] for f in frames[:16]]})
        if not cells:
            continue
        share = {c: sum(x["area"] for x in cells if x["cls"] == c) for c in ("observed", "uncertain", "generated")}
        tot = sum(share.values()) or 1.0
        share = {k: round(v / tot, 4) for k, v in share.items()}
        if share["observed"] >= 0.5:
            cls = "observed"
        elif share["generated"] >= 0.5 or (not has_ev and share["observed"] == 0):
            cls = "generated"
        else:
            cls = "uncertain"
        assumptions = []
        if has_ev:
            method = (f"Plane fitted to {plane.evidence['points']} reconstructed points seen in "
                      f"{plane.evidence['views']} frames (residual {plane.evidence['rmse']:.4f} u)")
            if share["observed"] < 1:
                assumptions.append("Planarity: the measured plane is extended across cells without point evidence.")
        else:
            method = "Completion: no point evidence for this surface"
            assumptions.append(plane.bound_reason)
        if plane.kind == "wall" and completion:
            assumptions.append("Vertical wall from floor to ceiling, meeting the neighbouring walls at right angles "
                               "(Manhattan world, closed room boundary).")
        if plane.kind in ("floor", "ceiling") and completion:
            assumptions.append(f"Continuous horizontal {plane.kind} bounded by the walls.")
        support_frames = set()
        for c in cells:
            support_frames.update(c["frames"]) if c["views"] else None
        surfaces.append({
            "id": sid, "kind": plane.kind, "class": cls, "method": method, "measured": has_ev,
            "corners": [(o).round(5).tolist(), (o + u).round(5).tolist(), (o + u + v).round(5).tolist(), (o + v).round(5).tolist()],
            "normal": normal.tolist(), "size": [round(float(lu), 5), round(float(lv), 5)], "grid": [nu, nv],
            "cells": cells, "shares": share, "evidence": plane.evidence, "assumptions": assumptions,
            "confidence": round(float(sum(c["confidence"] * c["area"] for c in cells) / sum(c["area"] for c in cells)), 3),
            "supporting_frames": len(support_frames),
        })
    return surfaces


def summary(surfaces: list[dict]) -> dict:
    area = {"observed": 0.0, "uncertain": 0.0, "generated": 0.0}
    seen = 0.0
    for s in surfaces:
        for c in s["cells"]:
            area[c["cls"]] += c["area"]
            seen += c["area"] if c["visible"] > 0 else 0.0
    tot = sum(area.values())
    low = sorted(({"surface": s["id"], "i": c["i"], "j": c["j"], "confidence": c["confidence"], "cls": c["cls"]}
                  for s in surfaces for c in s["cells"] if c["cls"] != "generated"), key=lambda c: c["confidence"])[:10]
    return {"area_total": round(tot, 4),
            "shares": {k: round(v / tot, 4) if tot else 0.0 for k, v in area.items()},
            "seen_share": round(seen / tot, 4) if tot else 0.0,
            "mean_confidence": round(float(np.average([c["confidence"] for s in surfaces for c in s["cells"]],
                                                      weights=[c["area"] for s in surfaces for c in s["cells"]])), 3) if tot else None,
            "lowest_confidence": low}
