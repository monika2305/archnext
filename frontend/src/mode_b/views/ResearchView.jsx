import { useEffect, useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import SceneViewer from '../components/SceneViewer.jsx'
import { modeB } from '../api.js'
import { completionStats } from '../lib/shell.js'
import { valueOf } from '../lib/research.js'

// Research Results: three short sections, every number read from mode_b/results/ablation.json (ordinary video,
// TUM RGB-D fr1/room and long_office_household recordings used as video; the RGB-D sensor demo is not part of it).

const SEQ = 'rgbd_dataset_freiburg1_room'
const fmtPct = (x) => (x == null ? 'N/A' : `${(100 * x).toFixed(1)}%`)
const fmtM = (x) => (x == null ? 'N/A' : `${x.toFixed(2)} m`)

function MiniScene({ name, label, completed }) {
  const [scene, setScene] = useState(null)
  useEffect(() => {
    fetch(`/api/mode-b/research/scenes/${name}`).then((r) => (r.ok ? r.json() : null)).then(setScene).catch(() => setScene(null))
  }, [name])
  const st = scene ? completionStats(scene.surfaces) : null
  return (
    <div className="rounded-xl border border-line overflow-hidden bg-white">
      <div className="px-3 py-2 text-[12.5px] font-medium flex justify-between"><span>{label}</span>
        {st && <span className="text-ink-mute font-normal tabular-nums">{completed ? `${st.gaps.length} gaps completed` : `${st.gaps.length} gaps open`}</span>}</div>
      <div className="h-56" style={{ background: '#EFECE6' }}>
        {scene ? <SceneViewer scene={scene} show={{ cameras: false }} hybrid={{ xray: true, completed, showGaps: false, geometry: 'hybrid' }} />
          : <div className="h-full grid place-items-center text-[12px] text-ink-mute">Scene not available</div>}
      </div>
    </div>
  )
}

export default function ResearchView() {
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { modeB.research().then(setR).catch((e) => setError(e.message)) }, [])
  if (error) return <div className="p-8 text-[13px] text-bad">{error}</div>
  if (!r) return <div className="h-full grid place-items-center"><Loader2 className="animate-spin text-accent" /></div>
  if (!r.available) {
    return <div className="h-full grid place-items-center p-8"><div className="card p-6 max-w-lg text-center"><FlaskConical className="mx-auto text-accent" />
      <p className="text-[13px] text-ink-mute mt-2">{r.reason}</p></div></div>
  }
  const seq = r.sequences.find((s) => s.sequence === SEQ)
  const office = r.sequences.find((s) => s.sequence.includes('long_office'))
  const v = (s, c, k) => valueOf(s, c, k)?.v ?? null
  const d = (s, k) => valueOf(s, 'D', k)
  const rows = [
    ['Room shell covered (≤ 10 cm of the measured room)', 'completeness', fmtPct],
  ]
  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto p-6 lg:p-8 space-y-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Research Results</h1>
          <p className="text-[13px] text-ink-mute">Ordinary video of a real office (TUM RGB-D fr1/room, used as plain video), compared with the room the depth sensor measured.</p>
        </div>

        <section>
          <div className="card-title mb-2">1 · Before vs after</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <MiniScene name="freiburg1_room_B.json" label="Before completion (input video)" completed={false} />
            <MiniScene name="freiburg1_room_B.json" label="After completion (same reconstruction)" completed />
          </div>
          <p className="text-[11.5px] text-ink-mute mt-1.5">Green observed · amber uncertain · violet generated.</p>
        </section>

        {seq && (
          <section>
            <div className="card-title mb-2">2 · Measured results</div>
            <div className="card overflow-hidden">
              <table className="table">
                <thead><tr><th>Metric</th><th className="text-right">Baseline (no completion)</th><th className="text-right">Completion + NextBestView footage</th></tr></thead>
                <tbody>{rows.map(([label, k, f]) => (
                  <tr key={k}><td className="text-ink">{label}</td><td className="text-right tabular-nums">{f(v(seq, 'A', k))}</td>
                    <td className="text-right tabular-nums">{f(v(seq, 'C', k))}</td></tr>))}</tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-ink-mute mt-1.5">Distances in metres after aligning the video reconstruction to the dataset's motion capture (evaluation only).
              PSNR / SSIM / LPIPS are not reported: the reconstruction is not photo-textured.</p>
          </section>
        )}

      </div>
    </div>
  )
}
