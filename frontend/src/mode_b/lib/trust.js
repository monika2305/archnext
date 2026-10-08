// VisionTrust classes and GeometryTrust colours (pure; shared by the viewer, legend and tests).

export const TRUST_CLASSES = {
  observed: { label: 'Observed', color: '#10B981', description: 'Supported by consistent multi-view reconstruction evidence.' },
  uncertain: { label: 'Uncertain', color: '#F59E0B', description: 'Seen, but with weak, sparse or inconsistent evidence.' },
  generated: { label: 'Generated', color: '#8B5CF6', description: 'Never seen: inferred from architectural constraints.' },
}

// Viewer display modes.
export const DISPLAY_MODES = [
  { key: 'complete', label: 'Complete scene' },
  { key: 'observed', label: 'Observed only' },
  { key: 'generated', label: 'Generated only' },
  { key: 'heatmap', label: 'Confidence heatmap' },
]

/** Whether a cell of the given class is drawn in a display mode. */
export function visibleIn(mode, cls) {
  if (mode === 'observed') return cls === 'observed'
  if (mode === 'generated') return cls === 'generated'
  return true
}

/** GeometryTrust heatmap: confidence 0..1 -> colour (red -> amber -> green), grey when unknown. */
export function heatColor(c) {
  if (c == null || !Number.isFinite(c)) return '#9CA3AF'
  const t = Math.max(0, Math.min(1, c))
  const stops = [[0, [166, 75, 69]], [0.5, [245, 158, 11]], [1, [16, 185, 129]]]
  const i = t <= 0.5 ? 0 : 1
  const [t0, a] = stops[i]
  const [t1, b] = stops[i + 1]
  const u = (t - t0) / (t1 - t0)
  const ch = a.map((v, k) => Math.round(v + (b[k] - v) * u))
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Area-weighted share of each class over the given surfaces' cells. */
export function classShares(surfaces) {
  const area = { observed: 0, uncertain: 0, generated: 0 }
  for (const s of surfaces || []) for (const c of s.cells || []) if (c.cls in area) area[c.cls] += c.area
  const total = area.observed + area.uncertain + area.generated
  return Object.fromEntries(Object.entries(area).map(([k, v]) => [k, total ? v / total : 0]))
}

/** Units for display: metres when calibrated, otherwise reconstruction units (scale unknown). */
export function lengthLabel(v, scale) {
  if (v == null || !Number.isFinite(v)) return '—'
  const m = scale?.meters_per_unit
  return m ? `${(v * m).toFixed(2)} m` : `${v.toFixed(2)} u`
}
