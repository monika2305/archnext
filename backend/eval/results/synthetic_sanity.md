**PRELIMINARY: only 3 plans. Not a final accuracy result.** SYNTHETIC plans (eval/synth.py seeds 100-102), exact ground truth incl. scale. Synthetic results do not establish real-world accuracy. Same image, coordinates and rules for every mode.

| Metric (mean over plans) | Standard (OpenCV) | AI model (raw) | AI + TopologyGuard/ScaleLock | Hybrid (AI-first) |
|---|---|---|---|---|
| Rooms found (recall, IoU≥0.5) | 0.905 | 0.688 | 0.915 | 0.952 |
| Rooms correct (precision) | 0.944 | 1.000 | 1.000 | 1.000 |
| Room boundary overlap (IoU, missed = 0) | 0.888 | 0.596 | 0.889 | 0.934 |
| Doors F1 | 0.976 | 0.987 | 0.987 | 0.989 |
| Windows F1 | 0.965 | 0.983 | 0.983 | 0.983 |
| Wall ends connected | 0.989 | 0.909 | 0.944 | 0.974 |
| Room size error % (lower is better) | 0.340 | 15.757 | 2.708 | 0.422 |
| Scale error % (lower is better) | 0.654 | 0.132 | 0.063 | 0.612 |
| Plans that failed to reconstruct | 0 | 0 | 0 | 0 |
| Seconds per plan (after shared OCR) | 1.6 | 1.2 | 2.8 | 3.0 |

