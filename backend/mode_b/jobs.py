"""Background reconstruction jobs: one worker process per project, run in the Mode B Python environment.

The API process never imports pycolmap or SciPy: it starts ``python -m mode_b.worker <action> <id>`` and reads the
status.json the worker keeps up to date (stages, progress, heartbeat). A job whose worker died is reported as
interrupted instead of "running" forever.
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time

from . import projects
from .settings import BACKEND, worker_python

_procs: dict[str, subprocess.Popen] = {}
_lock = threading.Lock()
STALE_S = 900          # no heartbeat for this long and no live process -> interrupted


def running(pid: str) -> bool:
    with _lock:
        p = _procs.get(pid)
        if p is not None and p.poll() is None:
            return True
    st = projects.status(pid)
    if st.get("state") not in ("queued", "running"):
        return False
    return time.time() - float(st.get("heartbeat") or 0) < STALE_S and p is None and _pid_alive(st.get("pid"))


def _pid_alive(pid) -> bool:
    if not pid:
        return False
    if sys.platform == "win32":
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))   # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(h)
        return code.value == 259                                        # STILL_ACTIVE
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def start(pid: str, action: str, *args: str) -> None:
    if running(pid):
        raise RuntimeError("A reconstruction job is already running for this project.")
    d = projects.path(pid)
    projects.write_json(d / "status.json", {"state": "queued", "action": action, "stages": [], "progress": 0.0,
                                            "message": "Starting", "heartbeat": time.time()})
    log = open(d / "worker.log", "ab")
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "ARCHNEXT_MODEB_DATA": str(projects.root().parent)}
    p = subprocess.Popen([worker_python(), "-m", "mode_b.worker", action, pid, *args], cwd=str(BACKEND),
                         stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags, env=env)
    log.close()
    with _lock:
        _procs[pid] = p


def cancel(pid: str) -> bool:
    with _lock:
        p = _procs.get(pid)
    if p is None or p.poll() is not None:
        return False
    p.terminate()
    st = projects.status(pid)
    st.update({"state": "cancelled", "message": "Cancelled by the user", "finished": time.time()})
    projects.write_json(projects.path(pid) / "status.json", st)
    return True


def status(pid: str) -> dict:
    """status.json, with a dead worker reported as interrupted."""
    st = projects.status(pid)
    if st.get("state") in ("queued", "running") and not running(pid):
        with _lock:
            p = _procs.get(pid)
        code = p.poll() if p is not None else None
        st = {**st, "state": "failed",
              "error": st.get("error") or ("The reconstruction worker stopped unexpectedly"
                                           + (f" (exit code {code})." if code is not None else ".")
                                           + " See worker.log in the project folder.")}
    return st


def check_worker(timeout: float = 60) -> dict:
    """Which Mode B dependencies the worker environment provides (runs ``python -m mode_b.worker check``)."""
    try:
        out = subprocess.run([worker_python(), "-m", "mode_b.worker", "check"], cwd=str(BACKEND), capture_output=True,
                             text=True, timeout=timeout,
                             creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
        import json
        return json.loads(out.stdout.strip().splitlines()[-1]) if out.returncode == 0 else \
            {"ok": False, "error": (out.stderr or out.stdout).strip()[-400:]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
