export const fmtM = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(d)} m`)
export const fmtM2 = (v) => (v == null ? '—' : `${v.toFixed(1)} m²`)
export const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)

export const SCALE_STATUS = {
  auto: { label: 'Scale from plan labels', short: 'Auto', tone: 'ok' },
  manual: { label: 'Scale set by you', short: 'Manual', tone: 'accent' },
  estimated: { label: 'Scale estimated', short: 'Estimated', tone: 'warn' },
}

export const TONE = {
  ok: 'bg-ok/10 text-ok',
  accent: 'bg-accent-soft text-accent-dark',
  warn: 'bg-warn/10 text-warn',
  bad: 'bg-bad/10 text-bad',
  mute: 'bg-paper text-ink-mute border border-line',
}

export const ROOM_COLORS = {
  bedroom: '#C9B79A', living: '#D2BE9C', dining: '#CDB894', kitchen: '#D9D2C4', bathroom: '#C9D4DA',
  circulation: '#DAD3C6', garage: '#C9C6BF', outdoor: '#C4CABB', study: '#CFC0A6', utility: '#D3CEC4', unknown: '#DCD5C8',
}

export const ROOM_TYPE_LABEL = {
  bedroom: 'Bedroom', living: 'Living', dining: 'Dining', kitchen: 'Kitchen', bathroom: 'Bathroom',
  circulation: 'Circulation', garage: 'Garage', outdoor: 'Outdoor', study: 'Study', utility: 'Utility', unknown: 'Unclassified',
}

/** Short, plain-English title for a structural issue (the full message stays available as details). */
export function issueTitle(i) {
  const m = i.message || ''
  switch (i.check) {
    case 'ambiguous_gaps': return m.startsWith('A narrow gap shows') ? 'Narrow gap with door marks' : 'Wall gap detected'
    case 'junction_gaps': return m.includes('markings') ? 'Gap with door marks' : 'Wall stops short'
    case 'dangling': return m.startsWith('Two walls almost meet') ? 'Corner misaligned' : 'Loose wall end'
    case 'rooms': return m.startsWith('No enclosed') ? 'No rooms found' : 'Room open to outside'
    case 'duplicates': return 'Wall drawn twice'
    case 'intersections': return 'Walls cross at an angle'
    case 'openings': return m.startsWith('Window-like') ? 'Window on inner wall?' : m.includes('duplicate') ? 'Duplicate opening' : m.includes('overlapping') ? 'Misplaced opening' : 'Door or window unclear'
    case 'micro_gaps': return 'Broken wall line'
    case 'fragments': return 'Stray fragment'
    case 'overshoots': return 'Wall overshoot'
    case 'manual': return 'Wall end moved'
    default: return 'Check this spot'
  }
}

export const CONFIG_LABEL = {
  baseline: 'Both off',
  topologyguard_only: 'TopologyGuard only',
  scalelock_only: 'ScaleLock only',
  full: 'Both on',
}

export const configKey = (c) => (c.topology_guard ? (c.scale_lock ? 'full' : 'topologyguard_only') : (c.scale_lock ? 'scalelock_only' : 'baseline'))
