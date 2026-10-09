import { useEffect, useState } from 'react'
import { Box, Camera, Database, Footprints, Grid3x3, Orbit, RotateCcw, ShieldCheck, Sparkles, SplitSquareHorizontal } from 'lucide-react'
import SceneViewer from '../components/SceneViewer.jsx'
import EvidencePanel, { ClassBar, Legend } from '../components/EvidencePanel.jsx'
import { modeB } from '../api.js'
import { DISPLAY_MODES } from '../lib/trust.js'

function InputFrames({ data }) {
  const m = data.manifests?.frames
  if (!m?.keyframes?.length) return null
  const pick = m.keyframes.filter((_, k) => k % Math.max(1, Math.round(m.keyframes.length / 8)) === 0).slice(0, 8)
  return (
    <div>
      <div className="label mb-1.5">Input frames</div>
      <div className="grid grid-cols-2 gap-1.5">
        {pick.map((f) => <img key={f.name} src={modeB.frameUrl(data.project.id, 'frames', f.name)} alt={`Input frame at ${f.time} s`}
                              title={`${f.time} s`} className="rounded-md border border-line aspect-[4/3] object-cover w-full" loading="lazy" />)}
      </div>
    </div>
  )
}

export default function SceneView({ data, scene, selection, onSelect }) {
  const [evidenceView, setEvidenceView] = useState(false)
  const [evidenceMode, setEvidenceMode] = useState('complete')
  const [show, setShow] = useState({ points: true, walls: true, cameras: false, grid: false, nbv: false })
  const [walk, setWalk] = useState(false)
  // RGB-D demo with a measured mesh: Complete room (mesh + generated shell cells) / Measured only / Evidence / Points
  const [rgbdView, setRgbdView] = useState(scene.kind === 'rgbd' && scene.mesh ? 'complete' : null)
  const meshUrl = scene.kind === 'rgbd' && scene.mesh ? `/api/mode-b/projects/${data.project.id}/mesh.glb?version=${scene.version}` : null
  const [resetKey, setResetKey] = useState(0)
  const [compare, setCompare] = useState(null)       // earlier version's scene for before/after
  const versions = data.project.versions.map((v) => v.version).filter((v) => v !== scene.version)
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }))

  const effectiveMode = scene.kind === 'rgbd' ? 'clean' : (evidenceView ? evidenceMode : 'clean')

  useEffect(() => { setCompare(null) }, [scene.version])
  const openCompare = async (v) => setCompare(v ? await modeB.scene(data.project.id, v) : null)

  const viewer = (sc, label) => (
    <div className="relative h-full min-h-0 rounded-2xl overflow-hidden border border-line bg-white">
      {label && <div className="absolute top-2 left-2 z-10 glass rounded-lg px-2.5 h-7 flex items-center text-[12px] font-medium">{label}</div>}
      <SceneViewer scene={sc} mode={effectiveMode} show={show} selection={selection} onSelect={onSelect} walk={walk} resetKey={resetKey}
                   rgbdView={sc === scene && sc.mesh ? rgbdView : null} meshUrl={sc === scene ? meshUrl : null} />
      {label && sc.summary && <div className="absolute bottom-2 left-2 right-2 z-10 glass rounded-lg px-2.5 py-1.5"><ClassBar shares={sc.summary.shares} /></div>}
    </div>
  )

  return (
    <div className="h-full p-4 flex flex-col gap-3 min-h-0">
      <div className="card px-2 py-1.5 flex items-center gap-1.5 flex-wrap">
        {scene.kind !== 'rgbd' && (
          <div className="seg" role="group" aria-label="Viewer style">
            <button
              data-active={!evidenceView}
              onClick={() => {
                setEvidenceView(false)
                setShow((s) => ({ ...s, grid: false, cameras: false, nbv: false }))
              }}
              title="Clean architectural 3D view without completion debug overlays"
            >
              <Box size={13} />Clean 3D
            </button>
            <button
              data-active={evidenceView}
              onClick={() => {
                setEvidenceView(true)
                setShow((s) => ({ ...s, grid: true }))
              }}
              title="Inspect VisionTrust observed, uncertain and generated regions"
            >
              <ShieldCheck size={13} />Evidence View
            </button>
          </div>
        )}

        {evidenceView && scene.kind !== 'rgbd' && (
          <div className="seg ml-1" role="group" aria-label="Evidence Display">
            {DISPLAY_MODES.map((m) => (
              <button
                key={m.key}
                data-active={evidenceMode === m.key}
                onClick={() => setEvidenceMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {scene.kind === 'rgbd' && scene.mesh && (
          <div className="seg" role="group" aria-label="RGB-D display">
            {[['complete', 'Complete room'], ['measured', 'Measured only'], ['evidence', 'Evidence view'], ['points', 'Points']].map(([k, l]) => (
              <button key={k} data-active={rgbdView === k} onClick={() => setRgbdView(k)}>{l}</button>))}
          </div>
        )}
        {scene.kind === 'rgbd' && (
          <span className="chip bg-accent-soft text-accent-dark ml-1">
            <Database size={12} />RGB-D sensor demo — depth camera + recorded poses, not video-only
          </span>
        )}

        <span className="w-px h-5 bg-line mx-1" />
        <button className="toggle-chip" data-on={show.points} onClick={() => toggle('points')}><Sparkles size={13} />Points</button>
        {scene.kind === 'rgbd' && (!scene.mesh || rgbdView === 'points') && <button className="toggle-chip" data-on={show.clean !== false} onClick={() => setShow((x) => ({ ...x, clean: x.clean === false }))} title="Hide points measured by only 2 frames (display only)">Hide noise</button>}
        {scene.surfaces?.length > 0 && scene.kind !== 'rgbd' && (
          <button className="toggle-chip" data-on={show.walls} onClick={() => toggle('walls')}><Box size={13} />Room layout</button>
        )}
        <button className="toggle-chip" data-on={show.cameras} onClick={() => toggle('cameras')}><Camera size={13} />Camera path</button>
        {evidenceView && (
          <button className="toggle-chip" data-on={show.grid} onClick={() => toggle('grid')}><Grid3x3 size={13} />Cells</button>
        )}
        {scene.nbv?.recommendations?.length > 0 && (
          <button className="toggle-chip" data-on={show.nbv} onClick={() => toggle('nbv')}><Camera size={13} />NextBestView</button>
        )}

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
          {scene.kind === 'rgbd' ? (
            <div className="space-y-2 text-[12.5px]" data-testid="rgbd-source">
              <div className="chip bg-accent-soft text-accent-dark"><Database size={12} />RGB-D sensor demo</div>
              <p className="text-ink-soft">{scene.source.note}</p>
              {scene.mesh && (
                <div className="space-y-1 text-[12px]" data-testid="rgbd-legend">
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-r from-amber-200 to-slate-400" />Measured surface: {scene.mesh.triangles.toLocaleString()} triangles from {scene.mesh.frames} depth frames</div>
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#8B5CF6]" />Generated: room shell where no frame saw the room (Complete room)</div>
                  <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#10B981]" /><span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B]" />Evidence view: observed / uncertain shell cells</div>
                </div>
              )}
              <div className="text-ink-mute">{scene.method.dense}. Depth: {scene.source.depth}; poses: {scene.source.poses}. Units: metres.</div>
              <div className="text-ink-mute">{scene.diagnostics.points_kept.toLocaleString()} points · room extent {scene.diagnostics.extent_m.join(' × ')} m</div>
            </div>
          ) : (
            <>
              {!evidenceView ? (
                <div className="space-y-3 text-[12.5px]">
                  <div className="card-title flex items-center gap-1.5">
                    <Box size={14} className="text-accent" />Reconstructed Room
                  </div>
                  <p className="text-ink-soft">
                    Reconstructed from video footage. Clean 3D view displays the room boundaries and 3D points without debug overlays.
                  </p>
                  <div className="p-2.5 rounded-lg bg-paper border border-line space-y-1.5 text-[12px]">
                    <div className="flex justify-between text-ink-soft">
                      <span>Room surfaces</span>
                      <span className="font-semibold text-ink">{scene.surfaces?.length || 0} (floor, walls, ceiling)</span>
                    </div>
                    <div className="flex justify-between text-ink-soft">
                      <span>Reconstructed points</span>
                      <span className="font-semibold text-ink">{((scene.points?.xyz?.length || 0) / 3).toLocaleString()}</span>
                    </div>
                    {scene.cameras?.length > 0 && (
                      <div className="flex justify-between text-ink-soft">
                        <span>Posed keyframes</span>
                        <span className="font-semibold text-ink">{scene.cameras.length}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-[11.5px] text-ink-mute">
                    Switch to <button onClick={() => { setEvidenceView(true); setShow((s) => ({ ...s, grid: true })); }} className="text-accent hover:underline font-medium cursor-pointer">Evidence View</button> to inspect VisionTrust cell classifications and confidence heatmap.
                  </div>
                </div>
              ) : (
                <>
                  <Legend mode={evidenceMode} />
                  <EvidencePanel scene={scene} projectId={data.project.id} selection={selection} scale={data.project.scale} />
                </>
              )}
            </>
          )}
          <InputFrames data={data} />
          {walk && <p className="text-[11.5px] text-ink-mute">Walk mode: drag to look around, W A S D or arrow keys to move.</p>}
        </aside>
      </div>
    </div>
  )
}
