import { Database, Info } from 'lucide-react'

// RGB-D sensor demo: VisionTrust / NextBestView pages computed only from the stored measurements.

function viewHistogram(views) {
  const bins = [[2, 2], [3, 5], [6, 10], [11, 20], [21, Infinity]]
  const counts = bins.map(() => 0)
  for (const v of views || []) { const k = bins.findIndex(([a, b]) => v >= a && v <= b); if (k >= 0) counts[k] += 1 }
  return bins.map(([a, b], k) => ({ label: b === Infinity ? `${a}+ frames` : a === b ? `${a} frames` : `${a}–${b} frames`, n: counts[k] }))
}

export function RgbdVisionTrust({ scene }) {
  const d = scene.diagnostics
  const hist = viewHistogram(scene.points.views)
  const total = hist.reduce((s, h) => s + h.n, 0) || 1
  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto p-6 lg:p-8 space-y-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">VisionTrust — RGB-D sensor data</h1>
          <p className="text-[13px] text-ink-mute">Every point in this demo is measured by the depth sensor: there is no generated or inferred geometry.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="card p-4"><div className="text-[12px] text-ink-soft font-medium flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#10B981]" />Observed (measured)</div>
            <div className="text-[26px] font-semibold tabular-nums text-[#10B981]">{d.points_kept.toLocaleString()}</div><div className="text-[11.5px] text-ink-mute">points, each seen by ≥ {d.min_views} frames</div></div>
          <div className="card p-4"><div className="text-[12px] text-ink-soft font-medium">Generated</div>
            <div className="text-[26px] font-semibold tabular-nums">0</div><div className="text-[11.5px] text-ink-mute">no completion is applied to sensor data</div></div>
          <div className="card p-4"><div className="text-[12px] text-ink-soft font-medium">Depth frames fused</div>
            <div className="text-[26px] font-semibold tabular-nums">{d.frames_fused}</div><div className="text-[11.5px] text-ink-mute">{(d.voxel_m * 100).toFixed(1)} cm cells · extent {d.extent_m.join(' × ')} m</div></div>
        </div>
        <div className="card p-4">
          <div className="card-title mb-3">How many frames measured each point</div>
          <div className="space-y-2">
            {hist.map((h) => (
              <div key={h.label} className="flex items-center gap-3 text-[12.5px]">
                <span className="w-24 text-ink-soft">{h.label}</span>
                <div className="flex-1 h-2.5 rounded-full bg-paper overflow-hidden"><div className="h-full bg-[#10B981]" style={{ width: `${(100 * h.n) / total}%` }} /></div>
                <span className="w-28 text-right tabular-nums text-ink-mute">{h.n.toLocaleString()} ({((100 * h.n) / total).toFixed(0)}%)</span>
              </div>))}
          </div>
          <p className="text-[12px] text-ink-mute mt-3">More frames = more repeated measurements of the same spot. Cells measured by only one frame were discarded as noise
            ({d.voxels.toLocaleString()} cells measured in total, {d.points_kept.toLocaleString()} kept).</p>
        </div>
        <div className="card p-4 text-[12.5px] text-ink-mute flex gap-2"><Info size={15} className="shrink-0 mt-0.5" />
          Missing-data regions (unseen walls, holes) are not computed for this demo: it has no room-surface model to measure them against, so no
          coverage percentage is shown. {scene.source.note}</div>
      </div>
    </div>
  )
}

export function RgbdNextBestView({ scene }) {
  return (
    <div className="h-full grid place-items-center p-8">
      <div className="card p-6 max-w-xl space-y-3 text-[13px]">
        <div className="card-title flex items-center gap-1.5"><Database size={15} className="text-accent" />NextBestView — not available for RGB-D sensor data</div>
        <p className="text-ink-soft">NextBestView recommends a new viewpoint by finding room surfaces that are generated or weakly observed. This demo only contains
          measured points ({scene.diagnostics.points_kept.toLocaleString()} from {scene.diagnostics.frames_fused} depth frames) and no room-surface model, so there is
          no reliable way to tell which parts of the room are missing.</p>
        <p className="text-ink-mute">Missing information: a room layout (floor, walls, ceiling) to compare the measured coverage against. To see NextBestView, open an
          MP4 video project (for example “TUM fr1/room — first half”).</p>
      </div>
    </div>
  )
}
