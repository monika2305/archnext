import { useState } from 'react'
import { Download, FileJson, Ruler } from 'lucide-react'
import { modeB } from '../api.js'
import { lengthLabel } from '../lib/trust.js'

// Export (GLB / scene JSON) and manual metric scale calibration.
export default function ExportView({ data, scene, onReload }) {
  const p = data.project
  const walls = scene.surfaces.filter((s) => s.kind === 'wall')
  const [wall, setWall] = useState(walls.find((w) => w.measured)?.id || walls[0]?.id || '')
  const [length, setLength] = useState('')
  const [msg, setMsg] = useState(null)
  const scale = p.scale

  const calibrate = async () => {
    try {
      await modeB.setScale(p.id, { surface: wall, length_m: Number(length) })
      await onReload()
      setMsg({ ok: true, text: 'Scale set: lengths and the GLB are now in metres.' })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
  }
  const clear = async () => { await modeB.setScale(p.id, { clear: true }); await onReload(); setMsg(null) }
  const sceneJson = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(scene, null, 1)], { type: 'application/json' }))
    a.download = `${p.name.replace(/[^\w-]+/g, '_')}-modeb-v${scene.version}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-6 lg:p-8 space-y-5">
        <h1 className="text-[22px] font-semibold tracking-tight">Export</h1>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="card p-4 space-y-2">
            <div className="card-title">3D scene (GLB)</div>
            <p className="text-[12.5px] text-ink-mute">Room surfaces split by VisionTrust class (with their evidence as metadata), the reconstructed
              points and the camera path — the geometry itself, without viewer highlights.
              {' '}{scale?.meters_per_unit ? 'Units: metres.' : 'Units: reconstruction units (scale unknown).'}</p>
            <a className="btn-primary w-full" href={modeB.glbUrl(p.id, scene.version, 'all')} download><Download size={15} />Complete scene (.glb)</a>
            <a className="btn-secondary w-full" href={modeB.glbUrl(p.id, scene.version, 'observed')} download><Download size={15} />Without generated surfaces (.glb)</a>
          </div>
          <div className="card p-4 space-y-2">
            <div className="card-title">Scene data (JSON)</div>
            <p className="text-[12.5px] text-ink-mute">Surfaces, cells, evidence, confidence, assumptions, camera poses, NextBestView and diagnostics of version {scene.version}.</p>
            <button className="btn-secondary w-full" onClick={sceneJson}><FileJson size={15} />Download scene.json</button>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="card-title flex items-center gap-1.5"><Ruler size={15} />Metric scale</div>
          <p className="text-[12.5px] text-ink-mute">A video alone does not reveal real sizes (Structure-from-Motion is up to scale). Enter the real length
            of one wall to express the reconstruction in metres.</p>
          <div className="text-[12.5px]">Current: {scale?.meters_per_unit
            ? <span className="text-ok font-medium">calibrated ({scale.reference}; 1 unit = {scale.meters_per_unit.toFixed(4)} m)</span>
            : <span className="text-warn font-medium">unknown — lengths are in reconstruction units</span>}</div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-ink-soft">Wall
              <select className="input block mt-1" value={wall} onChange={(e) => setWall(e.target.value)}>
                {walls.map((w) => <option key={w.id} value={w.id}>{w.id} ({lengthLabel(w.size[0], scale)}{w.measured ? '' : ', inferred'})</option>)}
              </select></label>
            <label className="text-[12px] text-ink-soft">Real length (m)
              <input className="input block mt-1 w-32" type="number" min="0.1" step="0.01" value={length} onChange={(e) => setLength(e.target.value)} /></label>
            <button className="btn-primary" disabled={!wall || !(Number(length) > 0)} onClick={calibrate}>Set scale</button>
            {scale?.meters_per_unit && <button className="btn-ghost" onClick={clear}>Clear</button>}
          </div>
          {walls.find((w) => w.id === wall && !w.measured) && <p className="text-[12px] text-warn">This wall's position is inferred, so its length is only a bound: prefer a measured wall.</p>}
          {msg && <p className={`text-[12.5px] ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
        </div>
      </div>
    </div>
  )
}
