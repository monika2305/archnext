"""A/B/C/D ablation of Mode B on TUM RGB-D (real videos, sensor ground truth).

  A  baseline        input video, plane-based reconstruction, completion OFF, no extra views
  B  VisionTrust     same reconstruction as A (same frames, same SfM run), completion ON
  C  full            B + K pool clips chosen by NextBestView, re-reconstructed with the extend pipeline
  D  random control  B + K pool clips chosen at random (same budget K), several seeds

C and D use the identical extend pipeline and the same number of additional clips (equal observation budget).
NextBestView scores each candidate clip with the app's own visibility test from the B reconstruction only
(its GT camera poses are used as the candidate viewpoints, expressed in the reconstruction's frame through the
evaluation-only alignment of the input cameras; no GT geometry is used for selection). Held-out clips are never
given to any reconstruction.

Usage:  cd backend && mode_b\\.venv\\Scripts\\python -m mode_b.evaluation.run_ablation [--sequences ...] [--k 2]
Writes mode_b/results/ablation.json, ablation.csv and reduced scenes for the Research dashboard.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

RESULTS = Path(__file__).resolve().parent.parent / "results"
WORK = Path(os.environ.get("ARCHNEXT_EVAL_WORK") or (Path.home() / ".archnext" / "mode_b_eval"))
os.environ["ARCHNEXT_MODEB_DATA"] = str(WORK / "data")

from .. import layout as layout_mod, projects, trust  # noqa: E402
from .. import pipeline  # noqa: E402
from ..errors import StageFailed  # noqa: E402
from ..scene import assemble  # noqa: E402
from ..settings import ProcessingSettings  # noqa: E402
from ..sfm import SfmResult  # noqa: E402
from ..worker import Status  # noqa: E402
from . import protocol  # noqa: E402
from .metrics import METRICS, evaluate  # noqa: E402
from .tum import Sequence  # noqa: E402

SEQUENCES = {
    "rgbd_dataset_freiburg1_room": {"input_frac": 0.5, "kind": "room"},
    "rgbd_dataset_freiburg3_long_office_household": {"input_frac": 0.5, "kind": "room"},
    "rgbd_dataset_freiburg3_cabinet": {"input_frac": 0.5, "kind": "object in a hall (not a closed room)"},
    "rgbd_dataset_freiburg1_360": {"input_frac": 1.0, "kind": "failure case: rotation on the spot"},
    "rgbd_dataset_freiburg3_nostructure_notexture_far": {"input_frac": 1.0, "kind": "failure case: textureless"},
}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def run_job(pid: str, action: str, args: list[str]) -> tuple[bool, str, dict]:
    st = Status(pid, action)
    try:
        msg = pipeline.run(action, pid, args, st)
        st.finish("done", msg)
        ok = True
    except StageFailed as exc:
        st.finish("failed", "stopped", str(exc))
        ok, msg = False, str(exc)
    secs = {s["key"]: s.get("seconds") for s in st.data["stages"]}
    return ok, msg, secs


def new_project(name: str, video: Path, completion: bool = True) -> str:
    s = ProcessingSettings(completion=completion)
    pid, d = projects.create(name, s.to_dict())
    shutil.copy(video, d / "input" / "video_0.mp4")
    p = projects.load(pid)
    p["videos"].append({"file": "video_0.mp4", "original_name": video.name, "bytes": video.stat().st_size,
                        "container": "MP4", "role": "initial"})
    projects.save(pid, p)
    return pid


def clone(pid: str, name: str) -> str:
    new, d = projects.create(name, {})
    shutil.rmtree(d)
    shutil.copytree(projects.path(pid), d)
    p = projects.load(new)
    p["id"], p["name"] = new, name
    projects.save(new, p)
    return new


def extend(pid: str, video: Path) -> tuple[bool, str, dict]:
    p = projects.load(pid)
    n = len(p["videos"])
    shutil.copy(video, projects.path(pid) / "input" / f"video_{n}.mp4")
    p["videos"].append({"file": f"video_{n}.mp4", "original_name": video.name, "bytes": video.stat().st_size,
                        "container": "MP4", "role": "additional"})
    projects.save(pid, p)
    return run_job(pid, "extend", [str(n)])


def frame_map(pid: str, video_frames: dict[str, list[int]]) -> dict[str, int]:
    """Image name -> sequence frame index, through each keyframe's frame index in its video."""
    out = {}
    d = projects.path(pid)
    for folder, frames in video_frames.items():
        m = projects.read_json(d / folder / "manifest.json")
        for f in m["keyframes"]:
            out[f"{folder}/{f['name']}"] = frames[f["index"]]
    return out


def baseline_scene(pid: str, version: int) -> dict:
    """Experiment A from the same SfM run and layout as B: VisionTrust completion off."""
    vdir = projects.version_dir(pid, version)
    sc_b = projects.read_json(vdir / "scene.json")
    sfm = SfmResult.from_npz(vdir / "sfm_raw.npz", sc_b["diagnostics"])
    fr = sc_b["layout"]["frame"]
    lay = layout_mod.estimate(sfm, frame=(np.array(fr["R"]), np.array(fr["t"])))
    d = projects.path(pid)
    manifests = {sub.name: projects.read_json(sub / "manifest.json") for sub in sorted(d.glob("frames*"))}
    return assemble(version, lay, sc_b["diagnostics"], manifests, False, sc_b["method"]["dense"])


def clip_poses_in_scene(seq: Sequence, clip: list[int], to_gt, frame: protocol.SceneFrame, fps_sample: float = 4.0):
    """Candidate viewpoints of a pool clip (sampled at 4 fps) in the reconstruction's scene frame."""
    step = max(1, int(round(seq.fps() / fps_sample)))
    inv = to_gt.inverse()
    M = frame.R @ inv.R                                          # GT direction -> scene direction
    C, R = [], []
    for i in clip[::step]:
        T = seq.pose_at(seq.rgb[i][0])
        if T is None:
            continue
        C.append(frame.inverse_point(inv(T[:3, 3][None])[0]))
        R.append(T[:3, :3].T @ M.T)                            # world(scene) -> camera
    return np.array(C), np.array(R)


def nbv_select(seq, sp, scene_b: dict, lay_b, to_gt, frame, k: int) -> tuple[list[int], list[dict]]:
    """Greedy selection of k pool clips maximising newly covered generated/uncertain area (NBV scoring)."""
    S = lay_b.sfm
    f, w, h = S.focal(), S.intrinsics["width"], S.intrinsics["height"]
    X, N, W = [], [], []
    for s in scene_b["surfaces"]:
        c = np.array(s["corners"], float)
        o, u, v = c[0], c[1] - c[0], c[3] - c[0]
        nu, nv = s["grid"]
        for cell in s["cells"]:
            wgt = 1.0 if cell["cls"] == "generated" else 0.5 * (1 - cell["confidence"]) if cell["cls"] == "uncertain" else 0
            if wgt > 0:
                X.append(o + (cell["i"] + 0.5) / nu * u + (cell["j"] + 0.5) / nv * v)
                N.append(s["normal"])
                W.append(wgt * cell["area"])
    X, N, W = np.array(X), np.array(N, float), np.array(W)
    seen_by = []
    for clip in sp.pool:
        C, R = clip_poses_in_scene(seq, clip, to_gt, frame)
        vis = np.zeros(len(X), bool)
        if len(C) and len(X):
            for n in np.unique(N, axis=0):
                sel = np.all(N == n, axis=1)
                vis[sel] = trust.visibility_from(C, R, f, w, h, X[sel], n, near=0.02 * lay_b.scale_ref).any(axis=0)
        seen_by.append(vis)
    chosen, covered, info = [], np.zeros(len(X), bool), []
    for _ in range(min(k, len(sp.pool))):
        gains = [float(W[v & ~covered].sum()) if j not in chosen else -1 for j, v in enumerate(seen_by)]
        j = int(np.argmax(gains))
        chosen.append(j)
        covered |= seen_by[j]
        info.append({"clip": j, "predicted_gain": round(gains[j], 5),
                     "predicted_gain_share": round(gains[j] / max(W.sum(), 1e-12), 4)})
    return chosen, info


def write_concat(seq: Sequence, clips: list[list[int]], out: Path) -> list[int]:
    frames = [i for c in clips for i in c]
    seq.write_video(out, frames)
    return frames


def reduced(scene: dict) -> dict:
    """Scene for the Research dashboard: surfaces and cameras (no point cloud, no per-cell frame lists)."""
    surf = [{**s, "cells": [{k: v for k, v in c.items() if k != "frames"} for c in s["cells"]]} for s in scene["surfaces"]]
    cams = [{k: c[k] for k in ("center", "forward", "up")} for c in scene["cameras"]]
    return {"version": scene["version"], "surfaces": surf, "cameras": cams, "summary": scene["summary"],
            "layout": {k: scene["layout"][k] for k in ("reliable", "box", "failure")}, "points": {"xyz": [], "rgb": []},
            "nbv": scene.get("nbv"), "completion": scene["completion"]}


def run_sequence(name: str, cfg: dict, k: int, seeds: list[int]) -> dict:
    t_all = time.time()
    seq = Sequence.load(name)
    sp = protocol.split(seq, cfg["input_frac"])
    work = WORK / name
    work.mkdir(parents=True, exist_ok=True)
    out = {"sequence": name, "kind": cfg["kind"], "frames": len(seq.rgb), "duration_s": round(len(seq.rgb) / seq.fps(), 1),
           "input_frames": len(sp.input), "input_s": round(len(sp.input) / seq.fps(), 1),
           "pool_clips": len(sp.pool), "heldout_clips": len(sp.heldout), "k": k, "configs": {}}
    vid = seq.write_video(work / "input.mp4", sp.input)
    log(name, "input", len(sp.input), "frames; pool", len(sp.pool), "held-out", len(sp.heldout))
    pid = new_project(f"eval {name} input", vid)
    t0 = time.time()
    ok, msg, secs = run_job(pid, "process", [])
    out["process_seconds"] = round(time.time() - t0, 1)
    out["stage_seconds"] = secs
    if not ok or not projects.load(pid)["versions"]:
        out["success"] = False
        out["failure"] = msg
        log(name, "FAILED:", msg)
        return out
    sc_b = projects.scene(pid, 1)
    out["success"] = True
    out["layout_reliable"] = sc_b["layout"]["reliable"]
    out["sfm"] = {k2: sc_b["diagnostics"].get(k2) for k2 in ("input_frames", "registered_frames", "points",
                                                             "reprojection_error_px", "mean_track_length", "seconds")}
    if not sp.pool:                                  # failure-case sequences: no evaluation split
        out["note"] = "Whole sequence used as input (reliability check only)."
        return out
    ref = protocol.gt_reference(seq)
    tree = cKDTree(ref["shell"])
    held = protocol.heldout_samples(seq, [f for c in sp.heldout for f in c], tree)
    out["reference"] = {"gt_layout_reliable": ref["layout_reliable"], "measured_planes": ref["measured"],
                        "shell_points": int(len(ref["shell"])), "heldout_frames": len(held),
                        "heldout_pixels": int(sum(len(h["depth"]) for h in held))}
    intr = seq.intrinsics

    def score(pid_x, version, scene, video_frames):
        fm = frame_map(pid_x, video_frames)
        vdir = projects.version_dir(pid_x, version)
        raw = SfmResult.from_npz(vdir / "sfm_raw.npz")
        idx = [fm[n] for n in raw.names]
        to_gt, al = protocol.align_raw_to_gt(seq, raw.centers, idx)
        frame = protocol.SceneFrame(scene["layout"]["frame"]["R"], scene["layout"]["frame"]["t"])
        m = evaluate(scene, to_gt, frame, ref["shell"], tree, ref["walls"], held, intr)
        m["alignment"] = al
        m["registered_frames"] = len(raw.names)
        return m, to_gt, frame

    vf_in = {"frames": sp.input}
    sc_a = baseline_scene(pid, 1)
    m_a, to_gt, frame = score(pid, 1, sc_a, vf_in)
    m_b, _, _ = score(pid, 1, sc_b, vf_in)
    out["configs"]["A"] = {"metrics": m_a, "completion": False, "extra_clips": []}
    out["configs"]["B"] = {"metrics": m_b, "completion": True, "extra_clips": []}
    (RESULTS / "scenes").mkdir(parents=True, exist_ok=True)
    short = name.replace("rgbd_dataset_", "")
    for cfg_name, sc in (("A", sc_a), ("B", sc_b)):
        (RESULTS / "scenes" / f"{short}_{cfg_name}.json").write_text(json.dumps(reduced(sc)), encoding="utf-8")
    log(name, "A/B done", {kk: m_b.get(kk) for kk in ("completeness", "chamfer_m", "observed_share")})

    # C: NextBestView-selected clips
    sfm_b = SfmResult.from_npz(projects.version_dir(pid, 1) / "sfm_raw.npz")
    fr = sc_b["layout"]["frame"]
    lay_b = layout_mod.estimate(sfm_b, frame=(np.array(fr["R"]), np.array(fr["t"])))
    chosen, sel_info = nbv_select(seq, sp, sc_b, lay_b, to_gt, frame, k)
    runs = [("C", chosen, {"selection": "NextBestView", "details": sel_info})]
    rng = np.random.default_rng(12345)
    for s in seeds:
        r = np.random.default_rng(s).choice(len(sp.pool), size=min(k, len(sp.pool)), replace=False).tolist()
        runs.append((f"D{s}", sorted(r), {"selection": "random", "seed": s}))
    del rng
    for label, clips, meta in runs:
        frames_ext = write_concat(seq, [sp.pool[j] for j in clips], work / f"extra_{label}.mp4")
        pid_x = clone(pid, f"eval {name} {label}")
        t1 = time.time()
        ok, msg, secs = extend(pid_x, work / f"extra_{label}.mp4")
        entry = {"completion": True, "extra_clips": clips, "extra_frames": len(frames_ext), **meta,
                 "seconds": round(time.time() - t1, 1), "stage_seconds": secs}
        if not ok:
            entry.update({"success": False, "failure": msg})
            log(name, label, "extend failed:", msg[:160])
        else:
            sc = projects.scene(pid_x, 2)
            m, _, _ = score(pid_x, 2, sc, {"frames": sp.input, "frames_1": frames_ext})
            entry.update({"success": True, "metrics": m, "alignment_extend": sc["diagnostics"].get("alignment")})
            if label in ("C", "D0"):
                (RESULTS / "scenes" / f"{short}_{label[0]}.json").write_text(json.dumps(reduced(sc)), encoding="utf-8")
            log(name, label, "clips", clips, {kk: m.get(kk) for kk in ("completeness", "chamfer_m", "observed_share")})
        out["configs"][label] = entry
    # D summary over seeds
    ds = [v for kk, v in out["configs"].items() if kk.startswith("D") and v.get("success")]
    if ds:
        keys = [kk for kk in ds[0]["metrics"] if isinstance(ds[0]["metrics"][kk], (int, float))]
        out["configs"]["D"] = {"completion": True, "selection": "random", "seeds": [v["seed"] for v in ds],
                               "metrics_mean": {kk: float(np.mean([v["metrics"][kk] for v in ds if v["metrics"].get(kk) is not None]))
                                                for kk in keys if any(v["metrics"].get(kk) is not None for v in ds)},
                               "metrics_std": {kk: float(np.std([v["metrics"][kk] for v in ds if v["metrics"].get(kk) is not None]))
                                               for kk in keys if any(v["metrics"].get(kk) is not None for v in ds)},
                               "failed_seeds": [kk for kk, v in out["configs"].items() if kk.startswith("D") and kk != "D" and not v.get("success")]}
    out["seconds_total"] = round(time.time() - t_all, 1)
    return out


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else round(float(o), 5)
    if isinstance(o, np.integer):
        return int(o)
    return o


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--sequences", nargs="*", default=list(SEQUENCES))
    ap.add_argument("--k", type=int, default=2)
    ap.add_argument("--seeds", type=int, default=3)
    a = ap.parse_args(argv)
    RESULTS.mkdir(parents=True, exist_ok=True)
    prev = json.loads((RESULTS / "ablation.json").read_text()) if (RESULTS / "ablation.json").exists() else {}
    results = {r["sequence"]: r for r in prev.get("sequences", [])}
    for name in a.sequences:
        if not (protocol.Sequence and (Path(os.environ.get("ARCHNEXT_TUM") or (Path.home() / ".cache/archnext/datasets/tum")) / name).exists()):
            log("missing sequence", name)
            continue
        results[name] = clean(run_sequence(name, SEQUENCES[name], a.k, list(range(a.seeds))))
        write(results, a)
    write(results, a)


def write(results: dict, a) -> None:
    doc = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "dataset": {"name": "TUM RGB-D benchmark", "license": "CC BY 4.0",
                    "url": "https://cvg.cit.tum.de/data/datasets/rgbd-dataset",
                    "citation": "Sturm et al., A Benchmark for the Evaluation of RGB-D SLAM Systems, IROS 2012"},
        "protocol": {
            "input": "first 50 % of each sequence as the input video (MP4 encoded from the RGB frames); the same split for every configuration",
            "pool": "remaining time cut into 2 s clips; 3 of every 4 are candidate clips, every 4th is held out",
            "heldout": "held-out clips are never given to a reconstruction; their depth frames evaluate novel views",
            "budget": f"C and D each add {a.k} clips (same number of frames per clip)",
            "random_seeds": a.seeds,
            "alignment": "evaluation-only Sim3 (Umeyama) of registered camera centres to motion-capture centres; "
                         "the app never sees ground truth",
            "reference": "TUM depth back-projected with ground-truth poses; room shell = points within 5 cm of floor/wall/"
                         "ceiling planes fitted to that dense cloud",
            "intrinsics": "unknown to the app (estimated by COLMAP), as for a phone video",
            "hardware": "Intel i7-1360P, 16 GB RAM, no CUDA GPU (CPU-only COLMAP; no dense MVS)",
        },
        "configs": {"A": "Baseline: sparse SfM + plane fitting, observed planes only, no completion, no extra views",
                    "B": "VisionTrust completion on, same frames and SfM run as A",
                    "C": "B + NextBestView-selected clips (extend pipeline)",
                    "D": "B + randomly selected clips, same budget (mean ± std over seeds)"},
        "metrics": METRICS,
        "sequences": list(results.values()),
    }
    (RESULTS / "ablation.json").write_text(json.dumps(clean(doc), indent=1), encoding="utf-8")
    rows = []
    for r in results.values():
        for cfg, v in r.get("configs", {}).items():
            m = v.get("metrics") or v.get("metrics_mean") or {}
            rows.append({"sequence": r["sequence"], "config": cfg, **{k: m.get(k) for k in METRICS},
                         "extra_clips": json.dumps(v.get("extra_clips")), "success": v.get("success", True)})
    if rows:
        with open(RESULTS / "ablation.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)


if __name__ == "__main__":
    sys.exit(main())
