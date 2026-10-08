"""Evaluation metrics for Mode B reconstructions against TUM RGB-D reference data.

Alignment. Video-only reconstructions have no metric scale. For evaluation only, the reconstruction is mapped
to the ground-truth (GT) frame by a similarity transform (Sim3, Umeyama) between its registered camera centres
and the motion-capture camera centres at the same timestamps. After this alignment distances are in metres.
The app itself never uses ground truth.

Reference geometry. GT points = TUM depth images back-projected with GT poses (all frames of the sequence,
input, candidate and held-out alike). The reference room shell = GT points within 5 cm of the floor / wall /
ceiling planes fitted to that dense GT cloud with the same layout estimator (measured planes only).
Furniture is not part of the shell.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree
from scipy.stats import spearmanr

from ..export import cell_quads

METRICS = {
    "chamfer_m": {"label": "Chamfer distance", "units": "m",
                  "definition": "Mean of (a) reconstruction-to-shell and (b) shell-to-reconstruction nearest-neighbour "
                                "distances between points sampled on the reconstructed surfaces and the GT room-shell points.",
                  "limitations": "Needs the evaluation-only Sim3 alignment; GT shell limited to what the depth sensor saw."},
    "accuracy_m": {"label": "Accuracy (reconstruction → shell)", "units": "m",
                   "definition": "Median distance from reconstructed surface samples to the nearest GT shell point.",
                   "limitations": "Shell regions the sensor never saw cannot be checked."},
    "completeness": {"label": "Surface completeness", "units": "fraction",
                     "definition": "Share of GT room-shell points within 10 cm of a reconstructed surface.",
                     "limitations": "Only the measured GT shell counts."},
    "completeness_observed": {"label": "Completeness by observed surfaces", "units": "fraction",
                              "definition": "Share of GT shell points within 10 cm of a surface cell classified OBSERVED.",
                              "limitations": "As above."},
    "wall_position_error_m": {"label": "Wall-position error", "units": "m",
                              "definition": "Mean distance between each reconstructed wall plane and the matching GT wall "
                                            "plane (same orientation, measured in GT), at the wall's centre.",
                              "limitations": "Only walls present in both layouts."},
    "room_dimension_error_m": {"label": "Room dimension error", "units": "m",
                               "definition": "Mean absolute difference of room length / width between reconstruction "
                                             "and GT layout, for axes where GT measured both walls.",
                               "limitations": "Few TUM rooms show both opposite walls."},
    "unseen_error_m": {"label": "Unseen-region error", "units": "m",
                       "definition": "Median distance from GENERATED cells' samples to the nearest GT shell point "
                                     "(only cells with GT shell data within 1 m).",
                       "limitations": "N/A without completion or without GT data there."},
    "heldout_depth_error_m": {"label": "Held-out view depth error", "units": "m",
                              "definition": "Median |rendered depth − sensor depth| over shell pixels of held-out frames "
                                            "(never used for reconstruction), rendering the reconstructed surfaces.",
                              "limitations": "Geometric novel-view metric; furniture pixels excluded."},
    "heldout_view_completeness": {"label": "Held-out view completeness", "units": "fraction",
                                  "definition": "Share of shell pixels of held-out frames on which the reconstruction has a "
                                                "surface within 20 cm of the sensor depth.",
                                  "limitations": "As above."},
    "observed_share": {"label": "Observed share", "units": "fraction of shell area",
                       "definition": "VisionTrust: area share of OBSERVED cells.", "limitations": "Model-internal."},
    "generated_share": {"label": "Generated share", "units": "fraction of shell area",
                        "definition": "VisionTrust: area share of GENERATED cells.", "limitations": "Model-internal."},
    "confidence_error_spearman": {"label": "Confidence vs error (Spearman ρ)", "units": "−1…1",
                                  "definition": "Rank correlation between a cell's GeometryTrust score and its median "
                                                "distance to the GT shell (negative = higher confidence, lower error).",
                                  "limitations": "Cells with GT shell data within 1 m only."},
    "psnr": {"label": "PSNR", "units": "dB", "definition": "N/A",
             "limitations": "Not computed: the reconstruction is an untextured plane layout, so no comparable photometric "
                            "novel-view rendering exists. Reporting it would be misleading."},
    "ssim": {"label": "SSIM", "units": "", "definition": "N/A", "limitations": "As PSNR."},
    "lpips": {"label": "LPIPS", "units": "", "definition": "N/A", "limitations": "As PSNR."},
}


def umeyama(src: np.ndarray, dst: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    mu_s, mu_d = src.mean(0), dst.mean(0)
    A, B = src - mu_s, dst - mu_d
    U, D, Vt = np.linalg.svd(B.T @ A / len(src))
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1
    R = U @ S @ Vt
    s = np.trace(np.diag(D) @ S) / max((A ** 2).sum() / len(src), 1e-12)
    return float(s), R, mu_d - s * R @ mu_s


class Sim3:
    def __init__(self, s: float, R: np.ndarray, t: np.ndarray):
        self.s, self.R, self.t = s, R, t

    def __call__(self, X: np.ndarray) -> np.ndarray:
        return self.s * X @ self.R.T + self.t

    def inverse(self) -> "Sim3":
        Ri = self.R.T
        return Sim3(1 / self.s, Ri, -(Ri @ self.t) / self.s)


def surface_samples(scene: dict, spacing: float) -> list[tuple[str, dict, np.ndarray, str]]:
    """(surface id, cell, samples (n,3) in scene coordinates, class) for every cell: a uniform grid with the given
    spacing (scene units), so sampling gaps never count as missing surface."""
    out = []
    for s in scene["surfaces"]:
        c = np.array(s["corners"], float)
        o, u, v = c[0], c[1] - c[0], c[3] - c[0]
        nu, nv = s["grid"]
        ku = max(2, int(np.ceil(np.linalg.norm(u) / nu / spacing)))
        kv = max(2, int(np.ceil(np.linalg.norm(v) / nv / spacing)))
        ga, gb = np.meshgrid((np.arange(ku) + 0.5) / ku, (np.arange(kv) + 0.5) / kv, indexing="ij")
        for cell in s["cells"]:
            a = (cell["i"] + ga.ravel()) / nu
            b = (cell["j"] + gb.ravel()) / nv
            out.append((s["id"], cell, o + a[:, None] * u + b[:, None] * v, cell["cls"]))
    return out


def ray_depth(scene: dict, origin: np.ndarray, dirs: np.ndarray) -> np.ndarray:
    """Distance along unit rays to the first reconstructed cell (inf if none), scene coordinates."""
    best = np.full(len(dirs), np.inf)
    for s in scene["surfaces"]:
        c = np.array(s["corners"], float)
        n = np.array(s["normal"], float)
        o, u, v = c[0], c[1] - c[0], c[3] - c[0]
        if u @ u < 1e-12 or v @ v < 1e-12:                    # degenerate rectangle: nothing to hit
            continue
        denom = dirs @ n
        ok = np.abs(denom) > 1e-9
        t = np.where(ok, ((o - origin) @ n) / np.where(ok, denom, 1), np.inf)
        t[t <= 1e-6] = np.inf
        fin = np.isfinite(t)
        X = origin + np.where(fin, t, 0.0)[:, None] * dirs        # no inf * 0 for rays parallel to the plane
        a = np.where(fin, (X - o) @ u / (u @ u), -1.0)
        b = np.where(fin, (X - o) @ v / (v @ v), -1.0)
        nu, nv = s["grid"]
        inside = (a >= 0) & (a <= 1) & (b >= 0) & (b <= 1) & np.isfinite(t)
        present = np.zeros((nu, nv), bool)
        for cell in s["cells"]:
            present[cell["i"], cell["j"]] = True
        ia = np.clip((a * nu).astype(int), 0, nu - 1)
        ib = np.clip((b * nv).astype(int), 0, nv - 1)
        hit = inside & present[ia, ib]
        best = np.where(hit & (t < best), t, best)
    return best


def evaluate(scene: dict, to_gt: Sim3, scene_to_raw, shell: np.ndarray, shell_tree: cKDTree,
             gt_planes: dict | None, heldout: list[dict], intr: tuple) -> dict:
    """All metrics for one reconstruction (``scene`` in its own layout frame). ``scene_to_raw`` maps scene
    coordinates back to raw SfM coordinates; ``to_gt`` maps raw SfM to the GT metric frame."""
    res = {}
    samples = surface_samples(scene, spacing=0.025 / to_gt.s)          # 2.5 cm in metres
    if not samples:
        return {k: None for k in METRICS}
    P_all, cls_all, cell_err, cell_conf = [], [], [], []
    for sid, cell, X, cls in samples:
        Y = to_gt(scene_to_raw(X))
        d, _ = shell_tree.query(Y)
        P_all.append(Y)
        cls_all.append(np.full(len(Y), cls))
        if np.median(d) < 1.0 and cls != "generated":
            cell_err.append(float(np.median(d)))
            cell_conf.append(cell["confidence"])
    P = np.vstack(P_all)
    cls = np.concatenate(cls_all)
    d_rec, _ = shell_tree.query(P)
    rec_tree = cKDTree(P)
    d_shell, _ = rec_tree.query(shell)
    res["accuracy_m"] = float(np.median(d_rec))
    res["completeness"] = float(np.mean(d_shell < 0.10))
    res["chamfer_m"] = float(0.5 * (np.mean(np.minimum(d_rec, 2.0)) + np.mean(np.minimum(d_shell, 2.0))))
    obs = P[cls == "observed"]
    res["completeness_observed"] = float(np.mean(cKDTree(obs).query(shell)[0] < 0.10)) if len(obs) else 0.0
    gen = P[cls == "generated"]
    if len(gen):
        dg = d_rec[cls == "generated"]
        dg = dg[dg < 1.0]
        res["unseen_error_m"] = float(np.median(dg)) if len(dg) else None
        res["unseen_evaluated_share"] = float(len(dg) / max(1, (cls == "generated").sum()))
    else:
        res["unseen_error_m"] = None
    res["confidence_error_spearman"] = (float(spearmanr(cell_conf, cell_err).statistic)
                                        if len(cell_err) >= 8 and np.ptp(cell_conf) > 0 else None)
    res["confidence_error_cells"] = len(cell_err)
    sm = scene.get("summary") or {}
    res["observed_share"] = sm.get("shares", {}).get("observed")
    res["generated_share"] = sm.get("shares", {}).get("generated")
    res["uncertain_share"] = sm.get("shares", {}).get("uncertain")
    # Walls and dimensions vs the GT layout (planes expressed in the GT frame).
    if gt_planes:
        errs, dims = [], []
        rec = {}
        for s in scene["surfaces"]:
            if s["kind"] != "wall":
                continue
            c = np.array(s["corners"], float)
            ctr = to_gt(scene_to_raw(c.mean(0, keepdims=True)))[0]
            n = to_gt.R @ (scene_to_raw.R_inv @ np.array(s["normal"], float))
            rec[s["id"]] = (ctr, -n)                           # outward normal in GT frame
        for gid, (gp, gn) in gt_planes.items():                # GT walls: point on plane, outward normal
            match = max(rec.items(), key=lambda kv: kv[1][1] @ gn, default=None)
            if match and match[1][1] @ gn > 0.9:
                errs.append(abs((match[1][0] - gp) @ gn))
        res["wall_position_error_m"] = float(np.mean(errs)) if errs else None
        res["walls_compared"] = len(errs)
        for a, b in (("+x", "-x"), ("+z", "-z")):
            ga, gb = gt_planes.get(f"wall-{a[1]}{a[0]}"), gt_planes.get(f"wall-{b[1]}{b[0]}")
            if ga is not None and gb is not None and rec:
                L_gt = abs((ga[0] - gb[0]) @ ga[1])
                ma = max(rec.values(), key=lambda v: v[1] @ ga[1])
                mb = max(rec.values(), key=lambda v: v[1] @ gb[1])
                if ma[1] @ ga[1] > 0.9 and mb[1] @ gb[1] > 0.9:
                    dims.append(abs(abs((ma[0] - mb[0]) @ ga[1]) - L_gt))
        res["room_dimension_error_m"] = float(np.mean(dims)) if dims else None
    else:
        res["wall_position_error_m"] = res["room_dimension_error_m"] = None
    # Held-out views: render reconstructed depth along each pixel ray and compare on shell pixels.
    errs, hits, total = [], 0, 0
    inv = to_gt.inverse()
    fx, fy, cx, cy = intr
    for h in heldout:
        uv, depth, Xw = h["uv"], h["depth"], h["X"]              # shell pixels: GT depth and world points
        Cw, Rw = h["center"], h["R_wc"]
        dirs_cam = np.stack([(uv[:, 0] - cx) / fx, (uv[:, 1] - cy) / fy, np.ones(len(uv))], axis=1)
        dirs_w = dirs_cam @ Rw.T
        o_s = scene_to_raw.inverse_point(inv(Cw[None])[0])
        far = Cw[None] + dirs_w
        d_s = scene_to_raw.inverse_point_many(inv(far)) - o_s
        scale_ray = np.linalg.norm(d_s, axis=1)
        t = ray_depth(scene, o_s, d_s / scale_ray[:, None])     # scene units along unit scene rays
        z_rec = t / scale_ray                                    # back to GT depth units (metres along camera z)
        ok = np.isfinite(z_rec)
        total += len(depth)
        if ok.any():
            e = np.abs(z_rec[ok] - depth[ok])
            errs.append(e)
            hits += int(np.sum(e < 0.20))
    res["heldout_depth_error_m"] = float(np.median(np.concatenate(errs))) if errs else None
    res["heldout_view_completeness"] = hits / total if total else None
    res["heldout_pixels"] = total
    res["psnr"] = res["ssim"] = res["lpips"] = None
    return res
