"""Mode B worker process: ``python -m mode_b.worker <action> <project id> [args]`` (Mode B environment).

Actions
  check                 report available dependencies (JSON on stdout)
  process <id>          first video: keyframes -> camera poses -> room geometry -> VisionTrust -> NextBestView -> GLB
  extend <id> <video>   additional footage: keyframes -> joint camera poses aligned to the previous version -> ...
  rescale <id>          rebuild the current version after a scale calibration

Every stage is recorded in status.json with its real state; a failing stage stops the job with the user-facing
reason and leaves earlier versions untouched. Nothing is reported as reconstructed unless the stage ran.
"""
from __future__ import annotations

import json
import sys
import threading
import time
import traceback

from . import projects
from .errors import StageFailed

STAGES = {
    "process": [("video", "Validate video"), ("keyframes", "Select keyframes"), ("sfm", "Estimate camera poses"),
                ("layout", "Reconstruct room geometry"), ("trust", "VisionTrust & GeometryTrust"),
                ("nbv", "NextBestView guidance"), ("export", "Export GLB")],
    "extend": [("video", "Validate additional video"), ("keyframes", "Select keyframes"),
               ("sfm", "Align with the existing reconstruction"), ("layout", "Reconstruct room geometry"),
               ("trust", "VisionTrust & GeometryTrust"), ("nbv", "NextBestView guidance"), ("export", "Export GLB")],
    "rgbd": [("frames", "Load RGB-D sensor frames"), ("fuse", "Fuse depth measurements"), ("export", "Export GLB")],
}


class Status:
    def __init__(self, pid: str, action: str):
        self.dir = projects.path(pid)
        self.data = {"state": "running", "action": action, "pid": __import__("os").getpid(), "started": time.time(),
                     "heartbeat": time.time(), "progress": 0.0, "message": "Starting", "error": None,
                     "stages": [{"key": k, "label": lab, "state": "pending", "detail": None} for k, lab in STAGES[action]]}
        self._lock = threading.Lock()
        self.flush()
        self._alive = True
        threading.Thread(target=self._beat, daemon=True).start()

    def _beat(self):
        while self._alive:
            time.sleep(5)
            with self._lock:
                self.data["heartbeat"] = time.time()
                self.flush()

    def flush(self):
        projects.write_json(self.dir / "status.json", self.data)

    def stage(self, key: str):
        return _Stage(self, key)

    def finish(self, state: str, message: str, error: str | None = None):
        self._alive = False
        with self._lock:
            self.data.update({"state": state, "message": message, "error": error, "finished": time.time(),
                              "heartbeat": time.time(), "progress": 1.0 if state == "done" else self.data["progress"]})
            self.flush()


class _Stage:
    def __init__(self, status: Status, key: str):
        self.s, self.key = status, key
        self.idx = next(i for i, st in enumerate(status.data["stages"]) if st["key"] == key)
        self.n = len(status.data["stages"])

    def __enter__(self):
        with self.s._lock:
            st = self.s.data["stages"][self.idx]
            st.update({"state": "running", "started": time.time()})
            self.s.data["message"] = st["label"]
            self.s.data["progress"] = self.idx / self.n
            self.s.flush()
        return self

    def progress(self, frac: float, detail: str):
        with self.s._lock:
            self.s.data["stages"][self.idx]["detail"] = detail
            self.s.data["progress"] = (self.idx + max(0.0, min(1.0, frac))) / self.n
            self.s.data["heartbeat"] = time.time()
            self.s.flush()

    def done(self, detail: str, **info):
        with self.s._lock:
            self.s.data["stages"][self.idx].update({"detail": detail, **info})
            self.s.flush()

    def skip(self, detail: str):
        with self.s._lock:
            self.s.data["stages"][self.idx].update({"state": "skipped", "detail": detail})
            self.s.flush()

    def __exit__(self, exc_type, exc, tb):
        with self.s._lock:
            st = self.s.data["stages"][self.idx]
            if st["state"] == "skipped":
                return False
            st["finished"] = time.time()
            st["seconds"] = round(st["finished"] - st["started"], 2)
            st["state"] = "done" if exc is None else "failed"
            if exc is not None:
                st["detail"] = str(exc) if isinstance(exc, (StageFailed, ValueError)) else f"{type(exc).__name__}: {exc}"
            self.s.flush()
        return False


def check() -> dict:
    out = {"ok": True, "python": sys.version.split()[0]}
    for mod in ("numpy", "cv2", "scipy", "pycolmap"):
        try:
            m = __import__(mod)
            out[mod] = getattr(m, "__version__", "yes")
        except Exception as exc:  # noqa: BLE001
            out[mod] = None
            out["ok"] = False
            out.setdefault("missing", []).append(mod)
    try:
        import pycolmap
        out["cuda"] = bool(getattr(pycolmap, "has_cuda", False))
    except Exception:  # noqa: BLE001
        out["cuda"] = False
    out["dense_mvs"] = out["cuda"]          # COLMAP PatchMatch stereo needs CUDA
    return out


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    action = argv[0]
    if action == "check":
        print(json.dumps(check()))
        return 0
    pid = argv[1]
    from . import pipeline
    status = Status(pid, action if action in STAGES else "process")
    try:
        msg = pipeline.run(action, pid, argv[2:], status)
        status.finish("done", msg)
        return 0
    except StageFailed as exc:
        status.finish("failed", "Reconstruction stopped", str(exc))
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        status.finish("failed", "Reconstruction stopped", f"Unexpected error: {type(exc).__name__}: {exc}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
