"""Mode B project storage (standard library only): one folder per project, JSON metadata, atomic writes.

<data>/projects/<id>/
  project.json          name, settings, versions, scale
  status.json           job progress, written by the worker
  input/                uploaded videos (video_0.<ext>, video_1.<ext> for additional footage)
  frames/               selected keyframes + manifest.json (frames_1/ for additional footage)
  sfm/                  COLMAP database and sparse model
  versions/v<N>/        scene.json (+ scene.glb) of every reconstruction, so updates can be compared
"""
from __future__ import annotations

import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path

from .settings import data_dir

_ID = re.compile(r"^[0-9a-f]{12}$")
_FILE = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")


class ProjectError(LookupError):
    pass


def valid_id(pid: str) -> bool:
    return bool(_ID.match(pid or ""))


def safe_name(name: str) -> bool:
    """A plain file name inside a project folder (no separators, no '..')."""
    return bool(_FILE.match(name or "")) and ".." not in name


def root() -> Path:
    return data_dir() / "projects"


def path(pid: str) -> Path:
    if not valid_id(pid):
        raise ProjectError("Unknown project.")
    p = root() / pid
    if not p.is_dir():
        raise ProjectError("Unknown project.")
    return p


def write_json(p: Path, obj) -> None:
    tmp = p.with_name(p.name + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(obj, indent=1), encoding="utf-8")
    for _ in range(20):                       # Windows: a reader may hold the file for a moment
        try:
            os.replace(tmp, p)
            return
        except PermissionError:
            time.sleep(0.05)
    os.replace(tmp, p)


def read_json(p: Path, default=None):
    for _ in range(5):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return default
        except (ValueError, PermissionError):
            time.sleep(0.05)
    return default


def create(name: str, settings: dict) -> tuple[str, Path]:
    pid = uuid.uuid4().hex[:12]
    p = root() / pid
    (p / "input").mkdir(parents=True)
    write_json(p / "project.json", {
        "id": pid, "name": (name or "Room video")[:120], "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "settings": settings, "videos": [], "versions": [], "current_version": None,
        "scale": {"status": "unknown", "meters_per_unit": None},
    })
    return pid, p


def load(pid: str) -> dict:
    return read_json(path(pid) / "project.json")


def save(pid: str, project: dict) -> None:
    write_json(path(pid) / "project.json", project)


def status(pid: str) -> dict:
    return read_json(path(pid) / "status.json", {"state": "idle", "stages": []})


def version_dir(pid: str, version: int) -> Path:
    return path(pid) / "versions" / f"v{int(version)}"


def scene(pid: str, version: int | None = None) -> dict | None:
    proj = load(pid)
    v = version if version is not None else proj.get("current_version")
    if v is None:
        return None
    return read_json(version_dir(pid, v) / "scene.json")


def listing() -> list[dict]:
    out = []
    if not root().is_dir():
        return out
    for p in sorted(root().iterdir(), key=lambda q: q.stat().st_mtime, reverse=True):
        proj = read_json(p / "project.json")
        if not proj or not valid_id(proj.get("id", "")):
            continue
        st = read_json(p / "status.json", {}) or {}
        out.append({"id": proj["id"], "name": proj["name"], "created": proj["created"],
                    "versions": len(proj.get("versions", [])), "state": st.get("state", "idle"),
                    "summary": (proj["versions"][-1].get("summary") if proj.get("versions") else None)})
    return out


def delete(pid: str) -> None:
    shutil.rmtree(path(pid))
