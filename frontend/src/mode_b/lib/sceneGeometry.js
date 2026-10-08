// Mode B scene geometry for the viewer (pure; tested in tests/mode_b.test.mjs).
// Coordinates are the scene's own (y up, reconstruction units) — the same as the GLB exporter uses.
import { heatColor, TRUST_CLASSES, visibleIn } from './trust.js'

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)

/** The four corners of one cell of a surface (same parametrisation as backend export.cell_quads). */
export function cellCorners(surface, cell) {
  const [c0, c1, , c3] = surface.corners
  const u = c1.map((v, k) => v - c0[k])
  const w = c3.map((v, k) => v - c0[k])
  const [nu, nv] = surface.grid
  const at = (a, b) => c0.map((v, k) => v + (a / nu) * u[k] + (b / nv) * w[k])
  const { i, j } = cell
  return [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
}

export function cellCenter(surface, cell) {
  const q = cellCorners(surface, cell)
  return [0, 1, 2].map((k) => (q[0][k] + q[2][k]) / 2)
}

/**
 * Triangles of a surface for display mode ``mode``: positions, per-vertex colours and, for each triangle,
 * the index of the cell it belongs to (for picking). Front faces point into the room.
 */
export function surfaceArrays(surface, mode) {
  const pos = []
  const col = []
  const triCell = []
  const n = surface.normal
  surface.cells.forEach((cell, ci) => {
    if (!visibleIn(mode, cell.cls)) return
    const [a, b, d, e] = cellCorners(surface, cell)
    const rgb = hex(mode === 'heatmap' ? heatColor(cell.cls === 'generated' ? null : cell.confidence) : TRUST_CLASSES[cell.cls].color)
    const cross = [
      (b[1] - a[1]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[1] - a[1]),
      (b[2] - a[2]) * (e[0] - a[0]) - (b[0] - a[0]) * (e[2] - a[2]),
      (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]),
    ]
    const inward = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] >= 0
    const tris = inward ? [[a, b, d], [a, d, e]] : [[a, d, b], [a, e, d]]
    for (const t of tris) {
      for (const v of t) { pos.push(...v); col.push(...rgb) }
      triCell.push(ci)
    }
  })
  return { positions: new Float32Array(pos), colors: new Float32Array(col), triCell }
}

/** Axis-aligned bounds of everything drawn (surfaces, cameras), for framing the view. */
export function sceneBounds(scene) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const add = (p) => p.forEach((v, k) => { lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v) })
  for (const s of scene.surfaces || []) s.corners.forEach(add)
  for (const c of scene.cameras || []) add(c.center)
  const xyz = scene.points?.xyz || []
  if (!(scene.surfaces || []).length) for (let i = 0; i < xyz.length; i += 3 * 50) add([xyz[i], xyz[i + 1], xyz[i + 2]])
  if (!Number.isFinite(lo[0])) return { center: [0, 0, 0], size: 1 }
  return { center: lo.map((v, k) => (v + hi[k]) / 2), size: Math.max(...hi.map((v, k) => v - lo[k])), lo, hi }
}

/** Selected cell -> human-readable evidence summary (Evidence Details panel). */
export function evidenceOf(surface, cell) {
  const kind = { observed: 'Reconstructed from video evidence', uncertain: 'Seen, but evidence is weak',
    generated: 'Inferred (never seen by the camera)' }[cell.cls]
  return {
    kind,
    reconstructed: cell.cls !== 'generated' && cell.points > 0,
    rows: [
      ['Classification', TRUST_CLASSES[cell.cls].label],
      ['Supporting frames (with 3D points here)', cell.views],
      ['Frames whose view contains this region', cell.visible],
      ['Reconstructed points in this region', cell.points],
      ['Distance of points to the plane', cell.rmse == null ? '—' : cell.rmse.toFixed(4)],
      ['GeometryTrust score', cell.confidence.toFixed(2)],
    ],
  }
}
