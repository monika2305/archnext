"""The interface and the API agree: every request in frontend/src/lib/api.js has a backend route with that method,
unknown API paths are a clear 404 (never "405 Method Not Allowed" or the web page), and the backend reports the API
version the interface checks for."""
import re
from pathlib import Path

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import API_VERSION, app

client = TestClient(app)
API_JS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "api.js"


def frontend_calls():
    src = API_JS.read_text(encoding="utf-8")
    for url, body, method in re.findall(r"request\((`[^`]+`|'[^']+')(?:,\s*(json\(|\{ method: '(\w+)'))?", src):
        path = re.sub(r"\$\{[^}]+\}", "x", url.strip("`'")).split("?")[0]
        yield ("POST" if body == "json(" else method or "GET"), path


def test_every_frontend_request_has_a_backend_route():
    routes = [(m, re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", r.path) + "$"))
              for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/") and "{path:path}" not in r.path
              for m in r.methods]
    calls = list(frontend_calls())
    assert len(calls) >= 20                                               # the parser still finds the calls
    missing = [(m, p) for m, p in calls if not any(m == rm and rx.match(p) for rm, rx in routes)]
    assert not missing, f"frontend calls without a backend route: {missing}"
    assert ("POST", "/api/plans/x/edit") in calls                        # Fix2Build commands (the reported bug)


def test_unknown_api_paths_are_a_404_that_names_the_request():
    for method in ("get", "post", "put", "patch", "delete"):
        r = getattr(client, method)("/api/plans/abc123abc123/no-such-thing")
        assert r.status_code == 404, (method, r.status_code)
        assert r.headers["content-type"].startswith("application/json")
        assert f"{method.upper()} /api/plans/abc123abc123/no-such-thing" in r.json()["detail"]


def test_real_routes_still_win_over_the_unknown_api_route():
    assert client.get("/api/health").json() == {"ok": True, "api_version": API_VERSION}
    assert client.post("/api/plans/0123456789ab/edit", json={"op": "reset"}).status_code == 404   # unknown plan
    assert "no longer available" in client.post("/api/plans/0123456789ab/edit", json={"op": "reset"}).json()["detail"]


def test_the_interface_requires_the_api_version_this_backend_reports():
    required = re.search(r"REQUIRED_API_VERSION = (\d+)", API_JS.read_text(encoding="utf-8")).group(1)
    assert int(required) == API_VERSION
