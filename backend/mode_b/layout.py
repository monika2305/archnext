"""Room layout from sparse SfM points and camera poses (plane-based fallback; no CUDA for dense MVS).

1. Clean points: track length >= 3, low reprojection error, statistical outlier removal.
2. Up direction: hand-held cameras have (nearly) no roll, so their x axes are horizontal; "up" is the direction
   most perpendicular to all camera x axes (smallest eigenvector), signed by the cameras' image-up vectors.
3. Manhattan frame: azimuths of locally planar, vertical point neighbourhoods (normals from k-NN PCA) folded to
   [0, 90) degrees; the histogram peak gives the wall directions.
4. Floor / ceiling: dominant horizontal point layers below / above all cameras.
5. Walls: for each of the four Manhattan directions, the outermost dominant vertical point layer beyond all
   cameras (the cameras are inside the room). A direction without such a layer has no wall evidence.

Every plane records its evidence (inlier points, spread, residual) or ``None``. Nothing here invents a surface:
missing planes are completed later by VisionTrust (``trust.py``) and marked GENERATED there.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.spatial import cKDTree

from .sfm import SfmResult

AXES = {"x": 0, "y": 1, "z": 2}


@dataclass
class Plane:
    id: str                       # floor, ceiling, wall-x+, wall-x-, wall-z+, wall-z-
    kind: str                     # floor | ceiling | wall
    axis: int                     # 0 = x, 1 = y, 2 = z (axis-aligned in the layout frame)
    sign: int                     # outward normal direction along the axis
    offset: float                 # plane coordinate along the axis
    evidence: dict | None         # None when no point layer supports it (position is then a bound)
    bound_reason: str | None = None

    def to_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "axis": "xyz"[self.axis], "sign": self.sign,
                "offset": round(float(self.offset), 5), "evidence": self.evidence, "bound_reason": self.bound_reason}


@dataclass
class Layout:
    R: np.ndarray                 # layout_from_sfm rotation
    t: np.ndarray                 # layout_from_sfm translation (x' = R x + t)
    sfm: SfmResult                # cameras and points expressed in the layout frame
    keep: np.ndarray              # mask of points kept after cleaning (into sfm.points)
    tau: float                    # inlier tolerance (reconstruction units)
    scale_ref: float              # characteristic room size (units)
    planes: dict[str, Plane] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    reliable: bool = False
    failure: str | None = None

    def box(self) -> dict:
        p = self.planes
        return {"x": [p["wall-x-"].offset, p["wall-x+"].offset], "y": [p["floor"].offset, p["ceiling"].offset],
                "z": [p["wall-z-"].offset, p["wall-z+"].offset]}


def clean_points(sfm: SfmResult, min_track: int = 3, max_error: float = 2.5, k: int = 8, z: float = 2.0) -> np.ndarray:
    lens = np.array([len(t) for t in sfm.tracks])
    keep = (lens >= min_track) & (sfm.errors <= max_error)
    idx = np.flatnonzero(keep)
    if len(idx) > k + 1:
        P = sfm.points[idx]
        d, _ = cKDTree(P).query(P, k=k + 1)
        md = d[:, 1:].mean(axis=1)
        bad = md > md.mean() + z * md.std()
        keep[idx[bad]] = False
    return keep


def up_direction(sfm: SfmResult) -> tuple[np.ndarray, str]:
    """Up from camera x axes (roll ~ 0); falls back to the mean image-up vector when headings barely vary."""
    X, Y, _ = sfm.camera_axes()
    mean_up = -Y.mean(axis=0)
    w, V = np.linalg.eigh(X.T @ X)
    if w[1] < 0.05 * max(w[2], 1e-9):           # all cameras face (almost) the same way: up is not determined
        B = V[:, :2]                             # by the x axes alone; take the mean image-up within their null space
        u = B @ (B.T @ mean_up)
        src = "camera image-up vectors (headings barely vary)"
    else:
        u = V[:, 0]
        src = "camera roll axes (smallest eigenvector of the camera x axes)"
    u /= np.linalg.norm(u)
    if u @ mean_up < 0:
        u = -u
    return u, src


def normals(P: np.ndarray, k: int = 12) -> tuple[np.ndarray, np.ndarray]:
    """Per-point normals and planarity (1 - smallest/middle eigenvalue ratio) from k-NN PCA."""
    k = min(k, len(P) - 1)
    _, nn = cKDTree(P).query(P, k=k + 1)
    Q = P[nn] - P[nn].mean(axis=1, keepdims=True)
    C = np.einsum("nki,nkj->nij", Q, Q) / k
    w, V = np.linalg.eigh(C)
    return V[:, :, 0], 1.0 - w[:, 0] / np.maximum(w[:, 1], 1e-12)


def manhattan_yaw(P: np.ndarray, up: np.ndarray) -> tuple[float | None, float]:
    """Dominant wall azimuth in [0, 90) degrees and the share of vertical-plane points agreeing with it."""
    if len(P) < 30:
        return None, 0.0
    n, planarity = normals(P)
    vertical = (np.abs(n @ up) < 0.25) & (planarity > 0.7)
    if vertical.sum() < 20:
        return None, 0.0
    e1 = np.cross(up, [1.0, 0, 0] if abs(up[0]) < 0.9 else [0, 0, 1.0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    az = np.degrees(np.arctan2(n[vertical] @ e2, n[vertical] @ e1)) % 90.0
    hist = np.histogram(az, bins=90, range=(0, 90))[0].astype(float)
    smooth = np.convolve(np.r_[hist[-3:], hist, hist[:3]], np.ones(7) / 7, mode="same")[3:-3]
    peak = int(np.argmax(smooth))
    sel = az[np.abs(((az - peak - 0.5) + 45) % 90 - 45) < 6]
    yaw = float(np.degrees(np.arctan2(np.sin(np.radians(sel * 4)).mean(), np.cos(np.radians(sel * 4)).mean())) / 4) % 90
    return yaw, len(sel) / max(1, vertical.sum())


def _peaks(v: np.ndarray, bin_w: float, min_support: int) -> list[tuple[float, int]]:
    """Point layers along one axis: (position, support) of histogram peaks, refined to the mean of inliers."""
    if len(v) == 0:
        return []
    lo, hi = v.min() - bin_w, v.max() + bin_w
    nb = max(3, int(np.ceil((hi - lo) / bin_w)))
    h, edges = np.histogram(v, bins=nb, range=(lo, hi))
    hs = np.convolve(h, [1, 1, 1], mode="same")
    out = []
    for i in range(nb):
        if hs[i] >= min_support and hs[i] == hs[max(0, i - 2):i + 3].max() and (not out or i - out[-1][2] > 2):
            c = 0.5 * (edges[i] + edges[i + 1])
            near = v[np.abs(v - c) < 1.5 * bin_w]
            out.append((float(near.mean()), int(len(near)), i))
    return [(c, s) for c, s, _ in out]


def _layer(P: np.ndarray, axis: int, pos: float, tol: float, other: tuple[int, int]) -> tuple[int, float, float]:
    """Support and extent (along the two other axes) of the point layer at ``pos``."""
    Q = P[np.abs(P[:, axis] - pos) < tol]
    if len(Q) < 3:
        return len(Q), 0.0, 0.0
    ext = [float(np.percentile(Q[:, a], 95) - np.percentile(Q[:, a], 5)) for a in other]
    return len(Q), ext[0], ext[1]


def _pick_layer(P: np.ndarray, sel: np.ndarray, axis: int, sign: int, tol: float, n_min: int, other, min_ext,
                rel: float) -> float | None:
    """The outermost (``sign``) layer along ``axis`` among points ``sel`` that is a genuine extended surface:
    support >= max(n_min, rel x the strongest layer) and extent >= ``min_ext`` along both other axes.
    Extent, not density, separates a wall or floor from a cluttered desk top or shelf."""
    v = sign * P[sel, axis]
    pk = _peaks(v, tol, n_min)
    if not pk:
        return None
    best = max(s for _, s in pk)
    for c, sup in sorted(pk, key=lambda t: -t[0]):           # outermost first
        if sup < max(n_min, rel * best):
            continue
        n, e1, e2 = _layer(P[sel], axis, sign * c, tol, other)
        if e1 >= min_ext[0] and e2 >= min_ext[1]:
            return sign * c
    return None


def _evidence(P: np.ndarray, axis: int, offset: float, tol: float, tracks_of, other_axes: tuple[int, int]) -> dict:
    d = P[:, axis] - offset
    inl = np.abs(d) < tol
    Q = P[inl]
    spread = [float(np.ptp(Q[:, a])) if len(Q) else 0.0 for a in other_axes]
    views = set()
    for i in np.flatnonzero(inl):
        views.update(tracks_of(i))
    return {"points": int(inl.sum()), "rmse": float(np.sqrt(np.mean(d[inl] ** 2))) if inl.any() else None,
            "spread": [round(s, 4) for s in spread], "views": len(views)}


def estimate(sfm: SfmResult, frame: tuple[np.ndarray, np.ndarray] | None = None) -> Layout:
    """Room layout. ``frame`` = (R, t) of an earlier version: reuse its axes and origin (no re-centring), so an
    updated reconstruction is directly comparable with the previous one."""
    keep = clean_points(sfm)
    if keep.sum() < 50:
        lay = Layout(np.eye(3), np.zeros(3), sfm, keep, 0.0, 0.0)
        lay.failure = (f"Only {int(keep.sum())} reliable 3D points were reconstructed: not enough evidence to "
                       "estimate floor and walls.")
        return lay
    up, up_src = up_direction(sfm)
    P0 = sfm.points[keep]
    yaw, agree = manhattan_yaw(P0, up) if frame is None else (0.0, 1.0)
    notes = [f"Up direction from {up_src}."] if frame is None else ["Axes and origin of the previous version kept."]
    if frame is not None:
        e1, up = frame[0][0], frame[0][1]
    elif yaw is None:
        yaw = 0.0
        notes.append("No dominant vertical planes were found; wall directions follow the first camera's heading.")
        z_first = sfm.rotations[0, 2, :]
        z_first = z_first - (z_first @ up) * up
        e1 = z_first / max(np.linalg.norm(z_first), 1e-9)
    else:
        e1 = np.cross(up, [1.0, 0, 0] if abs(up[0]) < 0.9 else [0, 0, 1.0])
        e1 /= np.linalg.norm(e1)
        notes.append(f"Manhattan wall directions from {agree:.0%} of locally planar vertical point patches.")
    e2 = np.cross(up, e1)
    c, s = np.cos(np.radians(yaw)), np.sin(np.radians(yaw))
    ex = c * e1 + s * e2
    ez = np.cross(ex, up)
    R = np.stack([ex, up, ez]) if frame is None else np.asarray(frame[0], float)
    cam0 = sfm.centers.mean(axis=0)
    t = -R @ cam0 if frame is None else np.asarray(frame[1], float)
    W = sfm.transformed(R, t)
    P = W.points[keep]
    tracks = [sfm.tracks[i] for i in np.flatnonzero(keep)]
    C = W.centers
    L = float(np.percentile(np.linalg.norm(P[:, [0, 2]] - C[:, [0, 2]].mean(axis=0), axis=1), 90))
    tau = 0.02 * L
    lay = Layout(R, t, W, keep, tau, L, notes=notes)
    n_min = max(12, int(0.008 * len(P)))
    # A layer only counts as a surface if its points are locally oriented like it (k-NN PCA normals): uniformly
    # scattered wall points otherwise form spurious horizontal "layers" at any height.
    nrm, _ = normals(P)
    along = np.abs(nrm) > 0.5                    # along[:, a]: the local normal is within 60 deg of axis a
    tracks_of = lambda i: tracks[i]  # noqa: E731

    # Floor and ceiling: horizontal layers below / above every camera.
    ymin, ymax = C[:, 1].min(), C[:, 1].max()
    below = P[:, 1] < ymin - 2 * tau
    above = P[:, 1] > ymax + 2 * tau
    y_floor = _pick_layer(P, below & along[:, 1], 1, -1, tau, n_min, (0, 2), (0.15 * L, 0.15 * L), 0.05)
    if y_floor is not None:
        ev = _evidence(P, 1, y_floor, tau, tracks_of, (0, 2))
        lay.planes["floor"] = Plane("floor", "floor", 1, -1, y_floor, ev)
    else:
        y_floor = float(min(P[:, 1].min(), ymin - tau))
        lay.planes["floor"] = Plane("floor", "floor", 1, -1, y_floor, None,
                                    "No floor layer found; the floor is placed at the lowest observed point (a bound).")
    y_ceil = _pick_layer(P, above & along[:, 1], 1, 1, tau, n_min, (0, 2), (0.15 * L, 0.15 * L), 0.05)
    if y_ceil is not None:
        lay.planes["ceiling"] = Plane("ceiling", "ceiling", 1, 1, y_ceil, _evidence(P, 1, y_ceil, tau, tracks_of, (0, 2)))

    # Walls: the outermost dominant vertical layer beyond all cameras, per direction.
    span = (P[:, 1] > y_floor + tau) & (P[:, 1] < (lay.planes["ceiling"].offset - tau if "ceiling" in lay.planes else np.inf))
    for axis in (0, 2):
        for sign in (1, -1):
            pid = f"wall-{'xyz'[axis]}{'+' if sign > 0 else '-'}"
            v = sign * P[:, axis]
            c_ext = (sign * C[:, axis]).max()
            cand = span & (v > c_ext + tau) & along[:, axis]
            height = (lay.planes["ceiling"].offset if "ceiling" in lay.planes else C[:, 1].max()) - y_floor
            found = _pick_layer(P, cand, axis, sign, tau, n_min, (2 - axis, 1), (0.15 * L, 0.2 * height), 0.1)
            if found is not None:
                ev = _evidence(P, axis, found, tau, tracks_of, (2 - axis, 1))
                lay.planes[pid] = Plane(pid, "wall", axis, sign, found, ev)
            else:
                far = np.percentile(v[span], 98) if span.any() else c_ext
                pos = max(c_ext + 2 * tau, float(far))
                lay.planes[pid] = Plane(pid, "wall", axis, sign, sign * pos, None,
                                        "No wall layer found beyond the camera path; the wall is placed at the farthest "
                                        "observed point in this direction (the room is at least this large).")
    if "ceiling" not in lay.planes:
        walls_top = [P[np.abs(P[:, p.axis] - p.offset) < tau, 1] for p in lay.planes.values()
                     if p.kind == "wall" and p.evidence]
        tops = np.concatenate(walls_top) if walls_top else np.zeros(0)
        y_top = max(float(np.percentile(tops, 98)) if len(tops) else -np.inf, ymax + 2 * tau,
                    float(np.percentile(P[:, 1], 98)))
        lay.planes["ceiling"] = Plane("ceiling", "ceiling", 1, 1, y_top, None,
                                      "No ceiling layer found; the ceiling is placed at the highest observed wall point "
                                      "(the room is at least this high).")

    walls_ok = [p for p in lay.planes.values() if p.kind == "wall" and p.evidence]
    axes_ok = {p.axis for p in walls_ok}
    floor_ok = lay.planes["floor"].evidence is not None
    lay.reliable = (len(walls_ok) >= 3) or (len(walls_ok) >= 2 and len(axes_ok) == 2 and floor_ok) or \
                   (len(walls_ok) >= 2 and floor_ok and len(axes_ok) == 1)
    if not lay.reliable:
        lay.failure = (f"Only {len(walls_ok)} wall(s){' and the floor' if floor_ok else ''} have point evidence: the room "
                       "layout cannot be estimated reliably. The observed points are shown, but no room shell is "
                       "completed. Record more of the walls (move along them, include corners).")
    if frame is not None:
        return lay
    # Centre the room: floor at y = 0, box centred on x and z.
    box_c = np.array([(lay.planes["wall-x+"].offset + lay.planes["wall-x-"].offset) / 2, lay.planes["floor"].offset,
                      (lay.planes["wall-z+"].offset + lay.planes["wall-z-"].offset) / 2])
    lay.t = lay.t - box_c
    lay.sfm = sfm.transformed(R, lay.t)
    for p in lay.planes.values():
        p.offset -= box_c[p.axis]
    return lay
