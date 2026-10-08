/** Small 2D helpers on the canonical plan geometry (image pixels). */

export function pointInPolygon([x, y], poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The room containing a plan point, or null (empty space selects nothing). */
export function roomAt(geometry, p) {
  return geometry.rooms.find((r) => pointInPolygon(p, r.polygon)) || null
}

/** Openings on the boundary of a room (a point just beside the opening lies inside the room). */
export function openingsOfRoom(geometry, room) {
  if (!room) return []
  return geometry.openings.filter((o) => {
    const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1
    const nx = -(o.y2 - o.y1) / L, ny = (o.x2 - o.x1) / L
    const cx = (o.x1 + o.x2) / 2, cy = (o.y1 + o.y2) / 2
    const d = o.thickness / 2 + 4
    return pointInPolygon([cx + nx * d, cy + ny * d], room.polygon) || pointInPolygon([cx - nx * d, cy - ny * d], room.polygon)
  })
}

export const wallLength = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1)

/** Closest point on a wall's centre line and the distance to it. */
export function projectOnWall(w, [x, y]) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1
  const L2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / L2))
  const px = w.x1 + dx * t, py = w.y1 + dy * t
  return { t, x: px, y: py, d: Math.hypot(x - px, y - py) }
}

/** Selection that still exists in this geometry (edits may delete the selected object). */
export function validSelection(geometry, sel) {
  if (!sel || !geometry) return null
  const list = sel.kind === 'room' ? geometry.rooms : sel.kind === 'wall' ? geometry.walls : geometry.openings
  return list.some((x) => x.id === sel.id) ? sel : null
}
