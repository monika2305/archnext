// Job status helpers for the Mode B dashboard (pure functions, tested in tests/mode_b_status.test.mjs).

export const ACTIVE = new Set(['queued', 'running'])

export const isActive = (status) => ACTIVE.has(status?.state)

/** Overall progress (0..100), the stage running now and the stage that failed, from the worker's status.json. */
export function summarize(status) {
  const stages = status?.stages || []
  const failed = stages.find((s) => s.state === 'failed') || null
  const running = stages.find((s) => s.state === 'running') || null
  const done = stages.filter((s) => s.state === 'done').length
  const pct = status?.state === 'done' ? 100 : Math.round(Math.max(0, Math.min(1, status?.progress || 0)) * 100)
  return {
    state: status?.state || 'idle', pct, running, failed, done, total: stages.length,
    skipped: stages.filter((s) => s.state === 'skipped'),
    message: failed ? (status?.error || failed.detail) : (running?.detail || running?.label || status?.message || ''),
  }
}

// Keyframe timeline: what happened to every sampled frame.
export const FRAME_STATUS = {
  keyframe: { label: 'Keyframe', color: '#3F6A8F' },
  blurry: { label: 'Blurry', color: '#A64B45' },
  duplicate: { label: 'Near-duplicate', color: '#C9C3B8' },
  little_motion: { label: 'Too little motion', color: '#E4E0D8' },
  thinned: { label: 'Thinned (limit)', color: '#B9C9D8' },
}

export function timelineCounts(timeline) {
  const c = Object.fromEntries(Object.keys(FRAME_STATUS).map((k) => [k, 0]))
  for (const f of timeline || []) if (f.status in c) c[f.status] += 1
  return c
}

export function formatSeconds(s) {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
}
