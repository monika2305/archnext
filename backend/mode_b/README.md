# ArchNext Mode B — Room video → evidence-aware 3D

**VisionTrust — "Reconstruct what you see. Reveal what you assume."**

Mode B is a separate dashboard at **`/mode-b`** (e.g. http://localhost:5173/mode-b). It shares nothing with Mode A
(blueprint → 3D) except the backend process that serves both: its API is under `/api/mode-b/*`, its projects live
in their own folder, the reconstruction runs in its own worker process and Python environment.

## Setup (once)

```bat
cd backend
py -3.10 -m venv mode_b\.venv
mode_b\.venv\Scripts\python -m pip install -r mode_b\requirements.txt
```

Then start the backend and frontend as usual (`start_backend.bat`, `start_frontend.bat`) and open `/mode-b`.
The Overview page reports whether the worker environment is available.

* Projects: `%USERPROFILE%\.archnext\mode_b\projects` (override with `ARCHNEXT_MODEB_DATA`).
* Worker Python: `backend\mode_b\.venv` (override with `ARCHNEXT_MODEB_PYTHON`).
* Tests: `cd backend && mode_b\.venv\Scripts\python -m pytest mode_b/tests`

## Pipeline (what actually runs)

| Stage | Method |
|---|---|
| Video | Container checked from the file bytes (MP4/MOV, WebM/MKV, AVI), decoded with OpenCV/FFmpeg; 2 s – 5 min, ≤ 400 MB |
| Keyframes | Frames sampled at 6 fps (enough overlap for fast hand-held turns: 89 instead of 60 of the keyframes of a TUM fr1/room segment registered); blurry ones rejected (variance of Laplacian < 45 % of the video's median); near-duplicates and frames with too little camera motion rejected (median LK optical flow); at most 150 keyframes |
| Camera poses | COLMAP (pycolmap 4.2, CPU): SIFT, exhaustive matching (≤ 150 frames of one video) or neighbour / loop / cross-video pairs, geometric verification, incremental SfM with fixed seeds. Pose-consistency self-check: hand-held cameras barely roll, so a model whose median camera roll exceeds 12° is treated as distorted; mapping is retried (up to 5 initialisations on the same matches) and the largest consistent model is kept, otherwise no room shell is built. Diagnostics: registered frames, points, track length, reprojection error, verified pairs, roll; failures explained (textureless, too little overlap, pure rotation, split model) |
| Dense MVS | **Not run**: COLMAP PatchMatch stereo needs an NVIDIA CUDA GPU (this machine: Intel Iris Xe). The scene records this |
| Room geometry | Plane-based fallback on the sparse points: up direction from the cameras' roll axes; Manhattan wall directions from image line segments (vanishing directions of the posed keyframes; fallbacks: point histograms, point normals); floor / ceiling / walls as the outermost *extended*, correctly oriented point layers beyond the camera path — a "floor" with reconstructed points below it (a desk top) is rejected. Reliable layout = a measured corner (two perpendicular walls), two walls + floor, or three walls; otherwise only the observed points are shown |
| VisionTrust | Every surface split into cells; each cell OBSERVED (≥ 3 points seen in ≥ 3 frames, on the plane), UNCERTAIN (inside some frame's view but without that evidence) or GENERATED (never inside any frame's view) |
| Completion | Room closed as a Manhattan box: planar walls extended floor-to-ceiling to their intersections; a wall / ceiling without evidence placed at the farthest / highest observed point (a bound), with the assumption recorded |
| GeometryTrust | Documented heuristic score per cell (views, points, plane residual, pose reprojection error, visibility) — not a calibrated probability |
| NextBestView | Candidate viewpoints sampled inside the room (away from walls and reconstructed obstacles), scored by the generated / uncertain area they would see; falls back to a viewing direction when the layout is mostly inferred |
| Additional footage | Keyframes of the new video matched against the earlier ones, joint SfM, Sim3 alignment on the shared keyframes (robust Umeyama, consistency check) into the previous version's frame; a new version is created, the old one kept |
| Export | GLB with one mesh per surface and one primitive per class (evidence in `extras`), the sparse points and the camera path; metres when a wall length was calibrated |

No metric scale is claimed from video alone: lengths are in reconstruction units until a known wall length is entered.

## Research evaluation

See `mode_b/evaluation/` and the Research page (A/B/C/D ablation on TUM RGB-D, CC BY 4.0).
