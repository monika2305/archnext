import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'

const MODES = [
  ['standard', 'Standard', 'OpenCV line detection'],
  ['ai', 'AI', 'Pretrained CubiCasa5K model'],
  ['hybrid', 'Hybrid', 'OpenCV + AI combined'],
]

/** Compact detection-mode switch. Changing it re-runs the selected detector for this plan. */
export default function DetectionSelect({ result, onConfig, busy }) {
  const [ai, setAi] = useState(null)
  useEffect(() => { api.aiStatus().then(setAi).catch(() => setAi({ available: false, reason: 'Status unavailable' })) }, [])
  const cfg = result.config || {}
  const det = result.detection || {}
  const current = cfg.detection || 'standard'
  const fellBack = det.requested && det.used && det.requested !== det.used

  return (
    <div className="px-4 py-2.5 border-b border-line">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-ink-mute">Detection</span>
        {busy && <Loader2 size={13} className="animate-spin text-accent" />}
        <div className="seg ml-auto">
          {MODES.map(([key, label, hint]) => {
            const off = key !== 'standard' && ai && !ai.available
            return (
              <button key={key} data-active={current === key} disabled={busy || off}
                      title={off ? `Unavailable: ${ai.reason}` : hint}
                      className="disabled:opacity-40"
                      onClick={() => current !== key && onConfig(cfg.topology_guard, cfg.scale_lock, key)}>
                {label}
              </button>
            )
          })}
        </div>
      </div>
      {fellBack && (
        <p className="text-[11.5px] text-warn mt-1.5 flex items-start gap-1.5" title={det.fallback || ''}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />AI unavailable, Standard used
        </p>
      )}
    </div>
  )
}
