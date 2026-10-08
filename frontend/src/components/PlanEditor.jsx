import { useEffect, useMemo, useRef, useState } from 'react'
import { ROOM_COLORS } from '../lib/format.js'
import { projectOnWall, roomAt, wallLength } from '../lib/planGeometry.js'
import { OPENING_COLOR, wallCorners } from './BlueprintOverlay.jsx'
import { GLOW } from './ModelViewer.jsx'

const pts = (arr) => arr.map((p) => p.join(',')).join(' ')

/** Pieces that form one wall with ``id`` (collinear, linked by openings between them). */
function chainOf(geometry, id) {
  const byId = Object.fromEntries(geometry.walls.map((w) => [w.id, w]))
  const walls = new Set([id])
  const todo = [id]
  while (todo.length) {
    const cur = todo.pop()
    for (const o of geometry.openings) {
      if (!o.hosts.includes(cur)) continue
      for (const h of o.hosts) {
        const a = byId[cur], b = byId[h]
        if (walls.has(h) || !a || !b || a.orient !== b.orient || a.orient === 'd') continue
        const off = a.orient === 'h' ? Math.abs(a.y1 - b.y1) : Math.abs(a.x1 - b.x1)
        if (off > Math.max(a.thickness, b.thickness) / 2 + 1.5) continue
        walls.add(h); todo.push(h)
      }
    }
  }
  return walls
}

/** Local, instant version of an edit so both panels follow the pointer; the server result replaces it. */
function draftGeometry(geometry, drag, scalePx) {
  if (!drag?.moved) return null
  const g = { ...geometry, walls: geometry.walls.map((w) => ({ ...w })), openings: geometry.openings.map((o) => ({ ...o })) }
  const byId = Object.fromEntries(g.walls.map((w) => [w.id, w]))
  if (drag.type === 'wall') {
    const chain = chainOf(geometry, drag.id)
    const w0 = byId[drag.id]
    const dx = w0.orient === 'h' ? 0 : drag.dx
    const dy = w0.orient === 'v' ? 0 : drag.dy
    const tol = Math.max(2, scalePx)
    for (const w of g.walls) {
      if (chain.has(w.id)) { w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy; continue }
      if (w.orient === 'd') continue
      // Walls touching the moved wall follow it along their own axis (as the server does).
      for (const c of chain) {
        const m = geometry.walls.find((x) => x.id === c)
        if (!m || m.orient === w.orient) continue
        for (const end of [0, 1]) {
          const p = end === 0 ? [w.x1, w.y1] : [w.x2, w.y2]
          if (projectOnWall(m, p).d <= m.thickness / 2 + tol) {
            if (w.orient === 'v') { if (end === 0) w.y1 += dy; else w.y2 += dy } else if (end === 0) w.x1 += dx; else w.x2 += dx
          }
        }
      }
    }
    for (const o of g.openings) if (o.hosts.every((h) => chain.has(h))) { o.x1 += dx; o.x2 += dx; o.y1 += dy; o.y2 += dy }
  } else if (drag.type === 'end') {
    const w = byId[drag.id]
    if (drag.end === 0) { w.x1 = drag.x; w.y1 = drag.y } else { w.x2 = drag.x; w.y2 = drag.y }
  } else if (drag.type === 'opening') {
    const o = g.openings.find((x) => x.id === drag.id)
    const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1
    const ux = (o.x2 - o.x1) / L, uy = (o.y2 - o.y1) / L
    const s = drag.offset
    const near = (w, p) => (Math.hypot(w.x1 - p[0], w.y1 - p[1]) <= Math.hypot(w.x2 - p[0], w.y2 - p[1]) ? 0 : 1)
    for (const [hid, p] of [[o.hosts[0], [o.x1, o.y1]], [o.hosts[1], [o.x2, o.y2]]]) {
      const w = byId[hid]
      if (!w) continue
      if (near(w, p) === 0) { w.x1 += ux * s; w.y1 += uy * s } else { w.x2 += ux * s; w.y2 += uy * s }
    }
    o.x1 += ux * s; o.y1 += uy * s; o.x2 += ux * s; o.y2 += uy * s
  }
  return g
}

/** Snap a point to wall ends / wall centre lines within ``reach`` px. */
function snapPoint(geometry, [x, y], reach, skip) {
  let best = { d: reach, p: [x, y], snapped: false }
  for (const w of geometry.walls) {
    if (w.id === skip) continue
    for (const q of [[w.x1, w.y1], [w.x2, w.y2]]) {
      const d = Math.hypot(q[0] - x, q[1] - y)
      if (d < best.d) best = { d, p: q, snapped: true }
    }
    const pr = projectOnWall(w, [x, y])
    if (pr.d < best.d * 0.8) best = { d: pr.d, p: [pr.x, pr.y], snapped: true }
  }
  return best
}

export default function PlanEditor({ result, geometry, tool, selection, onSelect, onCommand, onDraft, busy, fitKey }) {
  const svg = useRef(null)
  const { width: W, height: H } = result.image
  const unit = Math.max(W, H) / 900
  const t = result.wall_thickness_px
  const s = result.scale.meters_per_px
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H })
  const [drag, setDrag] = useState(null)        // select tool: { type, id, start, moved, ... }
  const [pan, setPan] = useState(null)
  const [hover, setHover] = useState(null)      // pointer in plan coords
  const [wallStart, setWallStart] = useState(null)

  useEffect(() => { setVb({ x: 0, y: 0, w: W, h: H }) }, [W, H, fitKey])
  useEffect(() => { setWallStart(null) }, [tool])
  const draft = useMemo(() => draftGeometry(geometry, drag, t), [geometry, drag, t])
  useEffect(() => { onDraft?.(draft) }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps
  const g = draft || geometry

  const toPlan = (e) => {
    const p = svg.current.createSVGPoint()
    p.x = e.clientX; p.y = e.clientY
    const q = p.matrixTransform(svg.current.getScreenCTM().inverse())
    return [q.x, q.y]
  }

  const wallById = (id) => g.walls.find((w) => w.id === id)
  const nearestWall = (p) => {
    let best = null
    for (const w of g.walls) {
      const pr = projectOnWall(w, p)
      if (pr.d <= w.thickness / 2 + 3 * unit + 4 && (!best || pr.d < best.pr.d)) best = { w, pr }
    }
    return best
  }
  const defaultWidth = (type) => Math.max((type === 'window' ? 1.2 : 0.9) / s, 2.2 * t)

  // ------------------------------------------------------------------ pointer handling
  const onDown = (e) => {
    if (busy || e.button !== 0) return
    const p = toPlan(e)
    const target = e.target.dataset
    if (tool === 'select') {
      if (target.kind === 'handle') {
        setDrag({ type: 'end', id: target.id, end: Number(target.end), start: p, x: p[0], y: p[1], moved: false })
      } else if (target.kind === 'opening') {
        onSelect({ kind: 'opening', id: target.id, from: '2d' })
        setDrag({ type: 'opening', id: target.id, start: p, offset: 0, moved: false })
      } else if (target.kind === 'wall') {
        onSelect({ kind: 'wall', id: target.id, from: '2d' })
        setDrag({ type: 'wall', id: target.id, start: p, dx: 0, dy: 0, moved: false })
      } else {
        const room = roomAt(g, p)
        if (room) onSelect({ kind: 'room', id: room.id, from: '2d' })
        setPan({ start: [e.clientX, e.clientY], vb, moved: false, room: !!room })
      }
      svg.current.setPointerCapture(e.pointerId)
    } else if (tool === 'wall') {
      const sp = snapPoint(g, p, 3 * t).p
      if (!wallStart) setWallStart(sp)
      else {
        onCommand({ op: 'add_wall', x1: wallStart[0], y1: wallStart[1], x2: sp[0], y2: sp[1] })
        setWallStart(null)
      }
    } else if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(p)
      if (hit) onCommand({ op: 'add_opening', wall: hit.w.id, x: hit.pr.x, y: hit.pr.y, width: defaultWidth(tool), type: tool })
    }
  }

  const onMove = (e) => {
    const p = toPlan(e)
    setHover(p)
    if (pan) {
      const k = vb.w / svg.current.getBoundingClientRect().width
      const dx = (e.clientX - pan.start[0]) * k, dy = (e.clientY - pan.start[1]) * k
      if (Math.abs(dx) + Math.abs(dy) > 3 * k) {
        setPan((cur) => ({ ...cur, moved: true }))
        setVb({ ...pan.vb, x: pan.vb.x - dx, y: pan.vb.y - dy })
      }
      return
    }
    if (!drag) return
    const dist = Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1])
    const moved = drag.moved || dist > 3 * unit
    if (!moved) return
    if (drag.type === 'wall') setDrag({ ...drag, moved, dx: p[0] - drag.start[0], dy: p[1] - drag.start[1] })
    else if (drag.type === 'end') {
      const w = geometry.walls.find((x) => x.id === drag.id)
      let q = [p[0], p[1]]
      if (w.orient === 'h') q[1] = drag.end === 0 ? w.y1 : w.y2
      if (w.orient === 'v') q[0] = drag.end === 0 ? w.x1 : w.x2
      const sp = snapPoint(geometry, q, 2 * t, w.id)
      if (sp.snapped) {
        if (w.orient === 'h') q = [sp.p[0], q[1]]
        else if (w.orient === 'v') q = [q[0], sp.p[1]]
        else q = sp.p
      }
      setDrag({ ...drag, moved, x: q[0], y: q[1], snapped: sp.snapped })
    } else if (drag.type === 'opening') {
      const o = geometry.openings.find((x) => x.id === drag.id)
      const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1
      const off = ((p[0] - drag.start[0]) * (o.x2 - o.x1) + (p[1] - drag.start[1]) * (o.y2 - o.y1)) / L
      setDrag({ ...drag, moved, offset: off })
    }
  }

  const onUp = () => {
    if (pan) {
      if (!pan.moved && !pan.room) onSelect(null)    // click on empty space clears the selection
      setPan(null)
      return
    }
    if (!drag) return
    const d = drag
    setDrag(null)
    if (!d.moved) return
    if (d.type === 'wall') onCommand({ op: 'move_wall', wall: d.id, dx: d.dx, dy: d.dy }, draft)
    else if (d.type === 'end') onCommand({ op: 'move_end', wall: d.id, end: d.end, x: d.x, y: d.y }, draft)
    else if (d.type === 'opening') onCommand({ op: 'move_opening', opening: d.id, offset: d.offset }, draft)
  }

  const onWheel = (e) => {
    const [px, py] = toPlan(e)
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const w = Math.min(W * 3, Math.max(W / 12, vb.w * k))
    const r = w / vb.w
    setVb({ x: px - (px - vb.x) * r, y: py - (py - vb.y) * r, w, h: vb.h * r })
  }
  useEffect(() => {      // wheel must be non-passive to prevent page scroll
    const el = svg.current
    const h = (e) => { e.preventDefault(); onWheel(e) }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  })

  // ------------------------------------------------------------------ rendering
  const sel = selection
  const selRoom = sel?.kind === 'room' ? g.rooms.find((r) => r.id === sel.id) : null
  const selWall = sel?.kind === 'wall' ? wallById(sel.id) : null
  const selOpening = sel?.kind === 'opening' ? g.openings.find((o) => o.id === sel.id) : null
  const hoverWall = (tool === 'door' || tool === 'window') && hover ? nearestWall(hover) : null
  const ghostW = hoverWall ? defaultWidth(tool) : 0
  const snapPreview = tool === 'wall' && hover ? snapPoint(g, hover, 3 * t) : null
  const cursor = tool === 'select' ? (drag?.moved ? 'grabbing' : pan?.moved ? 'grabbing' : 'default') : 'crosshair'

  return (
    <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="absolute inset-0 w-full h-full select-none"
         style={{ cursor, touchAction: 'none' }}
         onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}>
      <defs>
        <filter id="glow-violet" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={unit * 4} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={unit * 2.5} result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="0" y="0" width={W} height={H} fill="#fff" />
      <image href={result.image.url} x="0" y="0" width={W} height={H} opacity={0.45} pointerEvents="none" />

      {g.rooms.map((r) => (
        <polygon key={r.id} points={pts(r.polygon)} data-kind="room" data-id={r.id}
                 fill={ROOM_COLORS[r.type] || ROOM_COLORS.unknown} fillOpacity={0.4} stroke="#9C8F7A" strokeOpacity={0.5} strokeWidth={unit * 0.8} />
      ))}
      {selRoom && (
        <g pointerEvents="none" className="fade-in">
          <polygon points={pts(selRoom.polygon)} fill={GLOW.emerald} fillOpacity={0.22} stroke={GLOW.violet}
                   strokeWidth={unit * 4} filter="url(#glow-violet)" className="glow-pulse" />
          <polygon points={pts(selRoom.polygon)} fill="none" stroke={GLOW.cyan} strokeWidth={unit * 1.5} strokeDasharray={`${unit * 6} ${unit * 4}`} />
        </g>
      )}

      {g.walls.map((w) => (
        <polygon key={w.id} points={pts(wallCorners(w))} data-kind="wall" data-id={w.id}
                 fill={w.exterior ? '#2B3138' : '#4F6578'} fillOpacity={0.9}
                 stroke={w.source === 'edited' ? '#3E7D5A' : 'none'} strokeWidth={unit * 1.6}
                 style={{ cursor: tool === 'select' ? 'move' : undefined }} />
      ))}
      {(g.solids || []).map((sd, i) => (
        <rect key={i} x={sd.x0} y={sd.y0} width={sd.x1 - sd.x0} height={sd.y1 - sd.y0} fill="#2B3138" fillOpacity={0.85} pointerEvents="none" />
      ))}

      {g.openings.map((o) => {
        const c = wallCorners({ ...o, thickness: Math.max(o.thickness, 4) }, unit * 1.5)
        const col = OPENING_COLOR[o.type]
        return (
          <g key={o.id}>
            <polygon points={pts(c)} data-kind="opening" data-id={o.id} fill={col} fillOpacity={0.35} stroke={col} strokeWidth={unit * 1.2}
                     style={{ cursor: tool === 'select' ? 'ew-resize' : undefined }} />
            <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke={col} strokeWidth={unit * 2.2} pointerEvents="none"
                  strokeDasharray={o.type === 'window' ? `${unit * 4} ${unit * 2}` : undefined} />
          </g>
        )
      })}

      {selOpening && (
        <polygon points={pts(wallCorners({ ...selOpening, thickness: Math.max(selOpening.thickness, 4) }, unit * 3))}
                 fill={GLOW.amber} fillOpacity={0.35} stroke={GLOW.amber} strokeWidth={unit * 2.5} filter="url(#glow-cyan)" pointerEvents="none" />
      )}
      {selWall && (
        <g pointerEvents="none">
          <polygon points={pts(wallCorners(selWall, unit * 2))} fill={GLOW.cyan} fillOpacity={0.35} stroke={GLOW.cyan}
                   strokeWidth={unit * 2} filter="url(#glow-cyan)" />
          <text x={(selWall.x1 + selWall.x2) / 2} y={(selWall.y1 + selWall.y2) / 2 - selWall.thickness / 2 - unit * 8} textAnchor="middle"
                fontSize={unit * 13} fontWeight="700" fill="#0e7490" stroke="#fff" strokeWidth={unit * 3} paintOrder="stroke">
            {(wallLength(selWall) * s).toFixed(2)} m
          </text>
        </g>
      )}
      {selWall && tool === 'select' && [0, 1].map((end) => (
        <circle key={end} data-kind="handle" data-id={selWall.id} data-end={end}
                cx={end === 0 ? selWall.x1 : selWall.x2} cy={end === 0 ? selWall.y1 : selWall.y2} r={unit * 8}
                fill="#fff" stroke={GLOW.cyan} strokeWidth={unit * 3} style={{ cursor: 'grab' }} />
      ))}
      {drag?.type === 'end' && drag.snapped && (
        <circle cx={drag.x} cy={drag.y} r={unit * 13} fill="none" stroke={GLOW.violet} strokeWidth={unit * 2} pointerEvents="none" />
      )}

      {g.rooms.map((r) => (
        <g key={`l${r.id}`} pointerEvents="none">
          <text x={r.centroid[0]} y={r.centroid[1] - unit * 3} textAnchor="middle" fontSize={unit * 12} fontWeight="600"
                fill={selRoom?.id === r.id ? '#065f46' : '#26292E'} stroke="#fff" strokeWidth={unit * 3} paintOrder="stroke">{r.name}</text>
          <text x={r.centroid[0]} y={r.centroid[1] + unit * 11} textAnchor="middle" fontSize={unit * 10.5}
                fill="#4A4F57" stroke="#fff" strokeWidth={unit * 3} paintOrder="stroke">{r.area_m2.toFixed(1)} m²</text>
        </g>
      ))}

      {hoverWall && (
        <polygon pointerEvents="none" fill={tool === 'door' ? OPENING_COLOR.door : OPENING_COLOR.window} fillOpacity={0.6}
                 points={pts(wallCorners({
                   x1: hoverWall.pr.x - ((hoverWall.w.x2 - hoverWall.w.x1) / wallLength(hoverWall.w)) * ghostW / 2,
                   y1: hoverWall.pr.y - ((hoverWall.w.y2 - hoverWall.w.y1) / wallLength(hoverWall.w)) * ghostW / 2,
                   x2: hoverWall.pr.x + ((hoverWall.w.x2 - hoverWall.w.x1) / wallLength(hoverWall.w)) * ghostW / 2,
                   y2: hoverWall.pr.y + ((hoverWall.w.y2 - hoverWall.w.y1) / wallLength(hoverWall.w)) * ghostW / 2,
                   thickness: hoverWall.w.thickness + 4,
                 }))} />
      )}
      {tool === 'wall' && snapPreview && (
        <g pointerEvents="none">
          {wallStart && <line x1={wallStart[0]} y1={wallStart[1]} x2={snapPreview.p[0]} y2={snapPreview.p[1]}
                              stroke={GLOW.cyan} strokeWidth={t} strokeOpacity={0.55} strokeLinecap="butt" />}
          {wallStart && <circle cx={wallStart[0]} cy={wallStart[1]} r={unit * 6} fill={GLOW.cyan} />}
          <circle cx={snapPreview.p[0]} cy={snapPreview.p[1]} r={unit * (snapPreview.snapped ? 9 : 5)}
                  fill="none" stroke={snapPreview.snapped ? GLOW.violet : GLOW.cyan} strokeWidth={unit * 2} />
        </g>
      )}
    </svg>
  )
}
