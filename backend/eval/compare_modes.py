"""Standard vs AI vs Hybrid detection on REAL floor plans with human ground truth (CubiCasa5K samples).

Every mode gets the same image, the same working coordinates, the same OCR and the same evaluation rules
(app/evaluation.py), with TopologyGuard and ScaleLock on. "AI (raw)" is the AI geometry with TopologyGuard off.

    python -m eval.compare_modes --split test --n 40            # report
    python -m eval.compare_modes --split val --n 15 --hybrid add=1,drop=1,cut=0   # tuning (never on test)

CubiCasa5K plans come from the same source as the model's training data (different plans, same drafting
styles), so this favours the AI model. The annotations carry no metric scale: scale and size errors are not
measured here.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

from app.evaluation import _scale_gt, evaluate_version
from app.pipeline import ai_detect as ad
from app.pipeline import cubicasa as cc
from app.pipeline.run import PlanInputs, prepare_inputs, process_plan
from app.pipeline.walls import Wall
from eval.cubicasa_testset import annotation, fetch, split_list

RESULTS = Path(__file__).resolve().parent / "results"
MODES = ["standard", "ai_raw", "ai", "hybrid"]
LABEL = {"standard": "Standard (OpenCV)", "ai_raw": "AI model (raw)", "ai": "AI + TopologyGuard/ScaleLock",
         "hybrid": "Hybrid"}
# Hybrid variants for tuning on the validation split (all share OCR and the AI prediction).
# hybrid_cut / hybrid_nodrop / hybrid_noadd scored the same as "hybrid" on the first validation plans and were
# dropped to keep runs short; hybrid_aibase starts from the AI walls instead of the OpenCV walls.
VARIANTS = {"hybrid_aibase": {}}


def wall_raster(walls: list[Wall], solids: list[dict], shape, openings: list[dict] = ()) -> np.ndarray:
    """Predicted wall area. Door / window spans count as wall because the human annotation draws walls
    continuously through them (the same rule for every mode)."""
    m = np.zeros(shape, np.uint8)
    walls = list(walls) + [Wall("", o["x1"], o["y1"], o["x2"], o["y2"], o["thickness"], "d") for o in openings]
    for w in walls:
        L = max(w.length, 1e-6)
        ux, uy = (w.x2 - w.x1) / L, (w.y2 - w.y1) / L
        nx, ny, h = -uy, ux, w.thickness / 2
        poly = np.array([[w.x1 + nx * h, w.y1 + ny * h], [w.x2 + nx * h, w.y2 + ny * h],
                         [w.x2 - nx * h, w.y2 - ny * h], [w.x1 - nx * h, w.y1 - ny * h]])
        cv2.fillPoly(m, [np.round(poly).astype(np.int32)], 1)
    for s in solids:
        m[int(s["y0"]):int(s["y1"]), int(s["x0"]):int(s["x1"])] = 1
    return m > 0


def wall_scores(pred: np.ndarray, gt: np.ndarray, tol: int) -> dict:
    """Pixel IoU plus boundary-tolerant precision / recall (a wall pixel within ``tol`` px counts as found)."""
    k = np.ones((2 * tol + 1, 2 * tol + 1), np.uint8)
    gt_d = cv2.dilate(gt.astype(np.uint8), k) > 0
    pr_d = cv2.dilate(pred.astype(np.uint8), k) > 0
    inter, union = (pred & gt).sum(), (pred | gt).sum()
    prec = (pred & gt_d).sum() / max(pred.sum(), 1)
    rec = (gt & pr_d).sum() / max(gt.sum(), 1)
    return {"wall_iou": round(float(inter / max(union, 1)), 4), "wall_precision": round(float(prec), 4),
            "wall_recall": round(float(rec), 4)}


def make_inputs(base: PlanInputs, data: bytes, mode: str, hybrid_kw: dict) -> PlanInputs:
    """``base`` is the AI-mode inputs (image, OCR, OpenCV parse and AI prediction computed once)."""
    if mode in ("ai", "ai_raw"):
        return base
    if mode == "standard":
        return prepare_inputs(data, "standard", base=base)   # raises if OpenCV finds no walls
    inp = prepare_inputs(data, "hybrid", base=base)
    kw = VARIANTS.get(mode, hybrid_kw)
    if mode == "hybrid_aibase" and inp.detection.get("used") == "hybrid":
        inp.det = ad.hybrid_ai_base(inp.ai, base.cv_det)
    elif kw and inp.detection.get("used") == "hybrid":
        inp.det = ad.hybrid_walls(inp.ai, base.cv_det, inp.img.soft, **kw)
    return inp


def run_plan(folder: Path, hybrid_kw: dict) -> dict:
    return run_one((folder / "F1_scaled.png").read_bytes(), annotation(folder / "model.svg"), folder.name, hybrid_kw)


def run_one(data: bytes, gt_raw: dict, name: str, hybrid_kw: dict) -> dict:
    out = {"plan": name, "gt": {k: len(gt_raw.get(k, [])) for k in ("rooms", "doors", "windows", "walls")}}
    try:
        base = prepare_inputs(data, "ai")
    except ValueError as exc:          # neither detector could build anything from this image
        for mode in MODES:
            out[mode] = {"failed": str(exc)}
        return out
    for mode in MODES:
        t0 = time.time()
        try:
            inp = make_inputs(base, data, mode, hybrid_kw)
            if mode != "standard" and inp.detection.get("used") == "standard":
                if inp.detection.get("fallback", "").startswith("AI detection failed"):
                    raise ValueError(inp.detection["fallback"])
                raise RuntimeError(f"fell back to Standard: {inp.detection.get('fallback')}")
            sess = process_plan(data, name, topology_guard=(mode != "ai_raw"), scale_lock=True, inputs=inp)
        except ValueError as exc:   # the pipeline could not build a model from this plan
            out[mode] = {"failed": str(exc)}
            continue
        v = sess.corrected
        f = sess.image.resample
        gt = _scale_gt(gt_raw, f)
        res = evaluate_version(v.rooms, v.openings, v.stats(), sess.scale["meters_per_px"], gt)
        if gt_raw.get("walls"):
            gt_w = np.zeros(sess.image.dark.shape, np.uint8)
            for w in gt_raw["walls"]:
                cv2.fillPoly(gt_w, [np.round(np.array(w["polygon"]) * f).astype(np.int32)], 1)
            res.update(wall_scores(wall_raster(v.walls, v.solids, gt_w.shape, v.openings), gt_w > 0,
                                   tol=max(2, round(0.5 * sess.thickness))))
        else:
            res.update(wall_iou=None, wall_precision=None, wall_recall=None)
        res["seconds"] = round(time.time() - t0, 2)
        res["ai_seconds"] = inp.detection.get("ai_seconds")
        out[mode] = {k: res[k] for k in ("room_recall", "room_precision", "room_iou_all", "structural_consistency",
                                         "wall_iou", "wall_precision", "wall_recall", "seconds", "ai_seconds",
                                         "rooms_predicted", "rooms_actual")}
        out[mode]["dimension_error_pct"] = res.get("dimension_error_pct")
        out[mode]["scale_error_pct"] = res.get("scale_error_pct")
        out[mode]["scale_status"] = sess.scale["status"]
        out[mode]["doors_f1"] = res["doors"]["f1"]
        out[mode]["windows_f1"] = res["windows"]["f1"]
    return out


METRICS = ["room_recall", "room_precision", "room_iou_all", "wall_iou", "wall_precision", "wall_recall", "doors_f1",
           "windows_f1", "structural_consistency", "dimension_error_pct", "scale_error_pct"]
NO_ZERO_FILL = {"structural_consistency", "dimension_error_pct", "scale_error_pct"}


def summarise(rows: list[dict]) -> dict:
    """Mean over all plans; a failed reconstruction scores 0 (nothing found), except connectivity (excluded)."""
    out = {}
    for mode in MODES:
        ok = [r[mode] for r in rows if "failed" not in r[mode]]
        failed = len(rows) - len(ok)
        agg = {"plans": len(rows), "failed": failed}
        for m in METRICS:
            vals = [r[mode][m] for r in rows if "failed" not in r[mode] and r[mode][m] is not None]
            if m not in NO_ZERO_FILL and vals:
                vals += [0.0] * failed
            agg[m] = round(float(np.mean(vals)), 4) if vals else None
        secs = [r[mode]["seconds"] for r in rows if "failed" not in r[mode]]
        agg["seconds"] = round(float(np.mean(secs)), 2) if secs else None
        wins = sum(1 for r in rows if "failed" not in r[mode] and "failed" not in r["standard"]
                   and r[mode]["room_recall"] is not None and r["standard"]["room_recall"] is not None
                   and r[mode]["room_recall"] > r["standard"]["room_recall"])
        agg["room_recall_better_than_standard"] = wins
        out[mode] = agg
    return out


def markdown(summary: dict, args) -> str:
    head = ["Metric (mean over plans)"] + [LABEL[m] for m in MODES]
    src = (f"SYNTHETIC plans (eval/synth.py seeds {args.offset}-{args.offset + args.n - 1}), exact ground truth incl. "
           "scale. Synthetic results do not establish real-world accuracy." if args.synthetic else
           f"Real floor plans: CubiCasa5K `{args.split}` split, first {args.n} plans after offset {args.offset}, "
           "human ground truth.")
    lines = [src + " Same image, coordinates and rules for every mode.", "",
             "| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    names = {"room_recall": "Rooms found (recall, IoU≥0.5)", "room_precision": "Rooms correct (precision)",
             "room_iou_all": "Room boundary overlap (IoU, missed = 0)", "wall_iou": "Wall pixel IoU",
             "wall_precision": "Wall precision (tolerant)", "wall_recall": "Wall recall (tolerant)",
             "doors_f1": "Doors F1", "windows_f1": "Windows F1", "structural_consistency": "Wall ends connected",
             "dimension_error_pct": "Room size error % (lower is better)",
             "scale_error_pct": "Scale error % (lower is better)"}
    for m in METRICS:
        if all(summary[k][m] is None for k in MODES):
            continue
        lines.append("| " + names[m] + " | " + " | ".join(
            "—" if summary[k][m] is None else f"{summary[k][m]:.3f}" for k in MODES) + " |")
    lines.append("| Plans that failed to reconstruct | " + " | ".join(str(summary[k]["failed"]) for k in MODES) + " |")
    lines.append("| Seconds per plan (after shared OCR) | " + " | ".join(
        "—" if summary[k]["seconds"] is None else f"{summary[k]['seconds']:.1f}" for k in MODES) + " |")
    lines += ([""] if args.synthetic else
              ["", "Scale and size errors are not measured: CubiCasa5K annotations have no metric scale.",
               "Caveat: the AI model was trained on CubiCasa5K (other plans, same styles), which favours it here."])
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test")
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--hybrid", default="", help="hybrid options, e.g. add=1,drop=1,cut=0")
    ap.add_argument("--out", default="")
    ap.add_argument("--variants", action="store_true", help="also score the hybrid variants (tuning only)")
    ap.add_argument("--synthetic", action="store_true", help="ArchNext's synthetic plans (seeds from --offset)")
    args = ap.parse_args()
    if args.variants:
        MODES.extend(VARIANTS)
        LABEL.update({k: k for k in VARIANTS})
    kw = {}
    names = {"add": "add_missing", "drop": "drop_false", "cut": "cut_ai_openings"}
    for part in filter(None, args.hybrid.split(",")):
        k, v = part.split("=")
        kw[names[k]] = v == "1"
    if not cc.status()["available"]:
        raise SystemExit(f"Model unavailable: {cc.status()['reason']}")
    if args.synthetic:
        from eval.synth import generate  # noqa: PLC0415
        jobs = [(lambda seed=seed: run_one(*generate(seed), f"synthetic_{seed}", kw))
                for seed in range(args.offset, args.offset + args.n)]
    else:
        jobs = [(lambda fo=fo: run_plan(fo, kw)) for fo in fetch(split_list(args.split)[args.offset:args.offset + args.n])]
    rows = []
    for i, job in enumerate(jobs, 1):
        rows.append(job())
        r = rows[-1]
        print(f"[{i}/{len(jobs)}] {r['plan']}: " + "  ".join(
            f"{m}={'FAIL' if 'failed' in r[m] else round(r[m]['room_recall'] or 0, 2)}/{'' if 'failed' in r[m] else round(r[m]['wall_iou'], 2)}"
            for m in MODES), flush=True)
    summary = summarise(rows)
    print(json.dumps(summary, indent=1))
    if args.out:
        RESULTS.mkdir(exist_ok=True)
        meta = {"split": args.split, "n": args.n, "offset": args.offset, "hybrid_options": kw,
                "model": cc.MODEL_NAME, "model_source": cc.MODEL_SOURCE, "dataset": "ArchNext synthetic (eval/synth.py)" if args.synthetic else "CubiCasa5K (Zenodo 2613548)",
                "infer_long_side": cc.INFER_LONG_SIDE}
        (RESULTS / f"{args.out}.json").write_text(json.dumps({"meta": meta, "summary": summary, "plans": rows},
                                                             indent=1), encoding="utf-8")
        (RESULTS / f"{args.out}.md").write_text(markdown(summary, args), encoding="utf-8")


if __name__ == "__main__":
    main()
