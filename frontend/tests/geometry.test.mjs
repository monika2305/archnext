// Fix2Build / Synchronized View: the pure geometry and 3D-model logic shared by the 2D editor, the 3D viewer
// and the GLB exporter.  Run: npm test   (Node's built-in test runner, no extra dependencies)
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildModel, planFrame, roomBounds } from '../src/lib/buildModel.js'
import { openingsOfRoom, pointInPolygon, roomAt, validSelection } from '../src/lib/planGeometry.js'

// Two rooms split by a wall at x = 300 with a door, a window in the top wall; 0.01 m per px.
const walls = [
  { id: 'w1', x1: 100, y1: 100, x2: 500, y2: 100, thickness: 10, orient: 'h', exterior: true, height: null },
  { id: 'w2', x1: 100, y1: 300, x2: 500, y2: 300, thickness: 10, orient: 'h', exterior: true, height: null },
  { id: 'w3', x1: 100, y1: 100, x2: 100, y2: 300, thickness: 10, orient: 'v', exterior: true, height: null },
  { id: 'w4', x1: 500, y1: 100, x2: 500, y2: 300, thickness: 10, orient: 'v', exterior: true, height: 3.4 },
  { id: 'w5', x1: 300, y1: 100, x2: 300, y2: 180, thickness: 10, orient: 'v', exterior: false, height: null },
  { id: 'w6', x1: 300, y1: 260, x2: 300, y2: 300, thickness: 10, orient: 'v', exterior: false, height: null },
]
const openings = [
  { id: 'o1', type: 'door', x1: 300, y1: 180, x2: 300, y2: 260, width: 80, thickness: 10, hosts: ['w5', 'w6'] },
  { id: 'o2', type: 'window', x1: 380, y1: 100, x2: 440, y2: 100, width: 60, thickness: 10, hosts: ['w1', 'w1'] },
]
const room = (id, x0, x1, name) => ({
  id, name, type: 'bedroom', polygon: [[x0, 105], [x1, 105], [x1, 295], [x0, 295]], centroid: [(x0 + x1) / 2, 200],
  area_m2: ((x1 - x0) * 190) / 1e4, length_m: 1.9, width_m: (x1 - x0) / 100, rectangularity: 1,
})
const geometry = { walls, openings, rooms: [room('r1', 105, 295, 'Left'), room('r2', 305, 495, 'Right')], solids: [] }
const result = {
  image: { width: 600, height: 400 }, scale: { meters_per_px: 0.01 },
  geometry: { original: geometry, corrected: geometry },
}

test('every mesh is tagged with the id of the object it represents (3D picking)', () => {
  const { group } = buildModel(result, { wallHeight: 2.7 })
  const tags = { wall: new Set(), room: new Set(), opening: new Set() }
  group.traverse((o) => { if (o.isMesh && o.userData.kind) tags[o.userData.kind].add(o.userData.id) })
  assert.deepEqual([...tags.wall].sort(), ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'])
  assert.deepEqual([...tags.room].sort(), ['r1', 'r2'])
  assert.deepEqual([...tags.opening].sort(), ['o1', 'o2'])
})

test('per-wall height and real-world size reach the 3D model', () => {
  const { group } = buildModel(result, { wallHeight: 2.7 })
  const wall = (id) => group.getObjectByName(`Exterior wall ${id}`)
  wall('w4').geometry.computeBoundingBox()
  wall('w1').geometry.computeBoundingBox()
  const h = (m) => m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y
  assert.ok(Math.abs(h(wall('w4')) - 3.4) < 1e-6)      // the user set this one
  assert.ok(Math.abs(h(wall('w1')) - 2.7) < 1e-6)      // building default
  const len = wall('w1').geometry.boundingBox.max.x - wall('w1').geometry.boundingBox.min.x
  assert.ok(Math.abs(len - 4.0) < 1e-6)                // 400 px x 0.01 m/px
})

test('the 3D frame stays fixed while the geometry is edited', () => {
  const edited = { ...geometry, walls: walls.map((w) => (w.id === 'w4' ? { ...w, x1: 560, x2: 560 } : w)) }
  const a = planFrame(result)
  const b = planFrame({ ...result, geometry: { original: geometry, corrected: edited } })
  assert.deepEqual(a.toWorld(300, 200), b.toWorld(300, 200))
})

test('room bounds for camera focus use the real room polygon', () => {
  const f = planFrame(result)
  const b = roomBounds(f, geometry.rooms[1])
  assert.ok(Math.abs(b.sx - 1.9) < 1e-9 && Math.abs(b.sz - 1.9) < 1e-9)
  assert.ok(Math.abs(b.cx - f.toWorld(400, 200)[0]) < 1e-9)
})

test('2D room hit-testing: inside a room selects it, empty space selects nothing', () => {
  assert.equal(roomAt(geometry, [200, 200]).id, 'r1')
  assert.equal(roomAt(geometry, [450, 150]).id, 'r2')
  assert.equal(roomAt(geometry, [550, 350]), null)
  assert.ok(pointInPolygon([150, 150], geometry.rooms[0].polygon))
})

test('doors and windows on a room boundary are found for the amber highlight', () => {
  assert.deepEqual(openingsOfRoom(geometry, geometry.rooms[0]).map((o) => o.id), ['o1'])
  assert.deepEqual(openingsOfRoom(geometry, geometry.rooms[1]).map((o) => o.id).sort(), ['o1', 'o2'])
})

test('a selection that no longer exists is dropped, never re-pointed', () => {
  assert.deepEqual(validSelection(geometry, { kind: 'room', id: 'r2' }), { kind: 'room', id: 'r2' })
  assert.equal(validSelection(geometry, { kind: 'room', id: 'r9' }), null)
  assert.equal(validSelection(geometry, { kind: 'wall', id: 'w9' }), null)
  assert.equal(validSelection(null, { kind: 'room', id: 'r1' }), null)
})
