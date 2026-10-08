import { Ruler } from 'lucide-react'
import { SCALE_STATUS, TONE } from '../lib/format.js'

export default function ScaleBadge({ scale, short = false, className = '' }) {
  const s = SCALE_STATUS[scale.status]
  return <span className={`chip ${TONE[s.tone]} ${className}`}><Ruler size={12} />{short ? s.short : s.label}</span>
}
