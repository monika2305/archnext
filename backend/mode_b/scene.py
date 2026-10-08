"""Assemble the scene document (scene.json) of one reconstruction version from layout, VisionTrust and NBV."""
from __future__ import annotations

import time

import numpy as np

from . import nbv as nbv_mod
from . import trust
from .layout import Layout

MAX_POINTS = 30000


def frame_info(manifests: dict[str, dict]) -> dict[str, dict]:
    """Image name ("frames/v0_kf_0003.jpg") -> video number, frame index, timestamp."""
    out = {}
    for folder, m in manifests.items():
        n = 0 if folder == "frames" else int(folder.split("_")[1])
        for f in m["keyframes"]:
            out[f"{folder}/{f['name']}"] = {"video": n, "index": f["index"], "time": f["time"]}
    return out


def assemble(version: int, lay: Layout, diagnostics: dict, manifests: dict, completion: bool,
             reason_no_dense: str) -> dict:
    S = lay.sfm
    surfaces = trust.build_surfaces(lay, completion) if lay.tau > 0 else []
    info = frame_info(manifests)
    cams = []
    for k, name in enumerate(S.names):
        cams.append({"name": name, **info.get(name, {}), "center": np.round(S.centers[k], 5).tolist(),
                     "forward": np.round(S.rotations[k, 2], 5).tolist(), "up": np.round(-S.rotations[k, 1], 5).tolist(),
                     "reprojection_error_px": None if np.isnan(S.image_errors[k]) else round(float(S.image_errors[k]), 3)})
    idx = np.flatnonzero(lay.keep)
    if len(idx) > MAX_POINTS:
        idx = np.sort(np.random.default_rng(0).choice(idx, MAX_POINTS, replace=False))
    views = np.array([len(S.tracks[i]) for i in idx])
    rec = nbv_mod.recommend(lay, surfaces) if surfaces else {"mode": "unavailable", "recommendations": [],
                                                              "reason": "No room surfaces to plan views for."}
    p = S.intrinsics["params"]
    return {
        "version": version, "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "units": "reconstruction units (scale unknown; calibrate with a known wall length)",
        "completion": completion,
        "method": {
            "poses": "COLMAP incremental Structure-from-Motion (pycolmap, SIFT, CPU)",
            "dense": reason_no_dense,
            "geometry": "Manhattan room layout fitted to sparse points (floor, ceiling and wall planes)",
            "completion": "VisionTrust: constrained room closure (planarity, vertical walls, right-angle corners, "
                          "observed bounds)" if completion else "off (baseline: observed planes only)",
        },
        "layout": {"reliable": lay.reliable, "failure": lay.failure, "notes": lay.notes,
                   "tau": round(float(lay.tau), 5), "scale_ref": round(float(lay.scale_ref), 4),
                   "box": {k: [round(float(v[0]), 5), round(float(v[1]), 5)] for k, v in lay.box().items()} if lay.planes else None,
                   "planes": [pl.to_dict() for pl in lay.planes.values()],
                   "frame": {"R": np.round(lay.R, 8).tolist(), "t": np.round(lay.t, 8).tolist()}},
        "intrinsics": {**S.intrinsics, "focal_px": round(float(p[0]), 2)},
        "cameras": cams,
        "points": {"xyz": np.round(S.points[idx], 4).reshape(-1).tolist(), "rgb": S.colors[idx].reshape(-1).tolist(),
                   "views": views.tolist(), "total_kept": int(lay.keep.sum()), "total": int(len(S.points))},
        "surfaces": surfaces,
        "summary": trust.summary(surfaces) if surfaces else None,
        "confidence_method": trust.CONF_METHOD,
        "nbv": rec,
        "diagnostics": diagnostics,
    }
