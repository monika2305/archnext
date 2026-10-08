**PRELIMINARY: only 5 plans. Not a final accuracy result.** Real floor plans: CubiCasa5K `test` split, first 5 plans after offset 0, human ground truth. Same image, coordinates and rules for every mode.

| Metric (mean over plans) | Standard (OpenCV) | AI model (raw) | AI + TopologyGuard/ScaleLock | Hybrid (AI-first) | Hybrid, OpenCV-first (not used) |
|---|---|---|---|---|---|
| Rooms found (recall, IoU≥0.5) | 0.080 | 0.458 | 0.613 | 0.629 | 0.426 |
| Rooms correct (precision) | 0.092 | 0.838 | 0.823 | 0.760 | 0.803 |
| Room boundary overlap (IoU, missed = 0) | 0.072 | 0.384 | 0.553 | 0.544 | 0.356 |
| Wall pixel IoU | 0.223 | 0.647 | 0.653 | 0.641 | 0.565 |
| Wall precision (tolerant) | 0.712 | 0.925 | 0.934 | 0.906 | 0.916 |
| Wall recall (tolerant) | 0.369 | 0.920 | 0.920 | 0.913 | 0.799 |
| Doors F1 | 0.206 | 0.808 | 0.829 | 0.762 | 0.580 |
| Windows F1 | 0.124 | 0.743 | 0.757 | 0.678 | 0.368 |
| Wall ends connected | 0.450 | 0.571 | 0.707 | 0.713 | 0.706 |
| Plans that failed to reconstruct | 0 | 0 | 0 | 0 | 0 |
| Seconds per plan (after shared OCR) | 12.8 | 1.3 | 3.6 | 5.4 | 19.0 |

Scale and size errors are not measured: CubiCasa5K annotations have no metric scale.
Caveat: the AI model was trained on CubiCasa5K (other plans, same styles), which favours it here.
