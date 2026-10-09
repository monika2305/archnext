// Mode B dashboard logic: routing, processing status, VisionTrust classes and heatmap.   Run: npm test
import assert from 'node:assert/strict'
import test from 'node:test'
import { isModeB, locationFor, readLocation } from '../src/mode_b/lib/route.js'
import { isActive, summarize, timelineCounts } from '../src/mode_b/lib/status.js'
import { classShares, heatColor, lengthLabel, TRUST_CLASSES, visibleIn } from '../src/mode_b/lib/trust.js'
import { cellCorners, evidenceOf, sceneBounds, surfaceArrays } from '../src/mode_b/lib/sceneGeometry.js'
import { format, metricRows, nbvEffect, valueOf } from '../src/mode_b/lib/research.js'

test('Mode B has its own route; every other path stays Mode A', () => {
  assert.equal(isModeB('/mode-b'), true)
  assert.equal(isModeB('/mode-b/'), true)
  assert.equal(isModeB('/'), false)
  assert.equal(isModeB('/mode-bx'), false)
  assert.equal(isModeB('/analysis'), false)
})

test('the open project and page round-trip through the URL; bad values are ignored', () => {
  const url = locationFor({ project: 'abcdef012345', view: 'scene' })
  assert.equal(url, '/mode-b?project=abcdef012345&view=scene')
  assert.deepEqual(readLocation({ search: url.split('?')[1] && `?${url.split('?')[1]}` }), { project: 'abcdef012345', view: 'scene' })
  assert.deepEqual(readLocation({ search: '?project=../../x&view=evil' }), { project: null, view: 'overview' })
  assert.deepEqual(readLocation({ search: '?project=abcdef012345' }), { project: 'abcdef012345', view: 'reconstruction' })
})

test('processing status: progress, running and failed stages come from the worker, nothing is assumed', () => {
  const running = { state: 'running', progress: 0.42, stages: [
    { key: 'video', state: 'done' }, { key: 'keyframes', state: 'running', label: 'Select keyframes', detail: 'Selected 12 keyframes' },
    { key: 'sfm', state: 'pending' }] }
  const s = summarize(running)
  assert.equal(s.pct, 42)
  assert.equal(s.running.key, 'keyframes')
  assert.equal(s.message, 'Selected 12 keyframes')
  assert.equal(isActive(running), true)
  const failed = { state: 'failed', error: 'Too little parallax', progress: 0.5, stages: [{ key: 'sfm', state: 'failed', detail: 'x' }] }
  assert.equal(summarize(failed).failed.key, 'sfm')
  assert.equal(summarize(failed).message, 'Too little parallax')
  assert.equal(summarize(failed).pct, 50)                                // never shown as complete
  assert.equal(summarize({ state: 'done', progress: 0.9, stages: [] }).pct, 100)
  assert.deepEqual(timelineCounts([{ status: 'keyframe' }, { status: 'blurry' }, { status: 'keyframe' }]),
    { keyframe: 2, blurry: 1, duplicate: 0, little_motion: 0, thinned: 0 })
})

test('VisionTrust colours and display modes', () => {
  assert.equal(TRUST_CLASSES.observed.color, '#10B981')                 // emerald
  assert.equal(TRUST_CLASSES.uncertain.color, '#F59E0B')                // amber
  assert.equal(TRUST_CLASSES.generated.color, '#8B5CF6')                // violet
  assert.equal(visibleIn('observed', 'generated'), false)
  assert.equal(visibleIn('generated', 'generated'), true)
  assert.equal(visibleIn('complete', 'uncertain'), true)
  assert.equal(heatColor(1), '#10b981')
  assert.equal(heatColor(0), '#a64b45')
  assert.equal(heatColor(null), '#9CA3AF')                               // unknown confidence is grey, not green
})

test('class shares are area-weighted; lengths say when the scale is unknown', () => {
  const surfaces = [{ cells: [{ cls: 'observed', area: 3 }, { cls: 'generated', area: 1 }] }, { cells: [{ cls: 'uncertain', area: 4 }] }]
  assert.deepEqual(classShares(surfaces), { observed: 0.375, uncertain: 0.5, generated: 0.125 })
  assert.equal(lengthLabel(2, { meters_per_unit: 1.5 }), '3.00 m')
  assert.equal(lengthLabel(2, { meters_per_unit: null }), '2.00 u')
})


// A 4 x 2 wall at z = 0 (inward normal +z), 2 x 2 cells of three classes.
const wall = {
  id: 'wall-z-', kind: 'wall', normal: [0, 0, 1], grid: [2, 2],
  corners: [[0, 0, 0], [4, 0, 0], [4, 2, 0], [0, 2, 0]],
  cells: [{ i: 0, j: 0, cls: 'observed', confidence: 0.9, area: 2, points: 9, views: 5, visible: 7, rmse: 0.01 },
    { i: 1, j: 0, cls: 'uncertain', confidence: 0.3, area: 2, points: 1, views: 1, visible: 3, rmse: 0.05 },
    { i: 0, j: 1, cls: 'generated', confidence: 0.15, area: 2, points: 0, views: 0, visible: 0, rmse: null }],
}

test('3D scene: cells, picking map, front faces into the room, display filters', () => {
  assert.deepEqual(cellCorners(wall, wall.cells[1]), [[2, 0, 0], [4, 0, 0], [4, 1, 0], [2, 1, 0]])
  const all = surfaceArrays(wall, 'complete')
  assert.equal(all.positions.length, 3 * 3 * 2 * 3)                 // 3 cells x 2 triangles x 3 vertices
  assert.deepEqual(all.triCell, [0, 0, 1, 1, 2, 2])                   // triangle -> cell, for click picking
  const p = all.positions
  const e1 = [p[3] - p[0], p[4] - p[1], p[5] - p[2]]
  const e2 = [p[6] - p[0], p[7] - p[1], p[8] - p[2]]
  assert.ok(e1[0] * e2[1] - e1[1] * e2[0] > 0)                        // winding faces +z (into the room)
  assert.deepEqual(surfaceArrays(wall, 'observed').triCell, [0, 0])
  assert.deepEqual(surfaceArrays(wall, 'generated').triCell, [2, 2])
  const b = sceneBounds({ surfaces: [wall], cameras: [{ center: [2, 1, 3] }] })
  assert.deepEqual(b.center, [2, 1, 1.5])
  assert.equal(evidenceOf(wall, wall.cells[2]).reconstructed, false)  // generated: never "reconstructed"
  assert.equal(evidenceOf(wall, wall.cells[0]).rows[1][1], 5)
})

test('research table shows stored values only; missing values are N/A with the reason', () => {
  const seq = { configs: {
    A: { metrics: { completeness: 0.2, chamfer_m: 0.3 } }, B: { metrics: { completeness: 0.5, chamfer_m: 0.25 } },
    C: { success: true, metrics: { completeness: 0.6, chamfer_m: 0.2 } },
    D: { metrics_mean: { completeness: 0.55 }, metrics_std: { completeness: 0.02 }, seeds: [0, 1, 2] } } }
  const defs = { completeness: { label: 'Surface completeness', units: 'fraction', limitations: 'x' },
    chamfer_m: { label: 'Chamfer', units: 'm', limitations: 'y' }, psnr: { label: 'PSNR', units: 'dB', limitations: 'no texture' } }
  const rows = metricRows(seq, defs)
  const comp = rows.find((r) => r.key === 'completeness')
  assert.equal(comp.best, 'C')
  assert.deepEqual(comp.cells.D, { v: 0.55, sd: 0.02, n: 3 })
  assert.equal(rows.find((r) => r.key === 'chamfer_m').cells.D, null)    // not computed for D -> N/A, not 0
  assert.equal(rows.find((r) => r.key === 'psnr').na, 'no texture')
  assert.equal(format(0.1234, 'fraction'), '12.3%')
  assert.equal(format(null, 'm'), 'N/A')
  assert.ok(Math.abs(nbvEffect(seq, 'completeness').diff - 0.05) < 1e-12)
  assert.equal(valueOf({ configs: { C: { success: false, metrics: { completeness: 1 } } } }, 'C', 'completeness'), null)
})

test('completion stats: area-weighted, gaps are connected generated regions, generated never counted as evidence', async () => {
  const { completionStats, gapRegions, cellTriangles } = await import('../src/mode_b/lib/shell.js')
  const s = { id: 'wall-z-', normal: [0, 0, 1], grid: [3, 1], corners: [[0, 0, 0], [3, 0, 0], [3, 1, 0], [0, 1, 0]],
    cells: [{ i: 0, j: 0, cls: 'observed', area: 1 }, { i: 1, j: 0, cls: 'generated', area: 1 }, { i: 2, j: 0, cls: 'generated', area: 1 }] }
  const st = completionStats([s])
  assert.equal(gapRegions(s).length, 1)                     // two adjacent generated cells = one gap
  assert.ok(Math.abs(st.before - 1 / 3) < 1e-9 && Math.abs(st.generatedShare - 2 / 3) < 1e-9 && st.available)
  assert.equal(cellTriangles(s, ['generated']).length, 2 * 2 * 3 * 3)
  assert.equal(completionStats([{ ...s, cells: [s.cells[0]] }]).available, false)
})
