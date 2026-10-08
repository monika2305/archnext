"""Detection modes: AI geometry conversion, Hybrid, fallback to Standard, and live switching between modes."""
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.pipeline import cubicasa as cc
from app.pipeline.run import process_plan, session_result, set_config

client = TestClient(app)
PNG = (Path(__file__).resolve().parents[2] / "samples" / "generated_plan_7.png").read_bytes()
needs_model = pytest.mark.skipif(not cc.status()["available"], reason="CubiCasa5K model not installed")


@pytest.fixture(scope="module")
def ai_sess():
    return process_plan(PNG, "p.png", detection="ai")


@needs_model
def test_ai_geometry_is_real_and_aligned(ai_sess):
    res = session_result(ai_sess)
    assert res["detection"]["requested"] == "ai" and res["detection"]["used"] == "ai"
    g = res["geometry"]["corrected"]
    assert g["stats"]["walls"] >= 8 and g["stats"]["rooms"] >= 3
    assert any(o["source"] == "ai" for o in g["openings"])
    # Converted walls lie on the AI wall pixels, in the same image coordinates.
    wall = ai_sess.inputs.ai.rooms == cc.WALL
    hits = [wall[int(round((w["y1"] + w["y2"]) / 2)), int(round((w["x1"] + w["x2"]) / 2))] for w in g["walls"]]
    assert np.mean(hits) > 0.85


@needs_model
def test_switching_modes_reuses_shared_work_and_updates_geometry(ai_sess, monkeypatch):
    calls = []
    real = cc.predict
    monkeypatch.setattr(cc, "predict", lambda *a, **k: calls.append(1) or real(*a, **k))
    walls_ai = session_result(ai_sess)["geometry"]["corrected"]["walls"]
    set_config(ai_sess, True, True, "standard")
    res = session_result(ai_sess)
    assert res["config"]["detection"] == "standard" and res["detection"]["used"] == "standard"
    assert res["geometry"]["corrected"]["walls"] != walls_ai
    set_config(ai_sess, True, True, "hybrid")
    assert session_result(ai_sess)["detection"]["used"] == "hybrid"
    set_config(ai_sess, True, True, "ai")
    assert session_result(ai_sess)["geometry"]["corrected"]["walls"] == walls_ai
    assert calls == []          # the prediction made at upload is reused, never recomputed


def test_ai_falls_back_to_standard_with_a_reason(monkeypatch):
    def boom(*a, **k):
        raise cc.ModelUnavailable("weights missing (test)")
    monkeypatch.setattr(cc, "predict", boom)
    res = session_result(process_plan(PNG, "p.png", detection="hybrid"))
    assert res["detection"] == {**res["detection"], "requested": "hybrid", "used": "standard"}
    assert "weights missing" in res["detection"]["fallback"]
    assert any("Standard detection was used" in w for w in res["warnings"])
    assert res["geometry"]["corrected"]["stats"]["rooms"] > 0


def test_detection_mode_api():
    d = client.post("/api/plans", files={"file": ("p.png", PNG, "image/png")}).json()
    assert d["config"]["detection"] == "standard"
    r = client.post(f"/api/plans/{d['id']}/config", json={"topology_guard": True, "scale_lock": True, "detection": "ai"})
    assert r.status_code == 200 and r.json()["config"]["detection"] == "ai"
    assert r.json()["detection"]["used"] in ("ai", "standard")
    bad = client.post(f"/api/plans/{d['id']}/config", json={"topology_guard": True, "scale_lock": True, "detection": "x"})
    assert bad.status_code == 422
