import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Crosshair, Loader2, Minus, PenLine, Plus, RotateCcw, Undo2, X } from 'lucide-react'
import BlueprintOverlay, { OPENING_COLOR } from '../components/BlueprintOverlay.jsx'
import IssueList from '../components/IssueList.jsx'
import ScaleBadge from '../components/ScaleBadge.jsx'
import { api } from '../lib/api.js'

const LAYERS = [
  ['walls', 'Walls', '#4F6578'], ['rooms', 'Rooms', '#C9B79A'], ['openings', 'Doors & windows', OPENING_COLOR.door], ['issues', 'Issues', '#B07A2A'],
]

export default function AnalysisView({ result, onResult, onStudio }) {
  const [layers, setLayers] = useState({ walls: true, rooms: true, openings: true, issues: true })
  const [selected, setSelected] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [mode, setMode] = useState(null)        // null | 'fix' | 'edit' | 'scale'
  const [fixIssue, setFixIssue] = useState(null)
  const [editWallId, setEditWallId] = useState(null)
  const [editCheck, setEditCheck] = useState(null)
  const [picks, setPicks] = useState([])
  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState('m')
  const [busy, setBusy] = useState(false)
  const [busyText, setBusyText] = useState('')
  const [notice, setNotice] = useState(null)    // { ok, text }
  const [showNotes, setShowNotes] = useState(false)
  const noticeTimer = useRef(null)

  const cfgKey = `${result.config?.topology_guard}-${result.config?.scale_lock}`
  useEffect(() => { exitMode(); setSelected(null) }, [cfgKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  const flash = (ok, text) => {
    setNotice({ ok, text })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), ok ? 4000 : 6000)
  }
  function exitMode() {
    setMode(null); setFixIssue(null); setEditWallId(null); setEditCheck(null); setPicks([]); setDistance('')
  }
  const run = async (fn, text = 'Working…') => {
    setBusy(true); setBusyText(text)
    try { await fn() } catch (e) { flash(false, e.message) } finally { setBusy(false) }
  }

  // Fix -> Preview -> Apply / Cancel
  const startFix = (issue) => { exitMode(); setMode('fix'); setFixIssue(issue); setSelected(issue.key); setLayers((l) => ({ ...l, walls: true })) }
  const applyFix = () => run(async () => {
    const r = await api.applyFix(result.id, fixIssue.key)
    onResult(r); exitMode(); setSelected(null)
    flash(r.last_fix.resolved, r.last_fix.resolved ? `${r.last_fix.applied} applied` : `${r.last_fix.applied} applied, issue remains`)
  }, 'Applying…')
  const undo = () => run(async () => { onResult(await api.undoFix(result.id)); exitMode(); flash(true, 'Undone') })

  // Manual wall-end editing (snapped and validated by the server)
  const startEdit = (issue) => {
    exitMode(); setMode('edit'); setLayers((l) => ({ ...l, walls: true, openings: true }))
    if (issue) { setSelected(issue.key); setEditWallId(issue.walls[0]) }
  }
  const checkEdit = (wallId, end, x, y) => run(async () => {
    const w = result.geometry.corrected.walls.find((v) => v.id === wallId)
    setEditCheck({ pending: true, ok: true, end, x, y, after: end === 0 ? { ...w, x1: x, y1: y } : { ...w, x2: x, y2: y } })
    const { check } = await api.editWall(result.id, wallId, end, x, y, true)
    setEditCheck({ ...check, end, x, y })
  }, 'Checking…')
  const applyEdit = () => run(async () => {
    const c = editCheck
    const r = await api.editWall(result.id, c.after.id, c.end, c.x, c.y)
    onResult(r); setEditCheck(null); setEditWallId(null); flash(true, 'Wall updated')
  }, 'Applying…')

  // Scale calibration
  const startScale = () => { exitMode(); setMode('scale') }
  const onPick = (p) => setPicks((cur) => (cur.length >= 2 ? [p] : [...cur, p]))
  const applyScale = () => run(async () => {
    onResult(await api.calibrate(result.id, picks[0], picks[1], parseFloat(distance), unit)); exitMode(); flash(true, 'Scale set')
  })
  const resetScale = () => run(async () => { onResult(await api.resetCalibration(result.id)); flash(true, 'Using automatic scale') })

  const g = result.geometry.corrected.stats
  const tgOn = result.config?.topology_guard !== false
  const openIssues = result.topology.issues.filter((i) => i.status === 'review').length
  const scale = result.scale
  const notes = [...result.warnings, ...(scale.warnings || [])]

  return (
    <div className="h-full p-5 grid grid-cols-[1fr_300px] gap-5 min-h-0">
      <section className="card min-h-0 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-line flex items-center gap-1 overflow-x-auto scrollbar-thin">
          {LAYERS.map(([k, l, c]) => (
            <button key={k} data-on={layers[k]} className="toggle-chip" onClick={() => setLayers((s) => ({ ...s, [k]: !s[k] }))}>
              <span className="w-2 h-2 rounded-full" style={{ background: layers[k] ? c : '#C9C6BF' }} />{l}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <button className={`btn-sm ${mode === 'edit' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => (mode === 'edit' ? exitMode() : startEdit(null))}
                    title="Move wall ends by hand"><PenLine size={14} /><span className="hidden lg:inline">Edit walls</span></button>
            <span className="w-px h-5 bg-line mx-1" />
            <button className="icon-btn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} title="Zoom out"><Minus size={15} /></button>
            <button className="btn-ghost btn-sm tabular-nums w-12 px-1" onClick={() => setZoom(1)} title="Fit">{Math.round(zoom * 100)}%</button>
            <button className="icon-btn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} title="Zoom in"><Plus size={15} /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          <div className="absolute inset-0 overflow-auto scrollbar-thin blueprint-bg p-5">
            <BlueprintOverlay result={result} layers={layers} selectedKey={selected} zoom={zoom}
                              onSelectIssue={(key) => setSelected(key)}
                              preview={mode === 'fix' ? fixIssue : null}
                              pickMode={mode === 'scale'} picks={picks} onPick={onPick}
                              editMode={mode === 'edit'} editWallId={editWallId}
                              onEditWall={(id) => { setEditWallId(id); setEditCheck(null) }}
                              editCheck={editCheck} onDragEnd={checkEdit} />
          </div>

          {mode === 'fix' && fixIssue && (
            <div className="float-bar fade-in">
              <span className="font-medium">{fixIssue.fix.label}</span>
              <span className="flex items-center gap-1 text-ink-mute"><span className="w-3 h-2 rounded-sm border border-dashed border-bad bg-bad/20" />now</span>
              <span className="flex items-center gap-1 text-ink-mute mr-1"><span className="w-3 h-2 rounded-sm bg-ok" />after</span>
              <button className="btn-secondary btn-sm" onClick={exitMode} disabled={busy}><X size={13} />Cancel</button>
              <button className="btn-primary btn-sm" onClick={applyFix} disabled={busy}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Apply</button>
            </div>
          )}

          {mode === 'edit' && (
            <div className="float-bar fade-in">
              {busy ? <span className="flex items-center gap-2 text-ink-soft"><Loader2 size={14} className="animate-spin" />{busyText}</span>
                : !editWallId ? <span className="text-ink-soft">Click a wall, then drag an end</span>
                  : !editCheck ? <span className="text-ink-soft">Drag a blue handle · snaps to walls</span>
                    : editCheck.ok ? (
                      <span className="flex items-center gap-1.5 text-ok"><Check size={14} />
                        {editCheck.snapped ? `Snapped to ${editCheck.snapped}` : 'Looks good'}
                        <span className="text-ink-mute">· {editCheck.rooms_after} rooms</span></span>
                    ) : <span className="flex items-center gap-1.5 text-bad"><X size={14} />{editCheck.reason}</span>}
              {editCheck && <button className="btn-secondary btn-sm" onClick={() => setEditCheck(null)} disabled={busy}>Reset</button>}
              {editCheck?.ok && <button className="btn-primary btn-sm" onClick={applyEdit} disabled={busy}><Check size={13} />Apply</button>}
              <button className="btn-ghost btn-sm" onClick={exitMode} disabled={busy}>Done</button>
            </div>
          )}

          {mode === 'scale' && (
            <div className="float-bar fade-in">
              <Crosshair size={14} className="text-accent" />
              {picks.length < 2 ? <span className="text-ink-soft">Click two points with a known distance ({picks.length}/2)</span> : (
                <>
                  <input className="input h-8 w-24" type="number" min="0" step="any" placeholder="Length" autoFocus
                         value={distance} onChange={(e) => setDistance(e.target.value)} />
                  <select className="input h-8 w-16 px-2" value={unit} onChange={(e) => setUnit(e.target.value)}>
                    {['m', 'cm', 'mm', 'ft', 'in'].map((u) => <option key={u}>{u}</option>)}
                  </select>
                  <button className="btn-primary btn-sm" disabled={!(parseFloat(distance) > 0) || busy} onClick={applyScale}>
                    {busy && <Loader2 size={13} className="animate-spin" />}Apply</button>
                </>
              )}
              <button className="btn-ghost btn-sm" onClick={exitMode} disabled={busy}>Cancel</button>
            </div>
          )}

          {!mode && notice && (
            <div className={`float-bar fade-in ${notice.ok ? 'text-ok' : 'text-bad'}`}>
              {notice.ok ? <Check size={14} /> : <AlertTriangle size={14} />}<span>{notice.text}</span>
              {notice.ok && result.topology.can_undo && <button className="btn-ghost btn-sm text-ink-soft" onClick={undo} disabled={busy}><Undo2 size={13} />Undo</button>}
            </div>
          )}
          {mode && notice && !notice.ok && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 glass rounded-lg px-3 py-1.5 text-[12.5px] text-bad flex items-center gap-1.5 fade-in">
              <AlertTriangle size={13} />{notice.text}
            </div>
          )}
        </div>
      </section>

      <aside className="card min-h-0 flex flex-col overflow-hidden">
        <div className="grid grid-cols-5 border-b border-line">
          {[['Rooms', g.rooms], ['Walls', g.walls], ['Doors', g.doors], ['Windows', g.windows], ['Issues', tgOn ? openIssues : '—']].map(([l, v]) => (
            <div key={l} className="py-3 text-center">
              <div className={`text-[17px] font-semibold tabular-nums ${l === 'Issues' && openIssues > 0 ? 'text-warn' : ''}`}>{v}</div>
              <div className="text-[10.5px] text-ink-mute">{l}</div>
            </div>
          ))}
        </div>

        <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
          <ScaleBadge scale={scale} />
          {scale.status === 'manual' && scale.auto_available
            ? <button className="btn-ghost btn-sm ml-auto" onClick={resetScale} disabled={busy}><RotateCcw size={13} />Auto</button>
            : <button className="btn-ghost btn-sm ml-auto" onClick={startScale} disabled={busy}><Crosshair size={13} />Set scale</button>}
        </div>

        <div className="flex-1 min-h-0 overflow-auto scrollbar-thin p-3">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="label">Issues</span>
            <button className="btn-ghost btn-sm h-7" onClick={undo} disabled={!result.topology.can_undo || busy} title="Undo last change"><Undo2 size={13} />Undo</button>
          </div>
          {tgOn ? (
            <IssueList result={result} selected={selected} onSelect={setSelected} onFix={startFix} onEdit={startEdit}
                       busy={busy} locked={!!mode && mode !== 'edit'} />
          ) : (
            <div className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] text-ink-mute">
              TopologyGuard is off. Loose wall ends are marked in red.
              <div className="text-ink-soft mt-1 tabular-nums">{result.geometry.corrected.stats.dangling_endpoints} loose ends</div>
            </div>
          )}

          {notes.length > 0 && (
            <div className="mt-4 px-1">
              <button className="flex items-center gap-1.5 text-[11.5px] text-warn" onClick={() => setShowNotes((v) => !v)}>
                <AlertTriangle size={12} />{notes.length} note{notes.length > 1 ? 's' : ''}
              </button>
              {showNotes && <ul className="mt-1.5 space-y-1">{notes.map((w) => <li key={w} className="text-[11.5px] text-ink-mute leading-snug">{w}</li>)}</ul>}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-line">
          <button className="btn-primary w-full h-10" onClick={onStudio} disabled={!!mode && mode !== 'edit'}>Open 3D <ArrowRight size={15} /></button>
        </div>
      </aside>
    </div>
  )
}
