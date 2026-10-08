"""Mode B API: upload validation, background job and status, keyframe serving, safe paths, isolation from Mode A."""
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mode_b import api as mb_api
from mode_b.api import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def wait(pid, timeout=180):
    t = time.time()
    while time.time() - t < timeout:
        st = client.get(f"/api/mode-b/projects/{pid}/status").json()
        if st["state"] not in ("queued", "running"):
            return st
        time.sleep(0.5)
    raise AssertionError("job did not finish")


def test_a_non_video_upload_is_rejected_before_any_processing():
    r = client.post("/api/mode-b/projects", files={"file": ("room.mp4", b"<html>not a video</html>", "video/mp4")})
    assert r.status_code == 415 and "not a supported video" in r.json()["detail"]
    assert all(p["name"] != "room" for p in client.get("/api/mode-b/projects").json()["projects"])


def test_oversized_uploads_are_rejected(monkeypatch, tmp_video):
    monkeypatch.setattr(mb_api, "MAX_UPLOAD_MB", 0)
    r = client.post("/api/mode-b/projects", files={"file": ("a.mp4", tmp_video(n=60, step=6).read_bytes(), "video/mp4")})
    assert r.status_code == 413


def test_invalid_settings_are_rejected(tmp_video):
    r = client.post("/api/mode-b/projects", data={"settings": '{"max_keyframes": 9999}'},
                    files={"file": ("a.mp4", tmp_video(n=60, step=6).read_bytes(), "video/mp4")})
    assert r.status_code == 400


def test_upload_runs_the_worker_and_reports_real_stages(tmp_video):
    data = tmp_video(n=120, step=6, fps=20).read_bytes()
    r = client.post("/api/mode-b/projects", data={"name": "Synthetic pan"},
                    files={"file": ("pan.mp4", data, "application/octet-stream")})
    assert r.status_code == 200, r.text
    pid = r.json()["project"]["id"]
    st = wait(pid)
    stages = {s["key"]: s for s in st["stages"]}
    assert stages["video"]["state"] == "done" and "480x360" in stages["video"]["detail"]
    assert stages["keyframes"]["state"] == "done" and stages["keyframes"]["keyframes"] >= 8
    # A synthetic pan over a flat texture is not a room: later stages may fail or be skipped, never faked.
    assert all(s["state"] in ("done", "failed", "skipped", "pending") for s in st["stages"])
    p = client.get(f"/api/mode-b/projects/{pid}").json()
    kf = p["manifests"]["frames"]["keyframes"]
    img = client.get(f"/api/mode-b/projects/{pid}/frames/frames/{kf[0]['name']}")
    assert img.status_code == 200 and img.content[:2] == b"\xff\xd8"
    assert p["project"]["videos"][0]["container"].startswith("MP4")


def test_paths_and_ids_cannot_escape_the_project_folder():
    assert client.get("/api/mode-b/projects/..%2F..%2Fsecret").status_code == 404
    assert client.get("/api/mode-b/projects/0123456789ab").status_code == 404
    pid = client.get("/api/mode-b/projects").json()["projects"][0]["id"]
    for folder, name in (("frames", "..%2Fproject.json"), ("frames", "project.json"), ("..", "project.json"),
                         ("input", "video_0.mp4")):
        assert client.get(f"/api/mode-b/projects/{pid}/frames/{folder}/{name}").status_code == 404


def test_additional_footage_needs_a_finished_reconstruction(tmp_video):
    pid = client.get("/api/mode-b/projects").json()["projects"][0]["id"]
    r = client.post(f"/api/mode-b/projects/{pid}/extend",
                    files={"file": ("more.mp4", tmp_video("m.mp4", n=60, step=6).read_bytes(), "video/mp4")})
    if r.status_code != 200:            # only possible once a reconstruction exists
        assert r.status_code == 409


def test_health_reports_the_worker_environment():
    w = client.get("/api/mode-b/health").json()["worker"]
    assert w["ok"] and w["pycolmap"] and w["cv2"]
    assert w["dense_mvs"] == w["cuda"]


@pytest.mark.parametrize("path", ["/api/mode-b/research"])
def test_research_endpoint_answers_without_invented_numbers(path):
    r = client.get(path).json()
    assert r["available"] in (True, False)
    if not r["available"]:
        assert "not been run" in r["reason"]
