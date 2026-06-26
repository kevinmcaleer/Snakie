import {
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from 'react'
import {
  connectionColor,
  connectionId,
  signalColor,
  type RobotConnection,
  type RobotDefinition,
  type RobotNet
} from '../../../shared/robot'
import type { BoardDefinition } from '../../../shared/board'
import type { PartDefinition, PartLibraryWithParts } from '../../../preload/index.d'
import './WiringCanvas.css'

/**
 * WIRING CANVAS (#139 / #140) — the Board Viewer's "Wiring" mode.
 *
 * Lays the chosen microcontroller + the project's placed parts out as draggable
 * boxes with a connectable dot beside every pin, and lets you drag **noodle**
 * (bezier) wires between any two pins — node-RED style. Power wires are red,
 * ground white (the canvas mat is dark), and signal wires take a palette colour
 * (or one you pick). Everything is persisted to `robot.yml` via `onChange`, and
 * mirrored in the connections table beneath the canvas.
 */

const VIEW_W = 1000
const VIEW_H = 640
const BOX_W = 150
const ROW_H = 20
const TITLE_H = 26
const DOT_R = 5

/** A pin on a box, with the electrical net used for default wire colour. */
interface BoxPin {
  name: string
  net: RobotNet
}
interface Box {
  key: string // 'board' for the MCU, else the part instance id
  title: string
  pins: BoxPin[]
  x: number
  y: number
  w: number
  h: number
}

function boardPinNet(type: string | undefined): RobotNet {
  if (type === 'vcc') return 'vcc'
  if (type === 'gnd') return 'gnd'
  return 'signal'
}
function partPinNet(type: string): RobotNet {
  if (type === 'pwr') return 'vcc'
  if (type === 'gnd') return 'gnd'
  return 'signal'
}

export interface WiringCanvasProps {
  robot: RobotDefinition
  onChange: (next: RobotDefinition) => void
  /** Installed libraries (to resolve a placed part's pins). */
  libraries: PartLibraryWithParts[]
  /** Available microcontroller boards (built-ins + user), for the MCU + picker. */
  boards: BoardDefinition[]
}

interface Drag {
  kind: 'box' | 'pan' | 'wire'
  /** box drag */
  boxKey?: string
  startX?: number
  startY?: number
  ox?: number
  oy?: number
  /** box drag: live (uncommitted) position — persisted only on pointer-up. */
  liveX?: number
  liveY?: number
  /** pan */
  panX?: number
  panY?: number
  panTX?: number
  panTY?: number
  /** wire drag: the originating pin + live cursor (world coords) */
  from?: string
  cx?: number
  cy?: number
  moved?: boolean
}

export function WiringCanvas({ robot, onChange, libraries, boards }: WiringCanvasProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })
  const [, force] = useState(0) // re-render during a wire/pan drag (ref-driven)

  const boardDef = robot.board ? boards.find((b) => b.id === robot.board) ?? null : null

  const resolvePart = (lib: string, part: string): PartDefinition | null =>
    libraries.find((l) => l.id === lib)?.parts.find((p) => p.id === part) ?? null

  // --- build the boxes ------------------------------------------------------
  const boxes: Box[] = []
  if (boardDef) {
    const pins: BoxPin[] = (boardDef.headers ?? []).flatMap((h) =>
      h.pins.map((pad) => ({ name: pad.label, net: boardPinNet(pad.type) }))
    )
    boxes.push({
      key: 'board',
      title: boardDef.name,
      pins,
      x: robot.boardX ?? 40,
      y: robot.boardY ?? 30,
      w: BOX_W,
      h: TITLE_H + Math.max(1, pins.length) * ROW_H
    })
  }
  robot.parts.forEach((rp, i) => {
    const def = resolvePart(rp.lib, rp.part)
    const pins: BoxPin[] = def
      ? (def.headers ?? []).flatMap((h) => h.pins.map((p) => ({ name: p.name, net: partPinNet(p.type) })))
      : []
    boxes.push({
      key: rp.id,
      title: rp.label || def?.name || rp.id,
      pins,
      x: rp.x ?? 320 + (i % 2) * (BOX_W + 60),
      y: rp.y ?? 30 + Math.floor(i / 2) * 220,
      w: BOX_W,
      h: TITLE_H + Math.max(1, pins.length) * ROW_H
    })
  })
  const boxByKey = new Map(boxes.map((b) => [b.key, b]))

  // Live box-drag override (commit-on-drop): while dragging a box we update the
  // freshly-built box's position in place and only persist on pointer-up, so a
  // drag doesn't write robot.yml on every move.
  const liveDrag = dragRef.current
  if (liveDrag?.kind === 'box' && liveDrag.boxKey && liveDrag.liveX != null && liveDrag.liveY != null) {
    const b = boxByKey.get(liveDrag.boxKey)
    if (b) {
      b.x = liveDrag.liveX
      b.y = liveDrag.liveY
    }
  }

  // --- pin identity --------------------------------------------------------
  // Endpoints are `"<boxKey>.<pinName>#<index>"`. The INDEX is authoritative (pin
  // names repeat — a Pico has eight pads all called GND); the name is for display.
  const endpointOf = (boxKey: string, pinName: string, i: number): string => `${boxKey}.${pinName}#${i}`
  const parseEndpoint = (ep: string): { boxKey: string; index: number } => {
    const hash = ep.lastIndexOf('#')
    const index = hash >= 0 ? parseInt(ep.slice(hash + 1), 10) : -1
    const head = hash >= 0 ? ep.slice(0, hash) : ep
    const dot = head.indexOf('.')
    return { boxKey: dot >= 0 ? head.slice(0, dot) : head, index }
  }
  /** Net of an endpoint, for colour inference. */
  const pinNet = (endpoint: string): RobotNet => {
    const { boxKey, index } = parseEndpoint(endpoint)
    return boxByKey.get(boxKey)?.pins[index]?.net ?? 'signal'
  }
  /** Y of a pin row centre within its box (by index). */
  const rowYAt = (box: Box, i: number): number => box.y + TITLE_H + i * ROW_H + ROW_H / 2
  /** The two edge-dot positions for a pin index. */
  const dotsAt = (box: Box, i: number): { left: [number, number]; right: [number, number] } => {
    const y = rowYAt(box, i)
    return { left: [box.x, y], right: [box.x + box.w, y] }
  }

  // --- coordinate helpers ---------------------------------------------------
  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(ctm.inverse())
    return { x: (local.x - view.tx) / view.scale, y: (local.y - view.ty) / view.scale }
  }

  /** Find the pin dot near a world point (within a tolerance). */
  const dotAt = (wx: number, wy: number): { endpoint: string } | null => {
    for (const box of boxes) {
      for (let i = 0; i < box.pins.length; i++) {
        const { left, right } = dotsAt(box, i)
        if (Math.hypot(wx - left[0], wy - left[1]) < DOT_R + 5 || Math.hypot(wx - right[0], wy - right[1]) < DOT_R + 5) {
          return { endpoint: endpointOf(box.key, box.pins[i].name, i) }
        }
      }
    }
    return null
  }

  // --- mutations ------------------------------------------------------------
  const moveBox = (key: string, x: number, y: number): void => {
    if (key === 'board') onChange({ ...robot, boardX: x, boardY: y })
    else onChange({ ...robot, parts: robot.parts.map((p) => (p.id === key ? { ...p, x, y } : p)) })
  }
  const addConnection = (from: string, to: string): void => {
    if (from === to) return
    const id = connectionId(from, to)
    if (robot.connections.some((c) => c.id === id || (c.from === to && c.to === from))) return
    const net: RobotNet = pinNet(from) === 'vcc' || pinNet(to) === 'vcc'
      ? 'vcc'
      : pinNet(from) === 'gnd' || pinNet(to) === 'gnd'
        ? 'gnd'
        : 'signal'
    const conn: RobotConnection = { id, from, to, net }
    // Index the palette by the number of EXISTING signal wires (vcc/gnd don't
    // consume a colour), so signal wires stay distinct.
    if (net === 'signal') {
      conn.color = signalColor(robot.connections.filter((c) => (c.net ?? 'signal') === 'signal').length)
    }
    onChange({ ...robot, connections: [...robot.connections, conn] })
  }
  const removeConnection = (id: string): void =>
    onChange({ ...robot, connections: robot.connections.filter((c) => c.id !== id) })
  const setConnectionColor = (id: string, color: string): void =>
    onChange({ ...robot, connections: robot.connections.map((c) => (c.id === id ? { ...c, color } : c)) })
  // Remove a placed part AND any wires that reference it (no dangling endpoints).
  const removePart = (key: string): void =>
    onChange({
      ...robot,
      parts: robot.parts.filter((p) => p.id !== key),
      connections: robot.connections.filter(
        (c) => parseEndpoint(c.from).boxKey !== key && parseEndpoint(c.to).boxKey !== key
      )
    })

  // --- pointer handlers -----------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const w = toWorld(e)
    const dot = dotAt(w.x, w.y)
    if (dot) {
      dragRef.current = { kind: 'wire', from: dot.endpoint, cx: w.x, cy: w.y }
      force((n) => n + 1)
      return
    }
    // A box under the pointer? (title or body, excluding dots) → drag it.
    const box = boxes.find((b) => w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h)
    if (box) {
      dragRef.current = { kind: 'box', boxKey: box.key, startX: w.x, startY: w.y, ox: box.x, oy: box.y }
      return
    }
    // Empty space → pan.
    dragRef.current = { kind: 'pan', panX: e.clientX, panY: e.clientY, panTX: view.tx, panTY: view.ty }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'pan') {
      const ctm = svgRef.current?.getScreenCTM()
      const s = ctm && ctm.a ? ctm.a : 1
      setView((v) => ({ ...v, tx: (d.panTX ?? 0) + (e.clientX - (d.panX ?? 0)) / s, ty: (d.panTY ?? 0) + (e.clientY - (d.panY ?? 0)) / s }))
      return
    }
    const w = toWorld(e)
    if (d.kind === 'box') {
      // Stash the live position on the drag and re-render; the box override block
      // above paints it. We only commit to robot.yml on pointer-up.
      d.liveX = (d.ox ?? 0) + (w.x - (d.startX ?? 0))
      d.liveY = (d.oy ?? 0) + (w.y - (d.startY ?? 0))
      d.moved = true
      force((n) => n + 1)
      return
    }
    if (d.kind === 'wire') {
      d.cx = w.x
      d.cy = w.y
      force((n) => n + 1)
    }
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.kind === 'box' && d.moved && d.boxKey && d.liveX != null && d.liveY != null) {
      // Commit the dragged box's final position once, on drop.
      moveBox(d.boxKey, d.liveX, d.liveY)
      return
    }
    if (d?.kind === 'wire' && d.from) {
      const w = toWorld(e)
      const target = dotAt(w.x, w.y)
      if (target && target.endpoint !== d.from) addConnection(d.from, target.endpoint)
      force((n) => n + 1)
    }
  }

  const onWheel = (e: WheelEvent<SVGSVGElement>): void => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    setView((v) => {
      const scale = Math.min(3, Math.max(0.4, v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
      if (!ctm || !svg) return { ...v, scale }
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const local = pt.matrixTransform(ctm.inverse())
      const wx = (local.x - v.tx) / v.scale
      const wy = (local.y - v.ty) / v.scale
      return { scale, tx: local.x - wx * scale, ty: local.y - wy * scale }
    })
  }

  // --- wire path (a node-RED noodle) ----------------------------------------
  /** Choose facing dots for a connection and return a bezier path. */
  const wirePath = (from: string, to: string): { d: string } | null => {
    const f = parseEndpoint(from)
    const t = parseEndpoint(to)
    const fb = boxByKey.get(f.boxKey)
    const tb = boxByKey.get(t.boxKey)
    // Skip wires whose box or pin no longer resolves (e.g. a removed part, or a
    // pin index past the end after a part definition changed).
    if (!fb || !tb || f.index < 0 || f.index >= fb.pins.length || t.index < 0 || t.index >= tb.pins.length) {
      return null
    }
    const fd = dotsAt(fb, f.index)
    const td = dotsAt(tb, t.index)
    // Use the sides that face each other (shortest, least-crossing route).
    const fromRight = fb.x + fb.w / 2 <= tb.x + tb.w / 2
    const [x1, y1] = fromRight ? fd.right : fd.left
    const [x2, y2] = fromRight ? td.left : td.right
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
    const c1 = fromRight ? x1 + dx : x1 - dx
    const c2 = fromRight ? x2 - dx : x2 + dx
    return { d: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}` }
  }

  const drag = dragRef.current
  const isDark = true // the wiring mat is dark, so ground wires render light

  if (!boardDef && robot.parts.length === 0) {
    return (
      <div className="wc">
        <div className="wc__empty">
          <p>No microcontroller or parts yet.</p>
          <p className="wc__muted">
            Pick a board below, then add parts from the <strong>Parts</strong> mode (a part&apos;s
            <strong> Add to project</strong> button).
          </p>
          <BoardPicker boards={boards} value={robot.board} onChange={(id) => onChange({ ...robot, board: id })} />
        </div>
      </div>
    )
  }

  return (
    <div className="wc">
      <div className="wc__bar">
        <BoardPicker boards={boards} value={robot.board} onChange={(id) => onChange({ ...robot, board: id })} />
        <span className="wc__hint">Drag a pin dot to another pin to wire them.</span>
        <span className="wc__spacer" />
        <button type="button" className="wc__btn" onClick={() => setView({ tx: 0, ty: 0, scale: 1 })} title="Reset view">
          Fit
        </button>
      </div>

      <svg
        ref={svgRef}
        className="wc__svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        height="100%"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {/* Wires (under the boxes' dots but над the mat) */}
          {robot.connections.map((c) => {
            const p = wirePath(c.from, c.to)
            if (!p) return null
            return <path key={c.id} d={p.d} fill="none" stroke={connectionColor(c, isDark)} strokeWidth={3} className="wc__wire" />
          })}

          {/* The live wire being dragged */}
          {drag?.kind === 'wire' && drag.from && (() => {
            const f = parseEndpoint(drag.from)
            const fb = boxByKey.get(f.boxKey)
            if (!fb || f.index < 0 || f.index >= fb.pins.length) return null
            const fd = dotsAt(fb, f.index)
            const toRight = (drag.cx ?? 0) >= fb.x + fb.w / 2
            const [x1, y1] = toRight ? fd.right : fd.left
            const cx = drag.cx ?? x1
            const cy = drag.cy ?? y1
            const dx = Math.max(40, Math.abs(cx - x1) * 0.5)
            return (
              <path
                d={`M ${x1} ${y1} C ${toRight ? x1 + dx : x1 - dx} ${y1}, ${cx} ${cy}, ${cx} ${cy}`}
                fill="none"
                stroke="#4ea1ff"
                strokeWidth={2}
                strokeDasharray="5 4"
              />
            )
          })()}

          {/* Boxes */}
          {boxes.map((box) => (
            <g key={box.key}>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} className={`wc__box${box.key === 'board' ? ' wc__box--mcu' : ''}`} />
              <rect x={box.x} y={box.y} width={box.w} height={TITLE_H} rx={6} className="wc__box-title" />
              <text x={box.x + box.w / 2} y={box.y + TITLE_H / 2 + 4} className="wc__box-titletext">
                {box.title}
              </text>
              {box.key !== 'board' && (
                <g
                  className="wc__box-remove"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    removePart(box.key)
                  }}
                >
                  <title>Remove part</title>
                  <circle cx={box.x + box.w - TITLE_H / 2} cy={box.y + TITLE_H / 2} r={7} />
                  <text x={box.x + box.w - TITLE_H / 2} y={box.y + TITLE_H / 2 + 3.5}>
                    ✕
                  </text>
                </g>
              )}
              {box.pins.map((p, i) => {
                const y = box.y + TITLE_H + i * ROW_H + ROW_H / 2
                const dotCls = `wc__dot wc__dot--${p.net}`
                return (
                  <g key={p.name + i}>
                    <text x={box.x + box.w / 2} y={y + 3.5} className="wc__pin-name">
                      {p.name}
                    </text>
                    <circle cx={box.x} cy={y} r={DOT_R} className={dotCls} />
                    <circle cx={box.x + box.w} cy={y} r={DOT_R} className={dotCls} />
                  </g>
                )
              })}
            </g>
          ))}
        </g>
      </svg>

      <ConnectionsTable
        connections={robot.connections}
        isDark={isDark}
        onRemove={removeConnection}
        onColor={setConnectionColor}
      />
    </div>
  )
}

/** Microcontroller picker. */
function BoardPicker({
  boards,
  value,
  onChange
}: {
  boards: BoardDefinition[]
  value: string | undefined
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <label className="wc__board">
      <span>Microcontroller</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a board…</option>
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** "dist1.SDA#3" → "dist1.SDA" — the #index is internal disambiguation only. */
function fmtEndpoint(ep: string): string {
  const hash = ep.lastIndexOf('#')
  return hash >= 0 ? ep.slice(0, hash) : ep
}

/** The connections table beneath the canvas. */
function ConnectionsTable({
  connections,
  isDark,
  onRemove,
  onColor
}: {
  connections: RobotConnection[]
  isDark: boolean
  onRemove: (id: string) => void
  onColor: (id: string, color: string) => void
}): JSX.Element {
  return (
    <div className="wc__table">
      <div className="wc__table-head">
        <span>Connections</span>
        <span className="wc__table-count">{connections.length}</span>
      </div>
      {connections.length === 0 ? (
        <p className="wc__muted wc__table-empty">No wires yet — drag between two pins to connect them.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Net</th>
              <th>Colour</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id}>
                <td className="wc__mono">{fmtEndpoint(c.from)}</td>
                <td className="wc__mono">{fmtEndpoint(c.to)}</td>
                <td>{c.net ?? 'signal'}</td>
                <td>
                  <input
                    type="color"
                    className="wc__swatch"
                    value={/^#[0-9a-f]{6}$/i.test(connectionColor(c, isDark)) ? connectionColor(c, isDark) : '#888888'}
                    onChange={(e) => onColor(c.id, e.target.value)}
                    title="Wire colour"
                  />
                </td>
                <td>
                  <button type="button" className="wc__del" onClick={() => onRemove(c.id)} title="Delete wire" aria-label="Delete wire">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
