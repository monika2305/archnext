// Research dashboard helpers (pure; tested in tests/mode_b.test.mjs). Only values present in ablation.json are
// shown; anything missing is "N/A" with the reason recorded for that metric.

export const CONFIGS = ['A', 'B', 'C', 'D']

export const INNOVATIONS = {
  A: { completion: false, nbv: false, extra: false, selection: 'Original input only' },
  B: { completion: true, nbv: false, extra: false, selection: 'Original input only' },
  C: { completion: true, nbv: true, extra: true, selection: 'NextBestView' },
  D: { completion: true, nbv: false, extra: true, selection: 'Random (same budget)' },
}

// Which direction is better for each metric (for the "best" marker); null = descriptive only.
export const BETTER = {
  chamfer_m: 'lower', accuracy_m: 'lower', completeness: 'higher', completeness_observed: 'higher',
  wall_position_error_m: 'lower', room_dimension_error_m: 'lower', unseen_error_m: 'lower',
  heldout_depth_error_m: 'lower', heldout_view_completeness: 'higher', observed_share: 'higher',
  generated_share: null, confidence_error_spearman: 'lower',
}

export const METRIC_ORDER = ['completeness', 'completeness_observed', 'chamfer_m', 'accuracy_m', 'heldout_view_completeness',
  'heldout_depth_error_m', 'wall_position_error_m', 'room_dimension_error_m', 'unseen_error_m', 'observed_share',
  'generated_share', 'confidence_error_spearman', 'psnr', 'ssim', 'lpips']

/** Value (and spread for D) of one metric in one configuration, or null. */
export function valueOf(seq, cfg, key) {
  const c = seq?.configs?.[cfg]
  if (!c) return null
  if (cfg === 'D' && c.metrics_mean) {
    const v = c.metrics_mean[key]
    return v == null ? null : { v, sd: c.metrics_std?.[key] ?? null, n: c.seeds?.length || 0 }
  }
  if (c.success === false || !c.metrics) return null
  const v = c.metrics[key]
  return v == null ? null : { v }
}

export function format(v, units) {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  if (units === 'm') return `${v.toFixed(3)} m`
  if (units && units.startsWith('fraction')) return `${(100 * v).toFixed(1)}%`
  return v.toFixed(3)
}

/** Table rows: label, units, per-config cells, the best config (if comparable), N/A reason. */
export function metricRows(seq, defs) {
  return METRIC_ORDER.filter((k) => defs?.[k]).map((k) => {
    const d = defs[k]
    const cells = Object.fromEntries(CONFIGS.map((c) => [c, valueOf(seq, c, k)]))
    const present = CONFIGS.filter((c) => cells[c] != null)
    let best = null
    if (BETTER[k] && present.length >= 2) {
      const vals = present.map((c) => cells[c].v)
      const target = BETTER[k] === 'lower' ? Math.min(...vals) : Math.max(...vals)
      const winners = present.filter((c) => cells[c].v === target)
      best = winners.length === 1 ? winners[0] : null
    }
    return { key: k, label: d.label, units: d.units, cells, best, na: present.length === 0 ? d.limitations : null, definition: d.definition }
  })
}

/** C minus D (mean) for a metric: the effect attributable to NextBestView selection at equal budget. */
export function nbvEffect(seq, key) {
  const c = valueOf(seq, 'C', key)
  const d = valueOf(seq, 'D', key)
  if (!c || !d) return null
  return { diff: c.v - d.v, sd: d.sd, n: d.n }
}

export const shortName = (s) => s.replace('rgbd_dataset_', '').replace(/_/g, ' ')
