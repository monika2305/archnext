import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { ROOM_COLORS } from './format.js'

/**
 * Procedural 3D building from the canonical geometry (walls, openings, rooms in image pixels).
 * Units are metres; plan x maps to X and plan y maps to Z.
 *
 * The frame (origin) comes from the ORIGINAL detected walls, so it stays fixed while the geometry is edited:
 * the camera does not jump when a wall moves.
 */
export function planFrame(result) {
  const walls = (result.geometry.original?.walls?.length ? result.geometry.original : result.geometry.corrected).walls
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const w of walls) {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2)
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2)
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = result.image.width; maxY = result.image.height }
  const s = result.scale.meters_per_px
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  return {
    s, cx, cy,
    sizeX: (maxX - minX) * s, sizeZ: (maxY - minY) * s,
    toWorld: (x, y) => [(x - cx) * s, (y - cy) * s],
    toPlan: (X, Z) => [X / s + cx, Z / s + cy],
  }
}

const MAT = {
  wallInt: () => new THREE.MeshStandardMaterial({ name: 'Interior wall', color: '#F7F5F0', roughness: 0.92 }),
  wallExt: () => new THREE.MeshStandardMaterial({ name: 'Exterior wall', color: '#ECE7DF', roughness: 0.95 }),
  lintel: () => new THREE.MeshStandardMaterial({ name: 'Lintel', color: '#ECE8E1', roughness: 0.9 }),
  glass: () => new THREE.MeshStandardMaterial({ name: 'Glass', color: '#BFD6E4', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.38 }),
  frame: () => new THREE.MeshStandardMaterial({ name: 'Frame', color: '#8C857A', roughness: 0.6 }),
  door: () => new THREE.MeshStandardMaterial({ name: 'Door', color: '#B89B76', roughness: 0.7 }),
}

function boxAlong(frame, x1, y1, x2, y2, thickness, y0, y1h, material, name) {
  const [ax, az] = frame.toWorld(x1, y1)
  const [bx, bz] = frame.toWorld(x2, y2)
  const len = Math.hypot(bx - ax, bz - az)
  const h = y1h - y0
  if (len < 1e-3 || h <= 1e-3) return null
  const geo = new THREE.BoxGeometry(len, h, Math.max(thickness * frame.s, 0.02))
  const mesh = new THREE.Mesh(geo, material)
  mesh.position.set((ax + bx) / 2, y0 + h / 2, (az + bz) / 2)
  mesh.rotation.y = -Math.atan2(bz - az, bx - ax)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = name
  return mesh
}

const tag = (obj, kind, id) => { obj.userData = { ...obj.userData, kind, id }; return obj }

/** Height of a wall in metres (its own height if the user set one, otherwise the building's). */
export const wallHeightOf = (w, wallHeight) => (w.height ?? wallHeight)

export function buildModel(result, { wallHeight = 2.7, doorHeight = 2.1, sill = 0.9, head = 2.1 } = {}, geometry) {
  const frame = planFrame(result)
  const g = geometry || result.geometry.corrected
  const root = new THREE.Group()
  root.name = 'ArchNext building'
  const mats = Object.fromEntries(Object.entries(MAT).map(([k, f]) => [k, f()]))
  const wallsGroup = new THREE.Group(); wallsGroup.name = 'Walls'
  const openGroup = new THREE.Group(); openGroup.name = 'Openings'
  const floorGroup = new THREE.Group(); floorGroup.name = 'Floors'
  const hostHeight = Object.fromEntries(g.walls.map((w) => [w.id, wallHeightOf(w, wallHeight)]))

  for (const w of g.walls) {
    const m = boxAlong(frame, w.x1, w.y1, w.x2, w.y2, w.thickness, 0, wallHeightOf(w, wallHeight),
      w.exterior ? mats.wallExt : mats.wallInt, `${w.exterior ? 'Exterior' : 'Interior'} wall ${w.id}`)
    if (m) wallsGroup.add(tag(m, 'wall', w.id))
  }
  for (const s of g.solids || []) {
    const m = boxAlong(frame, s.x0, (s.y0 + s.y1) / 2, s.x1, (s.y0 + s.y1) / 2, s.y1 - s.y0, 0, wallHeight, mats.wallExt, 'Solid')
    if (m) wallsGroup.add(m)
  }

  for (const o of g.openings) {
    // An opening is as tall as the walls framing it.
    const top = Math.max(...o.hosts.map((h) => hostHeight[h] ?? wallHeight), 1)
    const dh = Math.min(doorHeight, top - 0.05)
    const hh = Math.min(head, top - 0.05)
    const og = tag(new THREE.Group(), 'opening', o.id)
    og.name = `Opening ${o.id}`
    if (o.type === 'window') {
      const sill0 = Math.min(sill, hh - 0.3)
      const parts = [
        boxAlong(frame, o.x1, o.y1, o.x2, o.y2, o.thickness, 0, sill0, mats.lintel, `Window sill ${o.id}`),
        boxAlong(frame, o.x1, o.y1, o.x2, o.y2, o.thickness, hh, top, mats.lintel, `Window head ${o.id}`),
        boxAlong(frame, o.x1, o.y1, o.x2, o.y2, o.thickness * 0.15, sill0, hh, mats.glass, `Glass ${o.id}`),
        boxAlong(frame, o.x1, o.y1, o.x2, o.y2, o.thickness * 1.02, sill0 - 0.03, sill0, mats.frame, `Window frame ${o.id}`),
      ]
      parts.forEach((p) => { if (p) { if (p.name.startsWith('Glass')) p.castShadow = false; og.add(tag(p, 'opening', o.id)) } })
    } else {
      const lintel = boxAlong(frame, o.x1, o.y1, o.x2, o.y2, o.thickness, dh, top, mats.lintel, `${o.type === 'door' ? 'Door' : 'Opening'} head ${o.id}`)
      if (lintel) og.add(tag(lintel, 'opening', o.id))
      if (o.type === 'door') {
        // Door leaf shown slightly open from the first jamb.
        const [ax, az] = frame.toWorld(o.x1, o.y1)
        const [bx, bz] = frame.toWorld(o.x2, o.y2)
        const width = Math.hypot(bx - ax, bz - az)
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(width * 0.96, dh - 0.02, 0.04), mats.door)
        const pivot = new THREE.Group()
        pivot.position.set(ax, 0, az)
        pivot.rotation.y = -Math.atan2(bz - az, bx - ax) + THREE.MathUtils.degToRad(35)
        leaf.position.set(width * 0.48, (dh - 0.02) / 2, 0)
        leaf.castShadow = true
        leaf.name = `Door leaf ${o.id}`
        pivot.add(tag(leaf, 'opening', o.id))
        pivot.name = `Door ${o.id}`
        og.add(pivot)
      }
    }
    openGroup.add(og)
  }

  for (const r of g.rooms) {
    if (r.polygon.length < 3) continue
    const shape = roomShape(frame, r.polygon)
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({ name: `Floor ${r.type}`, color: ROOM_COLORS[r.type] || ROOM_COLORS.unknown, roughness: 0.85 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = 0.012
    mesh.receiveShadow = true
    mesh.name = `Floor ${r.name}`
    mesh.userData = { kind: 'room', id: r.id, room: r.name, area_m2: r.area_m2 }
    floorGroup.add(mesh)
  }

  root.add(floorGroup, wallsGroup, openGroup)
  return { group: root, frame }
}

export function roomShape(frame, polygon) {
  let pts = polygon.map(([x, y]) => {
    const [X, Z] = frame.toWorld(x, y)
    return new THREE.Vector2(X, -Z)
  })
  if (THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse()
  return new THREE.Shape(pts)
}

/** World-space bounds of a room (for camera focus). */
export function roomBounds(frame, room) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (const [x, y] of room.polygon) {
    const [X, Z] = frame.toWorld(x, y)
    minX = Math.min(minX, X); maxX = Math.max(maxX, X); minZ = Math.min(minZ, Z); maxZ = Math.max(maxZ, Z)
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, sx: maxX - minX, sz: maxZ - minZ }
}

/** 2D wall rectangles in metres for walkthrough collision. */
export function collisionRects(result, frame, geometry) {
  return (geometry || result.geometry.corrected).walls.map((w) => {
    const [ax, az] = frame.toWorld(w.x1, w.y1)
    const [bx, bz] = frame.toWorld(w.x2, w.y2)
    return { ax, az, bx, bz, half: (w.thickness * frame.s) / 2 }
  })
}

/** GLB of the canonical geometry, built fresh so no selection highlight or preview ends up in the file. */
export function exportGLB(result, opts) {
  const { group } = buildModel(result, opts)
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(group, (glb) => {
      group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose() } })
      resolve(new Blob([glb], { type: 'model/gltf-binary' }))
    }, reject, { binary: true })
  })
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
