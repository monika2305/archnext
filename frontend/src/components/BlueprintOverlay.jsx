import { useEffect, useRef, useState } from 'react'
import { ROOM_COLORS } from '../lib/format.js'

export function wallCorners(w, extra = 0) {
  const dx = w.x2 - w.x1
  const dy = w.y2 - w.y1
  const L = Math.hypot(dx, dy) || 1
  const ux = dx / L, uy = dy / L
  const nx = -uy, ny = ux
  const h = w.thickness / 2 + extra
  return [
    [w.x1 + nx * h, w.y1 + ny * h], [w.x2 + nx * h, w.y2 + ny * h],
    [w.x2 - nx * h, w.y2 - ny * h], [w.x1 - nx * h, w.y1 - ny * h],
  ]
}

const pts = (arr) => arr.map((p) => p.join(',')).join(' ')
export const OPENING_COLOR = { door: '#B9772B', window: '#3D8DB8', opening: '#8A7FA6' }
export const ISSUE_COLOR = { fixable: '#3F6A8F', warning: '#B07A2A', info: '#8B9099' }
export const issueColor = (i) => (i.fixable ? ISSUE_COLOR.fixable : i.severity === 'info' ? ISSUE_COLOR.info : ISSUE_COLOR.warning)

/** Keep horizontal / vertical walls straight while an end is dragged. */
function constrain(w, end, x, y) {
  if (w.orient === 'h') return [x, end === 0 ? w.y1 : w.y2]
  if (w.orient === 'v') return [end === 0 ? w.x1 : w.x2, y]
  return [x, y]
}
const withEnd = (w, end, x, y) => (end === 0 ? { ...w, x1: x, y1: y } : { ...w, x2: x, y2: y })

export default function BlueprintOverlay({
  result, layers, selectedKey, onSelectIssue, preview, pickMode, picks, onPick, zoom = 1,
  editMode, editWallId, onEditWall, editCheck, onDragEnd,
}) {
  const svg = useRef(null)
  const selRef = useRef(null)
  const [drag, setDrag] = useState(null) // { wallId, end, x, y }
  useEffect(() => {
    selRef.current?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' })
  }, [selectedKey, preview])
  useEffect(() => { setDrag(null) }, [editWallId, result])

  const { width: W, height: H } = result.image
  const g = result.geometry.corrected
  const unit = Math.max(W, H) / 900 // stroke scale relative to image size
  const tgOn = result.config?.topology_guard !== false
  const selected = result.topology.issues.find((i) => i.key === selectedKey)
  const editWall = editMode ? g.walls.find((w) => w.id === editWallId) : null

  const toPlan = (e) => {
    const pt = svg.current.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse())
    return [Math.max(0, Math.min(W, p.x)), Math.max(0, Math.min(H, p.y))]
  }
  const handleClick = (e) => {
    if (pickMode && svg.current) onPick(toPlan(e))
  }
  const onMove = (e) => {
    if (!drag || !editWall) return
    const [x, y] = constrain(editWall, drag.end, ...toPlan(e))
    setDrag((d) => ({ ...d, x, y }))
  }
  const onUp = () => {
    if (!drag) return
    onDragEnd?.(drag.wallId, drag.end, drag.x, drag.y)
    setDrag(null)
  }

  // Wall currently shown for the edited wall: live drag, then the server-checked (snapped) result.
  const draftWall = editWall && drag ? withEnd(editWall, drag.end, drag.x, drag.y) : null
  const checked = editCheck && editWall && editCheck.after.id === editWall.id ? editCheck : null
  const shownEditWall = draftWall || (checked ? checked.after : editWall)

  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} onClick={handleClick} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
         style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, cursor: pickMode ? 'crosshair' : drag ? 'grabbing' : 'default', touchAction: 'none' }}
         className="block select-none">
      <rect x="0" y="0" width={W} height={H} fill="#fff" stroke="#E4E0D8" strokeWidth={unit} />
      <image href={result.image.url} x="0" y="0" width={W} height={H} opacity={layers.walls || layers.rooms ? 0.5 : 1} />

      {layers.rooms && g.rooms.map((r) => (
        <polygon key={r.id} points={pts(r.polygon)} fill={ROOM_COLORS[r.type] || ROOM_COLORS.unknown}
                 fillOpacity={0.45} stroke="#9C8F7A" strokeOpacity={0.6} strokeWidth={unit * 0.8} />
      ))}

      {layers.walls && g.walls.map((w) => {
        const isEdit = editWall && w.id === editWall.id
        return (
          <polygon key={w.id} points={pts(wallCorners(isEdit ? shownEditWall : w))}
                   fill={isEdit ? (checked && !checked.ok && !drag ? '#A64B45' : '#3E7D5A') : w.exterior ? '#2B3138' : '#4F6578'}
                   fillOpacity={0.88}
                   stroke={w.source === 'edited' ? '#3E7D5A' : w.source === 'corrected' ? '#3F6A8F' : 'none'}
                   strokeWidth={unit * (w.source === 'edited' ? 2.4 : 1.6)}
                   style={editMode ? { cursor: 'pointer' } : undefined}
                   onClick={editMode ? (e) => { e.stopPropagation(); onEditWall?.(w.id) } : undefined} />
        )
      })}
      {layers.walls && (g.solids || []).map((s, i) => (
        <rect key={i} x={s.x0} y={s.y0} width={s.x1 - s.x0} height={s.y1 - s.y0} fill="#2B3138" fillOpacity={0.85} />
      ))}

      {layers.openings && g.openings.map((o) => {
        const c = wallCorners({ ...o, thickness: Math.max(o.thickness, 4) }, unit)
        return (
          <g key={o.id} pointerEvents="none">
            <polygon points={pts(c)} fill={OPENING_COLOR[o.type]} fillOpacity={0.3} stroke={OPENING_COLOR[o.type]} strokeWidth={unit * 1.2} />
            <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke={OPENING_COLOR[o.type]} strokeWidth={unit * 2.2}
                  strokeDasharray={o.type === 'window' ? `${unit * 4} ${unit * 2}` : undefined} />
          </g>
        )
      })}

      {layers.rooms && g.rooms.map((r) => (
        <g key={`l${r.id}`} pointerEvents="none">
          <text x={r.centroid[0]} y={r.centroid[1] - unit * 3} textAnchor="middle" fontSize={unit * 12} fontWeight="600"
                fill="#26292E" stroke="#fff" strokeWidth={unit * 3} paintOrder="stroke">{r.name}</text>
          <text x={r.centroid[0]} y={r.centroid[1] + unit * 11} textAnchor="middle" fontSize={unit * 10.5}
                fill="#4A4F57" stroke="#fff" strokeWidth={unit * 3} paintOrder="stroke">{r.area_m2.toFixed(1)} m²</text>
        </g>
      ))}

      {pickMode && result.scale.measurements.map((m, i) => {
        const [x, y, w, h] = m.bbox
        const col = m.status === 'accepted' ? '#3E7D5A' : '#A64B45'
        return (
          <g key={`m${i}`} pointerEvents="none">
            <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill="none" stroke={col} strokeWidth={unit * 1.4} rx={unit * 2} />
            {m.line && <line x1={m.line[0]} y1={m.line[1]} x2={m.line[2]} y2={m.line[3]} stroke={col} strokeWidth={unit * 1.6} />}
          </g>
        )
      })}

      {selected && !preview && !editMode && (selected.walls || []).map((wid) => {
        const w = g.walls.find((x) => x.id === wid)
        return w ? <polygon key={`hl${wid}`} points={pts(wallCorners(w, unit * 3))} fill="none" stroke="#3F6A8F"
                            strokeWidth={unit * 2.5} strokeDasharray={`${unit * 5} ${unit * 3}`} pointerEvents="none" /> : null
      })}

      {layers.issues && result.topology.issues.filter((i) => i.status === 'review').map((iss) => {
        const sel = selectedKey === iss.key
        const col = issueColor(iss)
        return (
          <g key={iss.key} onClick={(e) => { e.stopPropagation(); onSelectIssue?.(iss.key) }} style={{ cursor: 'pointer' }}>
            {sel && <circle ref={selRef} cx={iss.at[0]} cy={iss.at[1]} r={unit * 18} fill="none" stroke={col} strokeWidth={unit * 2.5} className="pulse" />}
            <circle cx={iss.at[0]} cy={iss.at[1]} r={unit * 12} fill="transparent" />
            <circle cx={iss.at[0]} cy={iss.at[1]} r={unit * (sel ? 8 : 6)} fill={col} fillOpacity={0.92} stroke="#fff" strokeWidth={unit * 1.5} />
          </g>
        )
      })}

      {/* Without TopologyGuard there are no checks; loose wall ends are still marked so the difference is visible. */}
      {layers.issues && !tgOn && g.dangling.map(([x, y], i) => (
        <circle key={`d${i}`} cx={x} cy={y} r={unit * 6} fill="#A64B45" fillOpacity={0.85} stroke="#fff" strokeWidth={unit * 1.5} pointerEvents="none" />
      ))}

      {preview?.fix && (
        <g pointerEvents="none">
          {preview.fix.before.map((w) => (
            <polygon key={`pb${w.id}`} points={pts(wallCorners(w, unit))} fill="#A64B45" fillOpacity={0.18}
                     stroke="#A64B45" strokeWidth={unit * 1.6} strokeDasharray={`${unit * 4} ${unit * 3}`} />
          ))}
          {preview.fix.after.map((w) => (
            <polygon key={`pa${w.id}`} points={pts(wallCorners(w))} fill="#3E7D5A" fillOpacity={0.8}
                     stroke="#2E6146" strokeWidth={unit * 1.2} />
          ))}
          <circle ref={selRef} cx={preview.at[0]} cy={preview.at[1]} r={unit * 22} fill="none" stroke="#3E7D5A" strokeWidth={unit * 2} className="pulse" />
        </g>
      )}

      {editWall && (
        <g>
          {(checked || drag) && (
            <polygon points={pts(wallCorners(editWall, unit))} fill="none" stroke="#A64B45" strokeWidth={unit * 1.4}
                     strokeDasharray={`${unit * 4} ${unit * 3}`} pointerEvents="none" />
          )}
          {[0, 1].map((end) => {
            const x = end === 0 ? shownEditWall.x1 : shownEditWall.x2
            const y = end === 0 ? shownEditWall.y1 : shownEditWall.y2
            return (
              <circle key={end} cx={x} cy={y} r={unit * 8} fill="#fff" stroke="#3F6A8F" strokeWidth={unit * 3}
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        svg.current.setPointerCapture?.(e.pointerId)
                        setDrag({ wallId: editWall.id, end, x, y })
                      }} />
            )
          })}
        </g>
      )}

      {picks?.length > 0 && (
        <g pointerEvents="none">
          {picks.length === 2 && (
            <line x1={picks[0][0]} y1={picks[0][1]} x2={picks[1][0]} y2={picks[1][1]} stroke="#3F6A8F" strokeWidth={unit * 2.5} strokeDasharray={`${unit * 6} ${unit * 3}`} />
          )}
          {picks.map((p, i) => (
            <g key={i}>
              <circle cx={p[0]} cy={p[1]} r={unit * 7} fill="#fff" stroke="#3F6A8F" strokeWidth={unit * 2.5} />
              <circle cx={p[0]} cy={p[1]} r={unit * 2} fill="#3F6A8F" />
            </g>
          ))}
        </g>
      )}
    </svg>
  )
}
