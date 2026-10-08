"""Side-by-side picture: Original | Standard | AI | Hybrid, all on the same image and coordinates.

With a CubiCasa5K plan (human ground truth) walls are coloured correct / extra / missing.
With your own blueprint (no ground truth) only the detections are drawn and accuracy is "Not measured".

    python -m eval.visual_compare --cubicasa high_quality_architectural_2536
    python -m eval.visual_compare --image C:\\path\\to\\plan.png
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from app.pipeline.run import prepare_inputs, process_plan
from eval.compare_modes import RESULTS, wall_raster
from eval.cubicasa_testset import CACHE, annotation, fetch

C_OK, C_EXTRA, C_MISS = (70, 60, 50), (40, 40, 220), (0, 150, 255)       # BGR
C_DOOR, C_WIN, C_ROOM = (35, 120, 185), (200, 140, 40), (90, 140, 60)


def panel(img, sess, gt_walls, title, sub):
    out = (0.35 * img + 0.65 * 255).astype(np.uint8)
    v = sess.corrected
    pred = wall_raster(v.walls, v.solids, img.shape[:2], v.openings)
    for r in v.rooms:
        cv2.polylines(out, [np.round(np.array(r["polygon"])).astype(np.int32)], True, C_ROOM, 1, cv2.LINE_AA)
    if gt_walls is not None:
        tol = np.ones((7, 7), np.uint8)
        near_gt = cv2.dilate(gt_walls.astype(np.uint8), tol) > 0
        near_pr = cv2.dilate(pred.astype(np.uint8), tol) > 0
        out[pred & near_gt] = C_OK
        out[pred & ~near_gt] = C_EXTRA
        out[gt_walls & ~near_pr] = C_MISS
    else:
        out[pred] = C_OK
    for o in v.openings:
        col = C_DOOR if o["type"] == "door" else C_WIN if o["type"] == "window" else (150, 120, 140)
        cv2.line(out, (int(o["x1"]), int(o["y1"])), (int(o["x2"]), int(o["y2"])), col, 5, cv2.LINE_AA)
    return label(out, title, sub)


def label(img, title, sub=""):
    bar = np.full((64, img.shape[1], 3), 255, np.uint8)
    cv2.putText(bar, title, (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (40, 40, 40), 2, cv2.LINE_AA)
    cv2.putText(bar, sub, (12, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (90, 90, 90), 1, cv2.LINE_AA)
    return np.vstack([bar, img])


def legend(width, with_gt):
    bar = np.full((40, width, 3), 255, np.uint8)
    items = ([("correct wall", C_OK), ("extra wall", C_EXTRA), ("missing wall", C_MISS)] if with_gt
             else [("detected wall", C_OK)]) + [("door", C_DOOR), ("window", C_WIN), ("room boundary", C_ROOM)]
    x = 12
    for name, col in items:
        cv2.rectangle(bar, (x, 12), (x + 22, 28), col, -1)
        cv2.putText(bar, name, (x + 30, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (60, 60, 60), 1, cv2.LINE_AA)
        x += 40 + 11 * len(name)
    return bar


def build(data: bytes, gt_raw: dict | None, name: str) -> Path:
    base = prepare_inputs(data, "ai")      # image, OCR, OpenCV parse and AI prediction, computed once
    img = cv2.cvtColor(base.img.rgb, cv2.COLOR_RGB2BGR)
    f = base.img.resample
    gt_walls = None
    if gt_raw:
        m = np.zeros(img.shape[:2], np.uint8)
        for w in gt_raw["walls"]:
            cv2.fillPoly(m, [np.round(np.array(w["polygon"]) * f).astype(np.int32)], 1)
        gt_walls = m > 0
    panels = [label(img.copy(), "Original", f"{name}" + ("  |  human ground truth" if gt_raw else "  |  accuracy not measured"))]
    for mode, title in (("standard", "Standard (OpenCV)"), ("ai", "AI model (CubiCasa5K)"), ("hybrid", "Hybrid")):
        try:
            inp = base if mode == "ai" else prepare_inputs(data, mode, base=base)
            if mode != "standard" and inp.detection.get("used") != mode:
                raise ValueError(inp.detection.get("fallback") or "AI detection unavailable")
            sess = process_plan(data, name, inputs=inp)
            st = sess.corrected.stats()
            sub = f"{st['rooms']} rooms  {st['doors']} doors  {st['windows']} windows  {round(100 * st['connected_endpoint_ratio'])}% ends connected"
            if gt_raw:
                sub = f"GT: {len(gt_raw['rooms'])} rooms  |  " + sub
            panels.append(panel(img, sess, gt_walls, title, sub))
        except ValueError as exc:
            blank = np.full_like(img, 245)
            cv2.putText(blank, "No model: " + str(exc)[:60], (20, img.shape[0] // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                        (40, 40, 200), 2, cv2.LINE_AA)
            panels.append(label(blank, title, "failed"))
    top = np.hstack(panels[:2])
    bottom = np.hstack(panels[2:])
    sheet = np.vstack([top, bottom, legend(top.shape[1], gt_raw is not None)])
    scale = min(1.0, 2000 / sheet.shape[1])
    sheet = cv2.resize(sheet, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"compare_{name}.jpg"
    cv2.imwrite(str(out), sheet, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cubicasa", help="CubiCasa5K sample folder name, e.g. high_quality_architectural_2536")
    ap.add_argument("--image", help="your own plan image (no ground truth)")
    args = ap.parse_args()
    if args.cubicasa:
        d = CACHE / args.cubicasa
        if not d.exists():
            folder = args.cubicasa.replace("high_quality_architectural_", "high_quality_architectural/") \
                .replace("high_quality_", "high_quality/").replace("colorful_", "colorful/")
            d = fetch([folder])[0]
        print(build((d / "F1_scaled.png").read_bytes(), annotation(d / "model.svg"), d.name))
    elif args.image:
        p = Path(args.image)
        print(build(p.read_bytes(), None, p.stem))


if __name__ == "__main__":
    main()
