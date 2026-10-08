"""Autosave and restore: Fix2Build edits survive a browser refresh, a backend restart and session eviction, with
the same wall / opening / room ids, room names, ScaleLock scale and measurements; undo / redo stay correct."""
import json

from fastapi.testclient import TestClient

from app import main, store
from app.pipeline import editor
from app.pipeline.run import process_plan, session_result
from tests.test_fix2build import PNG

client = TestClient(main.app)


def post_edit(pid, **op):
    r = client.post(f"/api/plans/{pid}/edit", json=op)
    assert r.status_code == 200, r.text
    return r.json()


def restart_backend():
    """What a backend restart loses: every in-memory session and autosave status (the disk folder stays)."""
    main._sessions.clear()
    main._autosave.clear()


def fingerprint(d):
    g = d["geometry"]["corrected"]
    return {
        "walls": sorted((w["id"], w["x1"], w["y1"], w["x2"], w["y2"], w["thickness"], w["height"]) for w in g["walls"]),
        "openings": sorted((o["id"], o["type"], round(o["width"], 3)) for o in g["openings"]),
        "rooms": sorted((r["id"], r["name"], r["area_m2"]) for r in g["rooms"]),
        "scale": (d["scale"]["status"], d["scale"]["meters_per_px"]),
        "measurements": [(m["text"], m["status"], m["meters"]) for m in d["scale"]["measurements"]],
        "config": d["config"],
    }


def edited_plan():
    d = client.post("/api/plans", files={"file": ("two_rooms.png", PNG, "image/png")}).json()
    pid = d["id"]
    walls = d["geometry"]["corrected"]["walls"]
    div = min((w for w in walls if w["orient"] == "v"), key=lambda w: abs(w["x1"] - 600))
    left = min(d["geometry"]["corrected"]["rooms"], key=lambda r: r["centroid"][0])["id"]
    post_edit(pid, op="rename_room", room=left, name="Studio")
    post_edit(pid, op="set_wall", wall=div["id"], height=3.1)
    door = post_edit(pid, op="add_opening", wall=div["id"], x=600, y=450, width=90, type="door")["edit"]["created"]
    d = post_edit(pid, op="move_wall", wall=div["id"], dx=40, dy=0)
    return pid, d, left, door


def test_every_change_is_autosaved_and_reported():
    pid, d, _, _ = edited_plan()
    assert d["autosave"]["ok"] and d["autosave"]["revision"] == d["revision"] == 4
    saved = store.load(pid)
    assert saved["revision"] == 4 and saved["edits"] == 4 and saved["filename"] == "two_rooms.png"
    assert (store.folder() / f"{pid}.img").read_bytes() == PNG          # the original upload, written once
    assert client.get("/api/sessions/recent").json()["sessions"][0]["id"] == pid


def test_edits_survive_a_backend_restart_with_the_same_ids_names_and_scale():
    pid, before, left, door = edited_plan()
    restart_backend()
    r = client.get(f"/api/plans/{pid}")                                  # rebuilt from the autosave
    assert r.status_code == 200
    after = r.json()
    assert after["id"] == pid and after["revision"] == before["revision"]
    assert fingerprint(after) == fingerprint(before)
    rooms = {x["id"]: x for x in after["geometry"]["corrected"]["rooms"]}
    assert rooms[left]["name"] == "Studio"
    assert next(o for o in after["geometry"]["corrected"]["openings"] if o["id"] == door)["type"] == "door"
    assert client.get(f"/api/plans/{pid}/image").content                 # the plan image is back too
    # The undo history is not stored: undo starts empty, but new edits undo / redo normally.
    assert after["topology"]["can_undo"] is False
    assert client.post(f"/api/plans/{pid}/fixes/undo").status_code == 409
    d = post_edit(pid, op="rename_room", room=left, name="Office")
    assert d["revision"] == before["revision"] + 1 and d["autosave"]["ok"]
    d = client.post(f"/api/plans/{pid}/fixes/undo").json()
    assert {x["id"]: x["name"] for x in d["geometry"]["corrected"]["rooms"]}[left] == "Studio"
    d = client.post(f"/api/plans/{pid}/fixes/redo").json()
    assert {x["id"]: x["name"] for x in d["geometry"]["corrected"]["rooms"]}[left] == "Office"
    # ... and those are autosaved as well: a second restart keeps the redone edit.
    restart_backend()
    d = client.get(f"/api/plans/{pid}").json()
    assert {x["id"]: x["name"] for x in d["geometry"]["corrected"]["rooms"]}[left] == "Office"


def test_new_ids_after_a_restore_never_reuse_deleted_ones():
    pid, d, _, _ = edited_plan()
    walls = d["geometry"]["corrected"]["walls"]
    top = min((w for w in walls if w["orient"] == "h"), key=lambda w: w["y1"])
    created = post_edit(pid, op="add_wall", x1=164, y1=500, x2=597, y2=500)["edit"]["created"]
    post_edit(pid, op="delete_wall", wall=created)
    restart_backend()
    again = post_edit(pid, op="add_wall", x1=164, y1=520, x2=597, y2=520)["edit"]["created"]
    assert again != created and top["id"] in {w["id"] for w in client.get(f"/api/plans/{pid}").json()["geometry"]["corrected"]["walls"]}


def test_a_session_evicted_from_memory_is_reopened_from_its_autosave():
    pid, before, _, _ = edited_plan()
    main._sessions.pop(pid)
    assert fingerprint(client.get(f"/api/plans/{pid}").json()) == fingerprint(before)


def test_manual_scale_survives_a_restart():
    pid, _, _, _ = edited_plan()
    d = client.post(f"/api/plans/{pid}/calibration", json={"p1": [157, 157], "p2": [1043, 157], "distance": 9.0,
                                                            "unit": "m"}).json()
    assert d["scale"]["status"] == "manual"
    restart_backend()
    d2 = client.get(f"/api/plans/{pid}").json()
    assert d2["scale"]["status"] == "manual" and d2["scale"]["meters_per_px"] == d["scale"]["meters_per_px"]
    assert fingerprint(d2) == fingerprint(d)


def test_the_scale_in_force_is_restored_exactly_even_when_it_is_not_manual():
    # A TopologyGuard fix can re-run ScaleLock, so the saved automatic scale may differ from what detection on
    # the original image gives; reopening must not silently resize the building.
    sess = process_plan(PNG, "two_rooms.png")
    sess.scale = {**sess.scale, "meters_per_px": 0.0123}
    re = editor.import_project(json.loads(json.dumps(editor.export_project(sess))))
    assert re.scale["meters_per_px"] == 0.0123 and re.scale["status"] == sess.scale["status"]
    a, b = session_result(sess), session_result(re)
    assert [r["area_m2"] for r in a["geometry"]["corrected"]["rooms"]] == \
           [r["area_m2"] for r in b["geometry"]["corrected"]["rooms"]]


def test_unknown_or_unsafe_ids_are_not_found_and_never_touch_the_disk():
    assert client.get("/api/plans/0123456789ab").status_code == 404
    assert client.get("/api/plans/..secret").status_code == 404
    assert store.load("../secret") is None and not store.valid_id("../secret")


def test_the_web_app_route_serves_no_file_outside_the_frontend_build():
    # Autosaves hold the users' plans on disk: an encoded "../" must not reach them (or the source code).
    for url in ("/..%2F..%2Fbackend%2Fapp%2Fstore.py", "/%2E%2E/%2E%2E/backend/app/store.py"):
        r = client.get(url)
        assert "Autosave" not in r.text


def test_a_failed_autosave_keeps_the_edit_and_says_so(monkeypatch):
    pid, d, left, _ = edited_plan()
    def broken(*a, **k):
        raise OSError("disk full")
    monkeypatch.setattr(store, "save", broken)
    d2 = post_edit(pid, op="rename_room", room=left, name="Kitchen")
    assert d2["revision"] == d["revision"] + 1
    assert d2["autosave"]["ok"] is False and "disk full" in d2["autosave"]["error"]
    assert d2["autosave"]["revision"] == d["revision"]                    # last revision actually on disk
    assert {r["id"]: r["name"] for r in d2["geometry"]["corrected"]["rooms"]}[left] == "Kitchen"


def test_autosave_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("ARCHNEXT_AUTOSAVE", "0")
    d = client.post("/api/plans", files={"file": ("p.png", PNG, "image/png")}).json()
    assert d["autosave"]["enabled"] is False and store.load(d["id"]) is None
    restart_backend()
    assert client.get(f"/api/plans/{d['id']}").status_code == 404


def test_a_reopened_project_file_gets_its_own_autosave():
    pid, before, left, _ = edited_plan()
    proj = client.get(f"/api/plans/{pid}/project").json()
    assert proj["version"] == 2 and "image_b64" in proj
    d = client.post("/api/projects", files={"file": ("x.archnext.json", json.dumps(proj), "application/json")}).json()
    assert d["id"] != pid and d["autosave"]["ok"]
    assert {r["id"]: r["name"] for r in d["geometry"]["corrected"]["rooms"]}[left] == "Studio"
    assert fingerprint(d)["walls"] == fingerprint(before)["walls"]
    restart_backend()
    assert fingerprint(client.get(f"/api/plans/{d['id']}").json())["rooms"] == fingerprint(d)["rooms"]
