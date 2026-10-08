"""Pretrained floor-plan recognition with the official CubiCasa5K model.

Model: ``hg_furukawa_original`` from CubiCasa5K (Kalervo et al., "CubiCasa5K: A Dataset and an Improved
Multi-Task Model for Floorplan Image Analysis", SCIA 2019), official weights
``model_best_val_loss_var.pkl``. Source: https://github.com/CubiCasa/CubiCasa5k

The model code and weights are licensed CC BY-NC 4.0. They are NOT stored in this repository: ``download()``
fetches the official source archive and weights once into a local cache (``ARCHNEXT_MODEL_DIR``, default
``~/.cache/archnext/cubicasa5k``). Inference runs on the CPU with PyTorch.

Outputs used by ArchNext (per pixel, at the working-image resolution):
  * room segmentation, 12 classes (index 2 = Wall, 8 = Railing)
  * icon segmentation, 11 classes (index 1 = Window, 2 = Door)
"""
from __future__ import annotations

import os
import sys
import threading
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

MODEL_DIR = Path(os.environ.get("ARCHNEXT_MODEL_DIR", Path.home() / ".cache" / "archnext" / "cubicasa5k"))
WEIGHTS = MODEL_DIR / "model_best_val_loss_var.pkl"
SRC_DIR = MODEL_DIR / "src"
WEIGHTS_URL = ("https://drive.usercontent.google.com/download?id=1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK"
               "&export=download&confirm=t")
SOURCE_URL = "https://codeload.github.com/CubiCasa/CubiCasa5k/zip/refs/heads/master"
SOURCE_FILES = ("floortrans/__init__.py", "floortrans/models/__init__.py",
                "floortrans/models/hg_furukawa_original.py", "floortrans/models/model_1427.py", "LICENSE")
MODEL_NAME = "CubiCasa5K hg_furukawa_original (model_best_val_loss_var.pkl)"
MODEL_SOURCE = "https://github.com/CubiCasa/CubiCasa5k"
LICENSE = "CC BY-NC 4.0"

ROOM_CLASSES = ["Background", "Outdoor", "Wall", "Kitchen", "Living Room", "Bed Room", "Bath", "Entry", "Railing",
                "Storage", "Garage", "Undefined"]
ICON_CLASSES = ["No Icon", "Window", "Door", "Closet", "Electrical Appliance", "Toilet", "Sink", "Sauna Bench",
                "Fire Place", "Bathtub", "Chimney"]
WALL, RAILING = 2, 8
WINDOW, DOOR = 1, 2
N_HEATMAPS, N_ROOMS, N_ICONS = 21, 12, 11

# Long side (px) the network sees. CubiCasa5K was trained on plans of roughly this size.
INFER_LONG_SIDE = int(os.environ.get("ARCHNEXT_AI_LONG_SIDE", "1024"))


class ModelUnavailable(RuntimeError):
    """The pretrained model cannot be used (PyTorch missing, weights not downloaded, or load failure)."""


@dataclass
class AIPrediction:
    rooms: np.ndarray        # (H, W) uint8 room class per pixel
    icons: np.ndarray        # (H, W) uint8 icon class per pixel
    wall_prob: np.ndarray    # (H, W) float32 probability of the Wall class
    seconds: float           # inference time (forward passes only)
    infer_size: tuple[int, int]

    @property
    def wall_mask(self) -> np.ndarray:
        return np.where(self.rooms == WALL, 255, 0).astype(np.uint8)


_model = None
_load_error: str | None = None
_lock = threading.Lock()


def _torch():
    try:
        import torch  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise ModelUnavailable("PyTorch is not installed (pip install torch --index-url "
                               "https://download.pytorch.org/whl/cpu)") from exc
    return torch


def status() -> dict:
    """What is installed, without loading the model."""
    try:
        torch = _torch()
        torch_version = torch.__version__
    except ModelUnavailable:
        torch_version = None
    src_ok = all((SRC_DIR / f).exists() for f in SOURCE_FILES)
    out = {"model": MODEL_NAME, "source": MODEL_SOURCE, "license": LICENSE, "torch": torch_version,
           "weights": str(WEIGHTS), "weights_present": WEIGHTS.exists(), "source_present": src_ok,
           "weights_mb": round(WEIGHTS.stat().st_size / 1e6, 1) if WEIGHTS.exists() else None,
           "loaded": _model is not None, "error": _load_error}
    out["available"] = bool(torch_version and WEIGHTS.exists() and src_ok and not _load_error)
    if not out["available"]:
        out["reason"] = (_load_error or ("PyTorch is not installed" if not torch_version else
                                          "Model files are not downloaded (python -m app.pipeline.cubicasa --download)"))
    return out


def _http_get(url: str, dest: Path, log=print) -> None:
    import httpx  # noqa: PLC0415  (already a dependency of the test client)

    tmp = dest.with_suffix(dest.suffix + ".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total and done % (16 << 20) < (1 << 20):
                    log(f"  {done / 1e6:.0f} / {total / 1e6:.0f} MB")
    tmp.replace(dest)


def download(log=print) -> None:
    """Fetch the official model source and weights into the cache (skips files already present)."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if not all((SRC_DIR / f).exists() for f in SOURCE_FILES):
        log(f"Downloading official CubiCasa5K source from {SOURCE_URL}")
        archive = MODEL_DIR / "source.zip"
        _http_get(SOURCE_URL, archive, log)
        with zipfile.ZipFile(archive) as z:
            root = z.namelist()[0].split("/")[0]
            for f in SOURCE_FILES:
                (SRC_DIR / f).parent.mkdir(parents=True, exist_ok=True)
                (SRC_DIR / f).write_bytes(z.read(f"{root}/{f}"))
        archive.unlink()
    if not WEIGHTS.exists():
        log(f"Downloading pretrained weights to {WEIGHTS}")
        _http_get(WEIGHTS_URL, WEIGHTS, log)
    log("CubiCasa5K files are ready.")


def load():
    """Load the pretrained network once (thread-safe). Raises ModelUnavailable with a clear reason."""
    global _model, _load_error
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        torch = _torch()
        if not WEIGHTS.exists() or not all((SRC_DIR / f).exists() for f in SOURCE_FILES):
            raise ModelUnavailable("CubiCasa5K files are not downloaded. Run: python -m app.pipeline.cubicasa --download")
        try:
            if str(SRC_DIR) not in sys.path:
                sys.path.insert(0, str(SRC_DIR))
            from floortrans.models.hg_furukawa_original import hg_furukawa_original  # noqa: PLC0415

            # Exactly the official evaluation set-up: 51-class network, head replaced by the 44-class one.
            model = hg_furukawa_original(n_classes=51)
            n = N_HEATMAPS + N_ROOMS + N_ICONS
            model.conv4_ = torch.nn.Conv2d(256, n, bias=True, kernel_size=1)
            model.upsample = torch.nn.ConvTranspose2d(n, n, kernel_size=4, stride=4)
            try:
                ckpt = torch.load(WEIGHTS, map_location="cpu", weights_only=True)
            except Exception:  # noqa: BLE001 - older pickles may hold non-tensor metadata
                ckpt = torch.load(WEIGHTS, map_location="cpu", weights_only=False)
            model.load_state_dict(ckpt["model_state"])
            model.eval()
        except Exception as exc:  # noqa: BLE001
            _load_error = f"The pretrained model could not be loaded: {exc}"
            raise ModelUnavailable(_load_error) from exc
        _model = model
        _load_error = None
        return model


def predict(rgb: np.ndarray, long_side: int = INFER_LONG_SIDE) -> AIPrediction:
    """Run genuine pretrained inference on an RGB image; outputs are resized back to the input size."""
    torch = _torch()
    model = load()
    H, W = rgb.shape[:2]
    f = min(1.0, long_side / max(H, W)) if long_side else 1.0
    h, w = max(32, round(H * f)), max(32, round(W * f))
    small = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_AREA) if (h, w) != (H, W) else rgb
    # Pad with white paper to a multiple of 64 so every pooling level divides exactly; then the output maps
    # 1:1 onto the padded input and can be cropped and resized without shifting the geometry.
    ph, pw = -h % 64, -w % 64
    if ph or pw:
        small = cv2.copyMakeBorder(small, 0, ph, 0, pw, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    x = torch.from_numpy(np.ascontiguousarray(small.transpose(2, 0, 1))).float().unsqueeze(0)
    x = 2 * (x / 255.0) - 1          # official normalisation to [-1, 1]
    t0 = time.time()
    with torch.inference_mode():
        out = model(x)
        if out.shape[-2:] != x.shape[-2:]:
            out = torch.nn.functional.interpolate(out, size=x.shape[-2:], mode="bilinear", align_corners=False)
        out = out[:, :, :h, :w]
        if (h, w) != (H, W):
            out = torch.nn.functional.interpolate(out, size=(H, W), mode="bilinear", align_corners=False)
    secs = time.time() - t0
    rooms_logits = out[0, N_HEATMAPS:N_HEATMAPS + N_ROOMS]
    icons_logits = out[0, N_HEATMAPS + N_ROOMS:]
    rooms_p = torch.softmax(rooms_logits, 0)
    return AIPrediction(rooms=rooms_p.argmax(0).numpy().astype(np.uint8),
                        icons=icons_logits.argmax(0).numpy().astype(np.uint8),
                        wall_prob=rooms_p[WALL].numpy().astype(np.float32),
                        seconds=round(secs, 2), infer_size=(w, h))


def _main() -> None:  # pragma: no cover - manual utility
    import argparse  # noqa: PLC0415
    import json  # noqa: PLC0415

    ap = argparse.ArgumentParser(description="CubiCasa5K pretrained model utility")
    ap.add_argument("--download", action="store_true", help="download the official source and weights")
    ap.add_argument("--predict", metavar="IMAGE", help="run inference on an image and print a summary")
    args = ap.parse_args()
    if args.download:
        download()
    if args.predict:
        rgb = cv2.cvtColor(cv2.imread(args.predict), cv2.COLOR_BGR2RGB)
        t0 = time.time()
        load()
        load_s = time.time() - t0
        p = predict(rgb)
        print(json.dumps({"load_seconds": round(load_s, 2), "inference_seconds": p.seconds,
                          "infer_size": p.infer_size,
                          "wall_pixels": int((p.rooms == WALL).sum()),
                          "rooms": {ROOM_CLASSES[i]: int((p.rooms == i).sum()) for i in range(N_ROOMS)},
                          "doors_px": int((p.icons == DOOR).sum()), "windows_px": int((p.icons == WINDOW).sum())},
                         indent=1))
    print(json.dumps(status(), indent=1))


if __name__ == "__main__":
    _main()
