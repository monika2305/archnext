"""NextBestView: where to record next to reduce reconstruction uncertainty.

Targets are the cells VisionTrust could not confirm: GENERATED cells (weight 1) and UNCERTAIN cells (weight
0.5 x (1 - confidence)), each weighted by its area. Candidate viewpoints are sampled inside the room (a grid of
positions at the recorded camera height, 12 headings, 3 pitches) with the same camera intrinsics as the video.
A candidate is rejected when it is too close to a wall or inside occupied space (reconstructed points within
reach at body height: furniture). Each valid candidate's gain is the weighted target area inside its field of
view (same visibility test as VisionTrust). The best candidates are returned with the regions they would cover.

When the layout itself is mostly inferred (fewer than three walls with evidence or more than half the room
generated), a precise position would be falsely precise: only a viewing direction from the recorded camera path
is recommended.
"""
from __future__ import annotations

import numpy as np

from .layout import Layout
from .trust import _rect, visibility_from

YAWS = np.radians(np.arange(0, 360, 30))
PITCHES = np.radians([0.0, -25.0, 25.0])


def look_rotation(yaw: float, pitch: float) -> np.ndarray:
    """World -> camera rotation for a camera at heading ``yaw`` (around +y, 0 = +z) and ``pitch`` (up > 0).
    Camera axes follow COLMAP: x right, y down, z forward."""
    fwd = np.array([np.sin(yaw) * np.cos(pitch), np.sin(pitch), np.cos(yaw) * np.cos(pitch)])
    right = np.cross(fwd, [0.0, 1.0, 0.0])
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    return np.stack([right, down, fwd])


def _wall_names(lay: Layout) -> dict:
    """Name walls relative to the first recorded view: the far wall is the one the video started facing."""
    f0 = lay.sfm.rotations[0, 2].copy()
    f0[1] = 0
    f0 /= max(np.linalg.norm(f0), 1e-9)
    r0 = np.cross(f0, [0, 1.0, 0])                     # camera right when level
    names = {}
    outward = {"wall-x+": [1, 0, 0], "wall-x-": [-1, 0, 0], "wall-z+": [0, 0, 1], "wall-z-": [0, 0, -1]}
    for sid, n in outward.items():
        n = np.array(n, float)
        a, b = n @ f0, n @ (-r0)
        if abs(a) >= abs(b):
            names[sid] = "the wall ahead of the starting view" if a > 0 else "the wall behind the starting position"
        else:
            names[sid] = "the wall to the left of the starting view" if b > 0 else "the wall to the right of the starting view"
    names["floor"], names["ceiling"] = "the floor", "the ceiling"
    return names


def _cell_centers(surface: dict, box: dict):
    o, u, v = _rect(surface["id"], box)
    nu, nv = surface["grid"]
    return {(c["i"], c["j"]): o + (c["i"] + 0.5) / nu * u + (c["j"] + 0.5) / nv * v for c in surface["cells"]}


def recommend(lay: Layout, surfaces: list[dict], top: int = 3) -> dict:
    if not lay.reliable or not surfaces:
        return {"mode": "unavailable", "reason": "The room layout is not reliable enough to plan new views.",
                "recommendations": []}
    box = lay.box()
    names = _wall_names(lay)
    S = lay.sfm
    # Targets
    X, N, W, A, ref = [], [], [], [], []
    for s in surfaces:
        cc = _cell_centers(s, box)
        for c in s["cells"]:
            w = 1.0 if c["cls"] == "generated" else 0.5 * (1 - c["confidence"]) if c["cls"] == "uncertain" else 0.0
            if w > 0:
                X.append(cc[(c["i"], c["j"])])
                N.append(s["normal"])
                W.append(w * c["area"])
                A.append(c["area"])
                ref.append((s["id"], c["i"], c["j"], c["cls"]))
    total_area = sum(c["area"] for s in surfaces for c in s["cells"])
    if not X:
        return {"mode": "complete", "reason": "Every part of the room shell is observed; no further views are needed.",
                "recommendations": []}
    X, N, W, A = np.array(X), np.array(N, float), np.array(W), np.array(A)
    total_w = float(W.sum())

    # Candidate positions: a grid inside the room at the recorded camera height, away from walls and obstacles.
    (x0, x1), (y0, y1), (z0, z1) = box["x"], box["y"], box["z"]
    margin = max(0.12 * min(x1 - x0, z1 - z0), 2 * lay.tau)
    cam_h = float(np.median(S.centers[:, 1]))
    xs = np.linspace(x0 + margin, x1 - margin, 7) if x1 - x0 > 2 * margin else np.array([(x0 + x1) / 2])
    zs = np.linspace(z0 + margin, z1 - margin, 7) if z1 - z0 > 2 * margin else np.array([(z0 + z1) / 2])
    P = S.points[lay.keep]
    band = P[(P[:, 1] > y0 + 0.15 * (cam_h - y0)) & (P[:, 1] < cam_h + 0.1 * (y1 - y0))]
    reach = 0.06 * lay.scale_ref
    positions, rejected = [], {"near_wall": 0, "obstacle": 0}
    for x in xs:
        for z in zs:
            if len(band) and np.min(np.hypot(band[:, 0] - x, band[:, 2] - z)) < reach:
                rejected["obstacle"] += 1
                continue
            positions.append([x, cam_h, z])
    if not positions:
        return {"mode": "unavailable", "reason": "No free position inside the room could be found for a new view.",
                "recommendations": [], "rejected": rejected}
    positions = np.array(positions)

    f = S.focal()
    w, h = S.intrinsics["width"], S.intrinsics["height"]
    poses = [(p, yaw, pitch) for p in positions for yaw in YAWS for pitch in PITCHES]
    C = np.array([p for p, _, _ in poses])
    R = np.array([look_rotation(yaw, pitch) for _, yaw, pitch in poses])
    gains = np.zeros(len(poses))
    vis_all = np.zeros((len(poses), len(X)), bool)
    for n in np.unique(N, axis=0):
        sel = np.all(N == n, axis=1)
        vis = visibility_from(C, R, f, w, h, X[sel], n, near=0.02 * lay.scale_ref)
        vis_all[:, sel] = vis
    gains = vis_all.astype(float) @ W

    # Layout precision: is a precise position meaningful?
    measured_walls = sum(1 for p in lay.planes.values() if p.kind == "wall" and p.evidence)
    gen_share = sum(c["area"] for s in surfaces for c in s["cells"] if c["cls"] == "generated") / max(total_area, 1e-9)
    precise = measured_walls >= 3 and gen_share <= 0.5

    order = np.argsort(-gains)
    picks = []
    for k in order:
        if gains[k] <= 0 or len(picks) >= top:
            break
        p, yaw, pitch = poses[k]
        if any(np.linalg.norm(p - q["_p"]) < 0.2 * lay.scale_ref and abs(((yaw - q["_yaw"] + np.pi) % (2 * np.pi)) - np.pi) < np.radians(60)
               for q in picks):
            continue
        seen = vis_all[k]
        cover = {}
        for (sid, i, j, cls), s_ok, a in zip(ref, seen, A):
            if s_ok:
                cv = cover.setdefault(sid, {"surface": sid, "name": names.get(sid, sid), "cells": 0, "area": 0.0,
                                            "generated": 0, "uncertain": 0})
                cv["cells"] += 1
                cv["area"] += float(a)
                cv[cls] += 1
        covered = sorted(cover.values(), key=lambda c: -c["area"])
        picks.append({"_p": p, "_yaw": yaw, "rank": len(picks) + 1, "position": np.round(p, 4).tolist(),
                      "forward": np.round(R[k][2], 4).tolist(), "yaw_deg": round(float(np.degrees(yaw)), 1),
                      "pitch_deg": round(float(np.degrees(pitch)), 1), "expected_gain": round(float(gains[k]), 5),
                      "gain_share": round(float(gains[k] / total_w), 4),
                      "newly_seen_share": round(float(A[seen].sum() / total_area), 4),
                      "covers": [{**c, "area": round(c["area"], 5)} for c in covered],
                      "text": _describe(covered, p, R[k][2], box, names, precise, A[seen].sum() / total_area)})
    for q in picks:
        q.pop("_p"), q.pop("_yaw")
    return {"mode": "position" if precise else "direction", "precise": precise,
            "reason": None if precise else ("Most of the room shell is inferred, so the recommended position is only "
                                            "approximate: follow the viewing direction."),
            "targets": {"cells": int(len(X)), "area_share": round(float(A.sum() / total_area), 4)},
            "candidates_evaluated": int(len(poses)), "positions_valid": int(len(positions)), "rejected": rejected,
            "recommendations": picks,
            "method": "Visibility of generated / uncertain cells from sampled viewpoints (VisionTrust visibility test)"}


def _describe(covered, p, fwd, box, names, precise, share) -> str:
    main = covered[0]["name"] if covered else "the room"
    also = f" and {covered[1]['name']}" if len(covered) > 1 else ""
    kinds = []
    if sum(c["generated"] for c in covered):
        kinds.append("never seen")
    if sum(c["uncertain"] for c in covered):
        kinds.append("weakly observed")
    what = " and ".join(kinds) or "uncertain"
    pitch = "slightly downwards" if fwd[1] < -0.2 else "slightly upwards" if fwd[1] > 0.2 else "level"
    # Facing: which named surface the camera points at most directly.
    face = max(("wall-x+", [1, 0, 0]), ("wall-x-", [-1, 0, 0]), ("wall-z+", [0, 0, 1]), ("wall-z-", [0, 0, -1]),
               key=lambda kv: np.dot(fwd, kv[1]))[0]
    if precise:
        (x0, x1), _, (z0, z1) = box["x"], box["y"], box["z"]
        fx, fz = (p[0] - x0) / (x1 - x0), (p[2] - z0) / (z1 - z0)
        near = []
        for sid, frac in (("wall-x-", fx), ("wall-x+", 1 - fx), ("wall-z-", fz), ("wall-z+", 1 - fz)):
            if frac < 0.3:
                near.append(names[sid])
        where = ("near the centre of the room" if not near else
                 f"close to {near[0]}" if len(near) == 1 else f"in the corner between {near[0]} and {near[1]}")
        return (f"{main[0].upper()}{main[1:]}{also} contain {what} regions ({share:.0%} of the room shell). "
                f"Record a short additional view: stand {where} and point the camera towards {names[face]}, {pitch}.")
    return (f"{main[0].upper()}{main[1:]}{also} contain {what} regions ({share:.0%} of the room shell). "
            f"From the middle of your previous path, record a short view towards {names[face]}, {pitch}. "
            "The room boundary there is inferred, so the exact standing position is approximate.")
