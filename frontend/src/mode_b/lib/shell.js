// Room-shell helpers for the 3D Room view (pure; tested in tests/mode_b.test.mjs).
// The shell cells and their classes (observed / uncertain / generated) come from the backend (VisionTrust); nothing
// here re-classifies geometry.
import { cellCorners } from './sceneGeometry.js'

/** Triangles of the cells of ``surface`` whose class is in ``classes``; front faces point into the room. */
export function cellTriangles(surface, classes) {
  const pos = []
  const n = surface.normal
  for (const cell of surface.cells) {
    if (!classes.includes(cell.cls)) continue
    const [a, b, d, e] = cellCorners(surface, cell)
    const cr = [(b[1] - a[1]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[1] - a[1]),
      (b[2] - a[2]) * (e[0] - a[0]) - (b[0] - a[0]) * (e[2] - a[2]),
      (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0])]
    const inward = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0
    for (const t of (inward ? [[a, b, d], [a, d, e]] : [[a, d, b], [a, e, d]])) for (const v of t) pos.push(...v)
  }
  return new Float32Array(pos)
}

/** Connected groups (4-neighbour) of generated cells on one surface: each is one completed structural gap. */
export function gapRegions(surface) {
  const gen = new Map(surface.cells.filter((c) => c.cls === 'generated').map((c) => [`${c.i},${c.j}`, c]))
  const seen = new Set()
  const regions = []
  for (const [key, cell] of gen) {
    if (seen.has(key)) continue
    const stack = [cell]
    const cells = []
    seen.add(key)
    while (stack.length) {
      const c = stack.pop()
      cells.push(c)
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${c.i + di},${c.j + dj}`
        if (gen.has(k) && !seen.has(k)) { seen.add(k); stack.push(gen.get(k)) }
      }
    }
    regions.push({ surface: surface.id, cells, area: cells.reduce((s, c) => s + c.area, 0) })
  }
  return regions
}

/**
 * Before / after completion, area-weighted over the room shell:
 *   before = share of the shell with measured evidence (observed + uncertain cells)
 *   after  = the closed shell; the added part is GENERATED, never counted as observed.
 */
export function completionStats(surfaces) {
  const area = { observed: 0, uncertain: 0, generated: 0 }
  const gaps = []
  for (const s of surfaces || []) {
    for (const c of s.cells) if (c.cls in area) area[c.cls] += c.area
    gaps.push(...gapRegions(s))
  }
  const total = area.observed + area.uncertain + area.generated
  const share = (v) => (total ? v / total : 0)
  return {
    total, area, gaps,
    shares: { observed: share(area.observed), uncertain: share(area.uncertain), generated: share(area.generated) },
    before: share(area.observed + area.uncertain),
    generatedShare: share(area.generated),
    available: area.generated > 0,
  }
}
