"""Image loading, validation and normalisation for uploaded floor plans."""
from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageOps

from .walls import estimate_stroke_widths

ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MIN_SIDE = 200
# Working resolution: plans are resampled so that their longest side falls in this range.
TARGET_MIN_LONG = 1100
TARGET_MAX_LONG = 2000


class PlanImageError(ValueError):
    """Raised when an uploaded file cannot be used as a floor plan."""


@dataclass
class PreparedImage:
    rgb: np.ndarray          # normalised RGB image (H, W, 3) uint8
    gray: np.ndarray         # normalised grayscale (H, W) uint8
    dark: np.ndarray         # binary mask of dark ink (H, W) uint8 {0,255}
    soft: np.ndarray         # binary mask of any visible ink, including light grey symbols
    resample: float          # factor applied to the original upload
    original_size: tuple[int, int]
    threshold: float
    warnings: list[str]


def load_image(data: bytes) -> tuple[np.ndarray, tuple[int, int]]:
    if not data:
        raise PlanImageError("The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise PlanImageError("The file is larger than 25 MB. Please upload a smaller image.")
    try:
        img = Image.open(io.BytesIO(data))
        fmt = (img.format or "").upper()
        img.load()
    except Exception as exc:  # noqa: BLE001 - Pillow raises many types
        raise PlanImageError("The file could not be read as an image. Use PNG, JPG or WebP.") from exc
    if fmt not in ALLOWED_FORMATS:
        raise PlanImageError(f"Unsupported image format ({fmt or 'unknown'}). Use PNG, JPG or WebP.")
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    img = img.convert("RGB")
    w, h = img.size
    if min(w, h) < MIN_SIDE:
        raise PlanImageError(f"The image is too small ({w}x{h}). Upload a plan at least {MIN_SIDE}px on each side.")
    return np.array(img), (w, h)


def _frame_rows(d: np.ndarray, t: float) -> list[tuple[int, int]]:
    """Row bands near the top edge of ``d`` that are frame lines, not walls.

    * screenshot / scan borders: touch the image edge and run along >= 90% of it;
    * sheet frames: thin lines (<= 0.6 x wall thickness) within 6% of the edge running along >= 85% of it.
    Exterior walls near the edge are thicker than that and do not touch it, so they are kept.
    """
    n, side = d.shape
    m = max(4, int(0.06 * n))
    frac = d[:m].mean(1)
    out, r = [], 0
    while r < m:
        if frac[r] < 0.5:
            r += 1
            continue
        r0 = r
        while r < m and frac[r] >= 0.5:
            r += 1
        r1, thick, peak = r - 1, r - r0, float(frac[r0:r].max())
        # A frame line is isolated: clean paper right next to it. A strip of a wall is not (more wall beside it).
        inside = float(frac[min(m - 1, r1 + 1):min(m, r1 + 4)].max(initial=0.0))
        outside = float(frac[max(0, r0 - 3):r0].max(initial=0.0))
        isolated = inside < 0.25 and outside < 0.25
        edge = r0 <= 1 and peak >= 0.9 and thick <= max(3, 0.025 * n) and inside < 0.25
        # Sheet frames run (almost) the whole side; outer lines of thin double-line walls near a tight crop
        # are just as thin and isolated but shorter, so they need this length test to survive.
        thin = r0 > 1 and isolated and peak >= 0.85 and thick <= max(2.0, 0.6 * t) and thick <= 6
        if edge or thin:
            out.append((max(0, r0 - 1), min(n - 1, r1 + 2)))
    return out


def remove_frame(dark: np.ndarray, t: float) -> np.ndarray:
    """Boolean mask of border / frame lines along the four image edges."""
    mask = np.zeros(dark.shape, bool)
    d = dark > 0
    views = ((d, mask), (d[::-1], mask[::-1]), (d.T, mask.T), (d.T[::-1], mask.T[::-1]))
    for view, mview in views:
        for r0, r1 in _frame_rows(view, t):
            mview[r0:r1 + 1] |= view[r0:r1 + 1]
    return mask


def prepare(data: bytes) -> PreparedImage:
    rgb, size = load_image(data)
    warnings: list[str] = []
    h, w = rgb.shape[:2]
    long_side = max(h, w)
    factor = 1.0
    if long_side < TARGET_MIN_LONG:
        factor = TARGET_MIN_LONG / long_side
    elif long_side > TARGET_MAX_LONG:
        factor = TARGET_MAX_LONG / long_side
    if factor != 1.0:
        interp = cv2.INTER_CUBIC if factor > 1 else cv2.INTER_AREA
        rgb = cv2.resize(rgb, (round(w * factor), round(h * factor)), interpolation=interp)

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    # Flatten uneven illumination (photos / scans) before thresholding. Paper brightness is
    # measured per tile as a high percentile so that grey fills in digital plans do not count.
    H, W = gray.shape
    tile = max(H, W) // 6
    levels = [float(np.percentile(gray[y:y + tile, x:x + tile], 98))
              for y in range(0, H - tile // 2, tile) for x in range(0, W - tile // 2, tile)]
    illum_spread = (np.percentile(levels, 90) - np.percentile(levels, 10)) if levels else 0.0
    work = gray
    if illum_spread > 35:
        bg = cv2.medianBlur(cv2.dilate(gray, np.ones((7, 7), np.uint8)), 31)
        work = cv2.divide(gray, bg, scale=255)
        warnings.append("Uneven lighting was detected and compensated; photographed plans are less reliable than scans or exports.")

    work = cv2.GaussianBlur(work, (3, 3), 0)
    otsu, _ = cv2.threshold(work, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Walls are drawn in the darkest ink; cap the threshold so light fills/hatching are not treated as ink.
    thr = float(min(otsu, 165))
    _, dark = cv2.threshold(work, thr, 255, cv2.THRESH_BINARY_INV)
    # Remove isolated speckle noise.
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
    small = stats[:, cv2.CC_STAT_AREA] < 4
    small[0] = False
    dark[small[labels]] = 0

    _, soft = cv2.threshold(work, max(thr, 228), 255, cv2.THRESH_BINARY_INV)
    soft = cv2.morphologyEx(soft, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) | dark

    # Screenshot borders and sheet frames are not walls; drop them before any detector sees the image.
    frame = remove_frame(dark, estimate_stroke_widths(dark)[1] or 3.0)
    if frame.any():
        frame = cv2.dilate(frame.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        dark[frame] = 0
        soft[frame] = 0
        rgb = rgb.copy()
        rgb[frame] = 255
        gray = gray.copy()
        gray[frame] = 255
        warnings.append("A border or drawing frame along the image edge was ignored.")

    ink_ratio = float(np.count_nonzero(dark)) / dark.size
    if ink_ratio > 0.45:
        warnings.append("The image is very dark or heavily filled; wall detection may be unreliable.")
    if ink_ratio < 0.004:
        raise PlanImageError("Almost no drawing lines were found. Please upload an architectural floor plan.")

    return PreparedImage(rgb=rgb, gray=gray, dark=dark, soft=soft, resample=factor, original_size=size,
                         threshold=thr, warnings=warnings)
