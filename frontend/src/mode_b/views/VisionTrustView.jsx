import { AlertTriangle, ArrowRight, Info } from 'lucide-react'
import { ClassBar } from '../components/EvidencePanel.jsx'
import { heatColor, lengthLabel, TRUST_CLASSES } from '../lib/trust.js'

// VisionTrust & GeometryTrust report: what was observed, what is uncertain, what was generated and why.
export default function VisionTrustView({ data, scene, onSelect, onScene }) {
  const sm = scene.summary
  const scale = data.project.scale
  const generated = scene.surfaces.filter((s) => s.cells.some((c) => c.cls === 'generated'))
  const pick = (surface, cell) => { onSelect({ surface, cell }); onScene() }
  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-6 lg:p-8 space-y-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">VisionTrust</h1>
          <p className="text-[13px] text-ink-mute">Reconstruct what you see. Reveal what you assume. Every surface below says whether the video
            showed it, how strongly, and which assumptions filled the rest.</p>
        </div>

        {!scene.layout.reliable && (
          <div className="card px-4 py-3 text-[12.5px] text-warn flex gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" />{scene.layout.failure}</div>)}

        {sm && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(TRUST_CLASSES).map(([k, c]) => (
              <div key={k} className="card p-4">
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink-soft"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />{c.label}</div>
                <div className="text-[26px] font-semibold tabular-nums mt-1" style={{ color: c.color }}>{Math.round(100 * sm.shares[k])}%</div>
                <div className="text-[11.5px] text-ink-mute">of the room shell area</div>
              </div>))}
            <div className="card p-4">
              <div className="text-[12px] font-medium text-ink-soft">Mean GeometryTrust score</div>
              <div className="text-[26px] font-semibold tabular-nums mt-1">{sm.mean_confidence?.toFixed(2) ?? '—'}</div>
              <div className="text-[11.5px] text-ink-mute">{Math.round(100 * sm.seen_share)}% of the shell was inside some frame's view</div>
            </div>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="px-4 pt-3 pb-2 card-title">Surfaces</div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Surface</th><th>Class</th><th className="w-48">Evidence mix</th><th>Score</th><th>Supporting frames</th><th>Size</th><th>Reconstruction method</th></tr></thead>
              <tbody>
                {scene.surfaces.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-paper" onClick={() => pick(s.id, null)}>
                    <td className="font-medium text-ink whitespace-nowrap capitalize">{s.kind}{s.id !== s.kind && <span className="font-mono text-[11px] text-ink-mute"> {s.id}</span>}</td>
                    <td><span className="chip" style={{ background: `${TRUST_CLASSES[s.class].color}22`, color: TRUST_CLASSES[s.class].color }}>{TRUST_CLASSES[s.class].label}</span></td>
                    <td><ClassBar shares={s.shares} /></td>
                    <td className="tabular-nums"><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: heatColor(s.confidence) }} />{s.confidence.toFixed(2)}</td>
                    <td className="tabular-nums">{s.supporting_frames}</td>
                    <td className="tabular-nums whitespace-nowrap">{lengthLabel(s.size[0], scale)} × {lengthLabel(s.size[1], scale)}</td>
                    <td className="text-[12px] min-w-[240px]">{s.method}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card p-4">
            <div className="card-title mb-2">Completion assumptions (generated geometry)</div>
            {generated.length === 0 && <p className="text-[12.5px] text-ink-mute">{scene.completion ? 'Nothing had to be generated.' : 'Completion is off for this reconstruction (baseline): unseen regions are left open.'}</p>}
            <ul className="space-y-3">
              {generated.map((s) => (
                <li key={s.id} className="text-[12.5px]">
                  <div className="font-medium capitalize">{s.kind} <span className="font-mono text-[11px] text-ink-mute">{s.id}</span>
                    <span className="text-ink-mute font-normal"> · {Math.round(100 * s.shares.generated)}% generated</span></div>
                  <ul className="list-disc pl-4 text-ink-soft mt-0.5 space-y-0.5">{s.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                </li>))}
            </ul>
          </div>
          <div className="card p-4">
            <div className="card-title mb-2">Lowest-confidence regions</div>
            <ul className="divide-y divide-line">
              {(sm?.lowest_confidence || []).map((c) => (
                <li key={`${c.surface}-${c.i}-${c.j}`}>
                  <button className="w-full py-1.5 flex items-center gap-2 text-[12.5px] hover:text-accent" onClick={() => pick(c.surface, { i: c.i, j: c.j })}>
                    <span className="w-2 h-2 rounded-full" style={{ background: heatColor(c.confidence) }} />
                    <span className="capitalize">{c.surface}</span><span className="text-ink-mute">region {c.i},{c.j}</span>
                    <span className="ml-auto tabular-nums">{c.confidence.toFixed(2)}</span><ArrowRight size={13} className="text-ink-mute" />
                  </button>
                </li>))}
            </ul>
          </div>
        </div>

        <div className="card p-4 text-[12.5px] space-y-2">
          <div className="card-title flex items-center gap-1.5"><Info size={14} />How the GeometryTrust score is computed</div>
          <p className="font-mono text-[12px] bg-paper rounded-lg px-3 py-2">{scene.confidence_method.formula}</p>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-ink-soft">
            {Object.entries(scene.confidence_method.terms).map(([k, v]) => <li key={k}><span className="font-mono text-[11.5px]">{k}</span> = {v}</li>)}
          </ul>
          <p className="text-ink-mute">{scene.confidence_method.note}</p>
          <p className="text-ink-mute">Pipeline: {scene.method.poses}; {scene.method.geometry}. {scene.method.dense}</p>
          {scene.layout.notes?.map((n) => <p key={n} className="text-ink-mute">{n}</p>)}
        </div>
      </div>
    </div>
  )
}
