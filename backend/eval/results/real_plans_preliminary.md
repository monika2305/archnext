**PRELIMINARY: only 5 plans. Not a final accuracy result.** Real floor plans: CubiCasa5K `test` split, first 5 plans after offset 0, human ground truth. Same image, coordinates and rules for every mode.

| Metric (mean over plans) | Standard (OpenCV) | AI model (raw) | AI + TopologyGuard/ScaleLock | Hybrid (AI-first) |
|---|---|---|---|---|
| Rooms found (recall, IoU≥0.5) | 0.080 | 0.587 | 0.639 | 0.642 |
| Rooms correct (precision) | 0.092 | 0.812 | 0.830 | 0.751 |
| Room boundary overlap (IoU, missed = 0) | 0.072 | 0.505 | 0.576 | 0.565 |
| Wall pixel IoU | 0.223 | 0.640 | 0.646 | 0.632 |
| Wall precision (tolerant) | 0.714 | 0.917 | 0.926 | 0.902 |
| Wall recall (tolerant) | 0.369 | 0.920 | 0.920 | 0.913 |
| Doors F1 | 0.206 | 0.808 | 0.829 | 0.780 |
| Windows F1 | 0.124 | 0.761 | 0.761 | 0.680 |
| Wall ends connected | 0.447 | 0.609 | 0.710 | 0.719 |
| Plans that failed to reconstruct | 0 | 0 | 0 | 0 |
| Seconds per plan (after shared OCR) | 8.4 | 0.9 | 2.4 | 2.8 |

Scale and size errors are not measured: CubiCasa5K annotations have no metric scale.
Caveat: the AI model was trained on CubiCasa5K (other plans, same styles), which favours it here.
