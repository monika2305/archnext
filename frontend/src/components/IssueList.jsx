import { useMemo, useState } from 'react'
import { Check, ChevronDown, Hand, Wand2 } from 'lucide-react'
import { issueTitle } from '../lib/format.js'
import { issueColor } from './BlueprintOverlay.jsx'

const rank = (i) => (i.fixable ? 0 : i.severity === 'info' ? 2 : 1)

function DetailsToggle({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="text-[11.5px] text-ink-mute hover:text-ink-soft" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}>
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && <p className="basis-full text-[11.5px] text-ink-mute leading-snug mt-1">{children}</p>}
    </>
  )
}

export default function IssueList({ result, selected, onSelect, onFix, onEdit, busy, locked }) {
  const issues = result.topology.issues
  const open = useMemo(() => issues.filter((i) => i.status === 'review').sort((a, b) => rank(a) - rank(b)), [issues])
  const fixed = issues.filter((i) => i.status === 'fixed')
  const auto = issues.filter((i) => i.status === 'corrected')
  const [showDone, setShowDone] = useState(false)

  return (
    <div>
      {open.length === 0 ? (
        <div className="flex items-center gap-2 text-[12.5px] text-ok rounded-lg bg-ok/5 border border-ok/20 px-3 py-2.5">
          <Check size={15} />No issues left
        </div>
      ) : (
        <ul className="space-y-1">
          {open.map((i) => {
            const sel = selected === i.key
            return (
              <li key={i.key} className={`rounded-lg border transition-colors ${sel ? 'border-accent/40 bg-accent-soft/40' : 'border-transparent hover:bg-paper'}`}>
                <button className="w-full flex items-center gap-2.5 px-2.5 h-9 text-left" onClick={() => onSelect(sel ? null : i.key)}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: issueColor(i) }} />
                  <span className="text-[12.5px] font-medium text-ink flex-1 truncate">{issueTitle(i)}</span>
                  {i.fixable && <span className="chip bg-accent-soft text-accent-dark h-5 px-1.5 text-[10.5px]">Fixable</span>}
                </button>
                {sel && (
                  <div className="px-2.5 pb-2.5 flex flex-wrap items-center gap-2 fade-in">
                    {i.fixable ? (
                      <button className="btn-primary btn-sm" disabled={busy || locked} onClick={() => onFix(i)}><Wand2 size={13} />Fix</button>
                    ) : i.walls?.length > 0 ? (
                      <button className="btn-secondary btn-sm" disabled={busy || locked} onClick={() => onEdit(i)}><Hand size={13} />Edit by hand</button>
                    ) : null}
                    <DetailsToggle>{i.message.replace(/\s*Manual review required[^.]*\.?/, '')}</DetailsToggle>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {(fixed.length > 0 || auto.length > 0) && (
        <div className="mt-3">
          <button className="flex items-center gap-1.5 text-[11.5px] text-ink-mute hover:text-ink-soft" onClick={() => setShowDone((v) => !v)}>
            <ChevronDown size={13} className={`transition-transform ${showDone ? '' : '-rotate-90'}`} />
            {auto.length} auto-fixed{fixed.length > 0 && ` · ${fixed.length} fixed by you`}
          </button>
          {showDone && (
            <ul className="mt-1.5 space-y-1 pl-5">
              {[...fixed, ...auto].map((i) => (
                <li key={i.key} className="text-[11.5px] text-ink-mute flex gap-1.5">
                  <Check size={12} className={`${i.status === 'fixed' ? 'text-ok' : 'text-accent'} mt-0.5 shrink-0`} />{issueTitle(i)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
