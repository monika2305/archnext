import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Replace, Upload, X } from 'lucide-react'

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

export default function UploadView({ file, preview, status, error, result, onFile, onGenerate, onOpen }) {
  const input = useRef(null)
  const [drag, setDrag] = useState(false)
  const [localError, setLocalError] = useState('')
  const processing = status === 'processing'
  const secs = useTicker(processing)

  const pick = (f) => {
    if (!f) return
    if (!ACCEPT.includes(f.type)) return setLocalError('Use a PNG, JPG or WebP image.')
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
    <input ref={input} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden"
           onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
  )

  if (!file) {
    return (
      <div className="h-full grid place-items-center p-8">
        <div className="w-full max-w-3xl">
          <h1 className="text-[28px] font-semibold tracking-tight text-center">Turn a floor plan into 3D</h1>
          <p className="text-[14px] text-ink-mute text-center mt-1.5 mb-7">Every Line Becomes a Space.</p>
          <div {...dropProps} onClick={() => input.current?.click()}
            className={`cursor-pointer rounded-3xl border-2 border-dashed h-[52vh] min-h-[300px] grid place-items-center text-center transition-all
              ${drag ? 'border-accent bg-accent-soft/60 scale-[1.01]' : 'border-line bg-white hover:border-accent/50 hover:bg-accent-soft/20'}`}>
            <div>
              <div className="w-16 h-16 rounded-2xl bg-accent text-white grid place-items-center mx-auto mb-5 shadow-float">
                <Upload size={26} strokeWidth={1.8} />
              </div>
              <div className="text-[16px] font-medium">Drop your floor plan here</div>
              <div className="text-[13px] text-ink-mute mt-1">or <span className="text-accent font-medium">browse</span> · PNG, JPG, WebP</div>
            </div>
          </div>
          {fileInput}
          {localError && <p className="mt-3 text-[12.5px] text-bad flex items-center justify-center gap-1.5"><AlertTriangle size={14} />{localError}</p>}
        </div>
      </div>
    )
  }

  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(secs / 2))]
  return (
    <div className="h-full p-6 flex flex-col items-center gap-5 min-h-0" {...dropProps}>
      <div className={`card relative flex-1 min-h-0 w-full max-w-5xl overflow-hidden blueprint-bg ${drag ? 'ring-2 ring-accent' : ''}`}>
        <img src={preview} alt="Uploaded floor plan" className="absolute inset-0 m-auto max-w-[calc(100%-48px)] max-h-[calc(100%-48px)] object-contain bg-white shadow-card rounded" />
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
              : status === 'error' ? <><RefreshCw size={16} />Try again</> : <>Generate 3D <ArrowRight size={16} /></>}
          </button>
        )}
        {status === 'error' && <p className="text-[12.5px] text-bad flex items-center gap-1.5"><AlertTriangle size={14} />{error}</p>}
        {localError && <p className="text-[12.5px] text-bad">{localError}</p>}
      </div>
    </div>
  )
}
