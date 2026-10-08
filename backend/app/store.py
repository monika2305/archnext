"""Autosave: every plan session is written to disk after each change, so edits survive a browser refresh, a
backend restart and the in-memory session limit.

One project file per plan (``<id>.json``, the same format as *Save*, without the image) and the uploaded image
written once next to it (``<id>.img``). Writes are atomic (temporary file + rename), so a crash never leaves a
half-written project. Folder: ``ARCHNEXT_DATA_DIR`` or ``backend/data/sessions`` (git-ignored);
``ARCHNEXT_AUTOSAVE=0`` turns autosave off (edits then live in memory until *Save*).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from pathlib import Path

log = logging.getLogger("archnext.store")
DEFAULT_DIR = Path(__file__).resolve().parent.parent / "data" / "sessions"
KEEP = 50                                   # most recent plans kept on disk
_ID = re.compile(r"^[0-9a-f]{6,32}$")      # plan ids are hex; anything else never reaches the file system


def enabled() -> bool:
    return os.environ.get("ARCHNEXT_AUTOSAVE", "1") not in ("0", "false", "off")


def folder() -> Path:
    return Path(os.environ.get("ARCHNEXT_DATA_DIR") or DEFAULT_DIR)


def valid_id(plan_id: str) -> bool:
    return bool(_ID.match(plan_id or ""))


def _write(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def save(project: dict, plan_id: str, image: bytes) -> str:
    """Write one project (``editor.export_project`` without its image) and, once, the plan image.
    Returns the save time."""
    if not valid_id(plan_id):
        raise ValueError(f"invalid plan id {plan_id!r}")
    d = folder()
    d.mkdir(parents=True, exist_ok=True)
    img = d / f"{plan_id}.img"
    meta = {k: v for k, v in project.items() if k != "image_b64"}
    if not img.exists():
        _write(img, image)
    meta["saved_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    _write(d / f"{plan_id}.json", json.dumps(meta).encode("utf-8"))
    _prune(d)
    return meta["saved_at"]


def load(plan_id: str) -> dict | None:
    """The saved project with its image, or None when this plan was never saved here."""
    if not valid_id(plan_id):
        return None
    d = folder()
    try:
        meta = json.loads((d / f"{plan_id}.json").read_text("utf-8"))
        meta["image_b64"] = base64.b64encode((d / f"{plan_id}.img").read_bytes()).decode("ascii")
    except (OSError, ValueError):
        return None
    return meta


def recent(limit: int = 5) -> list[dict]:
    """Most recently saved plans, newest first (summary only, no image)."""
    d = folder()
    if not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        try:
            m = json.loads(p.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        out.append({"id": p.stem, "filename": m.get("filename"), "saved_at": m.get("saved_at"),
                    "revision": m.get("revision", 0), "edits": m.get("edits", 0),
                    "rooms": len(m.get("rooms", [])), "detection": m.get("config", {}).get("detection")})
    return out


def _prune(d: Path) -> None:
    files = sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in files[KEEP:]:
        for f in (p, p.with_suffix(".img")):
            try:
                f.unlink()
            except OSError:
                log.warning("could not remove old autosave %s", f)
