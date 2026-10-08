"""Camera poses and sparse 3D points with COLMAP (pycolmap, CPU): SIFT features -> matching with geometric
verification -> incremental Structure-from-Motion.

Video gives no metric scale: the reconstruction is up to an unknown scale factor ("units"). Intrinsics are not
known for an arbitrary phone video, so one shared SIMPLE_RADIAL camera is estimated (focal length initialised
by COLMAP from the image size). Dense multi-view stereo (PatchMatch) needs CUDA and is reported unavailable on
machines without it.
"""
from __future__ import annotations

import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pycolmap

from .errors import StageFailed

CFG = pycolmap.TwoViewGeometryConfiguration


@dataclass
class SfmResult:
    names: list[str]                                  # registered image names
    centers: np.ndarray                               # (n, 3) camera centres, world frame
    rotations: np.ndarray                             # (n, 3, 3) world -> camera rotations
    intrinsics: dict                                  # {"model", "width", "height", "params"} (shared camera)
    image_errors: np.ndarray                          # (n,) mean reprojection error of each image's points (px)
    points: np.ndarray                                # (m, 3)
    colors: np.ndarray                                # (m, 3) uint8
    errors: np.ndarray                                # (m,) reprojection error (px)
    tracks: list[np.ndarray]                          # per point: indices into ``names`` observing it
    diagnostics: dict = field(default_factory=dict)

    def to_npz(self, path: Path) -> None:
        lens = np.array([len(t) for t in self.tracks])
        np.savez_compressed(path, names=np.array(self.names), centers=self.centers, rotations=self.rotations,
                            image_errors=self.image_errors, points=self.points, colors=self.colors,
                            errors=self.errors, track_len=lens, track_idx=np.concatenate(self.tracks) if len(lens) else
                            np.zeros(0, int), intr_params=np.array(self.intrinsics["params"]),
                            intr_size=np.array([self.intrinsics["width"], self.intrinsics["height"]]),
                            intr_model=np.array(self.intrinsics["model"]))

    @classmethod
    def from_npz(cls, path: Path, diagnostics: dict | None = None) -> "SfmResult":
        z = np.load(path, allow_pickle=False)
        splits = np.cumsum(z["track_len"])[:-1]
        tracks = np.split(z["track_idx"], splits) if len(z["track_len"]) else []
        return cls([str(n) for n in z["names"]], z["centers"], z["rotations"],
                   {"model": str(z["intr_model"]), "width": int(z["intr_size"][0]), "height": int(z["intr_size"][1]),
                    "params": z["intr_params"].tolist()},
                   z["image_errors"], z["points"], z["colors"], z["errors"], tracks, diagnostics or {})

    def camera_axes(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Camera x (right), y (down) and z (forward) axes in world coordinates."""
        return self.rotations[:, 0, :], self.rotations[:, 1, :], self.rotations[:, 2, :]

    def focal(self) -> float:
        p = self.intrinsics["params"]
        return float(p[0])

    def transformed(self, R: np.ndarray, t: np.ndarray, s: float = 1.0) -> "SfmResult":
        """Apply x' = s R x + t to points and cameras (rotations become R_cam R^T)."""
        return SfmResult(self.names, (s * (R @ self.centers.T)).T + t, self.rotations @ R.T, self.intrinsics,
                         self.image_errors, (s * (R @ self.points.T)).T + t, self.colors, self.errors, self.tracks,
                         self.diagnostics)


def _pair_stats(db_path: Path) -> dict:
    """Verified pairs, inliers and the share of pairs that look like pure rotation (panoramic) or planar views."""
    db = pycolmap.Database.open(str(db_path))
    try:
        ids, geoms = db.read_two_view_geometries()
        configs, inliers = [], []
        for g in geoms:
            configs.append(g.config)
            inliers.append(len(g.inlier_matches))
        kp = [db.num_keypoints_for_image(im.image_id) for im in db.read_all_images()]
    finally:
        db.close()
    verified = [(c, n) for c, n in zip(configs, inliers) if n >= 15 and c not in (CFG.UNDEFINED, CFG.DEGENERATE)]
    pano = sum(1 for c, _ in verified if c in (CFG.PANORAMIC,))
    planar = sum(1 for c, _ in verified if c in (CFG.PLANAR, CFG.PLANAR_OR_PANORAMIC))
    return {"verified_pairs": len(verified), "mean_inliers": float(np.mean([n for _, n in verified])) if verified else 0.0,
            "panoramic_ratio": pano / len(verified) if verified else 0.0,
            "planar_ratio": planar / len(verified) if verified else 0.0,
            "mean_keypoints": float(np.mean(kp)) if kp else 0.0, "min_keypoints": int(min(kp)) if kp else 0}


def _diagnose(stats: dict, n_images: int, registered: int) -> str:
    """User-facing explanation of why poses could not be estimated, from the measured statistics."""
    if stats["mean_keypoints"] < 150:
        return ("Too few visual features were found (about %d per frame): the views are textureless, dark or "
                "blurred. Film with the lights on and include edges, furniture and doors." % stats["mean_keypoints"])
    if stats["verified_pairs"] < max(3, n_images // 4):
        return ("Camera motion or visual overlap is insufficient for reliable reconstruction: only %d frame pairs "
                "could be matched. Walk more slowly so consecutive views overlap." % stats["verified_pairs"])
    if stats["panoramic_ratio"] > 0.5:
        return ("The camera mostly rotated on the spot (pure rotation gives no depth). Walk sideways along the "
                "walls while filming instead of turning in place.")
    return (f"Only {registered} of {n_images} frames could be placed in a consistent 3D reconstruction "
            "(repeated patterns, reflections or abrupt motion). Record a slower, continuous walkthrough.")


def make_pairs(names: list[str], window: int = 30, cross_stride: int = 2, loop_stride: int = 8) -> list[tuple[str, str]]:
    """Image pairs to match when exhaustive matching is too expensive or several videos are combined:
    neighbours within ``window`` keyframes of the same video, a sparse grid of loop-closure pairs within a video,
    and every frame of a later video against every ``cross_stride``-th frame of the earlier ones (so additional
    footage is connected to the existing reconstruction wherever it overlaps)."""
    groups: dict[str, list[str]] = {}
    for n in names:
        groups.setdefault(n.split("/")[0], []).append(n)
    pairs = set()
    keys = list(groups)
    for g in keys:
        L = groups[g]
        for i in range(len(L)):
            for j in range(i + 1, min(len(L), i + window + 1)):
                pairs.add((L[i], L[j]))
        for i in range(0, len(L), loop_stride):
            for j in range(i + window + 1, len(L), loop_stride):
                pairs.add((L[i], L[j]))
    for gi, g in enumerate(keys[1:], 1):
        earlier = [n for k in keys[:gi] for n in groups[k]][::cross_stride]
        for a in groups[g]:
            for b in earlier:
                pairs.add((b, a))
    return sorted(pairs)


def run(image_dir: Path, names: list[str], work: Path, progress=lambda f, m: None, max_features: int = 4096,
        min_registered: int = 6) -> SfmResult:
    """Run SfM on ``names`` (in ``image_dir``); keep the largest model. Raises StageFailed with a reason."""
    t0 = time.time()
    if work.exists():
        shutil.rmtree(work)
    (work / "model").mkdir(parents=True)
    db = work / "database.db"
    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = "SIMPLE_RADIAL"
    ext = pycolmap.FeatureExtractionOptions()
    ext.use_gpu = False
    ext.num_threads = -1
    ext.sift.max_num_features = max_features
    progress(0.05, f"Extracting SIFT features from {len(names)} frames")
    pycolmap.extract_features(db, image_dir, image_names=names, camera_mode=pycolmap.CameraMode.SINGLE,
                              reader_options=reader, extraction_options=ext, device=pycolmap.Device.cpu)
    match = pycolmap.FeatureMatchingOptions()
    match.use_gpu = False
    match.num_threads = -1
    videos = len({n.split("/")[0] for n in names})
    if len(names) <= 150 and videos == 1:
        progress(0.25, f"Matching all {len(names) * (len(names) - 1) // 2} frame pairs")
        pycolmap.match_exhaustive(db, matching_options=match, device=pycolmap.Device.cpu)
    else:
        pairs = make_pairs(names)
        (work / "pairs.txt").write_text("".join(f"{a} {b}\n" for a, b in pairs))
        pairing = pycolmap.ImportedPairingOptions()
        pairing.match_list_path = str(work / "pairs.txt")
        progress(0.25, f"Matching {len(pairs)} frame pairs (neighbours, loop closures"
                       + (", and new footage against the earlier video)" if videos > 1 else ")"))
        pycolmap.match_image_pairs(db, matching_options=match, pairing_options=pairing, device=pycolmap.Device.cpu)
    stats = _pair_stats(db)
    progress(0.45, f"{stats['verified_pairs']} geometrically verified frame pairs; estimating camera poses")

    opts = pycolmap.IncrementalPipelineOptions()
    opts.num_threads = -1
    opts.min_model_size = 3
    opts.multiple_models = True
    opts.ba_use_gpu = False
    # Hand-held room videos turn quickly and blur: accept smaller (still RANSAC-verified) 2D-3D inlier sets when
    # registering a frame. On TUM fr1/room this registers 111 instead of 87 of 148 keyframes.
    opts.mapper.abs_pose_min_num_inliers = 15
    opts.mapper.abs_pose_min_inlier_ratio = 0.15
    try:
        models = pycolmap.incremental_mapping(db, image_dir, work / "model", options=opts)
    except Exception as exc:  # noqa: BLE001
        raise StageFailed(f"Structure-from-Motion failed: {exc}. " + _diagnose(stats, len(names), 0)) from exc
    best = max(models.values(), key=lambda r: r.num_reg_images(), default=None)
    registered = best.num_reg_images() if best is not None else 0
    diag = {"input_frames": len(names), "registered_frames": registered,
            "registered_ratio": registered / max(1, len(names)), "models": len(models), **stats}
    if best is None or registered < min_registered or registered < 0.3 * len(names):
        raise StageFailed(_diagnose(stats, len(names), registered))
    progress(0.9, f"{registered} of {len(names)} frames registered")

    img_ids = sorted(best.reg_image_ids(), key=lambda i: best.image(i).name)
    index = {iid: k for k, iid in enumerate(img_ids)}
    names_out, centers, rots, img_err = [], [], [], []
    per_img_err: dict[int, list[float]] = {i: [] for i in img_ids}
    pids = list(best.point3D_ids())
    pts = np.zeros((len(pids), 3))
    cols = np.zeros((len(pids), 3), np.uint8)
    errs = np.zeros(len(pids))
    tracks = []
    for k, pid in enumerate(pids):
        p = best.point3D(pid)
        pts[k], cols[k], errs[k] = p.xyz, p.color, p.error
        obs = sorted({index[e.image_id] for e in p.track.elements if e.image_id in index})
        tracks.append(np.array(obs, dtype=np.int32))
        for e in p.track.elements:
            if e.image_id in per_img_err:
                per_img_err[e.image_id].append(p.error)
    for iid in img_ids:
        im = best.image(iid)
        pose = im.cam_from_world()
        names_out.append(im.name)
        rots.append(pose.rotation.matrix())
        centers.append(im.projection_center())
        img_err.append(float(np.mean(per_img_err[iid])) if per_img_err[iid] else float("nan"))
    cam = best.camera(best.image(img_ids[0]).camera_id)
    diag.update({"points": len(pids), "mean_track_length": float(best.compute_mean_track_length()) if pids else 0.0,
                 "reprojection_error_px": float(best.compute_mean_reprojection_error()) if pids else None,
                 "focal_px": float(cam.params[0]), "seconds": round(time.time() - t0, 1),
                 "unregistered": sorted(set(names) - set(names_out)), "scale": "unknown (video has no metric scale)"})
    warnings = []
    if diag["registered_ratio"] < 0.8:
        warnings.append(f"{len(names) - registered} frames could not be placed; parts of the room they show are missing.")
    if diag["reprojection_error_px"] and diag["reprojection_error_px"] > 1.5:
        warnings.append("High reprojection error: camera poses are less precise than usual.")
    if diag["models"] > 1:
        warnings.append(f"The video split into {diag['models']} disconnected reconstructions; the largest one is used.")
    diag["warnings"] = warnings
    return SfmResult(names_out, np.array(centers), np.array(rots),
                     {"model": cam.model_name, "width": int(cam.width), "height": int(cam.height),
                      "params": [float(v) for v in cam.params]},
                     np.array(img_err), pts, cols, errs, tracks, diag)
