// Saved / unsaved state, warnings and "restore the last session" (src/lib/session.js).   Run: npm test
import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmDiscard, forgetTabPlan, lastPlan, rememberPlan, restoreOffers, saveState, tabPlan } from '../src/lib/session.js'

const memory = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}
const plan = (revision, autosave) => ({ id: 'abc123def456', filename: 'house.png', revision, autosave })
const saved = (revision) => ({ enabled: true, ok: true, revision, saved_at: '2026-10-09T10:15:00', error: null })

test('a committed edit that the server autosaved counts as saved', () => {
  const s = saveState(plan(3, saved(3)))
  assert.equal(s.status, 'saved')
  assert.equal(s.unsaved, false)
})

test('anything not yet on disk is unsaved: edit in flight, unapplied preview, drag, failed or lagging autosave', () => {
  assert.equal(saveState(plan(3, saved(3)), 'saving').status, 'saving')
  assert.equal(saveState(plan(3, saved(3)), 'preview').status, 'pending')
  assert.equal(saveState(plan(3, saved(3)), 'drag').status, 'pending')
  for (const p of ['saving', 'preview', 'drag']) assert.equal(saveState(plan(3, saved(3)), p).unsaved, true)
  const failed = saveState(plan(4, { enabled: true, ok: false, revision: 3, error: 'OSError: disk full' }))
  assert.equal(failed.status, 'error')
  assert.equal(failed.unsaved, true)
  assert.match(failed.detail, /disk full/)
  assert.equal(saveState(plan(4, saved(3))).unsaved, true)          // the server saved an older revision
  assert.equal(saveState(null).unsaved, false)
})

test('with autosave off, edits since the last downloaded file are unsaved', () => {
  const off = { enabled: false, ok: false, revision: null }
  assert.equal(saveState(plan(0, off)).unsaved, false)               // nothing edited yet
  assert.equal(saveState(plan(2, off)).unsaved, true)
  assert.equal(saveState(plan(2, off), null, 2).unsaved, false)       // "Save file" at revision 2
  assert.equal(saveState(plan(3, off), null, 2).unsaved, true)
})

test('leaving or replacing the plan asks only when something would be lost', () => {
  let asked = 0
  const yes = () => { asked++; return true }
  const no = () => { asked++; return false }
  assert.equal(confirmDiscard(saveState(plan(3, saved(3))), no), true)
  assert.equal(asked, 0)
  assert.equal(confirmDiscard(saveState(plan(3, saved(3)), 'preview'), no), false)
  assert.equal(confirmDiscard(saveState(plan(3, saved(3)), 'preview'), yes), true)
  assert.equal(asked, 2)
})

test('a refresh reopens the same plan and page; "New plan" stops that but keeps it on offer', () => {
  const local = memory(); const tab = memory()
  assert.equal(tabPlan(tab), null)
  rememberPlan(local, tab, plan(5, saved(5)), 'fix2build')
  assert.deepEqual(tabPlan(tab), { id: 'abc123def456', view: 'fix2build' })
  assert.equal(lastPlan(local).id, 'abc123def456')
  forgetTabPlan(tab)
  assert.equal(tabPlan(tab), null)
  assert.equal(lastPlan(local).id, 'abc123def456')
  tab.setItem('archnext.tabPlan', '{not json')                         // corrupted storage is ignored
  assert.equal(tabPlan(tab), null)
  assert.doesNotThrow(() => rememberPlan(null, null, plan(1), 'upload'))   // storage unavailable
})

test('reopen offers: the plan this browser used last comes first, the open plan is not offered again', () => {
  const recent = [{ id: 'a1a1a1' }, { id: 'b2b2b2' }, { id: 'c3c3c3' }]
  assert.deepEqual(restoreOffers(recent, { id: 'c3c3c3' }).map((s) => s.id), ['c3c3c3', 'a1a1a1', 'b2b2b2'])
  assert.deepEqual(restoreOffers(recent, { id: 'gone00' }).map((s) => s.id), ['a1a1a1', 'b2b2b2', 'c3c3c3'])
  assert.deepEqual(restoreOffers(recent, null, 'a1a1a1').map((s) => s.id), ['b2b2b2', 'c3c3c3'])
  assert.deepEqual(recent.map((s) => s.id), ['a1a1a1', 'b2b2b2', 'c3c3c3'])   // input not modified
})
