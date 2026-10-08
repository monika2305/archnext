import { useRef, useState } from 'react'
import { AlertTriangle, Camera, Compass, Loader2, Upload } from 'lucide-react'
import SceneViewer from '../components/SceneViewer.jsx'
import { ClassBar } from '../components/EvidencePanel.jsx'
import { TRUST_CLASSES } from '../lib/trust.js'

// NextBestView: evidence-based guidance for the next recording, and the upload of that footage.
export default function NextBestViewView({ data, scene, onExtend, busy }) {
  const rec = scene.nbv
  const [rank, setRank] = useState(1)
  const [file, setFile] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const input = useRef(null)
  const cur = rec.recommendations.find((r) => r.rank === rank)
  const cmp = scene.comparison

  const send = async () => {
    setSending(true)
    setError('')
    try { await onExtend(file); setFile(null) } catch (e) { setError(e.message) } finally { setSending(false) }
  }

  return (
    <div className="h-full p-4 grid gap-4 lg:grid-cols-[1fr_380px] min-h-0">
      <div className="relative min-h-[320px] rounded-2xl overflow-hidden border border-line bg-white">
        <SceneViewer scene={scene} mode="complete" show={{ points: false, cameras: true, grid: true, nbv: true }} nbvRank={rank} />
        <div className="absolute top-2 left-2 glass rounded-lg px-2.5 h-7 flex items-center gap-1.5 text-[12px] font-medium"><Camera size={13} className="text-cyan-600" />Recommended viewpoint</div>
      </div>
      <aside className="space-y-4 overflow-auto scrollbar-thin min-h-0">
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2"><Compass size={16} className="text-accent" /><div className="card-title">NextBestView</div>
            {rec.mode === 'direction' && <span className="chip bg-warn/10 text-warn">direction only</span>}
            {rec.mode === 'position' && <span className="chip bg-ok/10 text-ok">position + direction</span>}</div>
          {!cur && <p className="text-[12.5px] text-ink-mute">{rec.reason}</p>}
          {cur && (
            <>
              <p className="text-[13.5px] leading-relaxed">{cur.text}</p>
              {rec.reason && <p className="text-[12px] text-warn flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{rec.reason}</p>}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-paper p-2.5"><div className="text-[18px] font-semibold tabular-nums">{Math.round(100 * cur.newly_seen_share)}%</div>
                  <div className="text-[11px] text-ink-mute">of the room shell would enter the view</div></div>
                <div className="rounded-xl bg-paper p-2.5"><div className="text-[18px] font-semibold tabular-nums">{Math.round(100 * cur.gain_share)}%</div>
                  <div className="text-[11px] text-ink-mute">of the weighted uncertainty addressed</div></div>
              </div>
              <div>
                <div className="label mb-1">Regions this view covers</div>
                <ul className="text-[12.5px] space-y-1">
                  {cur.covers.slice(0, 5).map((c) => (
                    <li key={c.surface} className="flex justify-between gap-2"><span className="first-letter:uppercase">{c.name}</span>
                      <span className="text-ink-mute tabular-nums">{c.generated > 0 && <span style={{ color: TRUST_CLASSES.generated.color }}>{c.generated} generated </span>}
                        {c.uncertain > 0 && <span style={{ color: TRUST_CLASSES.uncertain.color }}>{c.uncertain} uncertain</span>}</span></li>))}
                </ul>
              </div>
              {rec.recommendations.length > 1 && (
                <div className="seg">{rec.recommendations.map((r) => <button key={r.rank} data-active={r.rank === rank} onClick={() => setRank(r.rank)}>Option {r.rank}</button>)}</div>)}
              <p className="text-[11.5px] text-ink-mute">{rec.candidates_evaluated} candidate viewpoints evaluated at {rec.positions_valid} free positions
                ({rec.rejected?.obstacle || 0} rejected as occupied). {rec.method}.</p>
            </>
          )}
        </div>

        <div className="card p-4 space-y-3">
          <div className="card-title">Add footage</div>
          <p className="text-[12.5px] text-ink-mute">Record a short clip following the recommendation, starting from a spot you already filmed so it can
            be aligned. A new version is created; the current one is kept for comparison.</p>
          <div onClick={() => input.current?.click()} className="rounded-xl border-2 border-dashed border-line hover:border-accent/50 cursor-pointer p-4 text-center text-[12.5px]">
            {file ? <span className="font-medium">{file.name}</span> : <span className="text-ink-mute"><Upload size={15} className="inline mr-1.5" />Choose additional video</span>}
          </div>
          <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = '' }} />
          <button className="btn-primary w-full" disabled={!file || sending || busy} onClick={send}>
            {sending ? <><Loader2 size={15} className="animate-spin" />Uploading…</> : 'Update reconstruction'}</button>
          {busy && <p className="text-[12px] text-ink-mute">A job is running for this project.</p>}
          {error && <p className="text-[12.5px] text-bad" role="alert">{error}</p>}
        </div>

        {cmp && (
          <div className="card p-4 space-y-2 text-[12.5px]">
            <div className="card-title">Version {cmp.previous_version} → {scene.version}</div>
            {cmp.before && <div><div className="text-ink-mute mb-1">Before</div><ClassBar shares={cmp.before.shares} /></div>}
            {cmp.after && <div><div className="text-ink-mute mb-1">After</div><ClassBar shares={cmp.after.shares} /></div>}
            {cmp.before && cmp.after && Object.keys(TRUST_CLASSES).map((k) => (
              <div key={k} className="flex justify-between"><span>{TRUST_CLASSES[k].label}</span>
                <span className="tabular-nums">{Math.round(100 * cmp.before.shares[k])}% → {Math.round(100 * cmp.after.shares[k])}%</span></div>))}
          </div>
        )}
      </aside>
    </div>
  )
}
