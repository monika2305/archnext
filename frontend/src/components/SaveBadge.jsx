import { AlertTriangle, CheckCircle2, CircleDot, Loader2 } from 'lucide-react'

// Saved / unsaved indicator for the open plan (state from lib/session.js saveState).
export default function SaveBadge({ save, compact = false }) {
  if (!save || save.status === 'none') return null
  const tone = {
    saved: 'text-ok',
    saving: 'text-accent',
    pending: 'text-warn',
    unsaved: 'text-warn',
    error: 'text-bad',
  }[save.status]
  const Icon = { saved: CheckCircle2, saving: Loader2, error: AlertTriangle }[save.status] || CircleDot
  return (
    <span data-testid="save-state" data-status={save.status} title={`${save.label}. ${save.detail}`}
          className={`flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap ${tone}`}>
      <Icon size={13} className={save.status === 'saving' ? 'animate-spin' : ''} />
      <span className={compact ? 'hidden lg:inline' : ''}>{save.label}</span>
    </span>
  )
}
