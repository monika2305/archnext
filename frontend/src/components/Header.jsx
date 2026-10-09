import { Box, FileUp, Layers, PencilRuler, Plus, ShieldCheck } from 'lucide-react'
import SaveBadge from './SaveBadge.jsx'

const TABS = [
  { key: 'upload', label: 'Upload', icon: FileUp },
  { key: 'analysis', label: 'Analysis', icon: Layers },
  { key: 'studio', label: '3D Studio', icon: Box },
  { key: 'fix2build', label: 'Fix2Build', icon: PencilRuler },
  { key: 'validation', label: 'Validation', icon: ShieldCheck },
]

function ConfigDot({ on, label }) {
  return (
    <span className="flex items-center gap-1.5" title={`${label} is ${on ? 'on' : 'off'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-ok' : 'bg-ink-mute/40'}`} />
      <span className={on ? 'text-ink-soft' : 'text-ink-mute line-through decoration-ink-mute/50'}>{label}</span>
    </span>
  )
}

export default function Header({ view, onView, hasResult, config, onNew, save, onHome }) {
  return (
    <header className="h-14 shrink-0 bg-white/90 backdrop-blur border-b border-line flex items-center px-3 lg:px-5 gap-3 lg:gap-6">
      <a href="/" onClick={(e) => { e.preventDefault(); if (onHome) onHome(); else window.location.href = '/'; }}
         className="flex items-center gap-2.5 xl:min-w-[230px] shrink-0 hover:opacity-80 transition-opacity cursor-pointer text-inherit no-underline"
         title="Back to ArchNext Home">
        <svg viewBox="0 0 32 32" className="w-7 h-7" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#3F6A8F" />
          <path d="M8 23V9h9v6h7v8z" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
        </svg>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight flex items-center gap-1.5">
            ArchNext
            <span className="chip bg-accent-soft text-accent-dark h-5 px-1.5 text-[10.5px]">Blueprint → 3D</span>
          </div>
          <div className="text-[11px] text-ink-mute hidden lg:block">Every Line Becomes a Space.</div>
        </div>
      </a>

      <nav className="flex items-center gap-1 mx-auto">
        {TABS.map(({ key, label, icon: Icon }) => {
          const disabled = key !== 'upload' && !hasResult
          const active = view === key
          return (
            <button key={key} disabled={disabled} onClick={() => onView(key)} title={label}
              className={`h-9 px-3 rounded-lg flex items-center gap-2 whitespace-nowrap text-[13px] font-medium transition-colors
                ${active ? 'bg-accent-soft text-accent-dark' : 'text-ink-soft hover:bg-paper'}
                disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed`}>
              <Icon size={15} strokeWidth={1.8} />
              <span className="hidden lg:inline">{label}</span>
            </button>
          )
        })}
      </nav>

      <div className="flex items-center gap-3 xl:min-w-[230px] justify-end shrink-0">
        {config && (
          <button onClick={() => onView('validation')} title="Change on the Validation page"
                  className="hidden xl:flex items-center gap-3 text-[11.5px] px-2.5 h-8 rounded-lg hover:bg-paper">
            <span className="text-ink-soft font-medium">{{ ai: 'AI', hybrid: 'Hybrid' }[config.detection] || 'Standard'}</span>
            <ConfigDot on={config.topology_guard} label="TopologyGuard" />
            <ConfigDot on={config.scale_lock} label="ScaleLock" />
          </button>
        )}
        {hasResult && <SaveBadge save={save} compact />}
        {hasResult && (
          <button className="btn-secondary btn-sm" onClick={onNew} title="New plan"><Plus size={14} /><span className="hidden lg:inline">New plan</span></button>
        )}
      </div>
    </header>
  )
}
