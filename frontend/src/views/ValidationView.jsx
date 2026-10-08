import { Fragment, useEffect, useRef, useState } from 'react'
import { FileJson, FlaskConical, Loader2, Ruler, ShieldCheck, Upload } from 'lucide-react'
import { api } from '../lib/api.js'
import { CONFIG_LABEL, ROOM_TYPE_LABEL, configKey, pct } from '../lib/format.js'
import { CONFIG_COLOR, ConfigBarChart, Disclosure, METRICS, fmtMetric, metricValue } from '../components/Charts.jsx'

const CONFIG_ORDER = ['baseline', 'topologyguard_only', 'scalelock_only', 'full'].map((key) => ({ key, label: CONFIG_LABEL[key] }))
const RESEARCH_METRICS = ['room_recall', 'room_iou_all', 'structural_consistency', 'dimension_error_pct', 'doors_f1', 'windows_f1']
const ALL_METRICS = [...RESEARCH_METRICS, 'room_precision', 'scale_error_pct']

function BigSwitch({ icon: Icon, name, hint, on, busy, onChange }) {
  return (
    <button onClick={() => onChange(!on)} disabled={busy} aria-pressed={on}
      className={`card flex items-center gap-4 px-5 py-4 text-left transition-all disabled:cursor-wait
        ${on ? 'border-accent/40 ring-1 ring-accent/20' : 'hover:border-ink-mute/40'}`}>
      <span className={`w-10 h-10 rounded-xl grid place-items-center ${on ? 'bg-accent text-white' : 'bg-paper text-ink-mute'}`}><Icon size={19} /></span>
      <span className="flex-1">
        <span className="block text-[15px] font-semibold">{name}</span>
        <span className="block text-[12.5px] text-ink-mute">{hint}</span>
      </span>
      <span className={`text-[12px] font-semibold w-7 text-right ${on ? 'text-accent' : 'text-ink-mute'}`}>{on ? 'ON' : 'OFF'}</span>
      <span className={`w-12 h-7 rounded-full p-1 transition-colors ${on ? 'bg-accent' : 'bg-line'}`}>
        <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  )
}

function Metric({ label, value, sub, muted, action }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-[12px] text-ink-mute">{label}</div>
      <div className={`mt-1 tabular-nums ${muted ? 'text-[15px] font-medium text-ink-mute py-[5px]' : 'text-[24px] font-semibold leading-tight'}`}>{value}</div>
      <div className="text-[11.5px] text-ink-mute mt-0.5 flex items-center gap-2 min-h-[18px]">{sub}{action}</div>
    </div>
  )
}

/** Paired bars: grey = both features off, blue = current settings. */
function CompareRow({ label, a, b, fmt, max, lowerBetter }) {
  const w = (v) => (v == null || !max ? 0 : Math.max(2, (v / max) * 100))
  const better = a != null && b != null && a !== b && (lowerBetter ? b < a : b > a)
  return (
    <div className="grid grid-cols-[130px_1fr_56px] items-center gap-x-3 gap-y-1">
      <span className="text-[12.5px] text-ink-soft row-span-2">{label}{lowerBetter && <span className="text-ink-mute"> ↓</span>}</span>
      <div className="h-2.5 rounded-full bg-paper overflow-hidden"><div className="h-full rounded-full bg-[#C9C6BF]" style={{ width: `${w(a)}%` }} /></div>
      <span className="text-[12px] tabular-nums text-ink-mute text-right">{a == null ? '—' : fmt(a)}</span>
      <div className="h-2.5 rounded-full bg-paper overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: `${w(b)}%` }} /></div>
      <span className={`text-[12px] tabular-nums text-right font-semibold ${better ? 'text-ok' : 'text-ink'}`}>{b == null ? '—' : fmt(b)}</span>
    </div>
  )
}

function MetricTable({ configs }) {
  return (
    <table className="table">
      <thead><tr><th>Metric</th>{CONFIG_ORDER.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}</tr></thead>
      <tbody>
        {[...ALL_METRICS, 'room_iou_matched', 'room_type_accuracy'].map((k) => (
          <tr key={k}>
            <td>{METRICS[k]?.label || { room_iou_matched: 'Room shape match (matched only)', room_type_accuracy: 'Room type correct' }[k]}</td>
            {CONFIG_ORDER.map((c) => {
              const v = metricValue(configs[c.key], k)
              return <td key={c.key} className="text-right tabular-nums">{METRICS[k] ? fmtMetric(k, v) : v == null ? 'N/A' : pct(v)}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DetectionTable({ configs }) {
  return (
    <table className="table">
      <thead><tr><th>Setting</th><th>Element</th><th className="text-right">Correct</th><th className="text-right">Detected</th><th className="text-right">Actual</th><th className="text-right">Precision</th><th className="text-right">Recall</th><th className="text-right">F1</th></tr></thead>
      <tbody>
        {CONFIG_ORDER.flatMap((c) => ['doors', 'windows'].map((el) => {
          const d = configs[c.key]?.[el]
          if (!d) return null
          return (
            <tr key={c.key + el}><td>{c.label}</td><td className="capitalize">{el}</td>
              <td className="text-right tabular-nums">{d.tp}</td><td className="text-right tabular-nums">{d.predicted}</td><td className="text-right tabular-nums">{d.actual}</td>
              <td className="text-right tabular-nums">{d.precision.toFixed(2)}</td><td className="text-right tabular-nums">{d.recall.toFixed(2)}</td><td className="text-right tabular-nums">{d.f1.toFixed(2)}</td></tr>
          )
        }))}
      </tbody>
    </table>
  )
}

const H3 = ({ children }) => <h3 className="text-[12.5px] font-semibold text-ink mt-6 mb-2 first:mt-1">{children}</h3>

export default function ValidationView({ result, onConfig, configBusy, configError }) {
  const [cmp, setCmp] = useState(null)
  const [cmpError, setCmpError] = useState('')
  const [bench, setBench] = useState(null)
  const [evalRes, setEvalRes] = useState(null)
  const [evalErr, setEvalErr] = useState('')
  const [evalBusy, setEvalBusy] = useState(false)
  const [source, setSource] = useState('bench')
  const [metric, setMetric] = useState('room_recall')
  const fileRef = useRef(null)

  useEffect(() => { api.benchmark().then(setBench).catch(() => setBench({ available: false })) }, [])
  useEffect(() => { setEvalRes(null); setSource('bench') }, [result.id])
  useEffect(() => {
    let live = true
    setCmpError('')
    api.compare(result.id).then((c) => live && setCmp(c)).catch((e) => live && setCmpError(e.message))
    return () => { live = false }
  }, [result])

  const runEval = async (f) => {
    if (!f) return
    setEvalBusy(true); setEvalErr('')
    try { setEvalRes(await api.evaluate(result.id, f)); setSource('plan') } catch (e) { setEvalErr(e.message) } finally { setEvalBusy(false) }
  }

  const cfg = result.config || { topology_guard: true, scale_lock: true }
  const key = configKey(cfg)
  const cur = cmp?.current
  const base = cmp?.configs?.baseline
  const stale = !cmp || cmp.config_key !== key
  const benchOk = bench?.available && bench.results
  const recall = evalRes ? evalRes.configs[key]?.room_recall : null
  const researchConfigs = source === 'plan' && evalRes ? evalRes.configs : benchOk ? bench.results : null
  const researchRows = researchConfigs ? CONFIG_ORDER.map((c) => ({ ...c, res: researchConfigs[c.key] })) : null
  const g = result.geometry.corrected
  const holdout = result.scale.holdout || []

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto px-6 py-7 space-y-5">
        <div className="flex items-end justify-between">
          <h1 className="text-[24px] font-semibold tracking-tight">How accurate is your plan?</h1>
          {configBusy && <span className="text-[12.5px] text-ink-mute flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />Updating plan…</span>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <BigSwitch icon={ShieldCheck} name="TopologyGuard" hint="Repairs broken and loose walls" on={cfg.topology_guard} busy={configBusy}
                     onChange={(v) => onConfig(v, cfg.scale_lock)} />
          <BigSwitch icon={Ruler} name="ScaleLock" hint="Reads real sizes from the plan" on={cfg.scale_lock} busy={configBusy}
                     onChange={(v) => onConfig(cfg.topology_guard, v)} />
        </div>
        {configError && <p className="text-[12.5px] text-bad">{configError}</p>}

        <div className={`grid grid-cols-4 gap-4 transition-opacity ${stale || configBusy ? 'opacity-50' : ''}`}>
          <Metric label="Walls connected" value={cur ? `${Math.round(cur.connected * 100)}%` : '—'}
                  sub={cur ? `${cur.open_ends} loose end${cur.open_ends === 1 ? '' : 's'}` : ''} />
          <Metric label="Rooms found" value={cur ? cur.rooms : '—'} sub={cur ? `${cur.doors} doors · ${cur.windows} windows` : ''} />
          {cur?.size_error_pct != null
            ? <Metric label="Size error" value={`${cur.size_error_pct.toFixed(1)}%`} sub={`vs ${cur.size_checks} sizes written on plan`} />
            : <Metric label="Size error" value="Not checked" muted sub="No readable sizes" />}
          {recall != null
            ? <Metric label="Accuracy" value={`${Math.round(recall * 100)}%`} sub="rooms matched · answer key" />
            : <Metric label="Accuracy" value="Accuracy not measured" muted
                      action={<button className="text-accent font-medium hover:underline" onClick={() => fileRef.current?.click()} disabled={evalBusy}>
                        {evalBusy ? 'Scoring…' : 'Add answer key'}</button>} />}
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { runEval(e.target.files?.[0]); e.target.value = '' }} />
        {(evalErr || cmpError) && <p className="text-[12.5px] text-bad">{evalErr || cmpError}</p>}

        <section className={`card p-5 transition-opacity ${stale || configBusy ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-4 mb-4">
            <h2 className="card-title">Before → after</h2>
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-mute"><span className="w-2.5 h-2.5 rounded-full bg-[#C9C6BF]" />Both off</span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-mute"><span className="w-2.5 h-2.5 rounded-full bg-accent" />Your settings</span>
            {key === 'baseline' && <span className="ml-auto text-[12px] text-ink-mute">Turn a switch on to compare</span>}
          </div>
          {cur && base ? (
            <div className="space-y-4">
              <CompareRow label="Walls connected" a={base.connected * 100} b={cur.connected * 100} max={100} fmt={(v) => `${Math.round(v)}%`} />
              <CompareRow label="Rooms found" a={base.rooms} b={cur.rooms} max={Math.max(base.rooms, cur.rooms, 1)} fmt={(v) => v} />
              <CompareRow label="Size error" a={base.size_error_pct} b={cur.size_error_pct} lowerBetter
                          max={Math.max(base.size_error_pct || 0, cur.size_error_pct || 0, 1)} fmt={(v) => `${v.toFixed(1)}%`} />
            </div>
          ) : (
            <div className="h-28 grid place-items-center text-ink-mute"><Loader2 size={18} className="animate-spin" /></div>
          )}
          <p className="text-[11.5px] text-ink-mute mt-4 pt-3 border-t border-line">
            Measured on your plan. Size error compares against dimensions written on it; true accuracy needs an answer key.
          </p>
        </section>

        <Disclosure title="Research results" subtitle="four-way study">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="seg">
              <button data-active={source === 'bench'} onClick={() => setSource('bench')} disabled={!benchOk}><FlaskConical size={13} />Synthetic benchmark</button>
              <button data-active={source === 'plan'} onClick={() => setSource('plan')} disabled={!evalRes}><FileJson size={13} />Your plan (answer key)</button>
            </div>
            <span className={`chip ${source === 'bench' ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok'}`}>
              {source === 'bench' ? 'Synthetic · not your plan' : 'Your plan · automatic result'}
            </span>
          </div>
          {researchRows ? (
            <>
              <div className="seg flex-wrap mb-2">
                {RESEARCH_METRICS.map((k) => <button key={k} data-active={metric === k} onClick={() => setMetric(k)}>{METRICS[k].label}</button>)}
              </div>
              <ConfigBarChart rows={researchRows} metric={metric} />
              <p className="text-[11.5px] text-ink-mute mt-1">
                {source === 'bench' ? bench.dataset.label : 'Scored against your answer key. Manual fixes are not counted.'}
              </p>
            </>
          ) : <p className="text-[12.5px] text-ink-mute">No benchmark results available.</p>}

          {cmp && (
            <>
              <H3>Your plan, all four settings (measured)</H3>
              <table className="table">
                <thead><tr><th>Setting</th><th className="text-right">Walls connected</th><th className="text-right">Rooms</th><th className="text-right">Size error</th><th>Scale</th></tr></thead>
                <tbody>
                  {CONFIG_ORDER.map((c) => {
                    const s = cmp.configs[c.key]
                    return (
                      <tr key={c.key} className={c.key === key ? 'bg-accent-soft/40' : ''}>
                        <td className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: CONFIG_COLOR[c.key] }} />{c.label}</td>
                        <td className="text-right tabular-nums">{Math.round(s.connected * 100)}%</td>
                        <td className="text-right tabular-nums">{s.rooms}</td>
                        <td className="text-right tabular-nums">{s.size_error_pct == null ? '—' : `${s.size_error_pct.toFixed(1)}%`}</td>
                        <td className="capitalize">{s.scale_status}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </Disclosure>

        <Disclosure title="Advanced details">
          <H3>Structural checks</H3>
          <table className="table">
            <thead><tr><th>Check</th><th className="text-right">Auto-fixed</th><th className="text-right">Fixed by you</th><th className="text-right">Open</th></tr></thead>
            <tbody>
              {result.topology.checks.map((c) => (
                <tr key={c.key}><td title={c.description}>{c.name}</td><td className="text-right tabular-nums">{c.corrected}</td>
                  <td className="text-right tabular-nums">{c.fixed}</td><td className="text-right tabular-nums">{c.review}</td></tr>
              ))}
            </tbody>
          </table>

          <H3>Room schedule</H3>
          {g.rooms.length === 0 ? <p className="text-[12.5px] text-ink-mute">No enclosed rooms.</p> : (
            <table className="table">
              <thead><tr><th>Room</th><th>Type</th><th className="text-right">Length</th><th className="text-right">Width</th><th className="text-right">Area</th><th>Label on plan</th></tr></thead>
              <tbody>
                {[...g.rooms].sort((a, b) => b.area_m2 - a.area_m2).map((r) => (
                  <tr key={r.id}><td className="text-ink font-medium">{r.name}</td><td>{ROOM_TYPE_LABEL[r.type]}</td>
                    <td className="text-right tabular-nums">{r.length_m.toFixed(2)} m</td><td className="text-right tabular-nums">{r.width_m.toFixed(2)} m</td>
                    <td className="text-right tabular-nums">{r.area_m2.toFixed(1)} m²</td><td className="font-mono text-ink-mute">{r.label_dims || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          )}

          <H3>Written vs measured sizes</H3>
          {holdout.length > 0 ? (
            <table className="table">
              <thead><tr><th>Label</th><th className="text-right">Written</th><th className="text-right">Measured</th><th className="text-right">Error</th></tr></thead>
              <tbody>
                {holdout.map((r, i) => (
                  <tr key={i}><td className="font-mono">{r.text}</td><td className="text-right tabular-nums">{r.labelled_m.toFixed(2)} m</td>
                    <td className="text-right tabular-nums">{r.predicted_m.toFixed(2)} m</td>
                    <td className={`text-right tabular-nums ${r.error_pct > 5 ? 'text-warn font-medium' : ''}`}>{r.error_pct.toFixed(1)}%</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-[12.5px] text-ink-mute">No labels to check against with the current scale.</p>}
          {result.scale.status === 'auto' && holdout.length > 0 && (
            <p className="text-[11.5px] text-ink-mute mt-1.5">Each label is predicted from the other labels only.</p>
          )}

          {researchConfigs && (
            <>
              <H3>Precision, recall and F1 · {source === 'plan' && evalRes ? 'your plan' : 'synthetic benchmark'}</H3>
              <MetricTable configs={researchConfigs} />
              <div className="mt-3"><DetectionTable configs={researchConfigs} /></div>
            </>
          )}

          {benchOk && (
            <>
              <H3>Synthetic benchmark per plan</H3>
              <p className="text-[11.5px] text-ink-mute mb-2">{bench.dataset.description} Seeds {bench.dataset.seeds[0]}–{bench.dataset.seeds[1]}.</p>
              <div className="overflow-auto">
                <table className="table">
                  <thead><tr><th>Plan</th><th className="text-right">Rooms</th><th>Units</th>
                    {CONFIG_ORDER.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}<th className="text-right">Scale error</th></tr></thead>
                  <tbody>
                    {bench.per_plan.map((p) => (
                      <tr key={p.seed}><td>#{p.seed}</td><td className="text-right">{p.rooms}</td><td>{p.units}</td>
                        {CONFIG_ORDER.map((c) => <td key={c.key} className="text-right tabular-nums">{pct(p[c.key].room_recall, 0)}</td>)}
                        <td className="text-right tabular-nums">{p.full.scale_error_pct == null ? 'N/A' : `${p.full.scale_error_pct.toFixed(1)}%`}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11.5px] text-ink-mute mt-1.5">Columns per setting: rooms found. Scale error: both on.</p>
              {bench.notes?.scale && <p className="text-[11.5px] text-ink-mute mt-1">{bench.notes.scale}</p>}
              <dl className="mt-3 grid grid-cols-[200px_1fr] gap-y-1 text-[11.5px]">
                {Object.entries(bench.definitions || {}).map(([k, v]) => (<Fragment key={k}><dt className="text-ink-soft font-mono">{k}</dt><dd className="text-ink-mute">{v}</dd></Fragment>))}
              </dl>
            </>
          )}

          <H3>Answer key format</H3>
          <pre className="text-[11.5px] bg-paper border border-line rounded-lg p-3 overflow-auto">{`{
  "meters_per_px": 0.02,
  "rooms":   [{ "polygon": [[x, y], ...], "type": "bedroom" }],
  "doors":   [{ "x1": 0, "y1": 0, "x2": 0, "y2": 0 }],
  "windows": [{ "x1": 0, "y1": 0, "x2": 0, "y2": 0 }]
}`}</pre>
          <button className="btn-secondary btn-sm mt-2" onClick={() => fileRef.current?.click()} disabled={evalBusy}>
            {evalBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}Upload answer key</button>
        </Disclosure>
      </div>
    </div>
  )
}
