import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { Download, Footprints, Loader2, Orbit, RotateCcw, Settings2, X } from 'lucide-react'
import { buildModel, collisionRects } from '../lib/buildModel.js'
import { fmtM, fmtM2 } from '../lib/format.js'
import ScaleBadge from '../components/ScaleBadge.jsx'
import Walkthrough from '../components/Walkthrough.jsx'

function CameraRig({ mode, view, frame, resetKey, controls }) {
  const { camera, size } = useThree()
  useEffect(() => {
    if (mode === 'walk') return
    const span = Math.max(frame.sizeX, frame.sizeZ, 4)
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const aspect = size.width / Math.max(size.height, 1)
    const fit = Math.max(frame.sizeZ, frame.sizeX / aspect) / (2 * tan)
    if (view === 'top') {
      camera.position.set(0, fit * 1.12 + 3, 0.001)
    } else {
      const d = Math.max(fit, span / (2 * tan)) * 1.15
      camera.position.set(d * 0.5, d * 0.72, d * 0.78)
    }
    camera.near = 0.05
    camera.far = span * 30
    camera.updateProjectionMatrix()
    if (controls.current) {
      controls.current.target.set(0, 0, 0)
      controls.current.update()
    }
  }, [mode, view, frame, resetKey, camera, controls, size.width, size.height])
  return null
}

function Scene({ model, frame, mode, view, labels, result, resetKey, walkStart, rects }) {
  const controls = useRef()
  const span = Math.max(frame.sizeX, frame.sizeZ, 4)
  const rooms = result.geometry.corrected.rooms
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
      <mesh rotation-x={-Math.PI / 2} position-y={-0.11} receiveShadow>
        <planeGeometry args={[span * 8, span * 8]} />
        <meshStandardMaterial color="#E7E3DB" roughness={1} />
      </mesh>
      <gridHelper args={[span * 4, Math.round(span * 4), '#D9D4CA', '#E2DED6']} position-y={-0.105} />
      <primitive object={model} />
      {labels && mode !== 'walk' && rooms.map((r) => {
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
      <CameraRig mode={mode} view={view} frame={frame} resetKey={resetKey} controls={controls} />
    </>
  )
}

function Switch({ on, onChange, label }) {
  return (
    <button className="w-full flex items-center justify-between py-1.5 text-[12.5px] text-ink-soft" onClick={() => onChange(!on)}>
      {label}
      <span className={`w-8 h-[18px] rounded-full p-0.5 transition-colors ${on ? 'bg-accent' : 'bg-line'}`}>
        <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-3.5' : ''}`} />
      </span>
    </button>
  )
}

export default function StudioView({ result }) {
  const [mode, setMode] = useState('orbit')     // orbit | walk
  const [view, setView] = useState('perspective') // perspective | top
  const [labels, setLabels] = useState(true)
  const [wallHeight, setWallHeight] = useState(result.scale.assumptions.wall_height_m)
  const [resetKey, setResetKey] = useState(0)
  const [settings, setSettings] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // The model is rebuilt from the active geometry, so fixes, edits, calibration and pipeline switches show up live.
  const { group, frame } = useMemo(() => buildModel(result, {
    wallHeight, doorHeight: result.scale.assumptions.door_height_m,
    sill: result.scale.assumptions.window_sill_m, head: result.scale.assumptions.window_head_m,
  }), [result, wallHeight])
  const rects = useMemo(() => collisionRects(result, frame), [result, frame])
  const walkStart = useMemo(() => {
    const rooms = [...result.geometry.corrected.rooms].sort((a, b) => b.area_m2 - a.area_m2)
    return rooms.length ? frame.toWorld(rooms[0].centroid[0], rooms[0].centroid[1]) : [0, 0]
  }, [result, frame])

  useEffect(() => () => {
    group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose() } })
  }, [group])

  const exportGLB = () => {
    setExporting(true); setExportError('')
    const exporter = new GLTFExporter()
    exporter.parse(group, (glb) => {
      const blob = new Blob([glb], { type: 'model/gltf-binary' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${(result.filename || 'plan').replace(/\.[^.]+$/, '')}-archnext.glb`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      setExporting(false)
    }, (err) => { setExportError(String(err?.message || err)); setExporting(false) }, { binary: true })
  }

  const g = result.geometry.corrected
  const scale = result.scale
  const area = g.rooms.reduce((a, r) => a + r.area_m2, 0)
  const reset = () => { setMode('orbit'); setResetKey((k) => k + 1) }

  return (
    <div className="h-full p-4 min-h-0">
      <section className="card h-full relative overflow-hidden">
        <Canvas shadows="soft" dpr={[1, 2]} camera={{ fov: 45, position: [10, 10, 10] }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
          <Suspense fallback={null}>
            <Scene model={group} frame={frame} mode={mode} view={view} labels={labels} result={result} resetKey={resetKey}
                   walkStart={walkStart} rects={rects} />
          </Suspense>
        </Canvas>

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="seg glass">
            <button data-active={mode === 'orbit'} onClick={() => setMode('orbit')}><Orbit size={14} />Orbit</button>
            <button data-active={mode === 'walk'} onClick={() => setMode('walk')}><Footprints size={14} />Walkthrough</button>
          </div>
          <button className="btn-secondary btn-sm glass" onClick={reset}><RotateCcw size={13} />Reset</button>
        </div>

        <div className="absolute top-3 right-3 flex items-center gap-2">
          <button className={`icon-btn glass w-9 h-9 ${settings ? 'text-accent' : ''}`} onClick={() => setSettings((v) => !v)} title="Settings">
            <Settings2 size={16} />
          </button>
          <button className="btn-primary h-9" onClick={exportGLB} disabled={exporting}>
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}Export GLB
          </button>
        </div>

        {settings && (
          <div className="absolute top-14 right-3 w-72 max-h-[calc(100%-120px)] overflow-auto scrollbar-thin glass rounded-xl p-4 fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className="card-title">Settings</span>
              <button className="icon-btn w-6 h-6" onClick={() => setSettings(false)}><X size={14} /></button>
            </div>
            <div className="seg w-full grid grid-cols-2 mb-2">
              <button data-active={view === 'perspective'} onClick={() => { setMode('orbit'); setView('perspective') }} className="justify-center">3D view</button>
              <button data-active={view === 'top'} onClick={() => { setMode('orbit'); setView('top') }} className="justify-center">Top view</button>
            </div>
            <Switch on={labels} onChange={setLabels} label="Room labels" />
            <div className="py-1.5">
              <div className="flex justify-between text-[12.5px] text-ink-soft"><span>Wall height</span><span className="tabular-nums">{wallHeight.toFixed(2)} m</span></div>
              <input type="range" min="2.2" max="4" step="0.05" value={wallHeight} onChange={(e) => setWallHeight(parseFloat(e.target.value))}
                     className="w-full accent-[#3F6A8F] mt-1" />
            </div>
            <div className="border-t border-line mt-2 pt-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between"><span className="text-ink-mute">Footprint</span><span className="tabular-nums">{frame.sizeX.toFixed(1)} × {frame.sizeZ.toFixed(1)} m</span></div>
              <div className="flex justify-between"><span className="text-ink-mute">Wall thickness</span><span className="tabular-nums">{fmtM(scale.wall_thickness_m)}</span></div>
              <div className="flex justify-between"><span className="text-ink-mute">Door height</span><span className="tabular-nums">{fmtM(scale.assumptions.door_height_m, 1)}</span></div>
              <div className="flex justify-between"><span className="text-ink-mute">Window sill / head</span><span className="tabular-nums">{scale.assumptions.window_sill_m.toFixed(1)} / {scale.assumptions.window_head_m.toFixed(1)} m</span></div>
            </div>
            {g.rooms.length > 0 && (
              <div className="border-t border-line mt-3 pt-3">
                <div className="label mb-1.5">Rooms</div>
                <ul className="space-y-1">
                  {[...g.rooms].sort((a, b) => b.area_m2 - a.area_m2).map((r) => (
                    <li key={r.id} className="flex justify-between gap-2 text-[12px]">
                      <span className="truncate text-ink-soft">{r.name}</span>
                      <span className="tabular-nums text-ink-mute whitespace-nowrap">{r.length_m.toFixed(1)} × {r.width_m.toFixed(1)} m</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="absolute left-3 bottom-3 glass rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft">
          {mode === 'walk' ? 'W A S D to move · drag to look' : 'Drag to orbit · scroll to zoom'}
        </div>
        <div className="absolute right-3 bottom-3 glass rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft flex items-center gap-2.5">
          <span className="tabular-nums">{g.rooms.length} room{g.rooms.length === 1 ? '' : 's'}</span><span className="text-line">|</span>
          <span className="tabular-nums">{fmtM2(area)}</span>
          <ScaleBadge scale={scale} short />
        </div>
        {exportError && <div className="absolute top-14 left-1/2 -translate-x-1/2 glass rounded-lg px-3 py-1.5 text-[12.5px] text-bad">Export failed: {exportError}</div>}
      </section>
    </div>
  )
}
