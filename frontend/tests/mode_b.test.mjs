// Mode B dashboard logic: routing, processing status, VisionTrust classes and heatmap.   Run: npm test
import assert from 'node:assert/strict'
import test from 'node:test'
import { isModeB, locationFor, readLocation } from '../src/mode_b/lib/route.js'
import { isActive, summarize, timelineCounts } from '../src/mode_b/lib/status.js'
import { classShares, heatColor, lengthLabel, TRUST_CLASSES, visibleIn } from '../src/mode_b/lib/trust.js'

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
