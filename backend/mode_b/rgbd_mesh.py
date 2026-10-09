"""RGB-D SENSOR DEMO: triangle mesh from the measured depth maps + a labelled room-shell layer.

Mesh (measured): for a spread of frames, neighbouring valid depth pixels are joined into triangles, back-projected with
the calibrated intrinsics and the dataset's recorded pose. A triangle is rejected when its vertices span a depth
discontinuity (object edges), when it is seen at a grazing angle or has an over-long edge, and when its area is already
covered by an earlier frame (3 cm cells), so overlapping frames do not stack duplicate surfaces. Colours are the RGB
pixels. Nothing is smoothed, filled or invented.

Shell (structural layer): the existing room-layout estimator is run on the fused depth points; floor / walls / ceiling
cells are classified by VisionTrust exactly as for video (observed / uncertain / generated) and are shown as a separate,
clearly coloured layer — never mixed into the measured mesh.
"""
from __future__ import annotations

import time

import cv2
import numpy as np

from . import layout as layout_mod, trust
from .evaluation.tum import Sequence
from .export import _Builder
from .sfm import SfmResult

M = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)          # TUM z-up -> viewer y-up (same as rgbd.py)


def triangulate(seq: Sequence, frames: list[int], centre: np.ndarray, step: int = 5, cell: float = 0.03):
    fx, fy, cx, cy = seq.intrinsics
    covered: set = set()
    V, C, F = [], [], []
    nv = 0
    for i in frames:
        t = seq.rgb[i][0]
        T, dname = seq.pose_at(t), seq.depth_for(t)
        if T is None or dname is None:
            continue
        d = cv2.imread(str(seq.path / dname), cv2.IMREAD_UNCHANGED).astype(np.float32) / 5000.0
        img = cv2.imread(str(seq.path / seq.rgb[i][1]))
        vv, uu = np.mgrid[0:d.shape[0]:step, 0:d.shape[1]:step]
        z = d[vv, uu]
        h, w = z.shape
        valid = (z > 0.4) & (z < 4.0)
        Pc = np.stack([(uu - cx) * z / fx, (vv - cy) * z / fy, z], axis=-1)
        Pw = (Pc.reshape(-1, 3) @ T[:3, :3].T + T[:3, 3]) @ M.T - centre
        col = img[vv, uu][..., ::-1].reshape(-1, 3)
        cam = M @ T[:3, 3] - centre
        idx = np.arange(h * w).reshape(h, w)
        a, b, c_, d_ = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, :-1].ravel(), idx[1:, 1:].ravel()
        zf = z.ravel()
        vf = valid.ravel()
        tris = np.concatenate([np.stack([a, c_, b], 1), np.stack([b, c_, d_], 1)])
        ok = vf[tris].all(1)
        tz = zf[tris]
        ok &= (tz.max(1) - tz.min(1)) < 0.03 + 0.04 * tz.min(1)                 # no bridging across depth jumps
        P0, P1, P2 = Pw[tris[:, 0]], Pw[tris[:, 1]], Pw[tris[:, 2]]
        n = np.cross(P1 - P0, P2 - P0)
        area = np.linalg.norm(n, axis=1)
        ctr = (P0 + P1 + P2) / 3
        view = ctr - cam
        cosang = np.abs((n * view).sum(1)) / np.maximum(area * np.linalg.norm(view, axis=1), 1e-9)
        ok &= cosang > 0.12                                                     # not grazing
        edge = np.maximum.reduce([np.linalg.norm(P1 - P0, axis=1), np.linalg.norm(P2 - P1, axis=1),
                                  np.linalg.norm(P0 - P2, axis=1)])
        ok &= edge < 0.15
        keys = np.floor(ctr / cell).astype(np.int64)
        kk = (keys[:, 0] + 2 ** 20) * 2 ** 42 + (keys[:, 1] + 2 ** 20) * 2 ** 21 + (keys[:, 2] + 2 ** 20)
        fresh = np.array([k not in covered for k in kk])                         # area not yet covered by earlier frames
        ok &= fresh
        covered.update(kk[ok].tolist())
        tris = tris[ok]
        if not len(tris):
            continue
        used, remap = np.unique(tris, return_inverse=True)
        V.append(Pw[used])
        C.append(col[used])
        F.append(remap.reshape(-1, 3) + nv)
        nv += len(used)
    return np.vstack(V).astype(np.float32), np.vstack(C).astype(np.uint8), np.vstack(F).astype(np.uint32)


def mesh_glb(V, C, F) -> bytes:
    import json
    import struct
    B = _Builder()
    pa = B.add(V, 34962, 5126, "VEC3", minmax=True)
    ca = B.add(np.concatenate([C, np.full((len(C), 1), 255, np.uint8)], 1), 34962, 5121, "VEC4")
    ia = B.add(F.reshape(-1), 34963, 5125, "SCALAR")
    gltf = {"asset": {"version": "2.0", "generator": "ArchNext Mode B RGB-D mesh",
                      "extras": {"units": "metres", "source": "RGB-D sensor depth + recorded poses (measured)"}},
            "scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"name": "Measured RGB-D surface", "mesh": 0}],
            "meshes": [{"name": "measured", "primitives": [{"attributes": {"POSITION": pa, "COLOR_0": ca}, "indices": ia,
                                                            "material": 0}]}],
            "materials": [{"name": "measured RGB", "doubleSided": True,
                           "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1}}],
            "accessors": B.accessors, "bufferViews": B.views, "buffers": [{"byteLength": len(B.bin)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    bn = bytes(B.bin) + b"\0" * ((4 - len(B.bin) % 4) % 4)
    return (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn)) + struct.pack("<II", len(js), 0x4E4F534A)
            + js + struct.pack("<II", len(bn), 0x004E4942) + bn)


def shell(points_view: np.ndarray, cams: list[dict]) -> tuple[list[dict], dict]:
    """Room shell from the fused points (viewer frame), VisionTrust-classified, returned in the viewer frame."""
    rng = np.random.default_rng(0)
    P = points_view[rng.choice(len(points_view), min(60000, len(points_view)), replace=False)]
    C = np.array([c["center"] for c in cams])
    R = []
    for c in cams:
        f, u = np.array(c["forward"]), np.array(c["up"])
        r = np.cross(u, f) * -1                       # camera x (right) = down x forward = -(up x forward)
        R.append(np.stack([np.cross(-u, f), -u, f]))  # rows: x, y (down), z (forward)
    fake = SfmResult([f"f{k}" for k in range(len(C))], C, np.array(R),
                     {"model": "PINHOLE", "width": 640, "height": 480, "params": [517.3, 318.6, 255.3]},
                     np.full(len(C), 0.5), P, np.zeros((len(P), 3), np.uint8), np.full(len(P), 0.5),
                     [np.arange(3, dtype=np.int32)] * len(P), {})
    lay = layout_mod.estimate(fake)
    if lay.tau == 0:
        return [], {"failure": lay.failure}
    surfaces = trust.build_surfaces(lay, completion=True)
    Rl, tl = lay.R, lay.t
    out = []
    for s in surfaces:
        cs = np.array(s["corners"]) - tl
        s["corners"] = np.round(cs @ Rl, 4).tolist()                          # layout frame -> viewer frame
        s["normal"] = np.round(Rl.T @ np.array(s["normal"]), 5).tolist()
        for cell in s["cells"]:
            cell["frames"] = []
        s["method"] = s["method"].replace("reconstructed points", "fused depth points")
        out.append(s)
    return out, {"reliable": lay.reliable, "failure": lay.failure,
                 "measured": [p.id for p in lay.planes.values() if p.evidence], "notes": lay.notes}


def build(name: str, cams: list[dict], points_view: np.ndarray, centre: np.ndarray, n_frames: int = 36, progress=None):
    t0 = time.time()
    seq = Sequence.load(name)
    frames = [int(c["index"]) for c in cams]
    pick = [frames[int(k)] for k in np.linspace(0, len(frames) - 1, min(n_frames, len(frames)))]
    V, C, F = triangulate(seq, pick, centre)
    if progress:
        progress(0.7, f"{len(F):,} measured triangles from {len(pick)} depth frames")
    surfaces, info = shell(points_view, cams)
    return {"V": V, "C": C, "F": F, "frames": pick, "surfaces": surfaces, "shell": info,
            "seconds": round(time.time() - t0, 1)}


def add_version(pid: str, progress=None) -> dict:
    """Version N+1 of an RGB-D demo project: same points, plus the measured mesh (mesh.glb) and the labelled shell.
    The earlier version is kept unchanged."""
    from . import projects, rgbd
    proj = projects.load(pid)
    v_prev = proj["current_version"]
    prev = projects.scene(pid, v_prev)
    name = prev["source"]["sequence"]
    r = rgbd.fuse(name)                                                   # deterministic: the same points as before
    m = build(name, r["cameras"], r["points"], r["centre"], progress=progress)
    v = v_prev + 1
    vdir = projects.version_dir(pid, v)
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "mesh.glb").write_bytes(mesh_glb(m["V"], m["C"], m["F"]))
    scene = {**prev, "version": v, "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "surfaces": m["surfaces"],
             "completion": True,
             "summary": trust.summary(m["surfaces"]) if m["surfaces"] else None,
             "layout": {"reliable": m["shell"].get("reliable"), "failure": m["shell"].get("failure"),
                        "notes": m["shell"].get("notes", []), "box": None, "planes": []},
             "mesh": {"file": "mesh.glb", "triangles": int(len(m["F"])), "vertices": int(len(m["V"])),
                      "frames": len(m["frames"]), "source": "measured depth (triangulated per frame)"},
             "shell": {"measured": m["shell"].get("measured"), "note": "Room-shell layer fitted to the fused depth "
                       "points; cells never seen by any frame are GENERATED (completion) and drawn separately."}}
    scene["method"] = {**prev["method"], "mesh": f"Depth-map triangulation: {len(m['F']):,} triangles from {len(m['frames'])} "
                       "frames (no smoothing, no hole filling)", "completion": "Room shell: measured planes extended; "
                       "unseen cells generated and labelled"}
    projects.write_json(vdir / "scene.json", scene)
    proj = projects.load(pid)
    proj["versions"].append({"version": v, "created": scene["created"], "videos": 0, "keyframes": len(m["frames"]),
                             "registered": len(m["frames"]), "summary": {"observed": None, "generated": None, "reliable": True}})
    proj["current_version"] = v
    projects.save(pid, proj)
    return scene
