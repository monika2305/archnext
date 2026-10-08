"""Mode B processing pipeline (runs in the worker). Each step is a recorded stage; see worker.py.

process: video -> keyframes -> camera poses (SfM) -> room layout -> VisionTrust/GeometryTrust -> NBV -> GLB
extend:  additional video -> keyframes -> joint SfM of all keyframes, aligned (Sim3 on the shared keyframes) to
         the previous version's coordinates -> layout in the same frame -> ... -> new version (old one kept)
"""
from __future__ import annotations

import json
import shutil
import time

import cv2
import numpy as np

from . import layout as layout_mod
from . import projects, scene as scene_mod, sfm as sfm_mod, video
from .errors import StageFailed
from .export import read_glb, scene_to_glb
from .settings import ProcessingSettings

NO_DENSE = ("Dense multi-view stereo was not run: COLMAP PatchMatch stereo requires an NVIDIA CUDA GPU, which this "
            "machine does not have. Geometry comes from the sparse points (plane-based layout).")


def _video_stage(status, pid: str, n: int, settings: ProcessingSettings):
    d = projects.path(pid)
    proj = projects.load(pid)
    path = d / "input" / proj["videos"][n]["file"]
    with status.stage("video") as st:
        try:
            info = video.probe(path)
        except video.VideoError as exc:
            raise StageFailed(str(exc)) from exc
        st.done(f"{info.width}x{info.height}, {info.duration_s:.1f} s at {info.fps:g} fps ({info.codec})",
                info=info.to_dict())
    folder = "frames" if n == 0 else f"frames_{n}"
    with status.stage("keyframes") as st:
        try:
            manifest = video.select_keyframes(path, d / folder, settings, info, name_prefix=f"v{n}_",
                                              progress=st.progress)
        except video.VideoError as exc:
            raise StageFailed(str(exc)) from exc
        if manifest.get("error"):
            raise StageFailed(manifest["error"])
        r = manifest["rejected"]
        st.done(f"{len(manifest['keyframes'])} keyframes from {manifest['sampled']} sampled frames "
                f"({r['blurry']} blurry, {r['duplicate']} near-duplicates, {r['little_motion']} with too little motion)",
                keyframes=len(manifest["keyframes"]))
    proj = projects.load(pid)
    proj["videos"][n].update({"info": info.to_dict(), "frames_folder": folder, "keyframes": len(manifest["keyframes"])})
    projects.save(pid, proj)
    return manifest


def _manifests(pid: str) -> dict:
    d = projects.path(pid)
    out = {}
    for sub in sorted(d.glob("frames*")):
        m = projects.read_json(sub / "manifest.json")
        if m and not m.get("error"):
            out[sub.name] = m
    return out


def umeyama(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """Similarity (s, R, t) minimising |dst - (s R src + t)|^2 (Umeyama 1991)."""
    mu_s, mu_d = src.mean(0), dst.mean(0)
    A, Bm = src - mu_s, dst - mu_d
    U, D, Vt = np.linalg.svd(Bm.T @ A / len(src))
    Sg = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        Sg[2, 2] = -1
    R = U @ Sg @ Vt
    s = np.trace(np.diag(D) @ Sg) / max((A ** 2).sum() / len(src), 1e-12)
    return float(s), R, mu_d - s * R @ mu_s


def robust_sim3(src: np.ndarray, dst: np.ndarray, iters: int = 3) -> tuple[float, np.ndarray, np.ndarray, np.ndarray]:
    """Umeyama with iterative rejection of correspondences beyond 3 x median residual; returns inlier mask."""
    m = np.ones(len(src), bool)
    for _ in range(iters):
        s, R, t = umeyama(src[m], dst[m])
        r = np.linalg.norm((s * (R @ src.T)).T + t - dst, axis=1)
        m_new = r <= max(3 * np.median(r[m]), 1e-9)
        if m_new.sum() < 4 or (m_new == m).all():
            break
        m = m_new
    s, R, t = umeyama(src[m], dst[m])
    return s, R, t, m


def _reconstruct(status, pid: str, names: list[str], prev: dict | None, settings: ProcessingSettings) -> str:
    d = projects.path(pid)
    proj = projects.load(pid)
    version = (max((v["version"] for v in proj["versions"]), default=0)) + 1
    vdir = projects.version_dir(pid, version)
    with status.stage("sfm") as st:
        work = d / ("sfm_next" if prev is not None else "sfm")
        try:
            res = sfm_mod.run(d, names, work, progress=st.progress,
                              existing=(d / "sfm") if prev is not None and (d / "sfm" / "best").is_dir() else None)
        except StageFailed:
            if prev is not None:
                shutil.rmtree(work, ignore_errors=True)       # the previous reconstruction stays as it was
            raise
        alignment = None
        if prev is not None:
            old = sfm_mod.SfmResult.from_npz(prev["dir"] / "sfm_raw.npz")
            common = sorted(set(old.names) & set(res.names))
            latest = names[-1].split("/")[0]                    # the folder of the video just added
            new_names = [n for n in names if n.split("/")[0] == latest]
            new_reg = [n for n in res.names if n in set(new_names)]
            if len(common) < 5 or len(new_reg) < max(3, 0.3 * len(new_names)):
                raise StageFailed(
                    f"The additional footage could not be aligned with the existing reconstruction: {len(new_reg)} of "
                    f"{len(new_names)} new frames were placed and {len(common)} earlier frames were re-identified. "
                    "Record a view that overlaps with what was filmed before (start from a familiar spot). "
                    f"The previous reconstruction (version {prev['version']}) is unchanged.")
            ia = [res.names.index(n) for n in common]
            ib = [old.names.index(n) for n in common]
            s, R, t, inl = robust_sim3(res.centers[ia], old.centers[ib])
            res = res.transformed(R, t, s)
            rmse = float(np.sqrt(np.mean(np.sum((res.centers[ia] - old.centers[ib]) ** 2, axis=1)[inl])))
            spread = float(np.linalg.norm(old.centers - old.centers.mean(0), axis=1).mean())
            alignment = {"common_frames": len(common), "inliers": int(inl.sum()), "new_frames": len(new_names),
                         "new_registered": len(new_reg), "rmse_units": round(rmse, 5),
                         "rmse_relative": round(rmse / max(spread, 1e-9), 4)}
            if rmse > 0.1 * spread:
                raise StageFailed(
                    "The additional footage was reconstructed, but it does not line up consistently with the earlier "
                    f"video (camera-path disagreement {rmse / spread:.0%} of the path size). The previous "
                    f"reconstruction (version {prev['version']}) is unchanged.")
        vdir.mkdir(parents=True, exist_ok=True)
        res.to_npz(vdir / "sfm_raw.npz")
        diag = {**res.diagnostics, "alignment": alignment}
        st.done(f"{diag['registered_frames']} of {diag['input_frames']} frames registered, {diag['points']} 3D points, "
                f"reprojection error {diag['reprojection_error_px']:.2f} px"
                + (f"; aligned with version {prev['version']} on {alignment['common_frames']} shared frames"
                   if alignment else ""), diagnostics=diag)

    with status.stage("layout") as st:
        frame = (np.array(prev["scene"]["layout"]["frame"]["R"]), np.array(prev["scene"]["layout"]["frame"]["t"])) \
            if prev else None
        lay = layout_mod.estimate(res, frame=frame, load_gray=lambda n: cv2.imread(str(d / n), cv2.IMREAD_GRAYSCALE))
        measured = [p.id for p in lay.planes.values() if p.evidence]
        if lay.tau == 0:
            raise StageFailed(lay.failure)
        st.done((f"Measured planes: {', '.join(measured) or 'none'}. ") + (lay.failure or "Room layout estimated."),
                reliable=lay.reliable)

    with status.stage("trust") as st:
        scene = scene_mod.assemble(version, lay, diag, _manifests(pid), settings.completion, NO_DENSE)
        sm = scene["summary"]
        if sm:
            st.done(f"Observed {sm['shares']['observed']:.0%}, uncertain {sm['shares']['uncertain']:.0%}, "
                    f"generated {sm['shares']['generated']:.0%} of the room shell; mean confidence {sm['mean_confidence']}")
        else:
            st.done("No room surfaces could be built; only the reconstructed points are available.")
        if prev is not None:
            scene["comparison"] = {"previous_version": prev["version"], "before": prev["scene"].get("summary"),
                                   "after": scene["summary"]}

    with status.stage("nbv") as st:
        rec = scene["nbv"]
        if rec["recommendations"]:
            st.done(rec["recommendations"][0]["text"])
        else:
            st.skip(rec.get("reason") or "No recommendation")

    with status.stage("export") as st:
        glb = scene_to_glb(scene)
        js, _ = read_glb(glb)                          # the file must parse back
        st.done(f"GLB with {len(js['meshes'])} meshes ({len(glb) / 1024:.0f} kB)", bytes=len(glb))
        scene["export"] = {"glb_bytes": len(glb), "meshes": len(js["meshes"])}

    projects.write_json(vdir / "scene.json", scene)
    proj = projects.load(pid)
    summ = scene["summary"] or {}
    proj["versions"].append({"version": version, "created": scene["created"], "videos": len(proj["videos"]),
                             "keyframes": len(names), "registered": diag["registered_frames"],
                             "summary": {"observed": summ.get("shares", {}).get("observed"),
                                         "generated": summ.get("shares", {}).get("generated"),
                                         "reliable": lay.reliable}})
    proj["current_version"] = version
    projects.save(pid, proj)
    # The COLMAP database and chosen model of the latest version are kept so further footage can be registered
    # into it; the previous ones are not needed any more.
    if prev is not None and (d / "sfm_next").is_dir():
        shutil.rmtree(d / "sfm", ignore_errors=True)
        (d / "sfm_next").rename(d / "sfm")
    return (f"Version {version}: {diag['registered_frames']} frames registered"
            + ("" if lay.reliable else " (partial result: room layout not reliable)"))


def run_rgbd(pid: str, sequence: str, status) -> str:
    """RGB-D sensor demo (TUM depth + dataset poses); see rgbd.py. Never part of the video-only pipeline."""
    from . import rgbd
    d = projects.path(pid)
    if sequence not in {x["sequence"] for x in rgbd.available()}:
        raise StageFailed(f"The RGB-D sequence {sequence!r} is not available locally.")
    with status.stage("frames") as st:
        st.done(f"TUM RGB-D sequence {sequence}: colour + depth images with recorded camera poses")
    with status.stage("fuse") as st:
        scene, r = rgbd.build_scene(sequence, progress=st.progress)
        manifest = rgbd.save_frames(r["seq"], r["frames_used"], d / "frames")
        projects.write_json(d / "frames" / "manifest.json", manifest)
        dg = scene["diagnostics"]
        st.done(f"{dg['points_kept']:,} coloured points from {dg['frames_fused']} depth frames "
                f"({dg['voxel_m'] * 100:.1f} cm voxels measured by >= {dg['min_views']} frames)")
    with status.stage("export") as st:
        glb = scene_to_glb(scene)
        read_glb(glb)
        scene["export"] = {"glb_bytes": len(glb), "meshes": 2}
        st.done(f"GLB {len(glb) / 1e6:.1f} MB")
    vdir = projects.version_dir(pid, 1)
    vdir.mkdir(parents=True, exist_ok=True)
    projects.write_json(vdir / "scene.json", scene)
    proj = projects.load(pid)
    proj["versions"] = [{"version": 1, "created": scene["created"], "videos": 0, "keyframes": dg["frames_fused"],
                         "registered": dg["frames_fused"], "summary": {"observed": None, "generated": None, "reliable": None}}]
    proj["current_version"] = 1
    projects.save(pid, proj)
    return f"RGB-D sensor reconstruction: {dg['points_kept']:,} points"


def run(action: str, pid: str, args: list[str], status) -> str:
    if action == "rgbd":
        return run_rgbd(pid, args[0], status)
    proj = projects.load(pid)
    settings = ProcessingSettings.clean(proj.get("settings"))
    n = int(args[0]) if action == "extend" and args else 0
    _video_stage(status, pid, n, settings)
    manifests = _manifests(pid)
    names = [f"{folder}/{f['name']}" for folder, m in manifests.items() for f in m["keyframes"]]
    prev = None
    if action == "extend":
        v = proj["current_version"]
        prev = {"version": v, "dir": projects.version_dir(pid, v), "scene": projects.scene(pid, v)}
    try:
        return _reconstruct(status, pid, names, prev, settings)
    except Exception:
        shutil.rmtree(projects.path(pid) / "sfm_next", ignore_errors=True)   # keep the previous version intact
        raise
