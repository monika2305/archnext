import { useMemo, useState } from 'react'
import { Database, Download, Eye, Footprints, Orbit, RotateCcw, ScanEye, Sparkles, Video, Wand2 } from 'lucide-react'
import SceneViewer from '../components/SceneViewer.jsx'
import { modeB } from '../api.js'
import { completionStats } from '../lib/shell.js'

// 3D Room: the reconstruction is the hero. Two lightweight controls: X-Ray Honesty and Show Completed Region.

function InputFrames({ data }) {
  const m = data.manifests?.frames
  if (!m?.keyframes?.length) return null
  const pick = m.keyframes.filter((_, k) => k % Math.max(1, Math.round(m.keyframes.length / 6)) === 0).slice(0, 6)
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

const pct = (v) => `${Math.round(100 * v)}%`
const SW = { observed: '#10B981', uncertain: '#F59E0B', generated: '#8B5CF6' }

export default function SceneView({ data, scene }) {
  const rgbd = scene.kind === 'rgbd'
  const hasShell = (scene.surfaces?.length || 0) > 0
  const stats = useMemo(() => completionStats(scene.surfaces), [scene.surfaces])
  const [xray, setXray] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [geometry, setGeometry] = useState('hybrid')          // RGB-D: hybrid (points + shell) | points | mesh
  const [walk, setWalk] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const meshUrl = rgbd && scene.mesh ? `/api/mode-b/projects/${data.project.id}/mesh.glb?version=${scene.version}` : null
  const hybrid = { xray, completed, showGaps: xray, geometry: rgbd ? geometry : 'hybrid' }   // no outlines in Normal 3D
  const shellOn = !rgbd || geometry !== 'points'
  const hybridProp = shellOn && hasShell ? hybrid : null

  return (
    <div className="h-full p-4 flex flex-col gap-3 min-h-0">
      <div className="card px-2 py-1.5 flex items-center gap-1.5 flex-wrap">
        <span className={`chip ${rgbd ? 'bg-accent-soft text-accent-dark' : 'bg-ok/10 text-ok'}`} data-testid="source-label">
          {rgbd ? <><Database size={12} />RGB-D sensor demo — depth camera + recorded poses</> : <><Video size={12} />Ordinary video (video-only reconstruction)</>}
        </span>
        {hasShell && (
          <>
            <span className="w-px h-5 bg-line mx-1" />
            <div className="seg" role="group" aria-label="Honesty view">
              <button data-active={!xray} onClick={() => setXray(false)}><Eye size={13} />Normal 3D</button>
              <button data-active={xray} onClick={() => setXray(true)}><ScanEye size={13} />X-Ray Honesty</button>
            </div>
            <button className={completed ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} disabled={!stats.available}
                    title={stats.available ? 'Reveal the precomputed structural completion (generated geometry)' : 'No unseen structural region to complete'}
                    onClick={() => setCompleted((v) => !v)}>
              <Wand2 size={14} />{completed ? 'Back to before' : 'Show completed region'}
            </button>
          </>
        )}
        {rgbd && (
          <div className="seg" role="group" aria-label="Geometry">
            {[['hybrid', 'Hybrid room'], ['points', 'Points'], ...(scene.mesh ? [['mesh', 'Mesh (experimental)']] : [])].map(([k, l]) => (
              <button key={k} data-active={geometry === k} onClick={() => setGeometry(k)}>{l}</button>))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <div className="seg">
            <button data-active={!walk} onClick={() => setWalk(false)}><Orbit size={13} />Orbit</button>
            <button data-active={walk} onClick={() => setWalk(true)} title="Drag to look, W A S D to move"><Footprints size={13} />Walk</button>
          </div>
          <button className="icon-btn" onClick={() => setResetKey((k) => k + 1)} title="Reset view"><RotateCcw size={15} /></button>
          <a className="btn-secondary btn-sm" href={modeB.glbUrl(data.project.id, scene.version, 'all')} download title="Download the 3D scene as GLB"><Download size={14} />GLB</a>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid gap-3 lg:grid-cols-[1fr_260px]">
        <div className="relative min-h-[320px] rounded-2xl overflow-hidden border border-line" style={{ background: '#EFECE6' }}>
          <SceneViewer scene={scene} show={{ cameras: false, grid: false, nbv: false, points: true }} walk={walk} resetKey={resetKey}
                       hybrid={hybridProp} meshUrl={meshUrl} rgbdView={null} />

          {hybridProp && (
            <div className="absolute left-3 bottom-3 glass rounded-xl px-3 py-2 text-[12px] space-y-1 max-w-[290px]" data-testid="legend">
              {xray ? (
                <>
                  {['observed', 'uncertain', ...(completed ? ['generated'] : [])].map((k) => (
                    <div key={k} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: SW[k] }} />
                      <span className="capitalize">{k}</span><span className="ml-auto tabular-nums text-ink-soft">{pct(stats.shares[k])}</span></div>))}
                  <div className="text-[11px] text-ink-mute pt-0.5">Share of room-shell area{rgbd ? '; furniture points are all measured' : ''}</div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm bg-[#ECE7DF] border border-line" />Room structure with evidence</div>
                  <div className="flex items-center gap-2"><Sparkles size={11} className="text-ink-mute" />{rgbd ? 'Measured furniture (depth sensor)' : 'Reconstructed points (video)'}</div>
                  {completed && <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: SW.generated }} />Generated completion</div>}
                  {!completed && stats.available && <div className="flex items-center gap-2 text-ink-mute">{stats.gaps.length} unseen region{stats.gaps.length === 1 ? '' : 's'} left open</div>}
                </>
              )}
            </div>
          )}

          {hybridProp && stats.available && (
            <div className="absolute right-3 top-3 glass rounded-xl px-3 py-2 text-[12px] w-[230px]" data-testid="completion-card">
              <div className="flex items-center gap-1.5 font-medium mb-1"><Wand2 size={13} className="text-[#7C3AED]" />{completed ? 'After completion' : 'Before completion'}</div>
              <div className="flex justify-between"><span className="text-ink-soft">Room shell with evidence</span><span className="tabular-nums">{pct(stats.before)}</span></div>
              <div className="flex justify-between"><span className="text-ink-soft">Unseen gaps {completed ? 'completed' : 'open'}</span><span className="tabular-nums">{stats.gaps.length}</span></div>
              {completed && <div className="text-[11px] text-ink-mute mt-1">{pct(stats.generatedShare)} of the shell is generated (planar walls / floor / ceiling extended to their intersections) — not observed.</div>}
            </div>
          )}
          {walk && <div className="absolute right-3 bottom-3 glass rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft">Drag to look · W A S D to move</div>}
        </div>

        <aside className="card p-3.5 overflow-auto scrollbar-thin space-y-3 min-h-0 text-[12.5px]">
          <div className="text-ink-soft leading-snug">
            {rgbd ? 'Built from the TUM dataset\'s depth-sensor images and recorded camera poses. Not video-only reconstruction.'
              : 'Built from ordinary video only: camera poses and 3D points estimated by COLMAP; room structure fitted to them.'}
          </div>
          {!hasShell && <div className="text-ink-mute">No room structure was estimated for this reconstruction; only measured points are shown.</div>}
          <InputFrames data={data} />
        </aside>
      </div>
    </div>
  )
}
