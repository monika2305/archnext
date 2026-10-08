"""SYNTHETIC test room (not real data): exact box geometry, points sampled on its walls and cameras inside it.

Used only to test the geometry code against a known answer. The camera path looks at the -z wall, the two side
walls and the floor, never at the +z wall or the ceiling, so those must come out GENERATED with completion on.
"""
from __future__ import annotations

import numpy as np

from mode_b.nbv import look_rotation
from mode_b.sfm import SfmResult

BOX = {"x": (-2.0, 2.0), "y": (0.0, 2.6), "z": (-2.5, 2.5)}


def room(seed: int = 0, n_per_m2: float = 60, noise: float = 0.004, rotate: float = 0.3, scale: float = 0.37,
         textureless_ceiling: bool = True) -> tuple[SfmResult, dict]:
    rng = np.random.default_rng(seed)
    (x0, x1), (y0, y1), (z0, z1) = BOX["x"], BOX["y"], BOX["z"]
    # Cameras: walk along x near z = +0.8, looking towards -z and turning to the side walls.
    C, R = [], []
    for k, x in enumerate(np.linspace(-1.2, 1.2, 40)):
        yaw = np.radians(180 + 70 * np.sin(k / 39 * np.pi * 2))           # 0 = +z, 180 = -z
        C.append([x, 1.5, 0.8])
        R.append(look_rotation(yaw, np.radians(-20)))
    C, R = np.array(C), np.array(R)

    def sample(axis, val, ranges, n):
        P = np.zeros((n, 3))
        P[:, axis] = val + rng.normal(0, noise, n)
        for a, (lo, hi) in ranges.items():
            P[:, a] = rng.uniform(lo, hi, n)
        return P

    surfaces = {
        "floor": sample(1, y0, {0: (x0, x1), 2: (z0, z1)}, int(n_per_m2 * 20)),
        "wall-z-": sample(2, z0, {0: (x0, x1), 1: (y0, y1)}, int(n_per_m2 * 10.4)),
        "wall-x-": sample(0, x0, {2: (z0, z1), 1: (y0, y1)}, int(n_per_m2 * 13)),
        "wall-x+": sample(0, x1, {2: (z0, z1), 1: (y0, y1)}, int(n_per_m2 * 13)),
        "wall-z+": sample(2, z1, {0: (x0, x1), 1: (y0, y1)}, int(n_per_m2 * 10.4)),
        "ceiling": sample(1, y1, {0: (x0, x1), 2: (z0, z1)}, 0 if textureless_ceiling else int(n_per_m2 * 20)),
    }
    f, w, h = 500.0, 640, 480
    pts, tracks, labels = [], [], []
    for name, P in surfaces.items():
        for p in P:
            Xc = np.einsum("cij,cj->ci", R, p - C)
            z = Xc[:, 2]
            u = f * Xc[:, 0] / np.where(z > 0, z, 1) + w / 2
            v = f * Xc[:, 1] / np.where(z > 0, z, 1) + h / 2
            seen = np.flatnonzero((z > 0.1) & (u > 0) & (u < w) & (v > 0) & (v < h))
            if len(seen) >= 3:                       # a point exists only if SfM could triangulate it
                pts.append(p)
                tracks.append(seen.astype(np.int32))
                labels.append(name)
    P = np.array(pts)
    # Express everything in an arbitrary SfM gauge: rotation, translation and scale (video has no metric scale).
    a = rotate
    G = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]]) @ \
        np.array([[1, 0, 0], [0, np.cos(0.2), -np.sin(0.2)], [0, np.sin(0.2), np.cos(0.2)]])
    tg = np.array([3.0, -1.0, 2.0])
    sfm = SfmResult([f"frames/v0_kf_{k:04d}.jpg" for k in range(len(C))], scale * (C @ G.T) + tg, R @ G.T,
                    {"model": "SIMPLE_RADIAL", "width": w, "height": h, "params": [f, w / 2, h / 2, 0.0]},
                    np.full(len(C), 0.6), scale * (P @ G.T) + tg, np.full((len(P), 3), 128, np.uint8),
                    np.full(len(P), 0.5), tracks, {})
    return sfm, {"labels": np.array(labels), "G": G, "t": tg, "s": scale}
