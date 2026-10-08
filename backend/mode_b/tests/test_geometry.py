"""Layout, VisionTrust classification and completion, GeometryTrust, NextBestView, alignment and GLB export,
tested on a SYNTHETIC box room with a known answer (see synthetic.py)."""
import numpy as np
import pytest

from mode_b import layout, nbv, pipeline, scene as scene_mod, trust
from mode_b.export import cell_quads, read_glb, scene_to_glb
from mode_b.sfm import SfmResult, make_pairs
from mode_b.tests.synthetic import BOX, room


@pytest.fixture(scope="module")
def synth():
    return room()


@pytest.fixture(scope="module")
def lay(synth):
    return layout.estimate(synth[0])


def plane_id(lay, gt, normal):
    """Layout id of the synthetic room's wall with outward ``normal`` (the Manhattan axes are only defined up to
    90-degree turns, so ids are matched geometrically)."""
    n = lay.R @ gt["G"] @ np.asarray(normal, float)
    axis = int(np.argmax(np.abs(n)))
    return f"wall-{'xyz'[axis]}{'+' if n[axis] > 0 else '-'}"


def test_upright_frame_and_manhattan_axes_are_recovered(synth, lay):
    sfm, gt = synth
    up = lay.R[1]
    true_up = gt["G"] @ np.array([0, 1.0, 0])
    assert abs(up @ true_up) > 0.995                                   # up direction within ~6 degrees
    ex_true = gt["G"] @ np.array([1.0, 0, 0])
    assert max(abs(lay.R[0] @ ex_true), abs(lay.R[2] @ ex_true)) > 0.995   # walls axis-aligned


def test_measured_planes_match_the_true_room_and_unseen_ones_are_bounds(synth, lay):
    gt = synth[1]
    s = gt["s"]
    assert lay.reliable
    p = lay.planes
    seen = [plane_id(lay, gt, n) for n in ([0, 0, -1], [-1, 0, 0], [1, 0, 0])]
    unseen = plane_id(lay, gt, [0, 0, 1])
    assert p["floor"].evidence and all(p[i].evidence for i in seen)
    assert p[unseen].evidence is None and p["ceiling"].evidence is None   # never filmed
    box = lay.box()
    ax_w = "xyz"[p[seen[1]].axis]                                       # the axis across the two side walls
    assert abs(np.ptp(box[ax_w]) / s - 4.0) < 0.1                       # true width 4 m (in metres again)
    assert abs(box["y"][0]) < 1e-6                                      # floor at y = 0
    ax_d = "xyz"[p[unseen].axis]
    assert np.ptp(box[ax_d]) / s <= 5.0 + 0.1                           # unseen wall: a bound, never beyond the data
    assert "farthest observed point" in p[unseen].bound_reason


def test_visiontrust_classes_follow_the_evidence(synth, lay):
    gt = synth[1]
    surfaces = {s["id"]: s for s in trust.build_surfaces(lay, completion=True)}
    assert surfaces[plane_id(lay, gt, [0, 0, -1])]["class"] == "observed"
    assert surfaces["ceiling"]["class"] == "generated"
    gen = surfaces[plane_id(lay, gt, [0, 0, 1])]
    assert gen["class"] in ("generated", "uncertain") and gen["shares"]["observed"] == 0
    assert not gen["measured"] and any("farthest observed point" in a for a in gen["assumptions"])
    for s in surfaces.values():                                        # every cell has a class and a score
        for c in s["cells"]:
            assert c["cls"] in ("observed", "uncertain", "generated") and 0 <= c["confidence"] <= 1
            if c["cls"] == "observed":
                assert c["points"] >= 3 and c["views"] >= 3
            if c["cls"] == "generated":
                assert c["visible"] == 0 and c["points"] == 0 and c["confidence"] <= 0.15


def test_baseline_without_completion_keeps_only_reconstructed_cells(synth, lay):
    base = trust.build_surfaces(lay, completion=False)
    ids = {s["id"] for s in base}
    assert "ceiling" not in ids and plane_id(lay, synth[1], [0, 0, 1]) not in ids
    assert all(c["points"] > 0 and c["cls"] != "generated" for s in base for c in s["cells"])
    full = trust.build_surfaces(lay, completion=True)
    area = lambda ss: sum(c["area"] for s in ss for c in s["cells"])  # noqa: E731
    assert area(full) > area(base)


def test_confidence_is_higher_where_evidence_is_stronger(lay):
    cells = [c for s in trust.build_surfaces(lay, completion=True) for c in s["cells"]]
    obs = np.mean([c["confidence"] for c in cells if c["cls"] == "observed"])
    gen = np.mean([c["confidence"] for c in cells if c["cls"] == "generated"])
    assert obs > gen + 0.3
    assert trust.CONF_METHOD["calibrated"] is False


def test_nextbestview_points_at_the_unseen_wall_from_inside_the_room(synth, lay):
    surfaces = trust.build_surfaces(lay, completion=True)
    rec = nbv.recommend(lay, surfaces)
    assert rec["recommendations"], rec
    best = rec["recommendations"][0]
    box = lay.box()
    x, _, z = best["position"]
    assert box["x"][0] < x < box["x"][1] and box["z"][0] < z < box["z"][1]   # inside, not in a wall
    unseen = plane_id(lay, synth[1], [0, 0, 1])
    covered = {c["surface"] for c in best["covers"]}
    assert covered & {unseen, "ceiling"}                                # it looks at what was never seen
    assert best["gain_share"] > 0 and ("Record a short additional view" in best["text"] or "record a short view" in best["text"])
    pl = lay.planes[unseen]
    assert best["forward"][pl.axis] * pl.sign > 0 or best["forward"][1] > 0.2   # towards the unseen wall, or up


def test_no_layout_is_invented_without_enough_evidence(synth):
    sfm = synth[0]
    keep = np.zeros(len(sfm.points), bool)
    keep[:30] = True
    few = SfmResult(sfm.names, sfm.centers, sfm.rotations, sfm.intrinsics, sfm.image_errors, sfm.points[keep],
                    sfm.colors[keep], sfm.errors[keep], [sfm.tracks[i] for i in np.flatnonzero(keep)], {})
    lay = layout.estimate(few)
    assert not lay.reliable and "not enough evidence" in lay.failure and lay.tau == 0   # pipeline stops here


def test_umeyama_recovers_a_similarity_and_rejects_outliers():
    rng = np.random.default_rng(1)
    A = rng.normal(size=(30, 3))
    th = 0.7
    R = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]])
    B = 2.5 * A @ R.T + [1, 2, 3]
    B[:3] += 5                                                          # three wrong correspondences
    s, R2, t, inl = pipeline.robust_sim3(A, B)
    assert abs(s - 2.5) < 1e-6 and np.allclose(R2, R, atol=1e-6) and inl[:3].sum() == 0 and inl[3:].all()


def test_pairs_connect_additional_footage_to_the_earlier_video():
    names = [f"frames/v0_kf_{i:04d}.jpg" for i in range(60)] + [f"frames_1/v1_kf_{i:04d}.jpg" for i in range(10)]
    pairs = set(make_pairs(names, window=5, cross_stride=2))
    assert ("frames/v0_kf_0000.jpg", "frames/v0_kf_0005.jpg") in pairs
    cross = [p for p in pairs if p[0].startswith("frames/") and p[1].startswith("frames_1/")]
    assert len(cross) == 10 * 30                                        # every new frame vs every 2nd old one


def test_glb_contains_exactly_the_scene_geometry(lay):
    sc = scene_mod.assemble(1, lay, {}, {}, True, "test")
    data = scene_to_glb(sc)
    js, binary = read_glb(data)
    assert js["asset"]["extras"]["units"].startswith("reconstruction units")
    mesh_names = {m["name"] for m in js["meshes"]}
    assert {s["id"] for s in sc["surfaces"]} <= mesh_names and "observed points" in mesh_names
    # Vertex count of every surface mesh = 4 per cell of the included classes.
    for s in sc["surfaces"]:
        m = next(m for m in js["meshes"] if m["name"] == s["id"])
        n = sum(js["accessors"][p["attributes"]["POSITION"]]["count"] for p in m["primitives"])
        assert n == 4 * len(s["cells"])
        V, T = cell_quads(s)
        acc = js["accessors"][m["primitives"][0]["attributes"]["POSITION"]]
        assert np.all(np.array(acc["min"]) >= V.min(0) - 1e-5) and np.all(np.array(acc["max"]) <= V.max(0) + 1e-5)
    # Calibrated: coordinates scale by metres per unit; "observed" export drops generated cells.
    js2, _ = read_glb(scene_to_glb(sc, meters_per_unit=2.0))
    a1 = js["accessors"][js["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    a2 = js2["accessors"][js2["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    assert np.allclose(np.array(a2["max"]), 2 * np.array(a1["max"]), atol=1e-4) and js2["asset"]["extras"]["units"] == "metres"
    js3, _ = read_glb(scene_to_glb(sc, include="observed"))
    assert all(p["extras"]["class"] != "generated" for m in js3["meshes"] for p in m["primitives"] if "extras" in p)


def test_scene_document_is_complete_and_honest(lay):
    sc = scene_mod.assemble(1, lay, {"points": 1}, {}, True, "Dense MVS not run: no CUDA.")
    assert sc["units"].startswith("reconstruction units") and sc["method"]["dense"].startswith("Dense MVS not run")
    assert sc["summary"]["shares"]["generated"] > 0 and abs(sum(sc["summary"]["shares"].values()) - 1) < 1e-3
    assert sc["layout"]["box"] and sc["cameras"] and len(sc["points"]["xyz"]) % 3 == 0
    assert sc["confidence_method"]["calibrated"] is False
