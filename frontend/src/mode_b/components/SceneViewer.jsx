import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { cellCorners, sceneBounds, surfaceArrays } from '../lib/sceneGeometry.js'

// Mode B 3D viewer: room surfaces coloured by VisionTrust class or GeometryTrust confidence, the reconstructed
// points, the recorded camera path and the NextBestView marker. Independent of Mode A's viewer.

function Surface({ surface, mode, selected, onPick }) {
  const isClean = mode === 'clean'
  const { geometry, triCell } = useMemo(() => {
    const a = surfaceArrays(surface, isClean ? 'complete' : mode)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3))
    if (!isClean) {
      g.setAttribute('color', new THREE.BufferAttribute(a.colors, 3))
    }
    g.computeVertexNormals()
    return { geometry: g, triCell: a.triCell }
  }, [surface, mode, isClean])
  useEffect(() => () => geometry.dispose(), [geometry])

  let materialProps = {
    side: THREE.FrontSide,
    transparent: true,
    opacity: 0.88,
    roughness: 0.85,
    metalness: 0.02,
    emissive: selected ? '#22d3ee' : '#000000',
    emissiveIntensity: selected ? 0.22 : 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
  }

  if (isClean) {
    if (surface.kind === 'floor') {
      materialProps = { ...materialProps, color: '#DDD7CD', opacity: 0.95, roughness: 0.75 }
    } else if (surface.kind === 'ceiling') {
      materialProps = { ...materialProps, color: '#F3EFE6', opacity: 0.25, roughness: 0.9 }
    } else {
      materialProps = { ...materialProps, color: '#EDE8E0', opacity: 0.88, roughness: 0.85 }
    }
  } else {
    materialProps = {
      ...materialProps,
      vertexColors: true,
      opacity: mode === 'generated' ? 0.75 : 0.88,
    }
  }

  return (
    <mesh geometry={geometry} userData={{ surface: surface.id }}
          onClick={(e) => { if (e.delta > 4) return; e.stopPropagation(); onPick?.(surface.id, surface.cells[triCell[e.faceIndex]]) }}>
      <meshStandardMaterial {...materialProps} />
    </mesh>
  )
}

function SurfaceOutline({ surface }) {
  const pts = useMemo(() => {
    const c = surface.corners
    return [c[0], c[1], c[2], c[3], c[0]]
  }, [surface])
  return <Line points={pts} color="#B8B1A4" lineWidth={1} transparent opacity={0.5} raycast={() => null} />
}

function CellGrid({ surface, mode }) {
  // Thin grid lines show the evidence cells; generated cells get a dashed violet outline.
  const lines = useMemo(() => surface.cells.filter((c) => mode !== 'observed' || c.cls === 'observed')
    .filter((c) => mode !== 'generated' || c.cls === 'generated')
    .map((c) => { const q = cellCorners(surface, c); return { pts: [...q, q[0]], gen: c.cls === 'generated', key: `${c.i}-${c.j}` } }), [surface, mode])
  return lines.map((l) => (
    <Line key={l.key} points={l.pts} color={l.gen ? '#7c3aed' : '#ffffff'} lineWidth={l.gen ? 1 : 0.6}
          transparent opacity={l.gen ? 0.7 : 0.35} dashed={l.gen} dashSize={0.08} gapSize={0.06} raycast={() => null} />
  ))
}

function SelectedCell({ surface, cell }) {
  const q = cellCorners(surface, cell)
  return <Line points={[...q, q[0]]} color="#22d3ee" lineWidth={3} raycast={() => null} />
}

// Display only (stored points are never changed): photo colours are sRGB, so they are converted to linear for
// Three.js (otherwise they look washed out); for dense RGB-D clouds, cells measured by only 2 frames - mostly floating
// fringe noise - are hidden unless minViews is lowered.
function Points({ points, minViews = 0 }) {
  const geometry = useMemo(() => {
    const keep = []
    const n = points.xyz.length / 3
    for (let i = 0; i < n; i++) if (!minViews || !points.views || points.views[i] >= minViews) keep.push(i)
    const pos = new Float32Array(keep.length * 3)
    const col = new Float32Array(keep.length * 3)
    keep.forEach((i, k) => {
      for (let c = 0; c < 3; c++) {
        pos[3 * k + c] = points.xyz[3 * i + c]
        col[3 * k + c] = points.dense ? Math.pow(points.rgb[3 * i + c] / 255, 2.2) : points.rgb[3 * i + c] / 255
      }
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [points, minViews])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <points geometry={geometry} raycast={() => null}>
      {points.dense ? <pointsMaterial size={points.size * 2.2} sizeAttenuation vertexColors />
        : <pointsMaterial size={3.5} sizeAttenuation={false} vertexColors />}
    </points>
  )
}

function Cameras({ cameras, size }) {
  const path = cameras.map((c) => c.center)
  const s = size * 0.025
  const frusta = cameras.filter((_, k) => k % Math.max(1, Math.round(cameras.length / 25)) === 0)
  return (
    <group>
      {path.length > 1 && <Line points={path} color="#3F6A8F" lineWidth={1.5} raycast={() => null} />}
      {frusta.map((c) => {
        const f = new THREE.Vector3(...c.forward)
        const u = new THREE.Vector3(...c.up)
        const r = new THREE.Vector3().crossVectors(f, u)
        const o = new THREE.Vector3(...c.center)
        const tip = (a, b) => o.clone().add(f.clone().multiplyScalar(s * 1.6)).add(r.clone().multiplyScalar(a * s)).add(u.clone().multiplyScalar(b * s * 0.75))
        const q = [tip(-1, 1), tip(1, 1), tip(1, -1), tip(-1, -1)]
        return <Line key={c.name} points={[q[0], q[1], q[2], q[3], q[0], o, q[1], q[2], o, q[3]]} color="#2F5373" lineWidth={1} raycast={() => null} />
      })}
    </group>
  )
}

function NbvMarker({ rec, size }) {
  const ref = useRef()
  useFrame(({ clock }) => { if (ref.current) ref.current.material.opacity = 0.55 + 0.35 * Math.sin(clock.elapsedTime * 3) })
  const o = new THREE.Vector3(...rec.position)
  const f = new THREE.Vector3(...rec.forward).normalize()
  const len = size * 0.12
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), f)
  const coneCenter = o.clone().add(f.clone().multiplyScalar(len / 2))
  return (
    <group>
      <mesh position={o} raycast={() => null}><sphereGeometry args={[size * 0.018, 20, 20]} /><meshBasicMaterial color="#22d3ee" /></mesh>
      <mesh ref={ref} position={coneCenter} quaternion={quat} raycast={() => null}>
        <coneGeometry args={[len * 0.45, len, 4, 1, true]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <Line points={[o, o.clone().add(f.clone().multiplyScalar(len * 2.2))]} color="#0891b2" lineWidth={2} dashed dashSize={len * 0.15} gapSize={len * 0.1} raycast={() => null} />
    </group>
  )
}

function Rig({ bounds, resetKey, controls, walk, startCam, dense }) {
  const { camera } = useThree()
  useEffect(() => {
    const [cx, cy, cz] = bounds.center
    const d = bounds.size * 1.25
    camera.near = bounds.size / 500
    camera.far = bounds.size * 40
    camera.updateProjectionMatrix()
    if (walk && startCam) {
      camera.position.set(...startCam.center)
      camera.lookAt(...startCam.center.map((v, k) => v + startCam.forward[k]))
      return
    }
    // Elevated 3/4 architectural eye-level perspective looking gently into the room
    const k = dense ? 0.72 : 1        // dense RGB-D clouds: frame the room more tightly
    camera.position.set(cx + d * 0.65 * k, cy + d * 0.45 * k, cz + d * 0.65 * k)
    controls.current?.target.set(cx, cy, cz)
    controls.current?.update()
  }, [bounds, resetKey, camera, controls, walk, startCam, dense])
  return null
}

/** First-person walkthrough: drag to look around, W/A/S/D or arrow keys to move (kept inside the room box). */
function Walk({ bounds, box }) {
  const { camera, gl } = useThree()
  const keys = useRef({})
  const look = useRef(null)
  useEffect(() => {
    const el = gl.domElement
    const down = (e) => { look.current = [e.clientX, e.clientY] }
    const move = (e) => {
      if (!look.current) return
      const e3 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
      e3.y -= (e.clientX - look.current[0]) * 0.004
      e3.x = Math.max(-1.3, Math.min(1.3, e3.x - (e.clientY - look.current[1]) * 0.004))
      camera.quaternion.setFromEuler(e3)
      look.current = [e.clientX, e.clientY]
    }
    const up = () => { look.current = null }
    const kd = (e) => { keys.current[e.key.toLowerCase()] = true }
    const ku = (e) => { keys.current[e.key.toLowerCase()] = false }
    el.addEventListener('pointerdown', down); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
    return () => {
      el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku)
    }
  }, [camera, gl])
  useFrame((_, dt) => {
    const k = keys.current
    const speed = bounds.size * 0.18 * dt
    const f = new THREE.Vector3()
    camera.getWorldDirection(f)
    f.y = 0
    f.normalize()
    const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0))
    const mv = new THREE.Vector3()
    if (k.w || k.arrowup) mv.add(f)
    if (k.s || k.arrowdown) mv.sub(f)
    if (k.d || k.arrowright) mv.add(r)
    if (k.a || k.arrowleft) mv.sub(r)
    if (mv.lengthSq()) camera.position.add(mv.normalize().multiplyScalar(speed))
    if (box) {
      const m = bounds.size * 0.02
      camera.position.x = Math.max(box.x[0] + m, Math.min(box.x[1] - m, camera.position.x))
      camera.position.z = Math.max(box.z[0] + m, Math.min(box.z[1] - m, camera.position.z))
    }
  })
  return null
}

export default function SceneViewer({ scene, mode = 'clean', show = {}, selection, onSelect, nbvRank = 1, walk = false, resetKey = 0 }) {
  const bounds = useMemo(() => sceneBounds(scene), [scene])
  const controls = useRef()
  const rec = scene.nbv?.recommendations?.find((r) => r.rank === nbvRank)
  const selSurface = selection && scene.surfaces.find((s) => s.id === selection.surface)
  const selCell = selSurface && selection.cell && selSurface.cells.find((c) => c.i === selection.cell.i && c.j === selection.cell.j)
  const startCam = scene.cameras?.[0]
  return (
    <Canvas camera={{ fov: 50, position: [5, 5, 5] }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true }}
            onPointerMissed={(e) => { if (e.type === 'click') onSelect?.(null) }}>
      <color attach="background" args={['#F9F8F6']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[bounds.center[0] + bounds.size, bounds.center[1] + bounds.size * 1.8, bounds.center[2] + bounds.size]} intensity={0.65} />
      <directionalLight position={[bounds.center[0] - bounds.size, bounds.center[1] + bounds.size * 0.8, bounds.center[2] - bounds.size]} intensity={0.3} color="#F5EFE6" />
      <Rig bounds={bounds} resetKey={resetKey} controls={controls} walk={walk} startCam={startCam} dense={!!scene.points?.dense} />
      {walk ? <Walk bounds={bounds} box={scene.layout?.box} /> : <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} />}
      {show.walls !== false && scene.surfaces.map((s) => (
        <group key={s.id}>
          <Surface surface={s} mode={mode} selected={selection?.surface === s.id}
                   onPick={(surface, cell) => onSelect?.({ surface, cell: cell ? { i: cell.i, j: cell.j } : null })} />
          {mode === 'clean' && <SurfaceOutline surface={s} />}
          {mode !== 'clean' && show.grid !== false && <CellGrid surface={s} mode={mode} />}
        </group>
      ))}
      {selCell && <SelectedCell surface={selSurface} cell={selCell} />}
      {show.points !== false && scene.points?.xyz?.length > 0 && <Points points={scene.points} minViews={scene.points?.dense && show.clean !== false ? 3 : 0} />}
      {show.cameras !== false && scene.cameras?.length > 0 && <Cameras cameras={scene.cameras} size={bounds.size} />}
      {show.nbv && rec && <NbvMarker rec={rec} size={bounds.size} />}
    </Canvas>
  )
}
