"""Fix2Build: editing commands on the canonical geometry, stable ids, undo / redo / reset, save and reopen."""
import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app.main import app
from app.pipeline import editor
from app.pipeline.run import process_plan, redo_user_fix, session_result, undo_user_fix

client = TestClient(app)
T = 14


def _png() -> bytes:
    """Two rooms side by side: outer walls and a full-height divider at x = 600."""
    img = Image.new("L", (1200, 900), 255)
    d = ImageDraw.Draw(img)
    for r in [(150, 150, 1050, 150 + T), (150, 750 - T, 1050, 750), (150, 150, 150 + T, 750), (1050 - T, 150, 1050, 750),
              (600 - T // 2, 150, 600 + T // 2, 750)]:
        d.rectangle(r, fill=20)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


PNG = _png()


@pytest.fixture()
def sess():
    return process_plan(PNG, "two_rooms.png")


def geo(sess):
    return session_result(sess)["geometry"]["corrected"]


def wall_near(sess, orient, x=None, y=None):
    ws = [w for w in sess.corrected.walls if w.orient == orient]
    key = (lambda w: abs((w.x1 + w.x2) / 2 - x)) if x is not None else (lambda w: abs((w.y1 + w.y2) / 2 - y))
    return min(ws, key=key)


def edit(sess, **op):
    out = editor.apply_edit(sess, op)
    assert out["ok"], out["reason"]
    return out


def areas(sess):
    return {r["id"]: r["area_m2"] for r in geo(sess)["rooms"]}


def test_ids_are_stable_and_room_names_survive_edits(sess):
    rooms = geo(sess)["rooms"]
    assert len(rooms) == 2
    left = min(rooms, key=lambda r: r["centroid"][0])
    edit(sess, op="rename_room", room=left["id"], name="Bedroom 1")
    wall_ids = {w.id for w in sess.corrected.walls}
    edit(sess, op="move_wall", wall=wall_near(sess, "v", x=600).id, dx=60, dy=0)
    rooms2 = {r["id"]: r for r in geo(sess)["rooms"]}
    assert left["id"] in rooms2 and rooms2[left["id"]]["name"] == "Bedroom 1"
    assert rooms2[left["id"]]["area_m2"] > left["area_m2"]               # the left room grew
    assert {w.id for w in sess.corrected.walls} == wall_ids              # no wall was re-numbered


def test_add_move_delete_wall_with_undo_redo(sess):
    before = areas(sess)
    out = edit(sess, op="add_wall", x1=164, y1=450, x2=597, y2=452)     # splits the left room
    assert out["created"] and len(geo(sess)["rooms"]) == 3
    new = next(w for w in sess.corrected.walls if w.id == out["created"])
    assert new.orient == "h" and new.y1 == new.y2                        # straightened
    assert abs(new.x1 - 157) < 10 and abs(new.x2 - 600) < 10             # snapped onto the walls it meets
    undo_user_fix(sess)
    assert areas(sess) == before
    redo_user_fix(sess)
    assert len(geo(sess)["rooms"]) == 3
    edit(sess, op="move_wall", wall=out["created"], dx=0, dy=-100)
    assert len(geo(sess)["rooms"]) == 3
    edit(sess, op="delete_wall", wall=out["created"])
    assert len(geo(sess)["rooms"]) == 2
    assert not editor.apply_edit(sess, {"op": "add_wall", "x1": 600, "y1": 160, "x2": 600, "y2": 740})["ok"]  # duplicate


def test_moving_an_outer_wall_drags_the_walls_attached_to_it(sess):
    right = wall_near(sess, "v", x=1043)
    before = areas(sess)
    edit(sess, op="move_wall", wall=right.id, dx=80, dy=0)
    g = geo(sess)
    assert len(g["rooms"]) == 2                                          # the building stays closed
    top = max((w for w in g["walls"] if w["orient"] == "h" and w["y1"] < 200), key=lambda w: max(w["x1"], w["x2"]))
    assert max(top["x1"], top["x2"]) > 1100                              # the top wall followed
    grown = [rid for rid, a in areas(sess).items() if a > before.get(rid, 1e9)]
    assert len(grown) == 1


def test_wall_end_thickness_and_height(sess):
    w = wall_near(sess, "v", x=600)
    edit(sess, op="set_wall", wall=w.id, thickness=20, height=3.2)
    d = next(x for x in geo(sess)["walls"] if x["id"] == w.id)
    assert d["thickness"] == 20 and d["height"] == 3.2
    assert not editor.apply_edit(sess, {"op": "set_wall", "wall": w.id, "height": 20})["ok"]
    edit(sess, op="move_end", wall=w.id, end=0 if w.y1 < w.y2 else 1, x=600, y=400)
    assert len(geo(sess)["rooms"]) == 1                                  # divider shortened: rooms merge


def test_openings_add_move_resize_retype_delete(sess):
    div = wall_near(sess, "v", x=600)
    out = edit(sess, op="add_opening", wall=div.id, x=600, y=450, width=90, type="door")
    oid = out["created"]
    o = next(x for x in geo(sess)["openings"] if x["id"] == oid)
    assert o["type"] == "door" and o["source"] == "user" and abs(o["width"] - 90) < 1
    assert len(geo(sess)["rooms"]) == 2                                  # a door does not merge the rooms
    cy = (o["y1"] + o["y2"]) / 2
    edit(sess, op="move_opening", opening=oid, offset=60)
    o2 = next(x for x in geo(sess)["openings"] if x["id"] == oid)
    assert abs(abs((o2["y1"] + o2["y2"]) / 2 - cy) - 60) < 1
    edit(sess, op="resize_opening", opening=oid, width=120)
    assert abs(next(x for x in geo(sess)["openings"] if x["id"] == oid)["width"] - 120) < 1
    edit(sess, op="set_opening_type", opening=oid, type="window")
    edit(sess, op="move_wall", wall=wall_near(sess, "h", y=157).id, dx=0, dy=-20)   # unrelated edit
    assert next(x for x in geo(sess)["openings"] if x["id"] == oid)["type"] == "window"   # user choice kept
    bad = editor.apply_edit(sess, {"op": "move_opening", "opening": oid, "offset": 2000})
    assert not bad["ok"] and "end of its wall" in bad["reason"]
    n_walls = len(sess.corrected.walls)
    edit(sess, op="delete_opening", opening=oid)
    assert oid not in {x["id"] for x in geo(sess)["openings"]} and len(sess.corrected.walls) == n_walls - 1


def test_preview_changes_nothing_and_reset_is_undoable(sess):
    before = geo(sess)
    out = editor.apply_edit(sess, {"op": "delete_wall", "wall": wall_near(sess, "v", x=600).id}, dry_run=True)
    assert out["ok"] and len(out["preview"]["rooms"]) == 1
    assert geo(sess) == before
    edit(sess, op="delete_wall", wall=wall_near(sess, "v", x=600).id)
    edit(sess, op="reset")
    assert len(geo(sess)["rooms"]) == 2 and len(geo(sess)["walls"]) == len(before["walls"])
    undo_user_fix(sess)
    assert len(geo(sess)["rooms"]) == 1


def test_save_and_reopen_keeps_the_edited_building(sess):
    div = wall_near(sess, "v", x=600)
    o = edit(sess, op="add_opening", wall=div.id, x=600, y=300, width=100, type="window")["created"]
    left = min(geo(sess)["rooms"], key=lambda r: r["centroid"][0])["id"]
    edit(sess, op="rename_room", room=left, name="Studio")
    edit(sess, op="set_wall", wall=div.id, height=3.0)
    edit(sess, op="add_wall", x1=164, y1=500, x2=597, y2=500)
    saved = json.loads(json.dumps(editor.export_project(sess)))
    re = editor.import_project(saved)
    a, b = geo(sess), session_result(re)["geometry"]["corrected"]
    assert sorted((w["id"], w["x1"], w["y1"], w["x2"], w["y2"], w["height"]) for w in a["walls"]) == \
        sorted((w["id"], w["x1"], w["y1"], w["x2"], w["y2"], w["height"]) for w in b["walls"])
    ob = next(x for x in b["openings"] if x["id"] == o)
    assert ob["type"] == "window" and ob["source"] == "user"
    names = {r["id"]: r["name"] for r in b["rooms"]}
    assert names.get(left) == "Studio" and len(b["rooms"]) == len(a["rooms"])
    assert len({r["id"] for r in b["rooms"]}) == len(b["rooms"])        # ids unique


def test_edit_redo_and_project_api():
    d = client.post("/api/plans", files={"file": ("p.png", PNG, "image/png")}).json()
    pid = d["id"]
    div = min((w for w in d["geometry"]["corrected"]["walls"] if w["orient"] == "v"), key=lambda w: abs(w["x1"] - 600))
    dry = client.post(f"/api/plans/{pid}/edit", json={"op": "delete_wall", "wall": div["id"], "dry_run": True}).json()
    assert dry["check"]["ok"] and len(dry["check"]["preview"]["rooms"]) == 1
    r = client.post(f"/api/plans/{pid}/edit", json={"op": "delete_wall", "wall": div["id"]})
    assert r.status_code == 200 and r.json()["geometry"]["corrected"]["stats"]["rooms"] == 1
    assert client.post(f"/api/plans/{pid}/edit", json={"op": "delete_wall", "wall": "nope"}).status_code == 409
    assert client.post(f"/api/plans/{pid}/fixes/undo").json()["topology"]["can_redo"] is True
    assert client.post(f"/api/plans/{pid}/fixes/redo").json()["geometry"]["corrected"]["stats"]["rooms"] == 1
    proj = client.get(f"/api/plans/{pid}/project").json()
    assert proj["format"] == "archnext-project"
    re = client.post("/api/projects", files={"file": ("p.archnext.json", json.dumps(proj), "application/json")})
    assert re.status_code == 200 and re.json()["geometry"]["corrected"]["stats"]["rooms"] == 1
    assert client.post("/api/projects", files={"file": ("x.json", "{}", "application/json")}).status_code == 400
