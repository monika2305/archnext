import { useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, ChevronDown, Film, Loader2, Settings2, Upload, X } from 'lucide-react'
import { TRUST_CLASSES } from '../lib/trust.js'

const DEFAULTS = { sample_fps: 4, max_keyframes: 90, min_motion: 0.025, blur_ratio: 0.45, completion: true }
const FIELDS = [
  ['sample_fps', 'Frames sampled per second', 1, 10, 0.5],
  ['max_keyframes', 'Maximum keyframes', 12, 200, 1],
  ['min_motion', 'Minimum motion between keyframes (fraction of image diagonal)', 0.005, 0.15, 0.005],
  ['blur_ratio', 'Blur rejection (fraction of median sharpness)', 0.1, 0.9, 0.05],
]
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i

export default function OverviewView({ projects, onOpen, onUploaded, worker }) {
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [settings, setSettings] = useState(DEFAULTS)
  const [showSettings, setShowSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)

  const pick = (f) => {
    if (!f) return
    if (!VIDEO.test(f.name)) return setError('Choose a video file (MP4 recommended; MOV, WebM and AVI also work).')
    if (f.size > 400 * 1024 * 1024) return setError('The video is larger than 400 MB. Trim or compress it.')
    setError('')
    setFile(f)
  }
  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await onUploaded(file, settings)
      if (r) setFile(null)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const workerProblem = worker && !worker.ok

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-6 lg:p-8 grid lg:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-5 min-w-0">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">Turn a room video into 3D</h1>
            <p className="text-[14px] text-ink-mute mt-1">Walk slowly around the room while filming. ArchNext estimates the camera path,
              reconstructs the surfaces it actually saw and marks everything it had to assume.</p>
          </div>

          {workerProblem && (
            <div className="card px-4 py-3 text-[12.5px] text-bad flex gap-2" role="alert"><AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>The Mode B reconstruction environment is not available ({worker.error || `missing: ${(worker.missing || []).join(', ')}`}).
                See backend/mode_b/README.md to set it up.</span></div>
          )}

          <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
               onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) }}
               onClick={() => !file && input.current?.click()}
               className={`rounded-3xl border-2 border-dashed min-h-[240px] grid place-items-center text-center transition-all p-6
                 ${file ? 'border-line bg-white' : 'cursor-pointer'}
                 ${drag ? 'border-accent bg-accent-soft/60' : file ? '' : 'border-line bg-white hover:border-accent/50 hover:bg-accent-soft/20'}`}>
            {!file ? (
              <div>
                <div className="w-16 h-16 rounded-2xl bg-accent text-white grid place-items-center mx-auto mb-5 shadow-float"><Upload size={26} strokeWidth={1.8} /></div>
                <div className="text-[16px] font-medium">Drop your room walkthrough video here</div>
                <div className="text-[13px] text-ink-mute mt-1">or <span className="text-accent font-medium">browse</span> · MP4 (H.264) recommended · 2 s – 5 min · up to 400 MB</div>
              </div>
            ) : (
              <div className="w-full max-w-md">
                <div className="flex items-center gap-3 text-left">
                  <div className="w-11 h-11 rounded-xl bg-accent-soft text-accent grid place-items-center shrink-0"><Film size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium truncate" title={file.name}>{file.name}</div>
                    <div className="text-[12px] text-ink-mute">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
                  </div>
                  {!busy && <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setFile(null) }} title="Remove"><X size={15} /></button>}
                </div>
                <button className="btn-primary btn-lg w-full mt-5" onClick={start} disabled={busy || workerProblem}>
                  {busy ? <><Loader2 size={16} className="animate-spin" />Uploading…</> : <>Reconstruct room <ArrowRight size={16} /></>}
                </button>
              </div>
            )}
          </div>
          <input ref={input} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi" className="hidden"
                 onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
          {error && <p className="text-[12.5px] text-bad flex items-center gap-1.5" role="alert"><AlertTriangle size={14} />{error}</p>}

          <div className="card">
            <button className="w-full px-4 py-3 flex items-center gap-2 text-[13px] font-medium" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 size={15} className="text-ink-mute" />Processing settings
              <ChevronDown size={15} className={`ml-auto text-ink-mute transition-transform ${showSettings ? 'rotate-180' : ''}`} />
            </button>
            {showSettings && (
              <div className="px-4 pb-4 grid sm:grid-cols-2 gap-x-5 gap-y-3 fade-in">
                {FIELDS.map(([k, label, min, max, step]) => (
                  <label key={k} className="text-[12px] text-ink-soft">
                    <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-ink">{settings[k]}</span></span>
                    <input type="range" min={min} max={max} step={step} value={settings[k]} className="w-full accent-[#3F6A8F]"
                           onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) })} />
                  </label>
                ))}
                <label className="sm:col-span-2 flex items-center gap-2 text-[12.5px] text-ink-soft">
                  <input type="checkbox" checked={settings.completion} onChange={(e) => setSettings({ ...settings, completion: e.target.checked })} />
                  VisionTrust completion of unseen room regions (off = observed geometry only)
                </label>
                <button className="btn-ghost btn-sm w-fit" onClick={() => setSettings(DEFAULTS)}>Reset to defaults</button>
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            {Object.entries(TRUST_CLASSES).map(([k, c]) => (
              <div key={k} className="card px-4 py-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />{c.label}</div>
                <p className="text-[12px] text-ink-mute mt-1 leading-snug">{c.description}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <div className="card-title mb-2">Recording tips</div>
            <ul className="text-[12.5px] text-ink-soft space-y-1.5 list-disc pl-4">
              <li>Move the camera sideways along the walls instead of only turning on the spot.</li>
              <li>Keep consecutive views overlapping; walk slowly to avoid motion blur.</li>
              <li>Include the floor and the room corners; turn the lights on.</li>
              <li>Plain white walls give few features: include edges, doors and furniture in view.</li>
            </ul>
          </div>
          <div className="card">
            <div className="px-4 pt-3 pb-2 card-title">Projects</div>
            {projects.length === 0 && <p className="px-4 pb-4 text-[12.5px] text-ink-mute">No room videos reconstructed yet.</p>}
            <ul className="divide-y divide-line">
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="w-full text-left px-4 py-2.5 hover:bg-paper transition-colors" onClick={() => onOpen(p.id)}>
                    <div className="text-[13px] font-medium truncate">{p.name}</div>
                    <div className="text-[11.5px] text-ink-mute flex items-center gap-1.5">
                      <StateDot state={p.state} />{stateLabel(p)} · {p.created.replace('T', ' ').slice(0, 16)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  )
}

const stateLabel = (p) => (p.state === 'done' ? (p.versions ? `${p.versions} version${p.versions > 1 ? 's' : ''}` : 'Keyframes only')
  : { running: 'Processing', queued: 'Queued', failed: 'Failed', cancelled: 'Cancelled' }[p.state] || 'Idle')

export function StateDot({ state }) {
  const c = { done: 'bg-ok', running: 'bg-accent animate-pulse', queued: 'bg-accent', failed: 'bg-bad', cancelled: 'bg-ink-mute' }[state] || 'bg-ink-mute/40'
  return <span className={`w-1.5 h-1.5 rounded-full ${c}`} />
}
