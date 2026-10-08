"""GLB export of a Mode B scene (NumPy only, so the API process can call it).

The file contains the reconstructed geometry itself, not the viewer's highlight effects:
  * one mesh per room surface, one primitive per VisionTrust class (observed / uncertain / generated), with the
    class colour as material and ``extras`` describing the surface, its evidence and assumptions;
  * the sparse reconstructed points (POINTS primitive with their image colours);
  * the camera path (LINE_STRIP).
Coordinates are the scene's (y up). With a manual scale calibration they are multiplied by metres-per-unit, so
the GLB is in metres; otherwise it is in reconstruction units and says so in ``asset.extras``.
"""
from __future__ import annotations

import json
import struct

import numpy as np

CLASS_RGBA = {"observed": [0.063, 0.725, 0.506, 1.0], "uncertain": [0.961, 0.620, 0.043, 1.0],
              "generated": [0.545, 0.361, 0.965, 1.0]}


class _Builder:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accessors = [], []

    def add(self, arr: np.ndarray, target: int | None, comp: int, typ: str, minmax: bool = False) -> int:
        while len(self.bin) % 4:
            self.bin += b"\0"
        data = arr.tobytes()
        view = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            view["target"] = target
        self.views.append(view)
        self.bin += data
        acc = {"bufferView": len(self.views) - 1, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if comp == 5121:
            acc["normalized"] = True
        if minmax:
            acc["min"] = arr.min(axis=0).astype(float).tolist()
            acc["max"] = arr.max(axis=0).astype(float).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1


def cell_quads(surface: dict, cls_filter=None):
    """Vertices (n, 3) and triangle indices of the surface's cells (optionally only some classes)."""
    c = np.array(surface["corners"], float)
    o, u, v = c[0], c[1] - c[0], c[3] - c[0]
    nu, nv = surface["grid"]
    verts, tris = [], []
    for cell in surface["cells"]:
        if cls_filter and cell["cls"] not in cls_filter:
            continue
        i, j = cell["i"], cell["j"]
        a = o + i / nu * u + j / nv * v
        b = o + (i + 1) / nu * u + j / nv * v
        d = o + (i + 1) / nu * u + (j + 1) / nv * v
        e = o + i / nu * u + (j + 1) / nv * v
        k = len(verts)
        verts += [a, b, d, e]
        n = np.array(surface["normal"], float)
        if np.dot(np.cross(b - a, e - a), n) >= 0:        # front faces point into the room
            tris += [[k, k + 1, k + 2], [k, k + 2, k + 3]]
        else:
            tris += [[k, k + 2, k + 1], [k, k + 3, k + 2]]
    return np.array(verts, np.float32).reshape(-1, 3), np.array(tris, np.uint32).reshape(-1, 3)


def scene_to_glb(scene: dict, meters_per_unit: float | None = None, include: str = "all") -> bytes:
    """``include``: "all" (observed + uncertain + generated) or "observed" (observed and uncertain only)."""
    if not scene.get("surfaces") and not scene.get("points", {}).get("xyz"):
        raise ValueError("This reconstruction has no geometry to export.")
    s = float(meters_per_unit) if meters_per_unit else 1.0
    B = _Builder()
    materials, meshes, nodes = [], [], []
    mat_index = {}
    for cls, rgba in CLASS_RGBA.items():
        mat_index[cls] = len(materials)
        materials.append({"name": f"VisionTrust {cls}", "doubleSided": True,
                          "pbrMetallicRoughness": {"baseColorFactor": rgba, "metallicFactor": 0.0, "roughnessFactor": 0.9}})
    classes = ("observed", "uncertain") if include == "observed" else ("observed", "uncertain", "generated")
    for surf in scene.get("surfaces", []):
        prims = []
        for cls in classes:
            V, T = cell_quads(surf, {cls})
            if not len(T):
                continue
            V = V * s
            N = np.tile(np.array(surf["normal"], np.float32), (len(V), 1))
            pa = B.add(V.astype(np.float32), 34962, 5126, "VEC3", minmax=True)
            na = B.add(N, 34962, 5126, "VEC3")
            ia = B.add(T.reshape(-1).astype(np.uint32), 34963, 5125, "SCALAR")
            prims.append({"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia, "material": mat_index[cls],
                          "extras": {"class": cls}})
        if not prims:
            continue
        meshes.append({"name": surf["id"], "primitives": prims})
        nodes.append({"name": f"{surf['kind']} {surf['id']}", "mesh": len(meshes) - 1,
                      "extras": {"surface": surf["id"], "class": surf["class"], "confidence": surf["confidence"],
                                 "method": surf["method"], "assumptions": surf["assumptions"], "shares": surf["shares"]}})
    pts = scene.get("points") or {}
    if pts.get("xyz"):
        P = np.array(pts["xyz"], np.float32).reshape(-1, 3) * s
        Cc = np.array(pts["rgb"], np.uint8).reshape(-1, 3)
        Cc = np.concatenate([Cc, np.full((len(Cc), 1), 255, np.uint8)], axis=1)
        pa = B.add(P, 34962, 5126, "VEC3", minmax=True)
        ca = B.add(Cc, 34962, 5121, "VEC4")
        meshes.append({"name": "observed points", "primitives": [{"attributes": {"POSITION": pa, "COLOR_0": ca}, "mode": 0}]})
        nodes.append({"name": "Reconstructed points (SfM)", "mesh": len(meshes) - 1})
    cams = scene.get("cameras") or []
    if len(cams) >= 2:
        Cp = np.array([c["center"] for c in cams], np.float32) * s
        pa = B.add(Cp, 34962, 5126, "VEC3", minmax=True)
        meshes.append({"name": "camera path", "primitives": [{"attributes": {"POSITION": pa}, "mode": 3}]})
        nodes.append({"name": "Camera path", "mesh": len(meshes) - 1})
    gltf = {
        "asset": {"version": "2.0", "generator": "ArchNext Mode B (VisionTrust)",
                  "extras": {"units": "metres" if meters_per_unit else "reconstruction units (scale unknown)",
                             "scene_version": scene.get("version"), "include": include}},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
        "materials": materials, "accessors": B.accessors, "bufferViews": B.views,
        "buffers": [{"byteLength": len(B.bin)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    bn = bytes(B.bin) + b"\0" * ((4 - len(B.bin) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(bn), 0x004E4942) + bn)


def read_glb(data: bytes) -> tuple[dict, bytes]:
    """Parse a GLB (for tests and checks): JSON chunk and binary chunk."""
    magic, ver, total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or ver != 2 or total != len(data):
        raise ValueError("not a GLB 2.0 file")
    jl, jt = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + jl])
    bl, bt = struct.unpack_from("<II", data, 20 + jl)
    return js, data[28 + jl:28 + jl + bl]
