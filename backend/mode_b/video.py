"""Video validation, frame extraction and keyframe selection (OpenCV + NumPy; runs in the Mode B worker).

Keyframes are chosen for Structure-from-Motion: sharp (variance of the Laplacian, relative to the video's own
median, so dim or soft footage is judged against itself), not near-duplicates, and separated by enough camera
motion (median sparse optical-flow displacement as a fraction of the image diagonal) to give parallax.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .settings import MAX_DURATION_S, MIN_DURATION_S, ProcessingSettings


class VideoError(ValueError):
    """The video cannot be used; the message is shown to the user."""


@dataclass
class VideoInfo:
    width: int
    height: int
    fps: float
    frames: int
    duration_s: float
    codec: str

    def to_dict(self) -> dict:
        return dict(self.__dict__)


def _fourcc(cap) -> str:
    v = int(cap.get(cv2.CAP_PROP_FOURCC))
    s = "".join(chr((v >> 8 * i) & 0xFF) for i in range(4))
    return s if s.isprintable() and s.strip() else "unknown"


def probe(path: Path) -> VideoInfo:
    """Open the video and decode its first frame; raise VideoError with a readable reason otherwise."""
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise VideoError("The video could not be opened. It may be corrupted or use an unsupported codec; "
                             "export it as MP4 (H.264) and try again.")
        ok, frame = cap.read()
        if not ok or frame is None:
            raise VideoError("No frame could be decoded from this video (unsupported codec or corrupted file). "
                             "Export it as MP4 (H.264) and try again.")
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0 or fps > 240:
            raise VideoError("The video reports no valid frame rate, so frame timestamps cannot be trusted.")
        info = VideoInfo(frame.shape[1], frame.shape[0], round(fps, 3), n, round(n / fps, 2) if n > 0 else 0.0,
                         _fourcc(cap))
    finally:
        cap.release()
    if info.duration_s and info.duration_s < MIN_DURATION_S:
        raise VideoError(f"The video is only {info.duration_s:.1f} s long. Record at least {MIN_DURATION_S:.0f} s "
                         "while walking slowly around the room.")
    if info.duration_s > MAX_DURATION_S:
        raise VideoError(f"The video is {info.duration_s:.0f} s long; the limit is {MAX_DURATION_S:.0f} s. "
                         "Trim it to one walkthrough of the room.")
    if min(info.width, info.height) < 240:
        raise VideoError(f"The resolution ({info.width}x{info.height}) is too low for reliable reconstruction.")
    return info


def sharpness(gray: np.ndarray) -> float:
    """Variance of the Laplacian on a 640-px-wide copy (comparable across resolutions)."""
    s = 640.0 / max(gray.shape[1], 1)
    g = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else gray
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def motion(prev: np.ndarray, cur: np.ndarray) -> tuple[float, int]:
    """Median optical-flow displacement of tracked corners as a fraction of the diagonal; number tracked.

    Returns (inf, 0) when nothing can be tracked (treated as a large change, not as a duplicate)."""
    pts = cv2.goodFeaturesToTrack(prev, maxCorners=300, qualityLevel=0.01, minDistance=8)
    if pts is None or len(pts) < 8:
        return float("inf"), 0
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev, cur, pts, None, winSize=(21, 21), maxLevel=3)
    good = st.reshape(-1) == 1
    if good.sum() < 8:
        return float("inf"), int(good.sum())
    d = np.linalg.norm((nxt - pts).reshape(-1, 2)[good], axis=1)
    return float(np.median(d) / np.hypot(*prev.shape[:2])), int(good.sum())


def texture_score(gray: np.ndarray) -> int:
    """Number of FAST corners on a 640-px-wide copy: very low values mean textureless views."""
    s = 640.0 / max(gray.shape[1], 1)
    g = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else gray
    return len(cv2.FastFeatureDetector_create(threshold=20).detect(g))


def sample_frames(path: Path, info: VideoInfo, settings: ProcessingSettings):
    """Yield (frame index, timestamp s, BGR frame) at ``settings.sample_fps`` (decoding sequentially)."""
    step = max(1, int(round(info.fps / settings.sample_fps)))
    cap = cv2.VideoCapture(str(path))
    try:
        i = 0
        while True:
            ok = cap.grab()
            if not ok:
                break
            if i % step == 0:
                ok, frame = cap.retrieve()
                if ok and frame is not None:
                    yield i, round(i / info.fps, 3), frame
            i += 1
    finally:
        cap.release()


def _prepare(frame: np.ndarray, settings: ProcessingSettings) -> tuple[np.ndarray, np.ndarray]:
    scale = min(1.0, settings.max_side / max(frame.shape[:2]))
    if scale < 1:
        frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return frame, cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)


def select_keyframes(path: Path, out_dir: Path, settings: ProcessingSettings, info: VideoInfo | None = None,
                     name_prefix: str = "", progress=None) -> dict:
    """Extract sampled frames, reject blurry ones and near-duplicates, keep frames with enough camera motion,
    write them as JPEG to ``out_dir`` and return the keyframe manifest (also written as manifest.json).

    Two streaming passes, so memory does not grow with video length: (1) sharpness of every sampled frame,
    which sets the video's own blur limit; (2) selection, keeping only the last keyframe in memory."""
    info = info or probe(path)
    out_dir.mkdir(parents=True, exist_ok=True)
    expected = max(1, int(info.duration_s * settings.sample_fps)) if info.duration_s else 1
    report = (lambda f, msg: progress(f, msg)) if progress else (lambda f, msg: None)

    timeline = []
    for k, (idx, t, frame) in enumerate(sample_frames(path, info, settings)):
        _, gray = _prepare(frame, settings)
        timeline.append({"index": idx, "time": t, "sharpness": round(sharpness(gray), 1),
                         "brightness": round(float(gray.mean()), 1)})
        if k % 10 == 0:
            report(min(0.4, 0.4 * (k + 1) / expected), f"Measured sharpness of {k + 1} frames")
    if len(timeline) < 3:
        raise VideoError("Too few frames could be decoded from this video.")
    blur_limit = float(np.median([s["sharpness"] for s in timeline]) * settings.blur_ratio)

    rejected = {"blurry": 0, "duplicate": 0, "little_motion": 0, "thinned": 0}
    kept, last_gray = [], None
    by_index = {s["index"]: s for s in timeline}
    for k, (idx, t, frame) in enumerate(sample_frames(path, info, settings)):
        s = by_index.get(idx)
        if s is None:
            continue
        if s["sharpness"] < blur_limit:
            s["status"] = "blurry"
            rejected["blurry"] += 1
            continue
        frame, gray = _prepare(frame, settings)
        if last_gray is not None:
            m, _ = motion(last_gray, gray)
            s["motion"] = None if m == float("inf") else round(m, 4)
            if m < settings.min_motion * 0.25:
                s["status"] = "duplicate"
                rejected["duplicate"] += 1
                continue
            if m < settings.min_motion:
                s["status"] = "little_motion"
                rejected["little_motion"] += 1
                continue
        s["status"] = "keyframe"
        name = f"{name_prefix}kf_{len(kept):04d}.jpg"
        cv2.imwrite(str(out_dir / name), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        kept.append({"name": name, "index": idx, "time": t, "sharpness": s["sharpness"], "motion": s.get("motion"),
                     "brightness": s["brightness"], "texture": texture_score(gray), "size": [frame.shape[1], frame.shape[0]]})
        last_gray = gray
        if k % 10 == 0:
            report(0.4 + min(0.5, 0.5 * (k + 1) / expected), f"Selected {len(kept)} keyframes")

    if len(kept) > settings.max_keyframes:          # keep an even spread in time
        pick = set(np.linspace(0, len(kept) - 1, settings.max_keyframes).round().astype(int).tolist())
        for j, f in enumerate(kept):
            if j not in pick:
                (out_dir / f["name"]).unlink(missing_ok=True)
                by_index[f["index"]]["status"] = "thinned"
                rejected["thinned"] += 1
        kept = [f for j, f in enumerate(kept) if j in pick]
        for n, f in enumerate(kept):                # contiguous names again
            new = f"{name_prefix}kf_{n:04d}.jpg"
            if new != f["name"]:
                (out_dir / f["name"]).rename(out_dir / new)
                f["name"] = new

    warnings = []
    if kept and np.mean([f["brightness"] for f in kept]) < 45:
        warnings.append("The footage is dark; feature matching may fail. Turn on the lights if possible.")
    if kept and np.median([f["texture"] for f in kept]) < 60:
        warnings.append("Most views show plain, textureless surfaces; camera poses may be unreliable there.")
    if rejected["blurry"] > 0.4 * len(timeline):
        warnings.append(f"{rejected['blurry']} of {len(timeline)} sampled frames are blurry: move the camera more slowly.")
    manifest = {
        "video": info.to_dict(), "settings": settings.to_dict(),
        "image_size": kept[0]["size"] if kept else None,
        "sampled": len(timeline), "rejected": rejected, "blur_limit": round(blur_limit, 1),
        "keyframes": kept, "warnings": warnings, "timeline": timeline,
    }
    if len(kept) < 8:
        manifest["error"] = ("Camera motion or visual overlap is insufficient for reliable reconstruction: only "
                             f"{len(kept)} usable keyframes were found (at least 8 are needed). Walk slowly "
                             "through the room so that consecutive views overlap but the viewpoint changes.")
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    report(1.0, f"{len(kept)} keyframes")
    return manifest
