"""Live TopologyGuard / ScaleLock switching on an uploaded plan, and manual wall-end editing."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.pipeline.run import (apply_user_fix, compare_configs, edit_wall_end, process_plan, session_result, set_config,
                              undo_user_fix)
from eval.synth import generate
from test_fixes import T, _fixable, _plan

client = TestClient(app)
CONFIGS = [(False, False), (True, False), (False, True), (True, True)]


@pytest.fixture(scope="module")
def synth_png():
    return generate(3)[0]


def test_all_four_configs_change_the_current_plan(synth_png):
    sess = process_plan(synth_png, "s.png")
    seen = {}
    for tg_on, sl_on in CONFIGS:
        set_config(sess, tg_on, sl_on)
        res = session_result(sess)
        assert res["config"] == {"topology_guard": tg_on, "scale_lock": sl_on}
        corr, orig = res["geometry"]["corrected"], res["geometry"]["original"]
        if not tg_on:
            # Without TopologyGuard the plan is the raw parser output and no checks or fixes are offered.
            assert corr["walls"] == orig["walls"]
            assert not any(i["status"] == "review" for i in res["topology"]["issues"])
        if not sl_on:
            assert res["scale"]["status"] in ("estimated", "manual") and res["scale"]["measurements"] == []
        seen[(tg_on, sl_on)] = res
    # TopologyGuard repairs the injected wall breaks; ScaleLock reads the written dimensions.
    assert seen[(True, True)]["geometry"]["corrected"]["stats"]["connected_endpoint_ratio"] > \
        seen[(False, True)]["geometry"]["corrected"]["stats"]["connected_endpoint_ratio"]
    assert seen[(True, True)]["scale"]["status"] == "auto"
    assert seen[(True, True)]["scale"]["meters_per_px"] != seen[(True, False)]["scale"]["meters_per_px"]

    cmp = compare_configs(sess)
    assert set(cmp["configs"]) == {"baseline", "topologyguard_only", "scalelock_only", "full"}
    assert cmp["configs"]["full"]["connected"] >= cmp["configs"]["baseline"]["connected"]
    assert cmp["configs"]["baseline"]["scale_status"] == "estimated"
    assert cmp["config_key"] == "full"


def test_fixes_are_kept_per_configuration():
    sess = process_plan(_plan(short_gap=2 * T))
    issue = _fixable(sess, "connect")[0]
    apply_user_fix(sess, issue.key)
    assert session_result(sess)["geometry"]["corrected"]["stats"]["rooms"] == 2
    set_config(sess, False, True)
    assert session_result(sess)["geometry"]["corrected"]["stats"]["rooms"] == 1   # raw parser output
    set_config(sess, True, True)
    res = session_result(sess)
    assert res["geometry"]["corrected"]["stats"]["rooms"] == 2 and res["topology"]["can_undo"]


def _divider(sess):
    return next(w for w in sess.corrected.walls if w.orient == "v" and 500 < w.x1 < 700)


def test_manual_edit_snaps_validates_and_undoes():
    sess = process_plan(_plan(short_gap=2 * T))
    w = _divider(sess)
    top = min((v for v in sess.corrected.walls if v.orient == "h"), key=lambda v: v.y1)
    end = 0 if w.y1 < w.y2 else 1
    # Dragged roughly to the top wall, slightly off and sideways: snaps onto its centre line, stays vertical.
    check = edit_wall_end(sess, w.id, end, w.x1 + 9, top.y1 + 6, dry_run=True)
    assert check["ok"] and check["snapped"] == "wall"
    assert check["after"]["x1"] == check["after"]["x2"] == w.x1
    assert min(check["after"]["y1"], check["after"]["y2"]) == pytest.approx(top.y1)
    assert session_result(sess)["geometry"]["corrected"]["stats"]["rooms"] == 1   # dry run changes nothing

    edit_wall_end(sess, w.id, end, w.x1, top.y1 + 6)
    res = session_result(sess)
    assert res["geometry"]["corrected"]["stats"]["rooms"] == 2
    assert next(x for x in res["geometry"]["corrected"]["walls"] if x["id"] == w.id)["source"] == "edited"
    assert any(i["status"] == "fixed" and i["check"] == "manual" for i in res["topology"]["issues"])
    undo_user_fix(sess)
    assert session_result(sess)["geometry"]["corrected"]["stats"]["rooms"] == 1


def test_manual_edit_never_closes_a_door():
    sess = process_plan(_plan(short_gap=5 * T, door_arc=True))
    assert any(o["type"] == "door" for o in sess.corrected.openings)
    w = _divider(sess)
    top = min((v for v in sess.corrected.walls if v.orient == "h"), key=lambda v: v.y1)
    end = 0 if w.y1 < w.y2 else 1
    walls_before = [x.to_dict() for x in sess.corrected.walls]
    check = edit_wall_end(sess, w.id, end, w.x1, top.y1)
    assert not check["ok"] and "door" in check["reason"]
    assert [x.to_dict() for x in sess.corrected.walls] == walls_before
    # Too short and flipped walls are rejected as well.
    other = w.y2 if end == 0 else w.y1
    assert not edit_wall_end(sess, w.id, end, w.x1, other + 3, dry_run=True)["ok"]


def test_config_edit_and_compare_api():
    d = client.post("/api/plans", files={"file": ("p.png", _plan(short_gap=2 * T), "image/png")}).json()
    assert d["config"] == {"topology_guard": True, "scale_lock": True}
    r = client.post(f"/api/plans/{d['id']}/config", json={"topology_guard": False, "scale_lock": True})
    assert r.status_code == 200 and r.json()["config"]["topology_guard"] is False
    c = client.get(f"/api/plans/{d['id']}/compare").json()
    assert c["config_key"] == "scalelock_only" and "current" in c
    client.post(f"/api/plans/{d['id']}/config", json={"topology_guard": True, "scale_lock": True})
    w = next(x for x in d["geometry"]["corrected"]["walls"] if x["orient"] == "v" and 500 < x["x1"] < 700)
    end = 0 if w["y1"] < w["y2"] else 1
    dry = client.post(f"/api/plans/{d['id']}/edits", json={"wall": w["id"], "end": end, "x": w["x1"], "y": 160,
                                                          "dry_run": True})
    assert dry.status_code == 200 and dry.json()["check"]["ok"]
    done = client.post(f"/api/plans/{d['id']}/edits", json={"wall": w["id"], "end": end, "x": w["x1"], "y": 160})
    assert done.status_code == 200 and done.json()["geometry"]["corrected"]["stats"]["rooms"] == 2
    bad = client.post(f"/api/plans/{d['id']}/edits", json={"wall": "nope", "end": 0, "x": 0, "y": 0})
    assert bad.status_code == 409
