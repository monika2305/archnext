import { Box, Download, Film, FlaskConical, LayoutGrid, Plus } from 'lucide-react'

// Mode B header: same structure and styling as the Mode A header (components/Header.jsx), its own tabs.
export const MODE_B_TABS = [
  { key: 'overview', label: 'Upload', icon: LayoutGrid, needs: null },
  { key: 'reconstruction', label: 'Generate', icon: Film, needs: 'project' },
  { key: 'scene', label: '3D Room', icon: Box, needs: 'scene' },
  { key: 'export', label: 'Export', icon: Download, needs: 'scene' },
  { key: 'research', label: 'Research', icon: FlaskConical, needs: null, advanced: true },
]
// VisionTrust / NextBestView pages are no longer in the navigation; their data now drives X-Ray Honesty and
// "Show completed region" inside the 3D Room. (The algorithms and stored data are unchanged.)

export function tabEnabled(tab, { project, scene }) {
  if (tab.needs === 'project') return !!project
  if (tab.needs === 'scene') return !!scene
  if (tab.needs === 'analysis') return !!scene
  return true
}

export default function ModeBHeader({ view, onView, project, scene, onNew, onHome }) {
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
          <div className="text-[14px] font-semibold tracking-tight flex items-center gap-1.5">ArchNext
            <span className="chip bg-accent-soft text-accent-dark h-5 px-1.5 text-[10.5px]">Video → 3D</span></div>
          <div className="text-[11px] text-ink-mute hidden lg:block">Reconstruct what you see. Reveal what you assume.</div>
        </div>
      </a>

      <nav className="flex items-center gap-1 mx-auto" aria-label="Mode B">
        {MODE_B_TABS.map((t, k) => {
          const Icon = t.icon
          const disabled = !tabEnabled(t, { project, scene })
          const active = view === t.key
          return (
            <span key={t.key} className="contents">
            {t.advanced && !MODE_B_TABS[k - 1].advanced && <span className="w-px h-5 bg-line mx-1.5" title="Advanced" />}
            <button disabled={disabled} onClick={() => onView(t.key)} title={t.label}
              className={`h-9 px-3 rounded-lg flex items-center gap-2 whitespace-nowrap text-[13px] font-medium transition-colors
                ${active ? 'bg-accent-soft text-accent-dark' : 'text-ink-soft hover:bg-paper'}
                disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-not-allowed`}>
              <Icon size={15} strokeWidth={1.8} />
              <span className={`hidden xl:inline ${t.advanced ? 'text-[12px]' : ''}`}>{t.label}</span>
            </button>
            </span>
          )
        })}
      </nav>

      <div className="flex items-center gap-3 xl:min-w-[230px] justify-end shrink-0">
        {project && <span className="hidden xl:block text-[12px] text-ink-soft font-medium truncate max-w-[160px]" title={project.name}>{project.name}</span>}
        {project && (
          <button className="btn-secondary btn-sm" onClick={onNew} title="New video"><Plus size={14} /><span className="hidden lg:inline">New video</span></button>
        )}
      </div>
    </header>
  )
}
