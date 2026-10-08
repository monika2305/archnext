import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, FlaskConical, Info, Loader2, Minus, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ErrorBar, Legend as RLegend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import SceneViewer from '../components/SceneViewer.jsx'
import { ClassBar } from '../components/EvidencePanel.jsx'
import { modeB } from '../api.js'
import { CONFIGS, format, INNOVATIONS, metricRows, nbvEffect, shortName, valueOf } from '../lib/research.js'

const CFG_COLOR = { A: '#9CA3AF', B: '#8B5CF6', C: '#10B981', D: '#F59E0B' }
const Flag = ({ on }) => (on ? <Check size={14} className="text-ok" /> : <Minus size={14} className="text-ink-mute/50" />)

// Research evaluation: the A/B/C/D ablation exactly as stored in mode_b/results/ablation.json (real runs only).
export default function ResearchView() {
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  const [seqName, setSeqName] = useState(null)
  const [scenes, setScenes] = useState({})
  const [showDefs, setShowDefs] = useState(false)
  useEffect(() => { modeB.research().then(setR).catch((e) => setError(e.message)) }, [])
  const evaluated = useMemo(() => (r?.sequences || []).filter((s) => s.configs && Object.keys(s.configs).length), [r])
  const seq = evaluated.find((s) => s.sequence === seqName) || evaluated[0]
  useEffect(() => {
    if (!seq) return
    const short = seq.sequence.replace('rgbd_dataset_', '')
    setScenes({})
    CONFIGS.forEach((c) => modeB.research && fetch(`/api/mode-b/research/scenes/${short}_${c}.json`)
      .then((x) => (x.ok ? x.json() : null)).then((sc) => sc && setScenes((s) => ({ ...s, [c]: sc }))).catch(() => {}))
  }, [seq])

  if (error) return <div className="p-8 text-[13px] text-bad">{error}</div>
  if (!r) return <div className="h-full grid place-items-center"><Loader2 className="animate-spin text-accent" /></div>
  if (!r.available) {
    return (
      <div className="h-full grid place-items-center p-8"><div className="card p-6 max-w-lg text-center">
        <FlaskConical className="mx-auto text-accent" /><div className="card-title mt-2">Research evaluation</div>
        <p className="text-[13px] text-ink-mute mt-1">{r.reason}</p></div></div>
    )
  }
  const rows = seq ? metricRows(seq, r.metrics) : []
  const chartData = seq ? ['completeness', 'heldout_view_completeness', 'observed_share'].map((k) => ({
    metric: r.metrics[k].label,
    ...Object.fromEntries(CONFIGS.map((c) => [c, valueOf(seq, c, k) ? 100 * valueOf(seq, c, k).v : null])),
    D_sd: valueOf(seq, 'D', k)?.sd != null ? 100 * valueOf(seq, 'D', k).sd : 0,
  })) : []
  const effect = seq && nbvEffect(seq, 'completeness')

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Research evaluation</h1>
          <p className="text-[13px] text-ink-mute">Ablation of VisionTrust completion and NextBestView guidance on real recordings:
            {' '}{r.dataset.name} ({r.dataset.license}), sensor depth and motion-capture poses as reference. Generated {r.generated.replace('T', ' ')}.</p>
        </div>

        <div className="card overflow-hidden">
          <table className="table">
            <thead><tr><th>Experiment</th><th>VisionTrust completion</th><th>NextBestView</th><th>Additional footage</th><th>Selection</th><th>What it isolates</th></tr></thead>
            <tbody>
              {CONFIGS.map((c) => (
                <tr key={c}>
                  <td className="font-medium text-ink"><span className="inline-block w-2.5 h-2.5 rounded-sm mr-2" style={{ background: CFG_COLOR[c] }} />{c}</td>
                  <td><Flag on={INNOVATIONS[c].completion} /></td><td><Flag on={INNOVATIONS[c].nbv} /></td><td><Flag on={INNOVATIONS[c].extra} /></td>
                  <td>{INNOVATIONS[c].selection}</td><td className="text-[12px]">{r.configs[c]}</td>
                </tr>))}
            </tbody>
          </table>
        </div>

        {evaluated.length > 1 && (
          <div className="seg">{evaluated.map((s) => <button key={s.sequence} data-active={s.sequence === seq?.sequence} onClick={() => setSeqName(s.sequence)}>{shortName(s.sequence)}</button>)}</div>)}

        {seq && (
          <>
            <div className="grid sm:grid-cols-4 gap-3 text-[12.5px]">
              <Stat label="Input video" value={`${seq.input_s} s`} sub={`${seq.input_frames} frames of ${seq.frames}`} />
              <Stat label="Candidate pool" value={`${seq.pool_clips} clips`} sub={`budget k = ${seq.k} clips for C and D`} />
              <Stat label="Held-out views" value={`${seq.reference?.heldout_frames ?? 0} frames`} sub={`${seq.reference?.heldout_pixels ?? 0} shell pixels, never reconstructed`} />
              <Stat label="Reference shell" value={(seq.reference?.measured_planes || []).length + ' planes'} sub={(seq.reference?.measured_planes || []).join(', ')} />
            </div>

            <div className="card overflow-hidden">
              <div className="px-4 pt-3 pb-1 flex items-center gap-2"><div className="card-title">{shortName(seq.sequence)} — measured results</div>
                <span className="text-[11.5px] text-ink-mute">({seq.kind}); D = mean ± std over {seq.configs.D?.seeds?.length || 0} random seeds</span></div>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Metric</th>{CONFIGS.map((c) => <th key={c} className="text-right">{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} title={row.definition}>
                        <td className="text-ink">{row.label}<span className="text-ink-mute text-[11px]"> {row.units && `(${row.units})`}</span></td>
                        {row.na ? <td colSpan={4} className="text-ink-mute text-[12px]">N/A — {row.na}</td>
                          : CONFIGS.map((c) => {
                            const cell = row.cells[c]
                            return (
                              <td key={c} className={`text-right tabular-nums whitespace-nowrap ${row.best === c ? 'font-semibold text-ink' : ''}`}>
                                {cell ? format(cell.v, row.units) : <span className="text-ink-mute">N/A</span>}
                                {cell?.sd != null && <span className="text-ink-mute text-[11px]"> ±{format(cell.sd, row.units).replace(' m', '')}</span>}
                              </td>)
                          })}
                      </tr>))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-[11.5px] text-ink-mute">Bold = best of the configurations for metrics with a clear direction. Distances are in metres after the
                evaluation-only Sim3 alignment to motion capture; the app itself has no metric scale.</p>
            </div>

            {effect && (
              <div className="card p-4 text-[13px] flex gap-2"><Info size={15} className="text-accent shrink-0 mt-0.5" />
                <span>NextBestView vs random clips at the same budget (C − D, surface completeness): <b>{effect.diff >= 0 ? '+' : ''}{(100 * effect.diff).toFixed(1)} points</b>
                  {effect.sd != null && <> (random seeds vary by ±{(100 * effect.sd).toFixed(1)} points, n = {effect.n})</>}.
                  {' '}{Math.abs(effect.diff) <= (effect.sd || 0) ? 'This is within the variation of random selection: not a conclusive difference on this sequence.' : ''}</span></div>)}

            <div className="card p-4">
              <div className="card-title mb-2">Coverage and completeness (%)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E4E0D8" />
                    <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip formatter={(v) => (v == null ? 'N/A' : `${Number(v).toFixed(1)}%`)} />
                    <RLegend wrapperStyle={{ fontSize: 12 }} />
                    {CONFIGS.map((c) => (
                      <Bar key={c} dataKey={c} fill={CFG_COLOR[c]} radius={[3, 3, 0, 0]}>
                        {c === 'D' && <ErrorBar dataKey="D_sd" width={4} stroke="#7C818A" />}
                      </Bar>))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-4">
              <div className="card-title mb-2">Side by side (VisionTrust classes; D = first random seed)</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {CONFIGS.map((c) => (
                  <div key={c} className="rounded-xl border border-line overflow-hidden">
                    <div className="px-2.5 py-1.5 text-[12px] font-medium flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: CFG_COLOR[c] }} />{c}
                      <span className="text-ink-mute font-normal truncate">{INNOVATIONS[c].selection}</span></div>
                    <div className="h-56 bg-white">{scenes[c] ? <SceneViewer scene={scenes[c]} mode="complete" show={{ points: false, cameras: true, grid: false, nbv: false }} />
                      : <div className="h-full grid place-items-center text-[12px] text-ink-mute">No scene</div>}</div>
                    {scenes[c]?.summary && <div className="px-2.5 py-2"><ClassBar shares={scenes[c].summary.shares} /></div>}
                  </div>))}
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <div className="card p-4 text-[12.5px] space-y-1.5">
                <div className="card-title mb-1">Selected clips</div>
                {['C', ...Object.keys(seq.configs).filter((k) => /^D\d+$/.test(k))].map((k) => seq.configs[k] && (
                  <div key={k} className="flex justify-between gap-2"><span>{k === 'C' ? 'C · NextBestView' : `${k} · random seed ${seq.configs[k].seed}`}</span>
                    <span className="tabular-nums text-ink-mute">clips {JSON.stringify(seq.configs[k].extra_clips)} · {seq.configs[k].extra_frames} frames
                      {seq.configs[k].success === false && <span className="text-bad"> · alignment failed</span>}</span></div>))}
                {seq.configs.C?.details?.map((d) => <div key={d.clip} className="text-ink-mute">NBV predicted gain of clip {d.clip}: {(100 * d.predicted_gain_share).toFixed(1)}% of weighted uncertainty</div>)}
              </div>
              <div className="card p-4 text-[12.5px] space-y-1.5">
                <div className="card-title mb-1">Processing time (CPU, no CUDA)</div>
                <div className="flex justify-between"><span>A / B (one reconstruction)</span><span className="tabular-nums">{seq.process_seconds} s</span></div>
                {Object.entries(seq.configs).filter(([k, v]) => v.seconds != null).map(([k, v]) => (
                  <div key={k} className="flex justify-between"><span>{k} (extend)</span><span className="tabular-nums">{v.seconds} s</span></div>))}
                <div className="flex justify-between text-ink-mute"><span>COLMAP: registered / input frames</span><span className="tabular-nums">{seq.sfm?.registered_frames} / {seq.sfm?.input_frames}</span></div>
              </div>
            </div>
          </>
        )}

        <div className="card overflow-hidden">
          <div className="px-4 pt-3 pb-1 card-title">Reconstruction success across sequences</div>
          <table className="table">
            <thead><tr><th>Sequence</th><th>Type</th><th>Camera poses</th><th>Room layout</th><th>Result</th></tr></thead>
            <tbody>
              {r.sequences.map((s) => (
                <tr key={s.sequence}>
                  <td className="text-ink whitespace-nowrap">{shortName(s.sequence)}</td><td className="text-[12px]">{s.kind}</td>
                  <td className="tabular-nums">{s.sfm ? `${s.sfm.registered_frames}/${s.sfm.input_frames} frames` : '—'}</td>
                  <td>{s.success ? (s.layout_reliable ? 'reliable' : 'partial') : '—'}</td>
                  <td className="text-[12px]">{s.success ? <span className="text-ok">reconstructed</span>
                    : <span className="text-bad flex gap-1"><X size={13} className="shrink-0 mt-0.5" />{s.failure}</span>}</td>
                </tr>))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <button className="w-full px-4 py-3 flex items-center gap-2 text-[13px] font-medium" onClick={() => setShowDefs((v) => !v)}>
            Protocol and metric definitions<ChevronDown size={15} className={`ml-auto transition-transform ${showDefs ? 'rotate-180' : ''}`} /></button>
          {showDefs && (
            <div className="px-4 pb-4 text-[12.5px] space-y-3 fade-in">
              <ul className="space-y-1 text-ink-soft">{Object.entries(r.protocol).map(([k, v]) => <li key={k}><b className="capitalize">{k}:</b> {String(v)}</li>)}</ul>
              <table className="table">
                <thead><tr><th>Metric</th><th>Units</th><th>Definition</th><th>Limitations</th></tr></thead>
                <tbody>{Object.entries(r.metrics).map(([k, m]) => <tr key={k}><td className="text-ink">{m.label}</td><td>{m.units}</td><td>{m.definition}</td><td>{m.limitations}</td></tr>)}</tbody>
              </table>
              <p className="text-ink-mute flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{r.dataset.citation}. Small evaluation set: results describe
                these recordings and are not a general accuracy claim.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-ink-mute text-[11.5px]">{label}</div>
      <div className="text-[18px] font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-ink-mute truncate" title={sub}>{sub}</div>
    </div>
  )
}
