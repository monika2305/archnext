import { AlertTriangle, Info } from 'lucide-react'
import { modeB } from '../api.js'
import { evidenceOf } from '../lib/sceneGeometry.js'
import { classShares, heatColor, lengthLabel, TRUST_CLASSES } from '../lib/trust.js'

export function ClassBar({ shares, height = 'h-2' }) {
  return (
    <div className={`flex ${height} rounded-full overflow-hidden bg-paper`}>
      {Object.entries(TRUST_CLASSES).map(([k, c]) => shares[k] > 0 && (
        <span key={k} style={{ width: `${100 * shares[k]}%`, background: c.color }} title={`${c.label} ${(100 * shares[k]).toFixed(0)}%`} />))}
    </div>
  )
}

export function Legend({ mode }) {
  if (mode === 'heatmap') {
    return (
      <div className="text-[11.5px] text-ink-mute">
        <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
        <div className="flex justify-between mt-1"><span>Low evidence</span><span>GeometryTrust score</span><span>High</span></div>
        <div className="flex items-center gap-1.5 mt-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#9CA3AF]" />Generated (no evidence)</div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-soft">
      {Object.entries(TRUST_CLASSES).map(([k, c]) => (
        <span key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />{c.label}</span>))}
    </div>
  )
}

/** Evidence Details for the selected surface (and cell), or the scene summary when nothing is selected. */
export default function EvidencePanel({ scene, projectId, selection, scale }) {
  const surface = selection && scene.surfaces.find((s) => s.id === selection.surface)
  const cell = surface && selection.cell && surface.cells.find((c) => c.i === selection.cell.i && c.j === selection.cell.j)
  if (!surface) {
    const sh = scene.summary?.shares || classShares(scene.surfaces)
    return (
      <div className="space-y-3">
        <div className="card-title">Scene evidence</div>
        <ClassBar shares={sh} />
        <div className="grid grid-cols-3 gap-2 text-center">
          {Object.entries(TRUST_CLASSES).map(([k, c]) => (
            <div key={k}><div className="text-[17px] font-semibold tabular-nums" style={{ color: c.color }}>{Math.round(100 * (sh[k] || 0))}%</div>
              <div className="text-[11px] text-ink-mute">{c.label}</div></div>))}
        </div>
        <p className="text-[12px] text-ink-mute flex gap-1.5"><Info size={13} className="shrink-0 mt-0.5" />Click a surface in the 3D view to see
          which frames support it and what was assumed.</p>
        {!scene.layout?.reliable && scene.layout?.failure && (
          <p className="text-[12px] text-warn flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{scene.layout.failure}</p>)}
      </div>
    )
  }
  const ev = cell && evidenceOf(surface, cell)
  return (
    <div className="space-y-3 text-[12.5px]">
      <div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: TRUST_CLASSES[surface.class].color }} />
          <span className="card-title capitalize">{surface.kind}{surface.id !== surface.kind && <span className="font-mono text-[11px] text-ink-mute"> {surface.id}</span>}</span>
        </div>
        <div className="text-ink-mute mt-0.5">{TRUST_CLASSES[surface.class].label} surface · score {surface.confidence.toFixed(2)} ·
          {' '}{lengthLabel(surface.size[0], scale)} × {lengthLabel(surface.size[1], scale)}</div>
      </div>
      <ClassBar shares={surface.shares} />
      <div className="text-ink-soft"><span className="text-ink-mute">Method: </span>{surface.method}</div>
      {surface.assumptions?.length > 0 && (
        <div>
          <div className="label mb-1">Assumptions</div>
          <ul className="space-y-1 text-ink-soft list-disc pl-4">{surface.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {cell && (
        <div className="rounded-xl border border-line p-3 space-y-1.5">
          <div className="flex items-center gap-2 font-medium">
            <span className="w-2 h-2 rounded-sm" style={{ background: TRUST_CLASSES[cell.cls].color }} />Region {cell.i},{cell.j}: {ev.kind}</div>
          {ev.rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><span className="text-ink-mute">{k}</span><span className="tabular-nums text-right">{v}</span></div>)}
          {cell.frames?.length > 0 && (
            <div>
              <div className="label mt-2 mb-1">{cell.views ? 'Supporting frames' : 'Frames that saw this region'}</div>
              <div className="grid grid-cols-4 gap-1">
                {cell.frames.slice(0, 8).map((f) => {
                  const [folder, name] = f.split('/')
                  return <img key={f} src={modeB.frameUrl(projectId, folder, name)} alt={f} title={f} className="rounded aspect-[4/3] object-cover border border-line" />
                })}
              </div>
            </div>
          )}
          {cell.cls === 'generated' && <p className="text-[11.5px] text-ink-mute">No frame saw this region: its geometry follows the assumptions above.</p>}
        </div>
      )}
    </div>
  )
}
