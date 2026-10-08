"""Real floor plans with human-made ground truth: samples from the CubiCasa5K dataset.

The full dataset is a 5.5 GB zip on Zenodo (https://zenodo.org/records/2613548, CC BY-NC 4.0). Only the
requested samples are read from it with HTTP range requests and cached next to the model weights; nothing is
stored in this repository.

Each sample provides ``F1_scaled.png`` and ``model.svg`` (same pixel coordinates). The SVG annotation is
converted to ArchNext's annotation format (see app/evaluation.py) using the same rules as the official
CubiCasa5K loader (floortrans/loaders/house.py):
  * rooms   = every ``Space`` polygon except ``Outdoor``
  * doors / windows = segment through the middle of each ``Door`` / ``Window`` polygon along its long side
  * walls   = ``Wall`` polygons (``Railing`` excluded), used for the wall-overlap score
The CubiCasa5K annotations contain no metric scale, so scale and dimension errors cannot be measured.
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from xml.dom import minidom

import httpx

from app.pipeline.cubicasa import MODEL_DIR

ZIP_URL = "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1"
CACHE = MODEL_DIR / "dataset"


class HTTPRangeFile(io.RawIOBase):
    """Read-only, seekable view of a remote file using HTTP range requests (enough for zipfile)."""

    def __init__(self, url: str, block: int = 1 << 20):
        self.url, self.block, self.pos = url, block, 0
        self.client = httpx.Client(follow_redirects=True, timeout=120)
        r = self.client.head(url)
        r.raise_for_status()
        self.size = int(r.headers["content-length"])
        self._cache: dict[int, bytes] = {}

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i: int) -> bytes:
        if i not in self._cache:
            a = i * self.block
            b = min(self.size, a + self.block) - 1
            for _ in range(4):
                try:
                    r = self.client.get(self.url, headers={"Range": f"bytes={a}-{b}"})
                    if r.status_code == 206:
                        self._cache[i] = r.content
                        break
                except httpx.HTTPError:
                    continue
            else:
                raise OSError("range request failed")
        return self._cache[i]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        out = bytearray()
        while n > 0 and self.pos < self.size:
            i, off = divmod(self.pos, self.block)
            chunk = self._block(i)[off:off + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)


def _zip() -> zipfile.ZipFile:
    return zipfile.ZipFile(HTTPRangeFile(ZIP_URL))


def split_list(name: str = "test") -> list[str]:
    """Sample folders of a split (cached)."""
    f = CACHE / f"{name}.txt"
    if not f.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with _zip() as z:
            f.write_bytes(z.read(f"cubicasa5k/{name}.txt"))
    return [line.strip().strip("/") for line in f.read_text().splitlines() if line.strip()]


def fetch(folders: list[str]) -> list[Path]:
    """Download F1_scaled.png and model.svg for the given sample folders (cached)."""
    out, missing = [], []
    for fo in folders:
        d = CACHE / fo.replace("/", "_")
        out.append(d)
        if not ((d / "F1_scaled.png").exists() and (d / "model.svg").exists()):
            missing.append((fo, d))
    if missing:
        with _zip() as z:
            for fo, d in missing:
                d.mkdir(parents=True, exist_ok=True)
                for name in ("F1_scaled.png", "model.svg"):
                    (d / name).write_bytes(z.read(f"cubicasa5k/{fo}/{name}"))
    return out


def _points(e) -> list[list[float]]:
    pol = next(p for p in e.childNodes if p.nodeName == "polygon")
    pts = [p for p in pol.getAttribute("points").strip().split(" ") if p]
    return [[float(v) for v in p.split(",")] for p in pts]


def _segment(pts: list[list[float]]) -> dict:
    """Opening polygon -> centre line along its long side (as in the official loader)."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    if max(xs) - min(xs) > max(ys) - min(ys):
        y = (min(ys) + max(ys)) / 2
        return {"x1": min(xs), "y1": y, "x2": max(xs), "y2": y}
    x = (min(xs) + max(xs)) / 2
    return {"x1": x, "y1": min(ys), "x2": x, "y2": max(ys)}


ROOM_TYPE = {"Bedroom": "bedroom", "Bath": "bathroom", "Sauna": "bathroom", "Kitchen": "kitchen",
             "LivingRoom": "living", "Lounge": "living", "Dining": "dining", "EatingArea": "dining",
             "Entry": "circulation", "HallWay": "circulation", "DraughtLobby": "circulation", "Hall": "circulation",
             "Garage": "garage", "CarPort": "garage", "Storage": "utility", "Closet": "utility",
             "DressingRoom": "utility", "Utility": "utility", "TechnicalRoom": "utility", "Office": "study",
             "Library": "study"}


def annotation(svg_path: Path) -> dict:
    """CubiCasa5K SVG -> ArchNext ground-truth annotation (pixel coordinates of F1_scaled.png)."""
    svg = minidom.parse(str(svg_path))
    gt = {"rooms": [], "doors": [], "windows": [], "walls": [], "source": "CubiCasa5K human annotation"}
    for e in svg.getElementsByTagName("g"):
        gid, cls = e.getAttribute("id"), e.getAttribute("class")
        try:
            if gid == "Wall":
                gt["walls"].append({"polygon": _points(e)})
            elif gid == "Door":
                gt["doors"].append(_segment(_points(e)))
            elif gid == "Window":
                gt["windows"].append(_segment(_points(e)))
            elif cls.startswith("Space "):
                name = cls.replace("Space ", "").split(" ")[0]
                if name == "Outdoor":
                    continue
                pts = _points(e)
                if len(pts) >= 3:
                    gt["rooms"].append({"polygon": pts, "type": ROOM_TYPE.get(name, "unknown"), "name": name})
        except StopIteration:
            continue
    return gt


if __name__ == "__main__":  # pragma: no cover - manual utility
    import sys

    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    dirs = fetch(split_list("test")[:n])
    for d in dirs:
        a = annotation(d / "model.svg")
        print(d.name, {k: len(v) for k, v in a.items() if isinstance(v, list)})
    print(json.dumps({"cache": str(CACHE)}))
