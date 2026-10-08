"""RGB-D SENSOR DEMO (separate from the video-only pipeline).

Builds a dense coloured point cloud of a TUM RGB-D sequence from the dataset's own measurements: the depth sensor's
depth images and the motion-capture camera poses published with the dataset. This is NOT video-only reconstruction
and is always labelled as such.

Fusion: depth pixels (0.3-4 m) of every ``stride``-th frame are back-projected with the calibrated intrinsics and the
recorded pose, averaged into ``voxel``-sized cells, and a cell is kept only if at least ``min_views`` different frames
measured it (multi-frame consistency removes single-frame noise and moving objects).
"""
from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np

from .evaluation.tum import ROOT, Sequence

MAX_POINTS = 400_000


def available() -> list[dict]:
    out = []
    if ROOT.is_dir():
        for p in sorted(ROOT.iterdir()):
            if (p / "rgb.txt").exists() and (p / "depth.txt").exists() and (p / "groundtruth.txt").exists():
                out.append({"sequence": p.name, "frames": sum(1 for _ in open(p / "rgb.txt")) - 3})
    return out


def fuse(name: str, stride: int = 8, pix: int = 3, voxel: float = 0.025, min_views: int = 2, progress=None):
    seq = Sequence.load(name)
    fx, fy, cx, cy = seq.intrinsics
    keys_all, rgb_all, frame_all, cams, used = [], [], [], [], []
    idx = list(range(0, len(seq.rgb), stride))
    for k, i in enumerate(idx):
        t = seq.rgb[i][0]
        T, dname = seq.pose_at(t), seq.depth_for(t)
        if T is None or dname is None:
            continue
        d = cv2.imread(str(seq.path / dname), cv2.IMREAD_UNCHANGED).astype(np.float32) / 5000.0
        img = cv2.imread(str(seq.path / seq.rgb[i][1]))
        v, u = np.mgrid[0:d.shape[0]:pix, 0:d.shape[1]:pix]
        z = d[v, u]
        ok = (z > 0.3) & (z < 4.0)
        Pc = np.stack([(u[ok] - cx) * z[ok] / fx, (v[ok] - cy) * z[ok] / fy, z[ok]], axis=1)
        Pw = Pc @ T[:3, :3].T + T[:3, 3]
        keys_all.append(np.floor(Pw / voxel).astype(np.int64))
        rgb_all.append(img[v[ok], u[ok]][:, ::-1])
        frame_all.append(np.full(len(Pw), k, np.int32))
        cams.append((i, T))
        used.append(i)
        if progress and k % 10 == 0:
            progress(0.8 * (k + 1) / len(idx), f"Fused {k + 1} of {len(idx)} depth frames")
    K = np.concatenate(keys_all)
    RGB = np.concatenate(rgb_all).astype(np.float64)
    F = np.concatenate(frame_all)
    key = (K[:, 0] + 2 ** 20) * 2 ** 42 + (K[:, 1] + 2 ** 20) * 2 ** 21 + (K[:, 2] + 2 ** 20)
    uk, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    views = np.zeros(len(uk), np.int64)
    pair = np.unique(inv.astype(np.int64) * 100000 + F)              # distinct (voxel, frame) pairs
    np.add.at(views, pair // 100000, 1)
    pos = np.zeros((len(uk), 3))
    col = np.zeros((len(uk), 3))
    np.add.at(pos, inv, (K + 0.5) * voxel)
    np.add.at(col, inv, RGB)
    pos /= cnt[:, None]
    col /= cnt[:, None]
    keep = views >= min_views
    pos, col, views = pos[keep], col[keep], views[keep]
    if len(pos) > MAX_POINTS:
        sel = np.sort(np.random.default_rng(0).choice(len(pos), MAX_POINTS, replace=False))
        pos, col, views = pos[sel], col[sel], views[sel]
    # TUM's world frame has z up; the viewer uses y up: (x, y, z) -> (x, z, -y). Centre the floor footprint.
    M = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)
    P = pos @ M.T
    floor = float(np.percentile(P[:, 1], 1))
    c = np.array([np.median(P[:, 0]), floor, np.median(P[:, 2])])
    P -= c
    cam_out = []
    for i, T in cams:
        R_wc = M @ T[:3, :3]
        cam_out.append({"name": f"frame {i}", "index": i, "time": round(seq.rgb[i][0] - seq.rgb[0][0], 2),
                        "center": np.round(M @ T[:3, 3] - c, 4).tolist(),
                        "forward": np.round(R_wc[:, 2], 4).tolist(), "up": np.round(-R_wc[:, 1], 4).tolist()})
    return {"points": P, "colors": col.round().astype(np.uint8), "views": views, "cameras": cam_out, "frames_used": used,
            "seq": seq, "stats": {"frames_fused": len(used), "measurements": int(len(K)), "voxels": int(len(uk)),
                                  "points_kept": int(len(P)), "voxel_m": voxel, "min_views": min_views,
                                  "extent_m": np.round(np.ptp(P, axis=0), 2).tolist()}}


def save_frames(seq: Sequence, used: list[int], folder: Path, n: int = 16) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    pick = [used[int(k)] for k in np.linspace(0, len(used) - 1, min(n, len(used)))]
    kf = []
    for k, i in enumerate(pick):
        img = seq.image(i)
        name = f"rgbd_{k:03d}.jpg"
        cv2.imwrite(str(folder / name), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
        t = round(seq.rgb[i][0] - seq.rgb[0][0], 2)
        kf.append({"name": name, "index": i, "time": t, "sharpness": 0, "motion": None, "brightness": 0, "texture": 0})
    dur = round(seq.rgb[-1][0] - seq.rgb[0][0], 2)
    return {"video": {"width": 640, "height": 480, "fps": round(seq.fps(), 2), "frames": len(seq.rgb), "duration_s": dur,
                      "codec": "TUM RGB-D image sequence"},
            "settings": {}, "image_size": [640, 480], "sampled": len(used), "keyframes": kf, "warnings": [],
            "rejected": {"blurry": 0, "duplicate": 0, "little_motion": 0, "thinned": 0},
            "timeline": [{"index": f["index"], "time": f["time"], "status": "keyframe", "sharpness": 0} for f in kf]}


def build_scene(name: str, progress=None) -> tuple[dict, dict]:
    t0 = time.time()
    r = fuse(name, progress=progress)
    scene = {
        "version": 1, "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": "rgbd",
        "units": "metres (depth sensor)",
        "source": {"type": "RGB-D sensor demo", "dataset": "TUM RGB-D (CC BY 4.0)", "sequence": name,
                   "depth": "Kinect depth images (measured)", "poses": "motion-capture camera poses published with the dataset",
                   "note": "Not video-only reconstruction: this demo uses the dataset's depth sensor and recorded poses."},
        "completion": False,
        "method": {"poses": "Dataset motion-capture poses (not estimated from video)",
                   "dense": f"Depth-sensor fusion: {r['stats']['frames_fused']} frames, {r['stats']['voxel_m'] * 100:.1f} cm voxels, "
                            f"kept where >= {r['stats']['min_views']} frames agree",
                   "geometry": "Coloured point cloud (no surface completion)", "completion": "off"},
        "layout": {"reliable": None, "failure": None, "notes": [], "box": None, "planes": []},
        "cameras": r["cameras"], "intrinsics": {"model": "PINHOLE", "width": 640, "height": 480, "params": list(r["seq"].intrinsics)},
        "points": {"xyz": np.round(r["points"], 3).reshape(-1).tolist(), "rgb": r["colors"].reshape(-1).tolist(),
                   "views": r["views"].tolist(), "total_kept": r["stats"]["points_kept"], "total": r["stats"]["voxels"],
                   "dense": True, "size": r["stats"]["voxel_m"]},
        "surfaces": [], "summary": None, "nbv": {"mode": "unavailable", "recommendations": [],
                                                 "reason": "Not used for the RGB-D sensor demo."},
        "diagnostics": {**r["stats"], "seconds": round(time.time() - t0, 1)},
    }
    return scene, r
