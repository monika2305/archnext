"""Mode B HTTP API: ``/api/mode-b/*`` (FastAPI router; standard library + FastAPI only).

Included by the main backend app, separate from every Mode A route. Expensive work runs in the Mode B worker
process (jobs.py); these endpoints only validate uploads, start jobs and serve results.
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import jobs, projects
from .settings import CONTAINERS, MAX_UPLOAD_MB, MODE_B, ProcessingSettings

router = APIRouter(prefix="/api/mode-b", tags=["mode-b"])
RESULTS = MODE_B / "results"
_worker_check: dict | None = None


def sniff_container(head: bytes) -> str | None:
    """Container type from the file's first bytes (MIME types and extensions are not trusted)."""
    if len(head) >= 12 and head[4:8] == b"ftyp":
        return "mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    if head[:4] == b"RIFF" and head[8:12] == b"AVI ":
        return "avi"
    return None


async def _save_upload(file: UploadFile, dest_dir, stem: str) -> tuple[str, int, str]:
    head = await file.read(64)
    kind = sniff_container(head)
    if kind is None:
        raise HTTPException(415, "This file is not a supported video. Upload an MP4 (or MOV / WebM / AVI) recording.")
    limit = MAX_UPLOAD_MB * 1024 * 1024
    name = f"{stem}.{kind}"
    size = len(head)
    with open(dest_dir / name, "wb") as out:
        out.write(head)
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > limit:
                out.close()
                (dest_dir / name).unlink(missing_ok=True)
                raise HTTPException(413, f"The video is larger than {MAX_UPLOAD_MB} MB. Trim or compress it.")
            out.write(chunk)
    return name, size, kind


def _project(pid: str) -> dict:
    try:
        return projects.load(pid)
    except projects.ProjectError as exc:
        raise HTTPException(404, "This Mode B project does not exist.") from exc


@router.get("/health")
def health(refresh: bool = False):
    """Mode B availability: the worker environment and its dependencies (cached after the first check)."""
    global _worker_check
    if _worker_check is None or refresh:
        _worker_check = jobs.check_worker()
    return {"ok": True, "worker": _worker_check}


@router.get("/projects")
def list_projects():
    return {"projects": projects.listing()}


@router.post("/projects")
async def create_project(file: UploadFile = File(...), settings: str = Form("{}"), name: str = Form("")):
    try:
        cfg = ProcessingSettings.clean(json.loads(settings or "{}"))
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, f"Invalid processing settings: {exc}") from exc
    pid, d = projects.create(name or re.sub(r"\.[^.]+$", "", file.filename or "Room video"), cfg.to_dict())
    try:
        stored, size, kind = await _save_upload(file, d / "input", "video_0")
    except HTTPException:
        projects.delete(pid)
        raise
    proj = projects.load(pid)
    proj["videos"].append({"file": stored, "original_name": (file.filename or "")[:120], "bytes": size,
                           "container": CONTAINERS[kind], "role": "initial"})
    projects.save(pid, proj)
    jobs.start(pid, "process")
    return {"project": projects.load(pid), "status": jobs.status(pid)}


@router.get("/demos")
def demos():
    """Locally available TUM RGB-D sequences for the RGB-D sensor demo (no download)."""
    from .evaluation.tum import ROOT
    out = []
    if ROOT.is_dir():
        for p in sorted(ROOT.iterdir()):
            if all((p / f).exists() for f in ("rgb.txt", "depth.txt", "groundtruth.txt")):
                out.append({"sequence": p.name, "label": p.name.replace("rgbd_dataset_", "").replace("_", " ")})
    return {"sequences": out}


class RgbdBody(BaseModel):
    sequence: str = Field(..., pattern=r"^rgbd_dataset_[a-z0-9_]{3,80}$")


@router.post("/demos/rgbd")
def create_rgbd_demo(body: RgbdBody):
    """RGB-D SENSOR DEMO project: dense reconstruction from TUM depth images + recorded poses (not video-only)."""
    if body.sequence not in {d["sequence"] for d in demos()["sequences"]}:
        raise HTTPException(404, "This RGB-D sequence is not available locally.")
    pid, d = projects.create(f"RGB-D sensor demo: {body.sequence.replace('rgbd_dataset_', '')}", {})
    proj = projects.load(pid)
    proj["kind"] = "rgbd"
    proj["source"] = {"type": "RGB-D sensor demo", "dataset": "TUM RGB-D (CC BY 4.0)", "sequence": body.sequence}
    projects.save(pid, proj)
    jobs.start(pid, "rgbd", body.sequence)
    return {"project": projects.load(pid), "status": jobs.status(pid)}


@router.get("/projects/{pid}")
def get_project(pid: str):
    proj = _project(pid)
    d = projects.path(pid)
    manifests = {}
    for sub in sorted(d.glob("frames*")):
        m = projects.read_json(sub / "manifest.json")
        if m:
            manifests[sub.name] = m
    return {"project": proj, "status": jobs.status(pid), "manifests": manifests}


@router.get("/projects/{pid}/status")
def get_status(pid: str):
    _project(pid)
    return jobs.status(pid)


@router.post("/projects/{pid}/cancel")
def cancel(pid: str):
    _project(pid)
    return {"cancelled": jobs.cancel(pid), "status": jobs.status(pid)}


@router.get("/projects/{pid}/frames/{folder}/{name}")
def keyframe(pid: str, folder: str, name: str):
    _project(pid)
    if not re.fullmatch(r"frames(_\d{1,3})?", folder) or not projects.safe_name(name) or not name.endswith(".jpg"):
        raise HTTPException(404, "Unknown frame.")
    f = projects.path(pid) / folder / name
    if not f.is_file():
        raise HTTPException(404, "Unknown frame.")
    return FileResponse(f, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/projects/{pid}/scene")
def get_scene(pid: str, version: int | None = None):
    proj = _project(pid)
    s = projects.scene(pid, version)
    if s is None:
        raise HTTPException(404, "No reconstruction is available for this project yet.")
    return {**s, "scale": proj.get("scale")}


@router.post("/projects/{pid}/extend")
async def extend(pid: str, file: UploadFile = File(...)):
    """Additional footage (e.g. recorded following NextBestView): aligned with the current reconstruction."""
    proj = _project(pid)
    if proj.get("current_version") is None:
        raise HTTPException(409, "Additional footage can only be added to a completed reconstruction.")
    if jobs.running(pid):
        raise HTTPException(409, "A reconstruction job is already running for this project.")
    n = len(proj["videos"])
    stored, size, kind = await _save_upload(file, projects.path(pid) / "input", f"video_{n}")
    proj["videos"].append({"file": stored, "original_name": (file.filename or "")[:120], "bytes": size,
                           "container": CONTAINERS[kind], "role": "additional"})
    projects.save(pid, proj)
    jobs.start(pid, "extend", str(n))
    return {"project": projects.load(pid), "status": jobs.status(pid)}


class ScaleBody(BaseModel):
    surface: str | None = None                       # calibrate from the real length of this wall ...
    length_m: float | None = Field(None, gt=0, lt=1000)
    meters_per_unit: float | None = Field(None, gt=0)  # ... or set the factor directly
    clear: bool = False


@router.post("/projects/{pid}/scale")
def set_scale(pid: str, body: ScaleBody):
    """Manual metric scale. Reconstructions from video alone have no metric scale (SfM is up to scale)."""
    proj = _project(pid)
    if body.clear:
        proj["scale"] = {"status": "unknown", "meters_per_unit": None}
    elif body.meters_per_unit:
        proj["scale"] = {"status": "manual", "meters_per_unit": body.meters_per_unit, "reference": "factor"}
    else:
        scene = projects.scene(pid)
        surf = next((s for s in (scene or {}).get("surfaces", []) if s["id"] == body.surface), None)
        if surf is None or not body.length_m or not surf.get("size"):
            raise HTTPException(400, "Choose a wall of the current reconstruction and enter its real length.")
        proj["scale"] = {"status": "manual", "meters_per_unit": body.length_m / surf["size"][0],
                         "reference": f"{surf['id']} = {body.length_m} m"}
    projects.save(pid, proj)
    return {"scale": proj["scale"]}


@router.get("/projects/{pid}/mesh.glb")
def mesh_file(pid: str, version: int | None = None):
    """Measured triangle mesh of an RGB-D demo version (depth-sensor data), if it has one."""
    proj = _project(pid)
    v = version if version is not None else proj.get("current_version")
    f = projects.version_dir(pid, v) / "mesh.glb" if v is not None else None
    if f is None or not f.is_file():
        raise HTTPException(404, "This reconstruction has no measured mesh.")
    return FileResponse(f, media_type="model/gltf-binary", filename=f"{proj['name'][:40]}-measured-mesh.glb".replace(" ", "_").replace(":", ""))


@router.get("/projects/{pid}/export.glb")
def export_glb(pid: str, version: int | None = None, include: str = "all"):
    """GLB of the reconstructed (and, unless include=observed, completed) room, in metres when calibrated."""
    proj = _project(pid)
    s = projects.scene(pid, version)
    if s is None:
        raise HTTPException(404, "No reconstruction is available for this project yet.")
    from .export import scene_to_glb          # NumPy only
    try:
        data = scene_to_glb(s, proj.get("scale", {}).get("meters_per_unit"), include=include)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    fname = re.sub(r"[^A-Za-z0-9_-]+", "_", proj["name"])[:60] or "room"
    return Response(data, media_type="model/gltf-binary",
                    headers={"Content-Disposition": f'attachment; filename="{fname}-modeb-v{s["version"]}.glb"'})


@router.get("/research/scenes/{name}")
def research_scene(name: str):
    """Reduced reconstruction (surfaces, cameras) of one ablation configuration, for side-by-side 3D."""
    if not re.fullmatch(r"[a-z0-9_]{3,80}_[ABCD]\.json", name):
        raise HTTPException(404, "Unknown result scene.")
    f = RESULTS / "scenes" / name
    if not f.is_file():
        raise HTTPException(404, "Unknown result scene.")
    return json.loads(f.read_text(encoding="utf-8"))


@router.get("/research")
def research():
    """Saved A/B/C/D ablation results (backend/mode_b/results), produced by mode_b.evaluation.run_ablation."""
    f = RESULTS / "ablation.json"
    if not f.exists():
        return {"available": False, "reason": "The ablation study has not been run yet "
                                              "(python -m mode_b.evaluation.run_ablation)."}
    return {"available": True, **json.loads(f.read_text(encoding="utf-8"))}
