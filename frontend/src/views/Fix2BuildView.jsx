import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Box, Check, DoorOpen, Download, Footprints, Loader2, Maximize2, Minimize2, MousePointer2, Orbit, Redo2,
  RotateCcw, Save, Scan, SquareDashed, Trash2, Undo2, X,
} from 'lucide-react'
import ModelViewer, { GLOW } from '../components/ModelViewer.jsx'
import PlanEditor from '../components/PlanEditor.jsx'
import { api } from '../lib/api.js'
import { downloadBlob, exportGLB } from '../lib/buildModel.js'
import { wallLength } from '../lib/planGeometry.js'

const TOOLS = [
  ['select', 'Select & move', MousePointer2, 'V'],
  ['wall', 'Draw wall', SquareDashed, 'W'],
  ['door', 'Add door', DoorOpen, 'D'],
  ['window', 'Add window', Scan, 'N'],
]
const OP_TEXT = {
  delete_wall: 'Delete wall', delete_opening: 'Remove opening (fill with wall)', set_wall: 'Change wall',
  resize_opening: 'Resize opening', set_opening_type: 'Change opening type', reset: 'Reset to detected geometry',
}

function NumField({ label, value, unit, onCommit, step = 0.01, min, max }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
      <span className="w-14 shrink-0">{label}</span>
      <input className="input h-7 w-20 px-2 text-[12px] tabular-nums" type="number" step={step} min={min} max={max} value={v}
             onChange={(e) => setV(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Enter') onCommit(parseFloat(v)) }} />
      <span className="text-ink-mute w-5">{unit}</span>
      <button className="btn-secondary btn-sm h-7 px-2" disabled={!(parseFloat(v) > 0) || parseFloat(v) === value}
              onClick={() => onCommit(parseFloat(v))}>Preview</button>
    </label>
  )
}

function Inspector({ result, geometry, selection, onPreview, onRename, busy, wallHeight }) {
  const s = result.scale.meters_per_px
  const est = result.scale.status === 'estimated'
  const [name, setName] = useState('')
  const room = selection?.kind === 'room' ? geometry.rooms.find((r) => r.id === selection.id) : null
  const wall = selection?.kind === 'wall' ? geometry.walls.find((w) => w.id === selection.id) : null
  const op = selection?.kind === 'opening' ? geometry.openings.find((o) => o.id === selection.id) : null
  useEffect(() => { setName(room?.name || '') }, [room?.id, room?.name])
  if (!room && !wall && !op) {
    return <div className="text-[12px] text-ink-mute">Click a room, wall, door or window, in 2D or in 3D.</div>
  }
  return (
    <div className="space-y-2 fade-in">
      {room && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GLOW.emerald, boxShadow: `0 0 8px ${GLOW.emerald}` }} />
            <span className="text-[13px] font-semibold">Room</span>
            <span className="text-[11px] font-mono text-violet-600">{room.id}</span>
          </div>
          <div className="flex gap-1.5">
            <input className="input h-8 flex-1 text-[12.5px]" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') onRename(room.id, name) }} aria-label="Room name" />
            <button className="btn-primary btn-sm h-8" disabled={busy || name.trim() === room.name} onClick={() => onRename(room.id, name)}>Rename</button>
          </div>
          <div className="text-[12px] text-ink-soft tabular-nums">
            {room.area_m2.toFixed(2)} m²{est && <span className="text-warn"> · estimated scale</span>}
            {room.rectangularity >= 0.85 ? ` · ${room.length_m.toFixed(2)} × ${room.width_m.toFixed(2)} m` : ' · irregular shape'}
          </div>
        </>
      )}
      {wall && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GLOW.cyan, boxShadow: `0 0 8px ${GLOW.cyan}` }} />
            <span className="text-[13px] font-semibold">{wall.exterior ? 'Exterior wall' : 'Wall'}</span>
            <span className="text-[11px] font-mono text-cyan-700">{wall.id}</span>
            <span className="ml-auto text-[12px] tabular-nums text-ink-soft">{(wallLength(wall) * s).toFixed(2)} m long</span>
          </div>
          <NumField label="Thickness" value={+(wall.thickness * s * 100).toFixed(1)} unit="cm" step={1}
                    onCommit={(cm) => onPreview({ op: 'set_wall', wall: wall.id, thickness: cm / 100 / s })} />
          <NumField label="Height" value={+(wall.height ?? wallHeight).toFixed(2)} unit="m" step={0.05} min={1} max={8}
                    onCommit={(m) => onPreview({ op: 'set_wall', wall: wall.id, height: m })} />
          <button className="btn-secondary btn-sm text-bad" disabled={busy} onClick={() => onPreview({ op: 'delete_wall', wall: wall.id })}>
            <Trash2 size={13} />Delete wall</button>
          <p className="text-[11px] text-ink-mute">Drag the wall to move it, or a cyan handle to move an end.</p>
        </>
      )}
      {op && (
        <>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: GLOW.amber, boxShadow: `0 0 8px ${GLOW.amber}` }} />
            <span className="text-[13px] font-semibold capitalize">{op.type}</span>
            <span className="text-[11px] font-mono text-amber-700">{op.id}</span>
            {op.source === 'user' && <span className="chip bg-ok/10 text-ok h-5">edited</span>}
          </div>
          <div className="seg">
            {['door', 'window', 'opening'].map((ty) => (
              <button key={ty} data-active={op.type === ty} disabled={busy} className="capitalize"
                      onClick={() => op.type !== ty && onPreview({ op: 'set_opening_type', opening: op.id, type: ty })}>{ty}</button>
            ))}
          </div>
          <NumField label="Width" value={+(op.width * s * 100).toFixed(0)} unit="cm" step={5}
                    onCommit={(cm) => onPreview({ op: 'resize_opening', opening: op.id, width: cm / 100 / s })} />
          <button className="btn-secondary btn-sm text-bad" disabled={busy} onClick={() => onPreview({ op: 'delete_opening', opening: op.id })}>
            <Trash2 size={13} />Remove opening</button>
          <p className="text-[11px] text-ink-mute">Drag it along its wall to move it.</p>
        </>
      )}
    </div>
  )
}

export default function Fix2BuildView({ result, onResult, selection, onSelect }) {
  const [tool, setTool] = useState('select')
  const [split, setSplit] = useState(50)
  const [full, setFull] = useState(null)            // '2d' | '3d' | null
  const [draft, setDraft] = useState(null)          // live drag geometry (both panels)
  const [pending, setPending] = useState(null)      // geometry shown while the server applies a drag
  const [preview, setPreview] = useState(null)      // { op, geometry, removed }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)              // { ok, text }
  const [mode, setMode] = useState('orbit')
  const [labels, setLabels] = useState(false)
  const [focusKey, setFocusKey] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const [fitKey, setFitKey] = useState(0)
  const wallHeight = result.scale.assumptions.wall_height_m
  const body = useRef(null)
  const msgTimer = useRef(null)

  const say = useCallback((ok, text) => {
    setMsg({ ok, text })
    clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), ok ? 3000 : 6000)
  }, [])
  useEffect(() => () => clearTimeout(msgTimer.current), [])
  useEffect(() => { setPreview(null); setPending(null) }, [result])

  const shown = preview?.geometry || draft || pending || result.geometry.corrected

  const commit = useCallback(async (op, draftGeom) => {
    setBusy(true)
    if (draftGeom) setPending(draftGeom)
    try {
      const r = await api.edit(result.id, op)
      onResult(r)
      if (r.edit?.created) {
        const kind = op.op === 'add_wall' ? 'wall' : 'opening'
        onSelect({ kind, id: r.edit.created, from: '2d' })
      }
      const lost = r.edit?.removed_openings?.length
      say(true, lost ? `Done. ${lost} opening(s) lost their wall and were removed.` : 'Applied')
    } catch (e) {
      setPending(null)
      say(false, e.message)
    } finally { setBusy(false) }
  }, [result.id, onResult, onSelect, say])

  const startPreview = useCallback(async (op) => {
    setBusy(true)
    try {
      const { check } = await api.editPreview(result.id, op)
      if (!check.ok) return say(false, check.reason)
      if (!check.preview) return commit(op)          // nothing to show (e.g. rename)
      setPreview({ op, geometry: check.preview, removed: check.removed_openings })
    } catch (e) { say(false, e.message) } finally { setBusy(false) }
  }, [result.id, say, commit])

  const applyPreview = () => { const op = preview.op; setPreview(null); commit(op) }
  const history = useCallback(async (kind) => {
    setBusy(true); setPreview(null)
    try { onResult(await (kind === 'undo' ? api.undoFix(result.id) : api.redo(result.id))); say(true, kind === 'undo' ? 'Undone' : 'Redone') }
    catch (e) { say(false, e.message) } finally { setBusy(false) }
  }, [result.id, onResult, say])
  const save = async () => {
    try {
      const proj = await api.saveProject(result.id)
      downloadBlob(new Blob([JSON.stringify(proj)], { type: 'application/json' }), `${(result.filename || 'plan').replace(/\.[^.]+$/, '')}.archnext.json`)
      say(true, 'Project saved. Reopen it from the Upload page.')
    } catch (e) { say(false, e.message) }
  }
  const exportModel = async () => {
    try {
      const blob = await exportGLB(result, { wallHeight, doorHeight: result.scale.assumptions.door_height_m,
        sill: result.scale.assumptions.window_sill_m, head: result.scale.assumptions.window_head_m })
      downloadBlob(blob, `${(result.filename || 'plan').replace(/\.[^.]+$/, '')}-archnext.glb`)
      say(true, 'GLB exported from the current geometry')
    } catch (e) { say(false, `Export failed: ${e.message || e}`) }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.closest?.('input, textarea, select')) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); history(e.shiftKey ? 'redo' : 'undo') }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); history('redo') }
      else if (e.ctrlKey || e.metaKey || e.altKey) return
      else if (k === 'escape') { setPreview(null); setTool('select'); onSelect(null) }
      else if ((k === 'delete' || k === 'backspace') && selection && !busy) {
        e.preventDefault()
        if (selection.kind === 'wall') startPreview({ op: 'delete_wall', wall: selection.id })
        if (selection.kind === 'opening') startPreview({ op: 'delete_opening', opening: selection.id })
      } else if (k === 'enter' && preview) applyPreview()
      else if (k === 'f') setFocusKey((n) => n + 1)
      else {
        const tl = TOOLS.find((x) => x[3].toLowerCase() === k)
        if (tl) setTool(tl[0])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Resizable split
  const dragSplit = (e) => {
    const rect = body.current.getBoundingClientRect()
    const move = (ev) => setSplit(Math.min(78, Math.max(22, ((ev.clientX - rect.left) / rect.width) * 100)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  const t = result.topology
  const cols = full === '2d' ? '1fr 0px 0fr' : full === '3d' ? '0fr 0px 1fr' : `${split}fr 6px ${100 - split}fr`

  return (
    <div className="h-full p-4 flex flex-col gap-3 min-h-0">
      {/* Toolbar */}
      <div className="card px-2 py-1.5 flex items-center gap-1 flex-wrap">
        <div className="seg">
          {TOOLS.map(([key, label, Icon, k]) => (
            <button key={key} data-active={tool === key} onClick={() => setTool(key)} title={`${label} (${k})`}>
              <Icon size={14} /><span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </div>
        <span className="w-px h-5 bg-line mx-1" />
        <button className="icon-btn" onClick={() => history('undo')} disabled={busy || !t.can_undo} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
        <button className="icon-btn" onClick={() => history('redo')} disabled={busy || !t.can_redo} title="Redo (Ctrl+Y)"><Redo2 size={16} /></button>
        <button className="btn-ghost btn-sm" onClick={() => startPreview({ op: 'reset' })} disabled={busy || !t.edited}
                title="Back to the detected geometry (undoable)"><RotateCcw size={14} /><span className="hidden lg:inline">Reset</span></button>
        <div className="ml-auto flex items-center gap-1.5">
          {busy && <Loader2 size={15} className="animate-spin text-accent" />}
          <button className="btn-secondary btn-sm" onClick={save} title="Save the edited project to a file"><Save size={14} />Save</button>
          <button className="btn-primary btn-sm" onClick={exportModel} title="Export the current geometry as GLB"><Download size={14} />Export GLB</button>
        </div>
      </div>

      {/* Panels */}
      <div ref={body} className="flex-1 min-h-0 grid gap-0 max-lg:!grid-cols-1 max-lg:!grid-rows-2" style={{ gridTemplateColumns: cols }}>
        <section className={`card relative min-h-0 overflow-hidden flex flex-col ${full === '3d' ? 'hidden' : ''}`}>
          <div className="relative flex-1 min-h-0">
          <div className="absolute top-2 left-2 z-10 glass rounded-lg px-2.5 h-8 flex items-center gap-2 text-[12px] font-medium">2D blueprint
            <button className="icon-btn w-6 h-6" onClick={() => setFitKey((n) => n + 1)} title="Fit to view"><Scan size={13} /></button>
            <button className="icon-btn w-6 h-6" onClick={() => setFull(full === '2d' ? null : '2d')} title={full === '2d' ? 'Exit fullscreen' : 'Fullscreen'}>
              {full === '2d' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
          </div>
          <div className="absolute inset-0 blueprint-bg">
            <PlanEditor result={result} geometry={preview?.geometry || pending || result.geometry.corrected} tool={preview ? 'none' : tool}
                        selection={selection} onSelect={onSelect} onCommand={commit} onDraft={setDraft} busy={busy || !!preview} fitKey={fitKey} />
          </div>
          </div>
          {/* Inspector docked below the plan so it never covers walls or rooms */}
          <div className="border-t border-line px-3 py-2.5 max-h-[45%] overflow-auto scrollbar-thin">
            <Inspector result={result} geometry={shown} selection={selection} busy={busy} wallHeight={wallHeight}
                       onPreview={startPreview} onRename={(id, name) => commit({ op: 'rename_room', room: id, name })} />
          </div>
        </section>
        <div className={`cursor-col-resize flex items-center justify-center max-lg:hidden ${full ? 'hidden' : ''}`} onPointerDown={dragSplit}
             title="Drag to resize">
          <span className="w-1 h-10 rounded-full bg-line" />
        </div>
        <section className={`card relative min-h-0 overflow-hidden ${full === '2d' ? 'hidden' : ''}`}>
          <ModelViewer result={result} geometry={shown} wallHeight={wallHeight} mode={mode} labels={labels}
                       selection={selection} onSelect={onSelect} focusKey={focusKey} resetKey={resetKey} />
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
            <span className="glass rounded-lg px-2.5 h-8 flex items-center text-[12px] font-medium">Live 3D</span>
            <div className="seg glass">
              <button data-active={mode === 'orbit'} onClick={() => setMode('orbit')}><Orbit size={13} />Orbit</button>
              <button data-active={mode === 'walk'} onClick={() => setMode('walk')}><Footprints size={13} />Walk</button>
            </div>
          </div>
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
            <button className={`glass btn-sm btn ${labels ? 'text-accent' : 'text-ink-soft'}`} onClick={() => setLabels((v) => !v)} title="Room labels"><Box size={13} />Labels</button>
            <button className="glass btn-sm btn text-ink-soft" onClick={() => { onSelect(null); setMode('orbit'); setResetKey((n) => n + 1) }}
                    title="Whole building"><RotateCcw size={13} />Full view</button>
            <button className="icon-btn glass w-8 h-8" onClick={() => setFull(full === '3d' ? null : '3d')} title={full === '3d' ? 'Exit fullscreen' : 'Fullscreen'}>
              {full === '3d' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
          </div>
          {mode === 'walk' && <div className="absolute left-2 bottom-2 glass rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft">W A S D to move · drag to look</div>}
        </section>
      </div>

      {preview && (
        <div className="float-bar !bottom-6 fade-in">
          <span className="font-medium">Preview: {OP_TEXT[preview.op.op] || 'Edit'}</span>
          {preview.removed?.length > 0 && <span className="text-warn">· removes {preview.removed.length} opening(s)</span>}
          <span className="text-ink-mute">· {preview.geometry.rooms.length} rooms</span>
          <button className="btn-secondary btn-sm" onClick={() => setPreview(null)}><X size={13} />Cancel</button>
          <button className="btn-primary btn-sm" onClick={applyPreview}><Check size={13} />Apply</button>
        </div>
      )}
      {!preview && msg && (
        <div className={`float-bar !bottom-6 fade-in ${msg.ok ? 'text-ok' : 'text-bad'}`}>
          {msg.ok ? <Check size={14} /> : <AlertTriangle size={14} />}{msg.text}
          {msg.ok && t.can_undo && <button className="btn-ghost btn-sm text-ink-soft" onClick={() => history('undo')}><Undo2 size={13} />Undo</button>}
        </div>
      )}
    </div>
  )
}
