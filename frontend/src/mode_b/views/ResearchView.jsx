import { useEffect, useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import { modeB } from '../api.js'

// Research evaluation (A/B/C/D ablation). Shows only results produced by mode_b.evaluation.run_ablation.
export default function ResearchView() {
  const [r, setR] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { modeB.research().then(setR).catch((e) => setError(e.message)) }, [])
  if (error) return <div className="p-8 text-[13px] text-bad">{error}</div>
  if (!r) return <div className="h-full grid place-items-center"><Loader2 className="animate-spin text-accent" /></div>
  return (
    <div className="h-full grid place-items-center p-8">
      <div className="card p-6 max-w-lg text-center">
        <FlaskConical className="mx-auto text-accent" />
        <div className="card-title mt-2">Research evaluation</div>
        <p className="text-[13px] text-ink-mute mt-1">{r.available ? 'Results available.' : r.reason}</p>
      </div>
    </div>
  )
}
