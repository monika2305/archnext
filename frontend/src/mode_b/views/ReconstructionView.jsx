import { AlertTriangle, CheckCircle2, Circle, CircleSlash, Loader2, Square, XCircle } from 'lucide-react'
import { modeB } from '../api.js'
import { FRAME_STATUS, formatSeconds, isActive, summarize, timelineCounts } from '../lib/status.js'

const STATE_ICON = {
  done: <CheckCircle2 size={16} className="text-ok" />,
  running: <Loader2 size={16} className="text-accent animate-spin" />,
  failed: <XCircle size={16} className="text-bad" />,
  skipped: <CircleSlash size={16} className="text-ink-mute" />,
  pending: <Circle size={16} className="text-ink-mute/50" />,
}

export default function ReconstructionView({ data, onCancel, onScene }) {
  const { project, status, manifests } = data
  const sum = summarize(status)
  const frames = Object.entries(manifests || {})
  const sfm = (status?.stages || []).find((s) => s.key === 'sfm')?.diagnostics

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-5">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight truncate">{project.name}</h1>
            <p className="text-[12.5px] text-ink-mute">{project.videos.length} video{project.videos.length > 1 ? 's' : ''} ·
              {' '}{project.versions.length} reconstruction{project.versions.length === 1 ? '' : 's'}</p>
          </div>
          <div className="ml-auto flex gap-2">
            {isActive(status) && <button className="btn-secondary btn-sm" onClick={onCancel}><Square size={13} />Cancel</button>}
            {project.current_version != null && <button className="btn-primary btn-sm" onClick={onScene}>Open 3D scene</button>}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="card-title">{status.action === 'extend' ? 'Additional footage' : 'Processing'}</div>
            <span className={`chip ${sum.state === 'failed' ? 'bg-bad/10 text-bad' : sum.state === 'done' ? 'bg-ok/10 text-ok' : 'bg-accent-soft text-accent-dark'}`}>
              {{ done: 'Finished', failed: 'Stopped', running: 'Running', queued: 'Queued', cancelled: 'Cancelled' }[sum.state] || sum.state}</span>
            <span className="ml-auto text-[12px] tabular-nums text-ink-mute">{sum.pct}%</span>
          </div>
          <div className="h-1.5 bg-paper rounded-full mt-3 overflow-hidden" role="progressbar" aria-valuenow={sum.pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full transition-all ${sum.state === 'failed' ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${sum.pct}%` }} />
          </div>
          <ol className="mt-4 space-y-2.5" data-testid="stages">
            {(status.stages || []).map((s) => (
              <li key={s.key} className="flex gap-3" data-state={s.state}>
                <span className="mt-0.5">{STATE_ICON[s.state] || STATE_ICON.pending}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium flex items-center gap-2">{s.label}
                    {s.seconds != null && <span className="text-[11.5px] text-ink-mute font-normal tabular-nums">{formatSeconds(s.seconds)}</span>}</div>
                  {s.detail && <div className={`text-[12.5px] ${s.state === 'failed' ? 'text-bad' : 'text-ink-mute'}`}>{s.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
          {sum.state === 'failed' && status.error && (
            <div className="mt-4 rounded-xl bg-bad/5 border border-bad/20 px-3.5 py-3 text-[12.5px] text-bad flex gap-2" role="alert">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" /><span>{status.error}</span></div>
          )}
        </div>

        {sfm && <SfmDiagnostics d={sfm} />}

        {frames.map(([folder, m]) => <Keyframes key={folder} id={project.id} folder={folder} m={m} />)}
      </div>
    </div>
  )
}

function SfmDiagnostics({ d }) {
  const rows = [
    ['Input frames', d.input_frames], ['Registered frames', `${d.registered_frames} (${Math.round(100 * d.registered_ratio)}%)`],
    ['3D points', d.points], ['Mean track length', d.mean_track_length?.toFixed(2)],
    ['Reprojection error', d.reprojection_error_px != null ? `${d.reprojection_error_px.toFixed(2)} px` : '—'],
    ['Verified image pairs', d.verified_pairs], ['Mean inlier matches / pair', d.mean_inliers?.toFixed(0)],
    ['Models found', d.models], ['Time', formatSeconds(d.seconds)],
  ]
  return (
    <div className="card p-4">
      <div className="card-title mb-2">Camera pose diagnostics (COLMAP)</div>
      <div className="grid sm:grid-cols-3 gap-x-6 gap-y-1.5">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between text-[12.5px]"><span className="text-ink-mute">{k}</span><span className="tabular-nums">{v ?? '—'}</span></div>)}
      </div>
      {d.warnings?.length > 0 && <ul className="mt-3 text-[12.5px] text-warn space-y-1">{d.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}</ul>}
    </div>
  )
}

function Keyframes({ id, folder, m }) {
  const counts = timelineCounts(m.timeline)
  const dur = m.video?.duration_s || 1
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="card-title">{folder === 'frames' ? 'Keyframes' : 'Keyframes (additional footage)'}</div>
        <span className="text-[12px] text-ink-mute">{m.keyframes.length} selected from {m.sampled} sampled frames ·
          {' '}{m.video.width}×{m.video.height}, {m.video.duration_s.toFixed(1)} s, {m.video.fps} fps</span>
      </div>
      <div className="relative h-5 mt-3 rounded-md bg-paper overflow-hidden" aria-label="Frame timeline">
        {m.timeline.map((f) => (
          <span key={f.index} className="absolute top-0 bottom-0 w-[2px]" title={`${f.time}s · ${FRAME_STATUS[f.status]?.label || f.status}`}
                style={{ left: `${(100 * f.time) / dur}%`, background: FRAME_STATUS[f.status]?.color || '#ddd' }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2 text-[11.5px] text-ink-mute">
        {Object.entries(FRAME_STATUS).map(([k, v]) => counts[k] > 0 && (
          <span key={k} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: v.color }} />{v.label} {counts[k]}</span>))}
      </div>
      {m.warnings?.length > 0 && <ul className="mt-3 text-[12.5px] text-warn space-y-1">{m.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</li>)}</ul>}
      <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2">
        {m.keyframes.map((f) => (
          <figure key={f.name} className="rounded-lg overflow-hidden border border-line bg-paper">
            <img src={modeB.frameUrl(id, folder, f.name)} alt={`Keyframe at ${f.time} s`} loading="lazy" className="w-full aspect-[4/3] object-cover" />
            <figcaption className="px-1.5 py-1 text-[10.5px] text-ink-mute tabular-nums flex justify-between"><span>{f.time.toFixed(1)} s</span><span title="Sharpness">◆ {Math.round(f.sharpness)}</span></figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
