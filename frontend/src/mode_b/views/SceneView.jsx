import { useEffect, useState } from 'react'
import { Camera, Footprints, Grid3x3, Orbit, RotateCcw, Sparkles, SplitSquareHorizontal } from 'lucide-react'
import SceneViewer from '../components/SceneViewer.jsx'
import EvidencePanel, { ClassBar, Legend } from '../components/EvidencePanel.jsx'
import { modeB } from '../api.js'
import { DISPLAY_MODES } from '../lib/trust.js'

export default function SceneView({ data, scene, selection, onSelect }) {
  const [mode, setMode] = useState('complete')
  const [show, setShow] = useState({ points: true, cameras: true, grid: true, nbv: true })
  const [walk, setWalk] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [compare, setCompare] = useState(null)       // earlier version's scene for before/after
  const versions = data.project.versions.map((v) => v.version).filter((v) => v !== scene.version)
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }))

  useEffect(() => { setCompare(null) }, [scene.version])
  const openCompare = async (v) => setCompare(v ? await modeB.scene(data.project.id, v) : null)

  const viewer = (sc, label) => (
    <div className="relative h-full min-h-0 rounded-2xl overflow-hidden border border-line bg-white">
      {label && <div className="absolute top-2 left-2 z-10 glass rounded-lg px-2.5 h-7 flex items-center text-[12px] font-medium">{label}</div>}
      <SceneViewer scene={sc} mode={mode} show={show} selection={selection} onSelect={onSelect} walk={walk} resetKey={resetKey} />
      {label && sc.summary && <div className="absolute bottom-2 left-2 right-2 z-10 glass rounded-lg px-2.5 py-1.5"><ClassBar shares={sc.summary.shares} /></div>}
    </div>
  )

  return (
    <div className="h-full p-4 flex flex-col gap-3 min-h-0">
      <div className="card px-2 py-1.5 flex items-center gap-1.5 flex-wrap">
        <div className="seg" role="group" aria-label="Display">
          {DISPLAY_MODES.map((m) => <button key={m.key} data-active={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>)}
        </div>
        <span className="w-px h-5 bg-line mx-1" />
        <button className="toggle-chip" data-on={show.points} onClick={() => toggle('points')}><Sparkles size={13} />Points</button>
        <button className="toggle-chip" data-on={show.cameras} onClick={() => toggle('cameras')}><Camera size={13} />Camera path</button>
        <button className="toggle-chip" data-on={show.grid} onClick={() => toggle('grid')}><Grid3x3 size={13} />Cells</button>
        {scene.nbv?.recommendations?.length > 0 && <button className="toggle-chip" data-on={show.nbv} onClick={() => toggle('nbv')}><Camera size={13} />NextBestView</button>}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="seg">
            <button data-active={!walk} onClick={() => setWalk(false)}><Orbit size={13} />Orbit</button>
            <button data-active={walk} onClick={() => setWalk(true)} title="Drag to look, W A S D to move"><Footprints size={13} />Walk</button>
          </div>
          <button className="icon-btn" onClick={() => setResetKey((k) => k + 1)} title="Reset camera"><RotateCcw size={15} /></button>
          {versions.length > 0 && (
            <label className="flex items-center gap-1.5 text-[12px] text-ink-soft"><SplitSquareHorizontal size={14} />
              <select className="input h-8 text-[12px]" value={compare?.version ?? ''} onChange={(e) => openCompare(e.target.value ? Number(e.target.value) : null)}>
                <option value="">No comparison</option>
                {versions.map((v) => <option key={v} value={v}>Compare with version {v}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className={`min-h-[320px] grid gap-3 ${compare ? 'md:grid-cols-2' : ''}`}>
          {compare && viewer(compare, `Before · version ${compare.version}`)}
          {viewer(scene, compare ? `After · version ${scene.version}` : null)}
        </div>
        <aside className="card p-4 overflow-auto scrollbar-thin space-y-4 min-h-0">
          <Legend mode={mode} />
          <EvidencePanel scene={scene} projectId={data.project.id} selection={selection} scale={data.project.scale} />
          {walk && <p className="text-[11.5px] text-ink-mute">Walk mode: drag to look around, W A S D or arrow keys to move.</p>}
        </aside>
      </div>
    </div>
  )
}
