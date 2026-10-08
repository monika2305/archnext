import { useState } from 'react'
import { Download, Footprints, Loader2, Orbit, RotateCcw, Settings2, X } from 'lucide-react'
import { downloadBlob, exportGLB, planFrame } from '../lib/buildModel.js'
import { fmtM, fmtM2 } from '../lib/format.js'
import ScaleBadge from '../components/ScaleBadge.jsx'
import ModelViewer from '../components/ModelViewer.jsx'

function Switch({ on, onChange, label }) {
  return (
    <button className="w-full flex items-center justify-between py-1.5 text-[12.5px] text-ink-soft" onClick={() => onChange(!on)}>
      {label}
      <span className={`w-8 h-[18px] rounded-full p-0.5 transition-colors ${on ? 'bg-accent' : 'bg-line'}`}>
        <span className={`block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-3.5' : ''}`} />
      </span>
    </button>
  )
}

export default function StudioView({ result, selection, onSelect }) {
  const [mode, setMode] = useState('orbit')     // orbit | walk
  const [view, setView] = useState('perspective') // perspective | top
  const [labels, setLabels] = useState(true)
  const [wallHeight, setWallHeight] = useState(result.scale.assumptions.wall_height_m)
  const [resetKey, setResetKey] = useState(0)
  const [settings, setSettings] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const g = result.geometry.corrected
  const scale = result.scale
  const frame = planFrame(result)
  const area = g.rooms.reduce((a, r) => a + r.area_m2, 0)
  const reset = () => { setMode('orbit'); onSelect?.(null); setResetKey((k) => k + 1) }

  // The GLB is built from the canonical geometry (edits included), never from the on-screen highlights.
  const doExport = async () => {
    setExporting(true); setExportError('')
    try {
      const blob = await exportGLB(result, {
        wallHeight, doorHeight: scale.assumptions.door_height_m,
        sill: scale.assumptions.window_sill_m, head: scale.assumptions.window_head_m,
      })
      downloadBlob(blob, `${(result.filename || 'plan').replace(/\.[^.]+$/, '')}-archnext.glb`)
    } catch (e) { setExportError(String(e?.message || e)) } finally { setExporting(false) }
  }

  return (
    <div className="h-full p-4 min-h-0">
      <section className="card h-full relative overflow-hidden">
        <ModelViewer result={result} wallHeight={wallHeight} mode={mode} view={view} labels={labels}
                     selection={selection} onSelect={onSelect} resetKey={resetKey} />

        <div className="absolute top-3 left-3 flex items-center gap-2">
          <div className="seg glass">
            <button data-active={mode === 'orbit'} onClick={() => setMode('orbit')}><Orbit size={14} />Orbit</button>
            <button data-active={mode === 'walk'} onClick={() => setMode('walk')}><Footprints size={14} />Walkthrough</button>
          </div>
          <button className="btn-secondary btn-sm glass" onClick={reset}><RotateCcw size={13} />Reset</button>
        </div>

        <div className="absolute top-3 right-3 flex items-center gap-2">
          <button className={`icon-btn glass w-9 h-9 ${settings ? 'text-accent' : ''}`} onClick={() => setSettings((v) => !v)} title="Settings">
            <Settings2 size={16} />
          </button>
          <button className="btn-primary h-9" onClick={doExport} disabled={exporting}>
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}Export GLB
          </button>
        </div>

        {settings && (
          <div className="absolute top-14 right-3 w-72 max-h-[calc(100%-120px)] overflow-auto scrollbar-thin glass rounded-xl p-4 fade-in">
            <div className="flex items-center justify-between mb-2">
              <span className="card-title">Settings</span>
              <button className="icon-btn w-6 h-6" onClick={() => setSettings(false)}><X size={14} /></button>
            </div>
            <div className="seg w-full grid grid-cols-2 mb-2">
              <button data-active={view === 'perspective'} onClick={() => { setMode('orbit'); setView('perspective') }} className="justify-center">3D view</button>
              <button data-active={view === 'top'} onClick={() => { setMode('orbit'); setView('top') }} className="justify-center">Top view</button>
            </div>
            <Switch on={labels} onChange={setLabels} label="Room labels" />
            <div className="py-1.5">
              <div className="flex justify-between text-[12.5px] text-ink-soft"><span>Wall height</span><span className="tabular-nums">{wallHeight.toFixed(2)} m</span></div>
              <input type="range" min="2.2" max="4" step="0.05" value={wallHeight} onChange={(e) => setWallHeight(parseFloat(e.target.value))}
                     className="w-full accent-[#3F6A8F] mt-1" />
            </div>
            <div className="border-t border-line mt-2 pt-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between"><span className="text-ink-mute">Footprint</span><span className="tabular-nums">{frame.sizeX.toFixed(1)} × {frame.sizeZ.toFixed(1)} m</span></div>
              <div className="flex justify-between"><span className="text-ink-mute">Wall thickness</span><span className="tabular-nums">{fmtM(scale.wall_thickness_m)}</span></div>
              <div className="flex justify-between"><span className="text-ink-mute">Door height</span><span className="tabular-nums">{fmtM(scale.assumptions.door_height_m, 1)}</span></div>
              <div className="flex justify-between"><span className="text-ink-mute">Window sill / head</span><span className="tabular-nums">{scale.assumptions.window_sill_m.toFixed(1)} / {scale.assumptions.window_head_m.toFixed(1)} m</span></div>
            </div>
            {g.rooms.length > 0 && (
              <div className="border-t border-line mt-3 pt-3">
                <div className="label mb-1.5">Rooms</div>
                <ul className="space-y-1">
                  {[...g.rooms].sort((a, b) => b.area_m2 - a.area_m2).map((r) => (
                    <li key={r.id}>
                      <button className={`w-full flex justify-between gap-2 text-[12px] rounded px-1 -mx-1 hover:bg-paper ${selection?.id === r.id ? 'bg-emerald-50' : ''}`}
                              onClick={() => onSelect?.({ kind: 'room', id: r.id, from: 'list' })}>
                        <span className="truncate text-ink-soft">{r.name}</span>
                        <span className="tabular-nums text-ink-mute whitespace-nowrap">{r.length_m.toFixed(1)} × {r.width_m.toFixed(1)} m</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="absolute left-3 bottom-3 glass rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft">
          {mode === 'walk' ? 'W A S D to move · drag to look' : 'Click a room to focus · drag to orbit · scroll to zoom'}
        </div>
        <div className="absolute right-3 bottom-3 glass rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft flex items-center gap-2.5">
          <span>{{ ai: 'AI', hybrid: 'Hybrid' }[result.config?.detection] || 'Standard'}</span><span className="text-line">|</span>
          <span className="tabular-nums">{g.rooms.length} room{g.rooms.length === 1 ? '' : 's'}</span><span className="text-line">|</span>
          <span className="tabular-nums">{fmtM2(area)}</span>
          <ScaleBadge scale={scale} short />
        </div>
        {exportError && <div className="absolute top-14 left-1/2 -translate-x-1/2 glass rounded-lg px-3 py-1.5 text-[12.5px] text-bad">Export failed: {exportError}</div>}
      </section>
    </div>
  )
}
