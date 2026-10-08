"""Mode B tests run in the Mode B environment:  cd backend && mode_b\\.venv\\Scripts\\python -m pytest mode_b/tests
Projects are written to a temporary folder. Videos made here are SYNTHETIC (generated textures), used only to test
the pipeline mechanics; reconstruction quality is evaluated on real footage (mode_b/evaluation)."""
import os
import sys
import tempfile
from pathlib import Path

os.environ["ARCHNEXT_MODEB_DATA"] = tempfile.mkdtemp(prefix="archnext-modeb-test-")
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))   # backend/ (for "import mode_b")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402


def write_video(path: Path, frames, fps: float = 20.0) -> Path:
    h, w = frames[0].shape[:2]
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    assert vw.isOpened()
    for f in frames:
        vw.write(f)
    vw.release()
    return path


def pan_frames(n: int, step: float, size=(480, 360), seed: int = 0, blur_from: int | None = None,
               still_from: int | None = None, still_to: int | None = None):
    """A camera panning across a random texture (synthetic). Optional blurred and motionless segments."""
    rng = np.random.default_rng(seed)
    tex = cv2.GaussianBlur((rng.random((size[1] + 40, size[0] + int(n * step) + 40, 3)) * 255).astype(np.uint8),
                           (5, 5), 0)
    out, x = [], 0.0
    for i in range(n):
        if not (still_from is not None and still_from <= i < still_to):
            x += step
        f = tex[20:20 + size[1], int(x):int(x) + size[0]].copy()
        if blur_from is not None and i >= blur_from:
            f = cv2.GaussianBlur(f, (31, 31), 12)
        out.append(f)
    return out


@pytest.fixture()
def tmp_video(tmp_path):
    def make(name="pan.mp4", **kw):
        fps = kw.pop("fps", 20.0)
        return write_video(tmp_path / name, pan_frames(**kw), fps)
    return make
