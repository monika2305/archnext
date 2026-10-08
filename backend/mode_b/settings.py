"""Mode B settings: limits, processing defaults and paths (standard library only)."""
from __future__ import annotations

import os
import sys
from dataclasses import asdict, dataclass, fields
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
MODE_B = Path(__file__).resolve().parent

MAX_UPLOAD_MB = 400
MIN_DURATION_S = 2.0
MAX_DURATION_S = 300.0
# Container signatures checked on the uploaded bytes (the file name / MIME type alone are not trusted).
CONTAINERS = {"mp4": "MP4 / MOV (ISO media)", "webm": "WebM / Matroska", "avi": "AVI"}


def data_dir() -> Path:
    """Projects live outside the repository (and outside OneDrive) by default: videos and frames are large."""
    return Path(os.environ.get("ARCHNEXT_MODEB_DATA") or (Path.home() / ".archnext" / "mode_b"))


def worker_python() -> str:
    """Python of the Mode B environment (pycolmap, OpenCV, SciPy). Falls back to the current interpreter."""
    env = os.environ.get("ARCHNEXT_MODEB_PYTHON")
    if env:
        return env
    for p in (MODE_B / ".venv" / "Scripts" / "python.exe", MODE_B / ".venv" / "bin" / "python"):
        if p.exists():
            return str(p)
    return sys.executable


@dataclass
class ProcessingSettings:
    """User-adjustable processing settings (validated ranges in ``clean``)."""
    sample_fps: float = 4.0           # frames decoded per second of video before selection
    max_keyframes: int = 150          # upper bound on frames given to Structure-from-Motion
    min_motion: float = 0.025         # median feature motion (fraction of image diagonal) between keyframes
    blur_ratio: float = 0.45          # a frame is blurry below this fraction of the video's median sharpness
    max_side: int = 960               # keyframes are resized so the longer side is at most this many pixels
    completion: bool = True           # VisionTrust completion of unseen room regions (off = baseline A)

    RANGES = {"sample_fps": (1.0, 10.0), "max_keyframes": (12, 200), "min_motion": (0.005, 0.15),
              "blur_ratio": (0.1, 0.9), "max_side": (480, 1600)}

    @classmethod
    def clean(cls, raw: dict | None) -> "ProcessingSettings":
        s = cls()
        for f in fields(cls):
            if raw and f.name in raw and raw[f.name] is not None:
                v = raw[f.name]
                if f.type in ("bool", bool):
                    setattr(s, f.name, bool(v))
                    continue
                v = float(v)
                lo, hi = cls.RANGES[f.name]
                if not lo <= v <= hi:
                    raise ValueError(f"{f.name} must be between {lo} and {hi}")
                setattr(s, f.name, int(v) if f.type in ("int", int) else v)
        return s

    def to_dict(self) -> dict:
        return asdict(self)
