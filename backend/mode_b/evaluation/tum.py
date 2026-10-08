"""TUM RGB-D benchmark sequences (Sturm et al., IROS 2012; CC BY 4.0, https://cvg.cit.tum.de/data/datasets/rgbd-dataset).

Real hand-held Kinect recordings of indoor rooms with motion-capture ground-truth camera poses and depth images.
Used here for (a) real input videos (RGB frames encoded as MP4) and (b) reference geometry: depth images
back-projected with the ground-truth poses (measured by sensors, not drawn by hand).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(os.environ.get("ARCHNEXT_TUM") or (Path.home() / ".cache" / "archnext" / "datasets" / "tum"))
# Calibrated intrinsics of the RGB cameras (from the dataset documentation); depth is registered to RGB.
INTRINSICS = {"freiburg1": (517.3, 516.5, 318.6, 255.3), "freiburg2": (520.9, 521.0, 325.1, 249.7),
              "freiburg3": (535.4, 539.2, 320.1, 247.6)}
DEPTH_SCALE = 5000.0     # depth PNG value / 5000 = metres


def _read_list(p: Path) -> list[list[str]]:
    return [ln.split() for ln in p.read_text().splitlines() if ln.strip() and not ln.startswith("#")]


def quat_to_R(qx, qy, qz, qw) -> np.ndarray:
    q = np.array([qw, qx, qy, qz], float)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


@dataclass
class Sequence:
    name: str
    path: Path
    rgb: list[tuple[float, str]]                       # (timestamp, relative path)
    depth: list[tuple[float, str]]
    gt_t: np.ndarray                                   # (n,) ground-truth timestamps
    gt_pose: np.ndarray                                # (n, 4, 4) world_from_camera

    @classmethod
    def load(cls, name: str) -> "Sequence":
        p = ROOT / name
        rgb = [(float(a), b) for a, b in _read_list(p / "rgb.txt")]
        depth = [(float(a), b) for a, b in _read_list(p / "depth.txt")]
        gt = np.array([[float(v) for v in r] for r in _read_list(p / "groundtruth.txt")])
        T = np.tile(np.eye(4), (len(gt), 1, 1))
        for k, r in enumerate(gt):
            T[k, :3, :3] = quat_to_R(*r[4:8])
            T[k, :3, 3] = r[1:4]
        return cls(name, p, rgb, depth, gt[:, 0], T)

    @property
    def intrinsics(self):
        return INTRINSICS[self.name.split("_")[2]]

    def pose_at(self, t: float, max_dt: float = 0.02) -> np.ndarray | None:
        """Ground-truth world_from_camera at time t (nearest sample within max_dt), or None."""
        k = int(np.argmin(np.abs(self.gt_t - t)))
        return self.gt_pose[k] if abs(self.gt_t[k] - t) <= max_dt else None

    def depth_for(self, t: float, max_dt: float = 0.02) -> str | None:
        ts = np.array([d[0] for d in self.depth])
        k = int(np.argmin(np.abs(ts - t)))
        return self.depth[k][1] if abs(ts[k] - t) <= max_dt else None

    def image(self, i: int) -> np.ndarray:
        return cv2.imread(str(self.path / self.rgb[i][1]))

    def fps(self) -> float:
        return (len(self.rgb) - 1) / (self.rgb[-1][0] - self.rgb[0][0])

    def write_video(self, out: Path, frames: list[int], fps: float | None = None) -> Path:
        """Encode the given RGB frames (indices into ``rgb``) as an MP4 at the sequence frame rate."""
        fps = fps or round(self.fps(), 2)
        first = self.image(frames[0])
        vw = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), fps, (first.shape[1], first.shape[0]))
        for i in frames:
            vw.write(self.image(i))
        vw.release()
        return out

    def backproject(self, i: int, stride: int = 4, max_depth: float = 4.5) -> np.ndarray | None:
        """World points (metres, GT frame) from the depth image registered to RGB frame ``i``."""
        t = self.rgb[i][0]
        pose, dname = self.pose_at(t), self.depth_for(t)
        if pose is None or dname is None:
            return None
        d = cv2.imread(str(self.path / dname), cv2.IMREAD_UNCHANGED).astype(np.float32) / DEPTH_SCALE
        fx, fy, cx, cy = self.intrinsics
        v, u = np.mgrid[0:d.shape[0]:stride, 0:d.shape[1]:stride]
        z = d[v, u]
        ok = (z > 0.3) & (z < max_depth)
        x = (u[ok] - cx) * z[ok] / fx
        y = (v[ok] - cy) * z[ok] / fy
        Pc = np.stack([x, y, z[ok]], axis=1)
        return Pc @ pose[:3, :3].T + pose[:3, 3]
