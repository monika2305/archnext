"""Evaluation protocol on TUM RGB-D sequences (offline, reproducible).

Each sequence is split along time:
  input video     frames [0, n_in): the walkthrough given to the reconstruction (experiments A and B)
  candidate pool  2-second clips after the input, recorded but unused unless selected (experiments C and D)
  held-out views  every 4th 2-second clip after the input: never given to any reconstruction, used only to
                  evaluate novel-view geometry
Reference geometry comes from the depth sensor and motion-capture poses of ALL frames (see metrics.py).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.spatial import cKDTree

from .. import layout as layout_mod
from ..sfm import SfmResult
from .metrics import Sim3, umeyama
from .tum import Sequence


@dataclass
class Split:
    input: list[int]
    pool: list[list[int]]
    heldout: list[list[int]]


def split(seq: Sequence, input_frac: float, clip_s: float = 2.0, heldout_every: int = 4) -> Split:
    n = len(seq.rgb)
    n_in = int(round(input_frac * n))
    clip = int(round(clip_s * seq.fps()))
    pool, held = [], []
    for k, start in enumerate(range(n_in, n - clip // 2, clip)):
        frames = list(range(start, min(n, start + clip)))
        (held if k % heldout_every == heldout_every - 1 else pool).append(frames)
    return Split(list(range(n_in)), pool, held)


class SceneFrame:
    """Scene (layout) coordinates X_s = R X_raw + t  <->  raw SfM coordinates."""

    def __init__(self, R, t):
        self.R, self.t = np.asarray(R, float), np.asarray(t, float)
        self.R_inv = self.R.T

    def __call__(self, X_s: np.ndarray) -> np.ndarray:
        return (X_s - self.t) @ self.R

    def inverse_point(self, X_raw: np.ndarray) -> np.ndarray:
        return self.R @ X_raw + self.t

    def inverse_point_many(self, X_raw: np.ndarray) -> np.ndarray:
        return X_raw @ self.R.T + self.t


def gt_centers(seq: Sequence, frame_idx: list[int]) -> tuple[np.ndarray, np.ndarray]:
    """GT camera centres for the given RGB frame indices (mask of frames with a GT pose within 20 ms)."""
    C, ok = [], []
    for i in frame_idx:
        T = seq.pose_at(seq.rgb[i][0])
        ok.append(T is not None)
        C.append(T[:3, 3] if T is not None else np.zeros(3))
    return np.array(C), np.array(ok)


def align_raw_to_gt(seq: Sequence, raw_centers: np.ndarray, frame_idx: list[int]) -> tuple[Sim3, dict]:
    """Evaluation-only Sim3 from raw SfM camera centres to GT centres (robust: drops > 3x median residuals)."""
    G, ok = gt_centers(seq, frame_idx)
    A, B = raw_centers[ok], G[ok]
    m = np.ones(len(A), bool)
    for _ in range(3):
        s, R, t = umeyama(A[m], B[m])
        r = np.linalg.norm(s * A @ R.T + t - B, axis=1)
        m2 = r <= max(3 * np.median(r[m]), 1e-6)
        if m2.sum() < 4 or (m2 == m).all():
            break
        m = m2
    s, R, t = umeyama(A[m], B[m])
    r = np.linalg.norm(s * A @ R.T + t - B, axis=1)
    return Sim3(s, R, t), {"frames": int(len(A)), "inliers": int(m.sum()), "ate_rmse_m": float(np.sqrt(np.mean(r[m] ** 2))),
                           "scale_m_per_unit": float(s)}


def gt_reference(seq: Sequence, frame_stride: int = 10, pix_stride: int = 6, max_points: int = 80000, seed: int = 0):
    """GT cloud (all frames), reference layout planes and room-shell points, all in the GT metric frame."""
    rng = np.random.default_rng(seed)
    pts, cams = [], []
    for i in range(0, len(seq.rgb), frame_stride):
        P = seq.backproject(i, stride=pix_stride)
        T = seq.pose_at(seq.rgb[i][0])
        if P is None or T is None:
            continue
        pts.append(P)
        cams.append(T)
    P = np.vstack(pts)
    if len(P) > max_points:
        P = P[rng.choice(len(P), max_points, replace=False)]
    C = np.array([T[:3, 3] for T in cams])
    R_cw = np.array([T[:3, :3].T for T in cams])              # world -> camera rotations
    fake = SfmResult([f"gt{k}" for k in range(len(C))], C, R_cw,
                     {"model": "PINHOLE", "width": 640, "height": 480, "params": list(seq.intrinsics[:1]) + [320.0, 240.0]},
                     np.zeros(len(C)), P, np.zeros((len(P), 3), np.uint8), np.zeros(len(P)),
                     [np.arange(3, dtype=np.int32)] * len(P), {})
    lay = layout_mod.estimate(fake)
    planes, shell_mask = {}, np.zeros(len(P), bool)
    Rl, tl = lay.R, lay.t
    if lay.tau > 0:
        box = lay.box()
        ctr = np.array([np.mean(box["x"]), np.mean(box["y"]), np.mean(box["z"])])
        Pl = P @ Rl.T + tl
        for pl in lay.planes.values():
            if pl.evidence is None:
                continue
            p_lay = ctr.copy()
            p_lay[pl.axis] = pl.offset
            n_lay = np.zeros(3)
            n_lay[pl.axis] = pl.sign
            planes[pl.id] = (Rl.T @ (p_lay - tl), Rl.T @ n_lay)
            shell_mask |= np.abs(Pl[:, pl.axis] - pl.offset) < 0.05
    walls = {k: v for k, v in planes.items() if k.startswith("wall")}
    return {"points": P, "shell": P[shell_mask], "planes": planes, "walls": walls, "layout_reliable": lay.reliable,
            "measured": sorted(planes), "n_frames": len(cams)}


def heldout_samples(seq: Sequence, frames: list[int], shell_tree: cKDTree, every: int = 6, pix_stride: int = 8) -> list[dict]:
    """Shell pixels of held-out frames: pixel, sensor depth, world point, camera pose."""
    import cv2
    out = []
    fx, fy, cx, cy = seq.intrinsics
    for i in frames[::every]:
        t = seq.rgb[i][0]
        T, dname = seq.pose_at(t), seq.depth_for(t)
        if T is None or dname is None:
            continue
        d = cv2.imread(str(seq.path / dname), cv2.IMREAD_UNCHANGED).astype(np.float32) / 5000.0
        v, u = np.mgrid[0:d.shape[0]:pix_stride, 0:d.shape[1]:pix_stride]
        z = d[v, u]
        ok = (z > 0.3) & (z < 6.0)
        uv = np.stack([u[ok], v[ok]], axis=1).astype(float)
        Pc = np.stack([(uv[:, 0] - cx) * z[ok] / fx, (uv[:, 1] - cy) * z[ok] / fy, z[ok]], axis=1)
        Xw = Pc @ T[:3, :3].T + T[:3, 3]
        dist, _ = shell_tree.query(Xw)
        sh = dist < 0.05
        if sh.sum() < 20:
            continue
        out.append({"frame": i, "uv": uv[sh], "depth": z[ok][sh], "X": Xw[sh], "center": T[:3, 3], "R_wc": T[:3, :3]})
    return out
