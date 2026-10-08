"""Fixes found on real blueprints: frame lines, false wide openings, opening typing, wall holes, noisy OpenCV."""
import io

import cv2
import numpy as np
from PIL import Image, ImageDraw

from app.pipeline import ai_detect as ad
from app.pipeline import cubicasa as cc
from app.pipeline.preprocess import prepare
from app.pipeline.run import process_plan, session_result
from app.pipeline.structure import MIN_OPENING
from app.pipeline.walls import Wall, WallDetection

T = 14


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _two_rooms(border: bool, margin: int = 150) -> bytes:
    img = Image.new("L", (1200, 900), 255)
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = margin, 150, 1200 - margin, 750
    for r in [(x0, y0, x1, y0 + T), (x0, y1 - T, x1, y1), (x0, y0, x0 + T, y1), (x1 - T, y0, x1, y1)]:
        d.rectangle(r, fill=20)
    d.rectangle((600 - T // 2, y0, 600 + T // 2, y1), fill=20)
    if border:                                   # screenshot-style border along two image edges
        d.rectangle((0, 0, 4, 899), fill=10)
        d.rectangle((0, 0, 1199, 3), fill=10)
    return _png(img)


def test_screenshot_border_is_ignored_but_walls_near_the_edge_are_kept():
    clean = session_result(process_plan(_two_rooms(False, margin=60)))
    framed_sess = process_plan(_two_rooms(True, margin=60))
    framed = session_result(framed_sess)
    assert any("border" in w for w in framed["warnings"])
    assert framed["geometry"]["corrected"]["stats"]["rooms"] == clean["geometry"]["corrected"]["stats"]["rooms"] == 2
    # The exterior wall 60 px from the edge survives.
    assert sum(1 for w in framed["geometry"]["corrected"]["walls"] if w["orient"] == "v") >= 3
    img = prepare(_two_rooms(True, margin=60))
    assert not img.dark[:, :3].any() and img.dark[:, 60:60 + T].any()


def test_walls_that_merely_line_up_across_a_room_are_not_an_opening():
    img = Image.new("L", (1300, 900), 255)
    d = ImageDraw.Draw(img)
    for r in [(100, 100, 1200, 100 + T), (100, 800 - T, 1200, 800), (100, 100, 100 + T, 800), (1200 - T, 100, 1200, 800),
              (400, 100, 400 + T, 800), (680, 100, 680 + T, 800),            # three columns
              (100, 450, 400, 450 + T), (680, 450, 1200, 450 + T)]:          # side columns split in two
        d.rectangle(r, fill=20)
    res = session_result(process_plan(_png(img)))
    g = res["geometry"]["corrected"]
    assert g["stats"]["rooms"] == 5           # the middle room is not cut in half by a phantom opening
    assert not any(400 < min(o["x1"], o["x2"]) and max(o["x1"], o["x2"]) < 695 for o in g["openings"])


def _gap_opening(width: float) -> dict:
    return {"x1": 100.0, "y1": 50.0, "x2": 100.0 + width, "y2": 50.0, "width": width, "thickness": 10.0}


def test_opening_type_needs_coverage_along_its_length():
    icons = np.zeros((100, 400), np.uint8)
    icons[45:56, 100:120] = cc.DOOR          # small door icon at one end of a 100 px gap
    door, window = ad._icon_cover(_gap_opening(100), icons, 10)
    assert door < 0.5 and window == 0
    icons[45:56, 100:190] = cc.DOOR
    assert ad._icon_cover(_gap_opening(100), icons, 10)[0] >= 0.8


def test_holes_in_drawn_walls_are_restored_but_a_real_door_stays_open():
    H, W, t = 120, 420, 10.0
    ink = np.zeros((H, W), np.uint8)
    ink[54:56, 10:410] = 255                  # both wall faces drawn along the whole wall ...
    ink[64:66, 10:410] = 255
    ink[54:66, 230:290] = 0                   # ... except a 60 px door opening
    ink[56:64, 10:230] = 255                  # solid fill like the drawn wall (incl. the AI's hole at 130-230)
    ink[56:64, 290:410] = 255
    icons = np.zeros((H, W), np.uint8)
    icons[52:68, 232:288] = cc.DOOR
    walls = [Wall("w1", 10, 60, 130, 60, t, "h"), Wall("w2", 290, 60, 410, 60, t, "h")]
    out = ad.close_inked_gaps(walls, t, ink, icons)
    a = next(w for w in out if w.id == "w1")
    assert 225 <= a.x2 <= 233                 # restored up to the door jamb
    assert next(w for w in out if w.id == "w2").x1 >= 285
    assert 290 - a.x2 >= MIN_OPENING * t      # the door itself is not closed


def test_hybrid_ignores_opencv_when_it_is_mostly_noise():
    H, W = 400, 400
    rooms = np.zeros((H, W), np.uint8)
    for sl in [(slice(50, 62), slice(50, 350)), (slice(338, 350), slice(50, 350)),
               (slice(50, 350), slice(50, 62)), (slice(50, 350), slice(338, 350)), (slice(50, 350), slice(194, 206))]:
        rooms[sl] = cc.WALL
    pred = cc.AIPrediction(rooms=rooms, icons=np.zeros((H, W), np.uint8),
                           wall_prob=(rooms == cc.WALL).astype(np.float32), seconds=0.0, infer_size=(W, H))
    noise = np.full((H, W), 255, np.uint8)       # OpenCV called almost everything "wall" (furnished colour plan)
    cv = WallDetection(mask=noise, thickness=12, max_thickness=12, thin_width=2, kernel=9, walls=[], solids=[],
                       warnings=[])
    hyb = ad.hybrid_ai_base(pred, cv)
    ai = ad.ai_walls(pred)
    assert [(w.x1, w.y1, w.x2, w.y2) for w in hyb.walls] == [(w.x1, w.y1, w.x2, w.y2) for w in ai.walls]
    assert cv2.countNonZero(hyb.mask) == cv2.countNonZero(ai.mask)


def test_thin_double_line_walls_near_a_tight_crop_are_not_treated_as_a_frame():
    img = Image.new("L", (900, 1300), 255)
    d = ImageDraw.Draw(img)
    for x in (30, 44):                         # outer and inner line of a hollow exterior wall, 30 px from the edge
        d.rectangle((x, 250, x + 2, 1150), fill=20)   # covers ~70% of the side, like a tightly cropped scan
    prepared = prepare(_png(img))
    assert not any("border" in w for w in prepared.warnings)
    assert prepared.dark[:, 25:50].any()
