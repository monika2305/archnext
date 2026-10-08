"""ArchNext API."""
from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from pathlib import Path

from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import store
from .evaluation import evaluate_session
from .pipeline import cubicasa
from .pipeline import editor
from .pipeline.preprocess import PlanImageError
from .pipeline.run import (DEFAULT_DETECTION, PlanSession, annotation_draft, apply_manual_scale, apply_user_fix,
                           compare_configs, edit_wall_end, process_plan, redo_user_fix, reset_scale, session_result,
                           set_config, undo_user_fix)

log = logging.getLogger("archnext")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="ArchNext", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_sessions: "OrderedDict[str, PlanSession]" = OrderedDict()
_lock = threading.Lock()
MAX_SESSIONS = 30
UNIT_TO_M = {"m": 1.0, "cm": 0.01, "mm": 0.001, "ft": 0.3048, "in": 0.0254}
ROOT = Path(__file__).resolve().parent.parent
BENCHMARK_FILE = ROOT / "eval" / "results" / "benchmark.json"


_load_lock = threading.Lock()
_autosave: dict[str, dict] = {}   # plan id -> result of its last autosave


def _register(sess: PlanSession) -> None:
    with _lock:
        _sessions[sess.id] = sess
        while len(_sessions) > MAX_SESSIONS:
            _sessions.popitem(last=False)   # still on disk: reopened from its autosave when asked for again


def _get(plan_id: str) -> PlanSession:
    with _lock:
        sess = _sessions.get(plan_id)
        if sess is not None:
            _sessions.move_to_end(plan_id)
    if sess is None:
        sess = _reload(plan_id)
    if sess is None:
        raise HTTPException(404, "This plan is no longer available. Please upload it again.")
    return sess


def _reload(plan_id: str) -> PlanSession | None:
    """A plan that is not in memory (backend restarted, or evicted) is rebuilt from its autosave."""
    if not store.enabled() or not store.valid_id(plan_id):
        return None
    with _load_lock:
        with _lock:
            sess = _sessions.get(plan_id)
        if sess is not None:
            return sess
        proj = store.load(plan_id)
        if proj is None:
            return None
        try:
            sess = editor.import_project(proj, plan_id=plan_id)
        except Exception:  # noqa: BLE001
            log.exception("autosave of plan %s could not be restored", plan_id)
            return None
        _autosave[plan_id] = {"enabled": True, "ok": True, "revision": sess.revision,
                              "saved_at": proj.get("saved_at"), "error": None}
        _register(sess)
        log.info("plan %s restored from its autosave", plan_id)
        return sess


def _changed(sess: PlanSession) -> None:
    """Call after every change to a plan (inside its lock): bump the revision and autosave it."""
    sess.revision += 1
    _persist(sess)


def _persist(sess: PlanSession) -> None:
    if not store.enabled():
        _autosave[sess.id] = {"enabled": False, "ok": False, "revision": None, "saved_at": None, "error": None}
        return
    try:
        saved_at = store.save(editor.export_project(sess, image=False), sess.id, sess.data)
        _autosave[sess.id] = {"enabled": True, "ok": True, "revision": sess.revision, "saved_at": saved_at,
                              "error": None}
    except Exception as exc:  # noqa: BLE001  (a failed save must never undo the edit itself)
        log.exception("autosave of plan %s failed", sess.id)
        prev = _autosave.get(sess.id, {})
        _autosave[sess.id] = {"enabled": True, "ok": False, "revision": prev.get("revision"),
                              "saved_at": prev.get("saved_at"), "error": f"{type(exc).__name__}: {exc}"}


def _out(sess: PlanSession, **extra) -> dict:
    """Session result plus its revision and whether that revision is safely saved."""
    state = _autosave.get(sess.id) or {"enabled": store.enabled(), "ok": False, "revision": None,
                                       "saved_at": None, "error": None}
    return {**session_result(sess), "revision": sess.revision, "autosave": state, **extra}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/ai/status")
def ai_status():
    """Whether the pretrained CubiCasa5K model can run here (no model load)."""
    return {**cubicasa.status(), "default_detection": DEFAULT_DETECTION}


@app.post("/api/plans")
async def upload_plan(file: UploadFile = File(...),
                      detection: Literal["standard", "ai", "hybrid"] = Form(DEFAULT_DETECTION)):
    data = await file.read()
    try:
        sess = process_plan(data, file.filename or "plan", detection=detection)
    except PlanImageError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, f"The plan could not be reconstructed: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("processing failed")
        raise HTTPException(500, "Something went wrong while processing this plan. Please try another image.") from exc
    _register(sess)
    with sess.lock:
        _persist(sess)
    log.info("plan %s processed in %s", sess.id, {k: round(v, 2) for k, v in sess.timings.items()})
    with sess.lock:
        return _out(sess)


@app.get("/api/plans/{plan_id}")
def get_plan(plan_id: str):
    sess = _get(plan_id)
    with sess.lock:
        return _out(sess)


@app.get("/api/sessions/recent")
def recent_sessions(limit: int = 5):
    """Autosaved plans, newest first, so the Upload page can offer to continue where the user left off."""
    return {"autosave": store.enabled(), "sessions": store.recent(max(1, min(limit, 20)))}


@app.get("/api/plans/{plan_id}/image")
def get_image(plan_id: str):
    return Response(_get(plan_id).png, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


class Calibration(BaseModel):
    p1: list[float] = Field(..., min_length=2, max_length=2)
    p2: list[float] = Field(..., min_length=2, max_length=2)
    distance: float = Field(..., gt=0)
    unit: str = "m"


@app.post("/api/plans/{plan_id}/calibration")
def calibrate(plan_id: str, body: Calibration):
    sess = _get(plan_id)
    if body.unit not in UNIT_TO_M:
        raise HTTPException(400, "Unsupported unit.")
    with sess.lock:
        try:
            apply_manual_scale(sess, body.p1, body.p2, body.distance * UNIT_TO_M[body.unit])
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        _changed(sess)
        return _out(sess)


@app.delete("/api/plans/{plan_id}/calibration")
def clear_calibration(plan_id: str):
    sess = _get(plan_id)
    with sess.lock:
        reset_scale(sess)
        _changed(sess)
        return _out(sess)


class FixRequest(BaseModel):
    key: str


@app.post("/api/plans/{plan_id}/fixes")
def apply_fix(plan_id: str, body: FixRequest):
    sess = _get(plan_id)
    with sess.lock:
        try:
            report = apply_user_fix(sess, body.key)
        except KeyError as exc:
            raise HTTPException(409, str(exc.args[0])) from exc
        _changed(sess)
        return _out(sess, last_fix=report)


@app.post("/api/plans/{plan_id}/fixes/undo")
def undo_fix(plan_id: str):
    sess = _get(plan_id)
    with sess.lock:
        try:
            undo_user_fix(sess)
        except KeyError as exc:
            raise HTTPException(409, str(exc.args[0])) from exc
        _changed(sess)
        return _out(sess)


@app.post("/api/plans/{plan_id}/fixes/redo")
def redo_fix(plan_id: str):
    sess = _get(plan_id)
    with sess.lock:
        try:
            redo_user_fix(sess)
        except KeyError as exc:
            raise HTTPException(409, str(exc.args[0])) from exc
        _changed(sess)
        return _out(sess)


@app.post("/api/plans/{plan_id}/edit")
def fix2build_edit(plan_id: str, body: dict):
    """One Fix2Build command on the canonical geometry (see app/pipeline/editor.py). ``dry_run`` previews it."""
    sess = _get(plan_id)
    dry = bool(body.get("dry_run"))
    with sess.lock:
        out = editor.apply_edit(sess, body, dry_run=dry)
        if dry:
            return {"check": out}
        if not out["ok"]:
            raise HTTPException(409, out["reason"])
        _changed(sess)
        return _out(sess, edit=out)


@app.get("/api/plans/{plan_id}/project")
def save_project(plan_id: str):
    """The edited building as a project file (image, settings, geometry, names) that can be reopened."""
    sess = _get(plan_id)
    with sess.lock:
        return editor.export_project(sess)


@app.post("/api/projects")
async def open_project(file: UploadFile = File(...)):
    try:
        proj = json.loads((await file.read()).decode("utf-8"))
        sess = editor.import_project(proj)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(400, f"The project file could not be opened: {exc}") from exc
    _register(sess)
    with sess.lock:
        _persist(sess)
        return _out(sess)


class WallEdit(BaseModel):
    wall: str
    end: int = Field(..., ge=0, le=1)
    x: float
    y: float
    dry_run: bool = False


@app.post("/api/plans/{plan_id}/edits")
def edit_wall(plan_id: str, body: WallEdit):
    """Move one wall end by hand. With ``dry_run`` the edit is only snapped and validated."""
    sess = _get(plan_id)
    with sess.lock:
        try:
            check = edit_wall_end(sess, body.wall, body.end, body.x, body.y, dry_run=body.dry_run)
        except (KeyError, ValueError) as exc:
            raise HTTPException(409, str(exc.args[0])) from exc
        if body.dry_run:
            return {"check": check}
        if not check["ok"]:
            raise HTTPException(409, check["reason"])
        _changed(sess)
        return _out(sess, check=check)


class PipelineConfig(BaseModel):
    topology_guard: bool
    scale_lock: bool
    detection: Literal["standard", "ai", "hybrid"] | None = None


@app.post("/api/plans/{plan_id}/config")
def change_config(plan_id: str, body: PipelineConfig):
    """Switch TopologyGuard / ScaleLock for this plan; geometry, scale and checks are recomputed."""
    sess = _get(plan_id)
    with sess.lock:
        try:
            set_config(sess, body.topology_guard, body.scale_lock, body.detection)
        except ValueError as exc:   # e.g. the selected detector cannot build a model from this image
            raise HTTPException(422, str(exc)) from exc
        _changed(sess)
        return _out(sess)


@app.get("/api/plans/{plan_id}/compare")
def compare(plan_id: str):
    sess = _get(plan_id)
    with sess.lock:
        return compare_configs(sess)


@app.get("/api/plans/{plan_id}/annotation-draft")
def get_annotation_draft(plan_id: str):
    """Unverified answer-key draft from the current detection, for manual review."""
    sess = _get(plan_id)
    with sess.lock:
        return annotation_draft(sess)


@app.post("/api/plans/{plan_id}/evaluate")
async def evaluate(plan_id: str, file: UploadFile = File(...)):
    sess = _get(plan_id)
    try:
        gt = json.loads((await file.read()).decode("utf-8"))
        return evaluate_session(sess, gt)
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(400, f"The annotation file is not valid: {exc}") from exc


@app.get("/api/benchmark")
def benchmark():
    if not BENCHMARK_FILE.exists():
        return JSONResponse({"available": False})
    return {"available": True, **json.loads(BENCHMARK_FILE.read_text(encoding="utf-8"))}


# Serve the built frontend when present (single-process demo mode).
_dist = ROOT.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = (_dist / path).resolve()
        if path and f.is_file() and f.is_relative_to(_dist.resolve()):   # never a file outside the build
            return FileResponse(f)
        return FileResponse(_dist / "index.html")
