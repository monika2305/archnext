# Four HackNex blueprints: Standard vs AI vs Hybrid (qualitative)

**No verified annotations exist for these images, so no accuracy percentages are reported.** Counts are what each
mode detected (TopologyGuard and ScaleLock on). Pictures: `compare_h1_simple.jpg` … `compare_h4_dimensioned.jpg`
(Original | Standard | AI | Hybrid, same image and coordinates).

| Image | Standard | AI | Hybrid |
|---|---|---|---|
| h1 simple black plan (screenshot) | 7 rooms, 7 doors, 6 windows, 100% ends connected | 7 rooms, 7 doors, 6 windows | 7 rooms, 7 doors, 6 windows |
| h2 furnished colour plan | fails in practice: furniture, rugs and cabinets become 281 wall pieces | 6 rooms, 4 doors, 6 windows | same as AI (OpenCV output ignored as noise) |
| h3 hand-drawn blue blueprint | 0 rooms (only frame fragments) | 6 rooms, 16 doors, 7 windows | 6 rooms, 16 doors, 7 windows |
| h4 dimensioned CAD, hatched walls | cannot reconstruct (no solid walls) | 10 rooms, 9 doors, 5 windows, scale read from the dimensions | same as AI |

By-eye check of h1 (unverified): 7 rooms, 7 doors, 6 windows — all three modes now match it.

**Size check against dimensions written on h4** (the only one of the four with readable dimension lines; each
written dimension is predicted from the others, so none grades itself). Hybrid detection: **1.27 %** with
ScaleLock, 17.3 % without it (10.3 % with TopologyGuard only), over 4 checked dimensions. Standard detection
cannot reconstruct h4, so this check was impossible before. This is not an overall accuracy figure.

## Geometry-conversion errors found and fixed

| Seen on | Problem | Fix |
|---|---|---|
| h1, h3, h4 | Screenshot borders / sheet frames along the image edge became walls (h1: three false strip rooms) | Preprocessing ignores isolated lines along the image edge (edge-touching borders, thin frames); walls near the edge are kept |
| h1 | Walls that merely line up across a room produced a wide "opening" that cut the room in two | A wide aligned gap that starts at an existing junction needs door/window evidence to be an opening |
| h2, h3 | Hybrid accepted OpenCV furniture, rugs and frames when the AI saw any trace of wall nearby | OpenCV pieces need clear AI wall support and wall-like thickness; OpenCV is skipped when it calls far more "wall" than the AI |
| h3, h4 | Long wall gaps became doors because a small part of them had door pixels | Door/window type requires the AI icon to cover most of the gap's length |
| h4 | Holes in the AI walls along hatched interior walls became long false openings | Drawn wall is restored up to the real door: both wall faces must continue in the drawing, no AI door there; AI "windows" on interior walls (misread hatching) are ignored |

## Remaining errors (not fixed)

* h2: the AI predicts a wall across the right bedroom; the balcony is not enclosed.
* h3: several AI door spans are too long; some interior walls of the sketch are missing.
* h4: one false door in the central corridor; the 246 cm top window is predicted as a door.
* Standard mode still cannot read hatched walls (h4), sketches (h3) or furnished colour plans (h2); use AI / Hybrid.
