"""Pretrained CubiCasa5K model: genuine weights load and inference (skipped when the model is not installed)."""
import cv2
import numpy as np
import pytest

from app.pipeline import cubicasa

needs_model = pytest.mark.skipif(not cubicasa.status()["available"], reason="CubiCasa5K model not installed")


@needs_model
def test_weights_load_and_inference_aligns_with_walls():
    model = cubicasa.load()
    assert sum(p.numel() for p in model.parameters()) > 10_000_000   # the real hourglass network
    rgb = cv2.cvtColor(cv2.imread("../samples/generated_plan_7.png"), cv2.COLOR_BGR2RGB)
    p = cubicasa.predict(rgb)
    assert p.rooms.shape == rgb.shape[:2] and p.icons.shape == rgb.shape[:2]
    wall = p.rooms == cubicasa.WALL
    assert wall.mean() > 0.01
    # Predicted walls sit on the drawn walls: overlap with dark ink is highest with no shift at all.
    dark = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < 128

    def overlap(dx, dy):
        return (np.roll(wall, (dy, dx), axis=(0, 1)) & dark).sum()

    best = max(((dx, dy) for dx in range(-6, 7, 2) for dy in range(-6, 7, 2)), key=lambda s: overlap(*s))
    assert best == (0, 0)
    assert overlap(0, 0) / wall.sum() > 0.5
    assert (p.icons == cubicasa.DOOR).any() and (p.icons == cubicasa.WINDOW).any()


def test_missing_model_is_reported_clearly(monkeypatch, tmp_path):
    monkeypatch.setattr(cubicasa, "WEIGHTS", tmp_path / "missing.pkl")
    st = cubicasa.status()
    assert not st["available"] and st["reason"]
