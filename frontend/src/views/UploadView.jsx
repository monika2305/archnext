import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, FileClock, Loader2, PencilRuler, RefreshCw, Replace, Upload, X } from 'lucide-react'
import { formatTime } from '../lib/session.js'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']
const STAGES = ['Reading the drawing', 'Finding walls, rooms and openings', 'Checking structure', 'Measuring real sizes']

function useTicker(active) {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!active) { setS(0); return undefined }
    const t = setInterval(() => setS((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [active])
  return s
}

// Autosaved plans the user can reopen (newest first; the one this browser used last first).
function ContinueList({ result, offers, onReopen, restoring, restoreNote, onContinue, onOpen }) {
  if (!result && !offers.length && !restoring && !restoreNote) return null
  return (
    <div className="mt-5 space-y-2" data-testid="continue">
      {restoring && !result && (
        <div className="card px-4 py-3 flex items-center gap-2.5 text-[13px]">
          <Loader2 size={16} className="animate-spin text-accent" />Restoring your last session…
        </div>
      )}
      {restoreNote && <p className="text-[12.5px] text-bad flex items-center gap-1.5"><AlertTriangle size={14} />{restoreNote}</p>}
      {result && (
        <div className="card px-4 py-3 flex items-center gap-3">
          <PencilRuler size={18} className="text-accent shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium truncate">Open plan: {result.filename}</div>
            <div className="text-[12px] text-ink-mute">{result.geometry.corrected.rooms.length} rooms
              {result.autosave?.ok ? ` · autosaved ${formatTime(result.autosave.saved_at)}` : ''}</div>
          </div>
          <button className="btn-secondary btn-sm" onClick={onOpen}>Analysis</button>
          <button className="btn-primary btn-sm" onClick={onContinue}>Continue editing <ArrowRight size={14} /></button>
        </div>
      )}
      {offers.length > 0 && (
        <div className="card divide-y divide-line">
          <div className="px-4 py-2.5 text-[12px] font-medium text-ink-mute flex items-center gap-1.5">
            <FileClock size={14} />{result ? 'Other recent plans' : 'Continue where you left off'} · autosaved on this computer
          </div>
          {offers.map((s) => (
            <div key={s.id} className="px-4 py-2.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{s.filename || 'Plan'}</div>
                <div className="text-[12px] text-ink-mute">
                  {s.edits ? `${s.edits} edit${s.edits === 1 ? '' : 's'}` : 'No edits'} · {s.rooms} rooms · saved {formatTime(s.saved_at)}
                </div>
              </div>
              <button className="btn-secondary btn-sm" onClick={() => onReopen(s.id)} disabled={!!restoring}>
                {restoring === s.id ? <Loader2 size={14} className="animate-spin" /> : null}Reopen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function UploadView({ file, preview, status, error, result, onFile, onGenerate, onOpen,
                                     offers = [], onReopen, restoring, restoreNote, onContinue }) {
  const input = useRef(null)
  const [drag, setDrag] = useState(false)
  const [localError, setLocalError] = useState('')
  const processing = status === 'processing'
  const secs = useTicker(processing)

  const pick = (f) => {
    if (!f) return
    const project = f.name.toLowerCase().endsWith('.json')
    if (!project && !ACCEPT.includes(f.type)) return setLocalError('Use a PNG, JPG or WebP image, or an .archnext.json project.')
    if (f.size > 25 * 1024 * 1024) return setLocalError('Max file size is 25 MB.')
    setLocalError('')
    onFile(f)
  }
  const dropProps = {
    onDragOver: (e) => { e.preventDefault(); setDrag(true) },
    onDragLeave: () => setDrag(false),
    onDrop: (e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) },
  }
  const fileInput = (
    <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp,.json" className="hidden"
           onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
  )

  if (!file) {
    return (
      <div className="h-full overflow-auto"><div className="min-h-full grid place-items-center p-8">
        <div className="w-full max-w-3xl">
          <h1 className="text-[28px] font-semibold tracking-tight text-center">Turn a floor plan into 3D</h1>
          <p className="text-[14px] text-ink-mute text-center mt-1.5 mb-7">Every Line Becomes a Space.</p>
          <div {...dropProps} onClick={() => input.current?.click()}
            className={`cursor-pointer rounded-3xl border-2 border-dashed ${result || offers.length ? 'h-[34vh] min-h-[220px]' : 'h-[52vh] min-h-[300px]'} grid place-items-center text-center transition-all
              ${drag ? 'border-accent bg-accent-soft/60 scale-[1.01]' : 'border-line bg-white hover:border-accent/50 hover:bg-accent-soft/20'}`}>
            <div>
              <div className="w-16 h-16 rounded-2xl bg-accent text-white grid place-items-center mx-auto mb-5 shadow-float">
                <Upload size={26} strokeWidth={1.8} />
              </div>
              <div className="text-[16px] font-medium">Drop your floor plan here</div>
              <div className="text-[13px] text-ink-mute mt-1">or <span className="text-accent font-medium">browse</span> · PNG, JPG, WebP · or a saved .archnext.json project</div>
            </div>
          </div>
          {fileInput}
          {localError && <p className="mt-3 text-[12.5px] text-bad flex items-center justify-center gap-1.5"><AlertTriangle size={14} />{localError}</p>}
          <ContinueList result={result} offers={offers} onReopen={onReopen} restoring={restoring} restoreNote={restoreNote}
                        onContinue={onContinue} onOpen={onOpen} />
        </div>
      </div></div>
    )
  }

  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(secs / 2))]
  return (
    <div className="h-full p-6 flex flex-col items-center gap-5 min-h-0" {...dropProps}>
      <div className={`card relative flex-1 min-h-0 w-full max-w-5xl overflow-hidden blueprint-bg ${drag ? 'ring-2 ring-accent' : ''}`}>
        {file.name.toLowerCase().endsWith('.json')
          ? <div className="absolute inset-0 grid place-items-center text-center"><div className="glass rounded-2xl px-6 py-5">
              <div className="text-[14px] font-medium">Saved ArchNext project</div>
              <div className="text-[12.5px] text-ink-mute mt-1">Your edited building will reopen exactly as saved.</div></div></div>
          : <img src={preview} alt="Uploaded floor plan" className="absolute inset-0 m-auto max-w-[calc(100%-48px)] max-h-[calc(100%-48px)] object-contain bg-white shadow-card rounded" />}
        <div className="absolute top-3 left-3 right-3 flex items-center gap-2">
          <span className="glass rounded-lg px-2.5 h-8 flex items-center text-[12.5px] font-medium max-w-[50%] truncate" title={file.name}>{file.name}</span>
          {!processing && (
            <div className="ml-auto flex gap-1.5">
              <button className="glass icon-btn" onClick={() => input.current?.click()} title="Choose another image"><Replace size={15} /></button>
              <button className="glass icon-btn" onClick={() => onFile(null)} title="Remove"><X size={15} /></button>
            </div>
          )}
        </div>
        {processing && (
          <div className="absolute inset-0 bg-white/55 backdrop-blur-[1px] grid place-items-center fade-in">
            <div className="glass rounded-2xl px-6 py-5 text-center min-w-[280px]">
              <Loader2 size={26} className="animate-spin text-accent mx-auto" />
              <div className="text-[14px] font-medium mt-3">{stage}…</div>
              <div className="text-[12px] text-ink-mute mt-0.5 tabular-nums">{secs}s</div>
            </div>
          </div>
        )}
      </div>
      {fileInput}

      <div className="flex flex-col items-center gap-2 pb-2">
        {status === 'ready' && result ? (
          <button className="btn-primary btn-lg" onClick={onOpen}>Open analysis <ArrowRight size={16} /></button>
        ) : (
          <button className="btn-primary btn-lg min-w-[220px]" onClick={onGenerate} disabled={processing}>
            {processing ? <><Loader2 size={16} className="animate-spin" />Generating…</>
              : status === 'error' ? <><RefreshCw size={16} />Try again</> : file.name.toLowerCase().endsWith('.json') ? <>Open project <ArrowRight size={16} /></> : <>Generate 3D <ArrowRight size={16} /></>}
          </button>
        )}
        {status === 'error' && <p className="text-[12.5px] text-bad flex items-center gap-1.5"><AlertTriangle size={14} />{error}</p>}
        {localError && <p className="text-[12.5px] text-bad">{localError}</p>}
      </div>
    </div>
  )
}
