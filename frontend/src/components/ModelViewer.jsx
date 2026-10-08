import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Edges, Html, Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { buildModel, collisionRects, roomBounds, roomShape, wallHeightOf } from '../lib/buildModel.js'
import { openingsOfRoom } from '../lib/planGeometry.js'
import Walkthrough from './Walkthrough.jsx'

export const GLOW = { cyan: '#22d3ee', emerald: '#10b981', violet: '#8b5cf6', amber: '#f59e0b' }
const noRay = () => null

function taggedAncestor(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData?.kind) return o
  return null
}

/** Camera: fits the building on reset / view change, flies smoothly to a selected room on focus. */
function CameraRig({ mode, view, frame, resetKey, focus, wallHeight, controls }) {
  const { camera, size } = useThree()
  const goal = useRef(null)
  const first = useRef(true)

  useEffect(() => {
    if (mode === 'walk') return
    const span = Math.max(frame.sizeX, frame.sizeZ, 4)
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const aspect = size.width / Math.max(size.height, 1)
    const fit = Math.max(frame.sizeZ, frame.sizeX / aspect) / (2 * tan)
    const d = Math.max(fit, span / (2 * tan)) * 1.15
    const pos = view === 'top' ? new THREE.Vector3(0, fit * 1.12 + 3, 0.001) : new THREE.Vector3(d * 0.5, d * 0.72, d * 0.78)
    camera.near = 0.05
    camera.far = span * 30
    camera.updateProjectionMatrix()
    goal.current = { pos, target: new THREE.Vector3(0, 0, 0) }
    if (first.current) {          // first frame: place the camera, no animation
      camera.position.copy(pos)
      controls.current?.target.set(0, 0, 0)
      controls.current?.update()
      goal.current = null
      first.current = false
    }
  }, [mode, view, frame, resetKey, camera, controls, size.width, size.height])

  useEffect(() => {
    if (!focus || mode === 'walk' || !controls.current) return
    const b = focus.bounds
    const span = Math.max(b.sx, b.sz, 2.5)
    const target = new THREE.Vector3(b.cx, 0.4, b.cz)
    const dir = camera.position.clone().sub(controls.current.target)
    dir.y = 0
    if (dir.lengthSq() < 1e-6) dir.set(0.5, 0, 0.8)
    dir.normalize()
    const dist = span * 1.6 + 3.5
    // A steep view from well above the walls: the whole room stays visible and the camera never cuts a wall.
    const pos = target.clone().add(dir.multiplyScalar(dist * 0.55)).add(new THREE.Vector3(0, Math.max(wallHeight * 2.5, dist * 1.05), 0))
    goal.current = { pos, target }
  }, [focus, mode, camera, controls, wallHeight])

  useFrame((_, dt) => {
    if (!goal.current || mode === 'walk' || !controls.current) return
    const k = 1 - Math.exp(-dt * 5)
    camera.position.lerp(goal.current.pos, k)
    controls.current.target.lerp(goal.current.target, k)
    controls.current.update()
    if (camera.position.distanceTo(goal.current.pos) < 0.02) goal.current = null
  })
  return null
}

/** Smooth highlight transition: eases ``apply(e)`` from 0 to 1 whenever ``key`` changes. */
function useFadeIn(key, apply) {
  const v = useRef(0)
  useEffect(() => { v.current = 0 }, [key])
  useFrame((_, dt) => {
    if (v.current >= 1) return
    v.current = Math.min(1, v.current + dt * 3.5)
    apply(1 - (1 - v.current) ** 3)
  })
}

function RoomGlow({ room, frame, wallHeight, geometry, scale }) {
  const floor = useMemo(() => {
    const geo = new THREE.ShapeGeometry(roomShape(frame, room.polygon))
    geo.rotateX(-Math.PI / 2)
    return geo
  }, [room, frame])
  const floorMat = useMemo(() => new THREE.MeshBasicMaterial({ color: GLOW.emerald, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }), [])
  const pts = useMemo(() => {
    const p = room.polygon.map(([x, y]) => frame.toWorld(x, y))
    return [...p, p[0]]
  }, [room, frame])
  const low = useMemo(() => pts.map(([x, z]) => [x, 0.04, z]), [pts])
  const high = useMemo(() => pts.map(([x, z]) => [x, wallHeight + 0.03, z]), [pts, wallHeight])
  const lineLow = useRef(), lineHigh = useRef()
  useFadeIn(room.id, (e) => {
    floorMat.opacity = 0.38 * e
    if (lineLow.current) lineLow.current.material.opacity = e
    if (lineHigh.current) lineHigh.current.material.opacity = 0.9 * e
  })
  const doors = useMemo(() => openingsOfRoom(geometry, room), [geometry, room])
  const b = roomBounds(frame, room)
  const estimated = scale.status === 'estimated'
  useEffect(() => () => { floor.dispose(); floorMat.dispose() }, [floor, floorMat])
  return (
    <group>
      <mesh geometry={floor} material={floorMat} position-y={0.025} raycast={noRay} renderOrder={2} />
      <Line ref={lineLow} points={low} color={GLOW.cyan} lineWidth={3.5} transparent opacity={0} toneMapped={false} raycast={noRay} />
      <Line ref={lineHigh} points={high} color={GLOW.violet} lineWidth={2.5} transparent opacity={0} toneMapped={false} raycast={noRay} />
      {doors.map((o) => <OpeningGlow key={o.id} o={o} frame={frame} wallHeight={wallHeight} subtle />)}
      <Html position={[b.cx, wallHeight + 0.5, b.cz]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="glow-card">
          <div className="text-[13px] font-semibold text-white leading-tight">{room.name}</div>
          <div className="text-[12px] text-emerald-300 tabular-nums">{room.area_m2.toFixed(1)} m²{estimated ? ' (est.)' : ''}</div>
          {room.rectangularity >= 0.85 && (
            <div className="text-[11px] text-white/70 tabular-nums">{room.length_m.toFixed(2)} × {room.width_m.toFixed(2)} m</div>
          )}
          <div className="text-[10px] text-violet-300 font-mono">{room.id}</div>
        </div>
      </Html>
    </group>
  )
}

function boxFor(frame, x1, y1, x2, y2, thick, h, pad = 0.03) {
  const [ax, az] = frame.toWorld(x1, y1)
  const [bx, bz] = frame.toWorld(x2, y2)
  const len = Math.hypot(bx - ax, bz - az)
  return { args: [len + pad, h + pad, Math.max(thick * frame.s, 0.02) + pad], position: [(ax + bx) / 2, h / 2, (az + bz) / 2], ry: -Math.atan2(bz - az, bx - ax) }
}

function WallGlow({ w, frame, wallHeight }) {
  const b = boxFor(frame, w.x1, w.y1, w.x2, w.y2, w.thickness, wallHeightOf(w, wallHeight))
  return (
    <mesh position={b.position} rotation-y={b.ry} raycast={noRay}>
      <boxGeometry args={b.args} />
      <meshBasicMaterial color={GLOW.cyan} transparent opacity={0.28} depthWrite={false} toneMapped={false} />
      <Edges color={GLOW.cyan} lineWidth={2} />
    </mesh>
  )
}

function OpeningGlow({ o, frame, wallHeight, subtle }) {
  const b = boxFor(frame, o.x1, o.y1, o.x2, o.y2, o.thickness * 1.3, Math.min(2.2, wallHeight))
  return (
    <mesh position={b.position} rotation-y={b.ry} raycast={noRay}>
      <boxGeometry args={b.args} />
      <meshBasicMaterial color={GLOW.amber} transparent opacity={subtle ? 0.22 : 0.4} depthWrite={false} toneMapped={false} />
      <Edges color={GLOW.amber} lineWidth={subtle ? 1.5 : 2.5} />
    </mesh>
  )
}

function Scene({ result, geometry, wallHeight, mode, view, labels, selection, onSelect, focusKey, resetKey, picking }) {
  const controls = useRef()
  const opts = useMemo(() => ({
    wallHeight, doorHeight: result.scale.assumptions.door_height_m,
    sill: result.scale.assumptions.window_sill_m, head: result.scale.assumptions.window_head_m,
  }), [result, wallHeight])
  const { group, frame } = useMemo(() => buildModel(result, opts, geometry), [result, opts, geometry])
  useEffect(() => () => group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose() } }), [group])
  const rects = useMemo(() => collisionRects(result, frame, geometry), [result, frame, geometry])
  const walkStart = useMemo(() => {
    const rooms = [...geometry.rooms].sort((a, b) => b.area_m2 - a.area_m2)
    return rooms.length ? frame.toWorld(rooms[0].centroid[0], rooms[0].centroid[1]) : [0, 0]
  }, [geometry, frame])
  const span = Math.max(frame.sizeX, frame.sizeZ, 4)

  const room = selection?.kind === 'room' ? geometry.rooms.find((r) => r.id === selection.id) : null
  const wall = selection?.kind === 'wall' ? geometry.walls.find((w) => w.id === selection.id) : null
  const opening = selection?.kind === 'opening' ? geometry.openings.find((o) => o.id === selection.id) : null
  // Focus only when a room is (re)selected, not on every geometry change.
  const focus = useMemo(() => (room ? { bounds: roomBounds(frame, room), key: focusKey } : null), // eslint-disable-line react-hooks/exhaustive-deps
    [room?.id, focusKey, frame])

  const onClick = (e) => {
    if (!picking || mode === 'walk' || e.delta > 4) return
    e.stopPropagation()
    const hit = e.intersections.map((i) => taggedAncestor(i.object)).find(Boolean)
    if (hit) onSelect?.({ kind: hit.userData.kind, id: hit.userData.id, from: '3d' })
  }

  return (
    <>
      <color attach="background" args={['#F2F0EB']} />
      <hemisphereLight args={['#ffffff', '#e2dbcf', 1.25]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[span * 0.35, span * 1.4, span * 0.25]} intensity={1.7} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span}
        shadow-camera-near={0.5} shadow-camera-far={span * 4} />
      <directionalLight position={[-span * 0.6, span * 0.6, -span * 0.4]} intensity={0.45} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.11} receiveShadow raycast={noRay}>
        <planeGeometry args={[span * 8, span * 8]} />
        <meshStandardMaterial color="#E7E3DB" roughness={1} />
      </mesh>
      <gridHelper args={[span * 4, Math.round(span * 4), '#D9D4CA', '#E2DED6']} position-y={-0.105} raycast={noRay} />
      <primitive object={group} onClick={onClick} />
      {room && <RoomGlow room={room} frame={frame} wallHeight={wallHeight} geometry={geometry} scale={result.scale} />}
      {wall && <WallGlow w={wall} frame={frame} wallHeight={wallHeight} />}
      {opening && <OpeningGlow o={opening} frame={frame} wallHeight={wallHeight} />}
      {labels && mode !== 'walk' && geometry.rooms.filter((r) => r.id !== room?.id).map((r) => {
        const [x, z] = frame.toWorld(r.centroid[0], r.centroid[1])
        return (
          <Html key={r.id} position={[x, 0.15, z]} center distanceFactor={span * 0.9} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
            <div className="px-2 py-1 rounded-md bg-white/90 border border-line shadow-card text-center whitespace-nowrap">
              <div className="text-[11px] font-semibold text-ink leading-tight">{r.name}</div>
              <div className="text-[10px] text-ink-mute leading-tight">{r.area_m2.toFixed(1)} m²</div>
            </div>
          </Html>
        )
      })}
      {mode === 'walk'
        ? <Walkthrough start={walkStart} rects={rects} />
        : <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.02}
                         minDistance={1} maxDistance={span * 6} />}
      <CameraRig mode={mode} view={view} frame={frame} resetKey={resetKey} focus={focus} wallHeight={wallHeight} controls={controls} />
    </>
  )
}

/**
 * Interactive 3D model of the canonical geometry (or a preview / drag draft of it).
 * Clicking a room, wall or opening reports it through ``onSelect``; the selection glows, rooms get focus.
 */
export default function ModelViewer({ result, geometry, wallHeight, mode = 'orbit', view = 'perspective', labels = false,
  selection, onSelect, focusKey = 0, resetKey = 0, picking = true }) {
  const down = useRef(null)
  return (
    <div className="absolute inset-0" onPointerDown={(e) => { down.current = [e.clientX, e.clientY] }}>
      <Canvas shadows="soft" dpr={[1, 2]} camera={{ fov: 45, position: [10, 10, 10] }} gl={{ preserveDrawingBuffer: true, antialias: true }}
              onPointerMissed={(e) => {
                const d = down.current ? Math.hypot(e.clientX - down.current[0], e.clientY - down.current[1]) : 0
                if (picking && mode !== 'walk' && d < 4) onSelect?.(null)   // a click on empty space clears; a drag does not
              }}>
        <Suspense fallback={null}>
          <Scene result={result} geometry={geometry || result.geometry.corrected} wallHeight={wallHeight} mode={mode} view={view}
                 labels={labels} selection={selection} onSelect={onSelect} focusKey={focusKey} resetKey={resetKey} picking={picking} />
        </Suspense>
      </Canvas>
    </div>
  )
}
