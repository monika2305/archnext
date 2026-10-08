# ArchNext — *Every Line Becomes a Space.*

HackNex 2026 · HNX26EPS06 · Mode A — Floor Plan to 3D Reconstruction.

ArchNext turns an uploaded 2D floor plan (PNG / JPG / WebP) into a scaled, explorable 3D building:

```
upload → preprocessing → wall / room / door / window detection → vectorisation
       → TopologyGuard → ScaleLock → procedural 3D (Three.js) → 3D Studio → GLB export
```

All geometry comes from the uploaded image. There is no sample building and no hard-coded geometry.

**Mode B — Room video → 3D** is a separate dashboard at `/mode-b` (e.g. http://localhost:5173/mode-b); see
[Mode B](#mode-b--room-video--3d-separate-dashboard) below. It does not change anything in Mode A.

---

## Windows quick start

Requirements: **Python 3.10** (the `py` launcher) and **Node.js 18+**.

```bat
cd C:\Users\Dell\OneDrive\Desktop\Arch
setup_windows.bat
```

Then run the two services in two terminals:

```bat
start_backend.bat      :: http://127.0.0.1:8000  (API)
start_frontend.bat     :: http://localhost:5173   (open this in the browser)
```

Or run a single process that serves the built interface and the API together:

```bat
start_demo.bat         :: builds the UI and opens http://127.0.0.1:8000
```

Manual equivalent:

```bat
cd backend
py -3.10 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

:: second terminal
cd frontend
npm install
npm run dev
```

The first upload takes a few seconds longer while the text-recognition models load.

`start_backend.bat` restarts the backend by itself when backend code changes (plans are autosaved, so they
survive it). A backend process started before an update keeps serving the old API: the interface then shows
*"The backend is running older code than this interface"* (it compares `api_version` from `/api/health`) and
failed requests name the method and endpoint. Close that backend window and start it again.

---

## Detection: Standard, AI and Hybrid

ArchNext has three detection modes. All three feed the same geometry reconstruction, TopologyGuard, ScaleLock,
3D Studio and GLB export, in the same image coordinates. The mode can be switched per plan in **Analysis →
Detection**; switching re-runs the selected detector (image, OCR and the AI prediction are computed once).

| Mode | What detects walls, doors and windows |
|---|---|
| **Standard** | the rule-based OpenCV parser described below |
| **AI** | the pretrained **CubiCasa5K** model (`hg_furukawa_original`, official weights `model_best_val_loss_var.pkl`, https://github.com/CubiCasa/CubiCasa5k), converted to ArchNext geometry |
| **Hybrid** | AI walls first, plus OpenCV wall pieces the AI partly supports; door / window types and unnamed room types from the AI |

**Provisional default: Hybrid** when the model is installed, otherwise Standard (`ARCHNEXT_DETECTION=standard`
forces Standard). If the model is missing or inference fails, AI and Hybrid fall back to Standard and the
reason is shown. The model runs on the CPU: 17.4 M parameters, 208.7 MB weights, about 4 s to load once and
about 2.5–3 s per plan (1024 px). Code and weights are **CC BY-NC 4.0** (non-commercial) and are downloaded
into `%USERPROFILE%\.cache\archnext\cubicasa5k`, never into this repository.

Install the optional model (once, into the existing environment):

```bat
cd backend
.venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m app.pipeline.cubicasa --download
```

### Preliminary comparison (not final accuracy)

Same image, coordinates and evaluation rules for every mode; TopologyGuard and ScaleLock on.
**5 real plans** from the CubiCasa5K *test* split with human annotations
(`backend/eval/results/real_plans_preliminary.md`):

| Mean over 5 real plans | Standard | AI | Hybrid |
|---|---|---|---|
| Rooms found (recall, IoU ≥ 0.5) | 0.08 | 0.64 | **0.64** |
| Room boundary overlap (IoU) | 0.07 | **0.58** | 0.57 |
| Wall pixel IoU | 0.22 | **0.65** | 0.63 |
| Doors F1 / Windows F1 | 0.21 / 0.12 | **0.83 / 0.76** | 0.78 / 0.68 |
| Wall ends connected | 0.45 | 0.71 | **0.72** |

**3 synthetic plans** with a known scale (`synthetic_sanity.md`; synthetic, not real-world accuracy):
room-size error Standard 0.34 %, AI 2.71 %, **Hybrid 0.42 %**; rooms found 0.91 / 0.92 / **0.95**.

Why Hybrid is the provisional default: on the real plans it finds about as much as AI and far more than
Standard (many real plans draw walls as thin double lines, which the OpenCV parser cannot read), and on plans
with a known scale it keeps room sizes as accurate as Standard, which AI-only does not. AI-only is better on
doors and windows. Caveats: only 5 + 3 plans; the AI was trained on CubiCasa5K (other plans, same drafting
styles), which favours it on these real plans; CubiCasa5K annotations have no scale, so dimension accuracy on
real plans is **not measured**. A larger run (`python -m eval.compare_modes --split test --n 40 --out
real_plans`) has not been run yet.

Visual comparisons (Original | Standard | AI | Hybrid; walls coloured correct / extra / missing against the
human annotation): `backend/eval/results/compare_high_quality_architectural_2207.jpg` and `..._2536.jpg`.
For your own plan (no ground truth, accuracy not measured): `python -m eval.visual_compare --image plan.png`.

**Four HackNex blueprints** (simple plan, furnished colour plan, hand-drawn blueprint, dimensioned CAD with hatched
walls; no verified annotations, so qualitative only): `backend/eval/results/hacknex_plans.md` and
`compare_h1_simple.jpg` … `compare_h4_dimensioned.jpg`. They exposed five conversion errors that are now fixed
(screenshot borders and sheet frames read as walls, aligned walls bridged by a false opening, Hybrid importing
OpenCV furniture noise, door/window types from small icon fragments, holes in hatched AI walls becoming false
openings). On the dimensioned plan, Hybrid + ScaleLock measures its written dimensions within 1.27 % (17.3 %
without ScaleLock); Standard cannot reconstruct that plan.

For a plan without ground truth, **Validation → Advanced details → Download draft (unverified)** exports the
current detection as an answer-key draft. Correct it by hand and set `"verified": true`; unverified drafts are
refused as ground truth.

Text recognition (room names and dimension labels) uses **RapidOCR** (`rapidocr-onnxruntime`) on the CPU.

### How the parser works

1. **Preprocessing:** EXIF orientation, alpha flattening, resampling to a 1100–2000 px working size,
   illumination compensation for photographed plans, and a dark-ink threshold capped so that grey fills
   and hatching are not treated as ink. Speckle removal.
2. **Wall thickness estimation:** a distance-transform ridge histogram separates thin strokes (text,
   furniture, dimension lines, door swings) from wall-thickness strokes.
3. **Wall mask:** morphological opening at the wall thickness removes everything thinner than a wall.
   Compact blobs such as arrows and bold glyphs, and anything inside OCR text boxes, are discarded.
4. **Vectorisation:** run-length band extraction gives horizontal and vertical wall rectangles. Residual
   components become oblique walls (minimum-area rectangles). Massive blocks such as chimney breasts are kept.
5. **Openings:** rays cast from wall ends find gaps. Each gap is classified from the original ink:
   door-swing arcs (contrast-tested against clutter) mean a **door**; glazing lines across the gap mean a
   **window**; otherwise it is a plain **opening**. Wide gaps and gaps next to an existing junction need
   positive evidence.
6. **Rooms:** walls and openings are rasterised and the remaining free space is labelled. Regions
   connected to the image border are exterior. Walls next to exterior space are marked as exterior walls.
   OCR text inside a room gives its name and type.

---

## Feature 1 — TopologyGuard

TopologyGuard runs on the extracted vector walls. It keeps both the **original** (parser) geometry and
the **corrected** geometry, so the difference can be measured.

| Check | Action |
|---|---|
| Duplicate wall segments | merged (auto) |
| Stray wall fragments | removed if tiny *and* isolated (auto) |
| Broken wall lines (gap < 1.1 × wall thickness) | closed (auto); a door can never be that narrow |
| Junction gaps (wall stops ≤ 1.5 × thickness short) | extended to the junction (auto) |
| Junction overshoots | trimmed (auto) |
| Ambiguous gaps (between a break and a door) | left open, **flagged for review** |
| Suspicious / oblique intersections | flagged for review |
| Disconnected wall ends | flagged for review |
| Door / window placement | removed if overlapping another wall; windows on interior walls flagged |
| Room enclosure | open boundaries that leak a room to the outside are flagged |

Door-sized gaps are never closed automatically.

### Fix buttons (first part of Fix2Build)

After the automatic pass, the remaining issues are re-detected on the **current** geometry and listed in
**Analysis → Issues** with short titles ("Wall stops short", "Loose wall end"); the full explanation is
behind **Details**. Clicking an issue highlights it on the blueprint.

| Remaining issue | Offered action |
|---|---|
| Narrow gap in a straight wall (1.1–1.9 × wall thickness) | **Close gap** (merges the two segments) |
| Wall stopping short of a junction (up to 1.9 × thickness) | **Connect walls** (extends the wall to the junction) |
| Two walls almost meeting at a corner | **Align junction** (both ends moved to a clean corner, each by ≤ 2 × thickness) |
| Overlapping parallel segments of similar thickness | **Remove duplicate** |
| Anything else (free wall ends, oblique crossings, uncertain openings, gaps showing door/window markings) | **Edit by hand** (see below), no automatic fix |

A fix is offered only if it is local, the gap shows no door-swing or glazing marks, the new geometry does
not cover a detected door or window, and the wall end is actually connected afterwards. **Fix** shows a
preview (red dashed = current, green = after); **Apply** changes the stored wall geometry. Openings,
rooms, room dimensions, ScaleLock label matching, all checks and the 3D model / GLB are then recomputed.
**Undo** restores the previous geometry exactly (up to 20 steps). "All structural checks pass" is only
shown when the re-run checks find nothing. User fixes are never counted in the automatic accuracy scores.

### Manual wall-end editing

**Edit walls** (or **Edit by hand** on an issue) lets you drag either end of a wall. Horizontal and vertical
walls stay straight, and the end snaps to the nearest wall end or wall centre line within 2 × wall
thickness. The server validates every drop before anything changes: the edit is refused if it would cover
a door, window or other opening, make any existing opening disappear after re-detection, flip the wall or
make it too short. A valid edit shows the result (snapped position, room count) and is committed only on
**Apply**; **Undo** reverts it like any fix.

### Live TopologyGuard / ScaleLock switches

The two switches on the Validation page re-run the pipeline for the uploaded plan in any of the four
configurations. Preprocessing, OCR and wall parsing are computed once and shared, so switching takes a
moment rather than a full re-upload. The 2D overlay, issues, measurements, 3D model and GLB export all
follow the active configuration. Each configuration keeps its own fixes, undo history and calibration.

## Feature 2 — ScaleLock

* **Automatic:** OCR reads dimension text. The parser handles metric (`3.45 x 4.10 m`, `2400 mm`, unitless
  `322X347`) and imperial (`10'1" x 11'1"`, `14'6"`) values. Room labels are compared with the rectangular
  room they sit in, and both sides must give the same scale. Stand-alone values are matched to the
  dimension line next to them. Unitless values are tested as m, cm and mm.
* **Consensus:** the scale with the most agreeing measurements (within 8 %) wins, and the median of those
  is used. Inconsistent measurements are **rejected** with a reason; they are never averaged in. One value
  that nothing confirms is not trusted, except a room label whose two dimensions agree with each other
  (low confidence).
* **Hold-out check:** each accepted label is predicted from the others and the error is shown in Validation.
* **Manual fallback:** mark two points on the blueprint and enter the distance in m, cm, mm, ft or in.
* **Estimated:** if neither is available, the scale is estimated from a typical door width (0.85 m) or
  wall thickness, and shown as *Estimated — not calibrated*.

Wall height (2.7 m), door height (2.1 m) and window sill / head (0.9 / 2.1 m) are **assumptions** and are
labelled as such. Wall thickness comes from the plan.

---

## The views

* **Upload** — large drop area, blueprint preview, one action: *Generate 3D*.
* **Fix2Build** — side-by-side 2D editor and live 3D model with Synchronized View (see below).
* **Analysis** — the blueprint fills the page with compact layer toggles (walls, rooms, doors & windows,
  issues) and zoom. A slim side panel holds the summary (rooms, walls, doors, windows, issues), the scale
  status with *Set scale*, and the issue list with Fix → Preview → Apply / Cancel → Undo and manual editing.
* **3D Studio** — a full-size viewer with four visible actions: **Orbit**, **Walkthrough** (WASD, walls
  block movement), **Reset** and **Export GLB**. Top view, room labels, wall height, construction values and
  the room list live in the collapsible settings panel.
* **Validation** — *How accurate is your plan?* Two switches (**TopologyGuard**, **ScaleLock**), four plain
  metric cards measured on the uploaded plan (walls connected, rooms found, size error against the
  dimensions written on the plan, accuracy), and one before → after comparison against both features off.
  Without an answer key (ground-truth annotation) the accuracy card says *Accuracy not measured*.
  **Research results** (collapsed) holds the four-way ablation on the synthetic benchmark, clearly labelled
  as synthetic, plus the four settings measured on this plan. **Advanced details** (collapsed) holds the
  structural checks, room schedule, written-vs-measured sizes, precision/recall/F1 tables, per-plan
  benchmark tables and the answer-key format.

---

## Evaluation

`backend/eval/synth.py` generates floor plans with exact ground truth: rooms, doors, windows and scale. It
draws them in a conventional style with wall breaks, junction gaps and speckle noise injected into the
raster.

### Four-way ablation

`python -m eval.run_benchmark 20 --verify` runs the full pipeline **independently** for each
configuration on the same 20 plans (seeds 100–119) with the same parser and metric definitions. Then it
runs the whole study again and checks that the results are identical.

| Configuration | TopologyGuard | ScaleLock |
|---|---|---|
| Baseline | off | off (estimated scale) |
| TopologyGuard only | on | off (estimated scale) |
| ScaleLock only | off | on |
| Full ArchNext | on | on |

**Synthetic benchmark — 20 generated floor plans. Results do not establish real-world accuracy.**
From `backend/eval/results/benchmark.md` (re-run: identical):

| Metric | Baseline | TopologyGuard only | ScaleLock only | Full ArchNext |
|---|---|---|---|---|
| Room recall | 0.337 | 0.963 | 0.337 | 0.963 |
| Room precision | 0.663 | 0.992 | 0.663 | 0.992 |
| Room IoU (all GT rooms) | 0.288 | 0.940 | 0.288 | 0.940 |
| Room-type accuracy | 0.877 | 0.976 | 0.877 | 0.976 |
| Dimension error | 15.5 % | 4.7 % | 13.7 % | 1.1 % |
| Scale error | 3.2 % | 3.3 % | 1.4 % | 0.7 % |
| Wall connectivity | 0.901 | 0.991 | 0.901 | 0.991 |
| Door F1 | 0.992 | 0.992 | 0.992 | 0.992 |
| Window F1 | 0.989 | 0.989 | 0.989 | 0.989 |

What the ablation shows:
* **TopologyGuard** drives room recovery: recall goes from 0.34 to 0.96, IoU from 0.29 to 0.94.
* **ScaleLock** drives metric accuracy, but it **depends on TopologyGuard**. Alone it reaches 1.4 % scale
  error yet 13.7 % dimension error, because rooms are still merged. Combined it gives 1.1 % dimension error.
* Neither changes door/window detection. Both use the same opening classifier, which is part of the parser.

The first run of this ablation exposed a ScaleLock weakness. With TopologyGuard off, several room labels
landed inside one merged space and "agreed" on a wrong scale (3 plans with 40–67 % scale error; mean 9.6 %).
ScaleLock now rejects labels that share one detected space. The pre-fix table is kept in
`backend/eval/results/ablation_before_merged_label_rule.md`.

In the app, uploading an annotation for the current plan re-runs the same four configurations on that plan.
No real-world annotated test set is included, so real-world accuracy is reported as **not evaluated**.

Real plans tested during development (third-party images used only for local testing, not included in the
repository):

| Plan | Result |
|---|---|
| CubiCasa-style apartment (imperial labels) | 8 rooms; auto-calibrated from 3 labels; hold-out error 0.2–0.9 % |
| Scanned Israeli apartment (cm labels, Hebrew text) | 15 rooms; auto-calibrated from 4 agreeing cm labels (hold-out error 0.5–5.8 %); 9 inconsistent or unmatched labels rejected; open kitchen/living area joins the stairwell and is treated as exterior |
| UK terraced-house plan (no dimensions) | rooms 4 → 8 after TopologyGuard; scale estimated; manual calibration available |
| Australian marketing plan (grey interior walls) | **fails to form rooms**: only the thick exterior walls are detected |

`samples/` has two generated plans with annotation files. Upload `generated_plan_7.png`, then load
`generated_plan_7.json` with **Validation → Accuracy → Add answer key** to see the metrics live.

### Tests run

* `cd backend && python -m pytest -q`: **49 tests** (the CubiCasa5K tests skip when the model is not installed):
  * dimension parsing
  * TopologyGuard closes breaks but keeps openings
  * end-to-end reconstruction with auto scale under 3 % error
  * different plans give different geometry
  * the API: upload, manual calibration (labelled *manual*, dimensions double), unrealistic-reference
    warnings, reset, four-way annotation evaluation
  * invalid uploads
  * **fixes**: Connect changes the real wall coordinates and splits the merged room, the issue
    disappears, Undo restores identical geometry, door-width gaps are never offered a fix, and the
    fix/undo API round-trips
  * **live configurations**: all four TopologyGuard / ScaleLock combinations change the current plan's
    geometry, checks and scale; fixes are kept per configuration; the comparison endpoint
  * **manual editing**: a dragged end snaps onto the wall and splits the merged room, a dry run changes
    nothing, Undo restores it; dragging a wall across a doorway is refused and leaves geometry unchanged
  * **pretrained model**: the real weights load (17.4 M parameters) and the prediction aligns with the
    drawn walls (overlap peaks at zero shift); a missing model is reported clearly
  * **detection modes**: AI geometry lies on the AI prediction, switching modes reuses the cached prediction
    and changes the geometry, fallback to Standard is reported, TopologyGuard / ScaleLock / comparison /
    manual edit + Undo work in AI mode, the default-mode rule, unverified answer-key drafts are refused
  * **conversion fixes**: screenshot borders ignored while walls near the edge (incl. thin double-line walls
    on tight crops) are kept; aligned walls are not bridged by a false opening; door/window type needs length
    coverage; hatched-wall holes are restored up to a real door; Hybrid ignores noisy OpenCV output
  * **Fix2Build**: every editing command (add / move / delete wall, wall end, thickness, height, add / move /
    resize / retype / delete opening, rename, reset), stable ids, undo / redo, preview, save + reopen, API
  * **saving and restoring**: every change autosaved with its revision; a backend restart / evicted session
    restores the same walls, openings, room ids and names, scale and measurements; ids are not reused after a
    restore; undo / redo after a restore; manual and automatic scale restored exactly; reopened project files get
    their own autosave; a failed autosave keeps the edit and reports it; autosave off; unsafe ids rejected; the
    web-app route never serves files outside the frontend build
* `cd frontend && npm test`: **13 tests** (3D meshes tagged with object ids for picking, per-wall height and metric
  size in 3D, fixed 3D frame while editing, room bounds for camera focus, 2D room hit-testing, a room's doors and
  windows, stale selections dropped; saved / unsaved state, when to warn, refresh restore, reopen offers)
* Browser end-to-end (headless Chromium):
  * upload → Analysis → Fix preview → Apply → 3D Studio → GLB export
  * the exported GLB changes (the moved walls and the recomputed floors), and after Undo it is node-for-node
    identical to the original
  * Validation in both source modes, with annotation upload
  * no console errors
* Exported GLBs, including one exported after applying a fix, pass the Khronos glTF Validator with
  0 errors and 0 warnings.
* `npm run build` succeeds.

---

## Known limitations

* Standard mode needs walls drawn as dark, solid (filled) strokes; thin double-line walls are only partly
  reconstructed. AI and Hybrid handle them, but AI-only room sizes are less exact than Standard / Hybrid.
* Curved walls are not reconstructed. Oblique walls are supported when they are drawn solid.
* Door vs. window classification depends on door swings and glazing lines. Sliding doors usually come
  out as uncertain openings, which are flagged. Glazing-like gaps on purely interior walls are no longer
  called windows; they become uncertain openings instead.
* Open-plan areas and spaces that open to stairwells are merged or treated as exterior.
* OCR reads Latin text and digits. Other scripts (for example Hebrew room names) are not used for names,
  but their numeric dimension labels are.
* Single-floor plans only. Photographed plans with perspective distortion are not rectified.
* Sessions are kept in memory: restarting the backend clears uploaded plans and fixes.

## Fix2Build and Synchronized View

**Fix2Build** (tab *Fix2Build*) shows the 2D blueprint editor and the live 3D model side by side (resizable; each
panel can go fullscreen; stacked on narrow screens). Every edit changes the one canonical building model and both
panels, Analysis, Validation, 3D Studio and the GLB export follow it.

| Action | How |
|---|---|
| Select a room / wall / door / window | click it in 2D **or** in 3D |
| Move a wall | drag it (pieces joined by doors/windows move together; walls attached to it follow, so rooms stay closed) |
| Move a wall end | select the wall, drag a cyan handle (snaps to wall ends and wall centre lines) |
| Add a wall | *Draw wall* (W): click start, click end (snapping, straightened when nearly horizontal/vertical) |
| Add a door / window | *Add door* (D) / *Add window* (N): click on a wall (the wall is cut, the 3D wall gets the opening) |
| Move a door / window | drag it along its wall (it cannot run past the wall ends) |
| Wall thickness / height, opening width, door ↔ window, delete | inspector under the plan → **Preview → Apply / Cancel** |
| Rename a room | inspector → name → Enter |
| Undo / Redo / Reset | Ctrl+Z / Ctrl+Y (or the toolbar); *Reset* returns to the detected geometry (undoable) |
| Save / reopen | automatic (see *Saving and restoring* below); *Save file* also downloads `name.archnext.json`, which opens on any computer from the Upload page (*Open project*) |
| Export | *Export GLB* writes the current geometry (edits included, highlights excluded) |

Shortcuts: V select, W wall, D door, N window, Delete, Enter (apply preview), Esc (cancel / clear), F (refocus).

**Synchronized View.** Selecting a room in either panel highlights the *same* room (by id) in both: emerald floor,
cyan floor outline, violet outline along the wall tops, amber doors and windows of that room, a floating card
(name, area, length × width when the room is rectangular, id) and a smooth camera flight to the room from above the
walls. *Full view* returns to the whole building. Clicking empty space clears the selection. Areas are labelled
"(est.)" when the scale is estimated. The same selection is used in 3D Studio.

**Architecture.**
* One canonical model: the session's corrected geometry on the backend. Edits are commands
  (`POST /api/plans/{id}/edit`, `backend/app/pipeline/editor.py`); each can be previewed (`dry_run`) and is
  committed to the undo / redo history. The frontend renders this model only; drags are previewed locally and
  replaced by the server result on release, so 2D and 3D cannot drift apart.
* Stable ids: walls keep their ids (deleted ids are never reused); openings and rooms keep theirs across rebuilds
  (matched by host walls / room overlap ≥ 50 %). A room changed beyond that gets a new id and the selection is
  dropped rather than pointed at the wrong room; selections are also cleared when the plan or detection
  configuration changes.
* Doors and windows are gaps between wall pieces, so the 3D wall is genuinely cut. Openings the user created or
  corrected persist and move with their walls; a manual edit never turns the old ink of a moved wall into a new
  door or window.
* No AI inference during editing. Manual edits keep the current scale (moving one wall does not re-scale the
  building). TopologyGuard reports issues on the edited geometry but never rewrites user edits.

**Known limitations.** Editing is done in 2D; the 3D panel selects and highlights (no 3D drag handles). On real
plans an edit takes about 1 s on the server; during a drag the panels show a local approximation (rooms and areas
update on release). Moving whole walls with their neighbours works for horizontal / vertical walls; oblique walls
move alone. Only openings between two collinear wall pieces can be moved or resized (corner openings can be
retyped or removed). A custom room name stays with the room id, so it is lost if an edit changes the room so much
that it gets a new id.

**Saving and restoring.** Every change to a plan (Fix2Build edit, undo / redo, TopologyGuard fix, calibration,
mode switch) is autosaved by the backend as soon as it is applied: a project file per plan in
`backend/data/sessions/` (git-ignored; `ARCHNEXT_DATA_DIR` moves it, `ARCHNEXT_AUTOSAVE=0` turns it off; the 50
most recent plans are kept). Writes are atomic, so a crash never leaves a half-written project.
* **Browser refresh**: the tab reopens the same plan on the same page, undo history included.
* **Backend restart** (or a plan dropped from memory): the plan is rebuilt from its autosave the first time it is
  asked for (a few seconds; detection runs once, then the saved geometry replaces it) with the same wall, opening
  and room ids, room names, wall heights, door / window types, scale and ScaleLock measurements.
* **New visit / New plan**: the Upload page lists the recent autosaved plans (*Continue where you left off*);
  *Reopen* brings one back.
* **Indicator**: header and Fix2Build toolbar show *All changes saved*, *Saving…*, *Unsaved preview* (a previewed
  change not applied yet) or *Not saved* (autosave failed; the edit itself is kept, use *Save file*).
* **Warnings**: leaving the page, *New plan*, choosing another file or leaving Fix2Build asks first when something
  would be lost (an unapplied preview, an edit in flight, a failed autosave, or, with autosave off, edits since
  the last *Save file*). Nothing is asked when everything is saved, since the plan stays reopenable.
* Limitations: the undo history is kept in memory only, so after a backend restart Undo starts empty (new edits
  undo normally). Only the current TopologyGuard / ScaleLock / detection configuration of a plan is restored.
  Autosaves contain the uploaded plan image and stay on the computer running the backend.

**Review 2 demo.** Upload a plan → *Generate 3D* → *Fix2Build* → click a bedroom in 2D (it glows in 3D, the camera
flies to it, the card shows name and area) → drag one of its walls (3D wall moves, area recalculates) → Ctrl+Z
(geometry and area return) → click a room in 3D (the 2D room lights up) → *Add door* on a wall → *Export GLB*.

## Mode B — Room video → 3D (separate dashboard)

**VisionTrust — "Reconstruct what you see. Reveal what you assume."** Mode B reconstructs a room from a short
walkthrough video and marks every part of the result as OBSERVED (multi-view evidence), UNCERTAIN (seen, weak
evidence) or GENERATED (never seen, completed from architectural constraints). It is independent of Mode A:
`/mode-b` route, `/api/mode-b/*` API, own projects folder (`%USERPROFILE%\.archnext\mode_b`), own worker process and
Python environment (`backend/mode_b/.venv`). Setup and the exact pipeline: [`backend/mode_b/README.md`](backend/mode_b/README.md).

| Step | What runs (CPU only: this machine has no CUDA GPU) |
|---|---|
| Video | byte-level container check, OpenCV decode, keyframes (blur, near-duplicates, camera motion) |
| Camera poses | COLMAP incremental SfM (pycolmap 4.2.1): SIFT, verified matching, mapping; a pose-consistency self-check (camera roll) retries the mapping and refuses distorted models |
| Geometry | dense MVS **not** run (needs CUDA); Manhattan room layout fitted to the sparse points: up from camera axes, wall directions from image line segments (vanishing directions), floor / walls / ceiling as extended, oriented point layers |
| VisionTrust | surface cells classified observed / uncertain / generated; constrained completion (planar walls to their intersections, observed bounds) with recorded assumptions |
| GeometryTrust | documented per-cell evidence score (not a calibrated probability), heatmap |
| NextBestView | candidate viewpoints inside the room scored by the unconfirmed area they would see; additional footage aligned (Sim3 on shared keyframes) into a new version |
| Export | GLB (surfaces per class with evidence metadata, points, camera path); metres after a wall-length calibration |

Research evaluation (A baseline / B VisionTrust / C + NextBestView clips / D + random clips, equal budget) on the
TUM RGB-D benchmark (CC BY 4.0, real recordings with sensor depth and motion-capture poses): run
`cd backend && mode_b\.venv\Scripts\python -m mode_b.evaluation.run_ablation`; results are stored in
`backend/mode_b/results/` and shown on the Mode B Research page.

## Project layout

```
backend/
  app/main.py              FastAPI endpoints (upload, image, calibration, fixes, wall edits,
                           configuration switch, comparison, evaluation, benchmark)
  app/pipeline/            preprocess, walls, structure (openings), rooms, topology (TopologyGuard),
                           scalelock, measure (dimension parsing), ocr, run (orchestration)
  app/pipeline/fixes.py    remaining-issue detection, safe fix proposals, apply
  app/pipeline/editor.py   Fix2Build editing commands, project save / reopen
  app/store.py             autosave: one project file per plan, restore after refresh / restart
  app/pipeline/cubicasa.py pretrained CubiCasa5K model: download, load, CPU inference
  app/pipeline/ai_detect.py AI / Hybrid predictions -> ArchNext wall detection, openings, room types
  app/evaluation.py        ground-truth metrics and the four ablation configurations
  eval/synth.py            generated plans with exact ground truth
  eval/run_benchmark.py    four-way ablation -> eval/results/
  eval/compare_modes.py    Standard vs AI vs Hybrid on real annotated plans (or synthetic) -> eval/results/
  eval/cubicasa_testset.py CubiCasa5K samples + SVG annotations via HTTP range requests (cached)
  eval/visual_compare.py   Original | Standard | AI | Hybrid picture
  tests/                   pytest suite
frontend/
  src/views/               Upload, Analysis, 3D Studio, Fix2Build, Validation
  src/components/          blueprint overlay, PlanEditor (Fix2Build 2D), ModelViewer (3D + Synchronized View),
                           issue list, charts, walkthrough
  src/views/Fix2BuildView  side-by-side workspace, inspector, undo / redo, save, export
  src/lib/buildModel.js    procedural Three.js building + GLB export source
  src/lib/session.js       saved / unsaved state, leave / replace warnings, last-session restore
samples/                   generated plans + annotation files
```
