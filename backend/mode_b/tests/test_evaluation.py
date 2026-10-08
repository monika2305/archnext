"""Evaluation calculations (alignment, ray casting, metrics) on SYNTHETIC data with known answers."""
import numpy as np
from scipy.spatial import cKDTree

from mode_b import layout, scene as scene_mod
from mode_b.evaluation import metrics, protocol
from mode_b.tests.synthetic import BOX, room


def test_umeyama_and_sim3_inverse_round_trip():
    rng = np.random.default_rng(3)
    A = rng.normal(size=(20, 3))
    th = 1.1
    R = np.array([[np.cos(th), 0, np.sin(th)], [0, 1, 0], [-np.sin(th), 0, np.cos(th)]])
    B = 0.4 * A @ R.T + [0.5, -1, 2]
    s, R2, t = metrics.umeyama(A, B)
    T = metrics.Sim3(s, R2, t)
    assert np.allclose(T(A), B, atol=1e-9) and np.allclose(T.inverse()(B), A, atol=1e-9)


def test_ray_depth_hits_the_first_reconstructed_cell_and_respects_holes():
    sc = {"surfaces": [{"id": "wall-z+", "normal": [0, 0, -1], "grid": [2, 1],
                        "corners": [[-1, -1, 3], [1, -1, 3], [1, 1, 3], [-1, 1, 3]],
                        "cells": [{"i": 0, "j": 0}]}]}                  # only the left half exists
    dirs = np.array([[-0.2, 0, 1], [0.2, 0, 1], [0, 0, -1], [1, 0, 0]], float)
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    t = metrics.ray_depth(sc, np.zeros(3), dirs)
    assert abs(t[0] - 3 / dirs[0, 2]) < 1e-9                          # left half: hit
    assert np.isinf(t[1]) and np.isinf(t[2]) and np.isinf(t[3])       # hole, behind, parallel


def test_metrics_on_a_reconstruction_that_matches_the_reference_exactly():
    sfm, gt = room()
    lay = layout.estimate(sfm)
    sc = scene_mod.assemble(1, lay, {}, {}, True, "test")
    to_gt = metrics.Sim3(1 / gt["s"], gt["G"].T, -(gt["G"].T @ gt["t"]) / gt["s"])     # SfM gauge -> metres
    frame = protocol.SceneFrame(lay.R, lay.t)
    (x0, x1), (y0, y1), (z0, z1) = BOX["x"], BOX["y"], BOX["z"]
    # Reference shell = the wall points the cameras actually observed (unseen wall parts cannot be reconstructed).
    seen = np.isin(gt["labels"], ["wall-z-", "wall-x-", "wall-x+"])
    shell = to_gt(sfm.points[seen])
    walls = {"wall-z-": (np.array([0, 1.3, z0]), np.array([0, 0, -1.0])),
             "wall-x-": (np.array([x0, 1.3, 0]), np.array([-1.0, 0, 0])),
             "wall-x+": (np.array([x1, 1.3, 0]), np.array([1.0, 0, 0]))}
    m = metrics.evaluate(sc, to_gt, frame, shell, cKDTree(shell), walls, [], (500, 500, 320, 240))
    assert m["wall_position_error_m"] < 0.05 and m["walls_compared"] == 3
    assert m["room_dimension_error_m"] < 0.1                          # the 4 m width (x- to x+)
    assert m["completeness"] > 0.9                                    # every seen wall is covered
    assert m["psnr"] is None and m["ssim"] is None and m["lpips"] is None   # never invented
