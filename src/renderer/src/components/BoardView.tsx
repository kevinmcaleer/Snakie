import { useMemo, useState } from 'react'
import {
  parsePins,
  PIN_TYPE_COLOR,
  PIN_TYPE_LABEL,
  type PinType,
  type UsedPins
} from './parse-pins'
import {
  BUILTIN_BOARDS,
  DEFAULT_BOARD_ID,
  mergeBoards,
  type BoardDefinition,
  type BoardHeader,
  type BoardPad,
  type BoardFeature
} from './board-defs'
import './BoardView.css'

/**
 * BOARD VIEW
 * ==========
 *
 * A generic, data-driven visualiser: it parses the active editor file for pin
 * usage ({@link parsePins}) and draws ANY {@link BoardDefinition} (built-in or
 * user-authored), wiring every used pad to a **connection-type badge**
 * (OUTPUT / INPUT / PWM / I2C / SPI / PIO) — not a peripheral. A board selector
 * in the title bar switches between boards; the bottom "pins in use" strip lists
 * each connection by type.
 *
 * It re-derives entirely from `{ source, fileName, isPython }` plus internal
 * board-selection state, so it works both embedded and as the root of the
 * floating Board View window — the parent re-renders it on every active-file
 * change and it updates live.
 */

export interface BoardViewProps {
  /** The active file's content (already a `.py` file when meaningful). */
  source: string
  /** The active file's base name, shown for context. May be empty/undefined. */
  fileName?: string
  /** Whether the active file is a Python file (gates the "no pins" empty state). */
  isPython: boolean
  /** User-authored board definitions to merge with the built-ins (optional). */
  userBoards?: BoardDefinition[]
  /** When true, render the window title-bar chrome (drag region + selector). */
  asWindow?: boolean
  /** Open the user's boards folder (wired in the floating window). */
  onOpenBoardsFolder?: () => void
  /** Close the view. When set, a ✕ button is shown in the title bar. */
  onClose?: () => void
}

// --- Drawing geometry -------------------------------------------------------
// The SVG is drawn in a fixed viewBox; the board outline is sized from its
// `aspect` (w/h) and centred on the dark mat, leaving margins for the wires +
// connection-type badges that dock on the far left/right.

const VIEW_W = 760
const VIEW_H = 480
const CX = VIEW_W / 2
const CY = VIEW_H / 2
// Maximum outline footprint (board never exceeds this box).
const MAX_BOARD_W = 300
const MAX_BOARD_H = 380
const PAD_R = 7
const NODE_LEFT_X = 78
const NODE_RIGHT_X = VIEW_W - 78
const STORAGE_KEY = 'snakie.board.id'

/** The drawn board outline rect, computed from a definition's aspect. */
interface BoardBox {
  x: number
  y: number
  w: number
  h: number
}

/** Fit the board into the mat from its aspect ratio, centred. */
function boardBox(aspect: number): BoardBox {
  let w = MAX_BOARD_W
  let h = w / aspect
  if (h > MAX_BOARD_H) {
    h = MAX_BOARD_H
    w = h * aspect
  }
  return { x: CX - w / 2, y: CY - h / 2, w, h }
}

/** A resolved pad with its drawn coordinate + the edge it sits on. */
interface PadPoint {
  x: number
  y: number
  edge: BoardHeader['edge'] | 'led'
  pad: BoardPad
}

/** Compute every pad's drawn coordinate for a board (so they can be drawn + matched). */
function layoutPads(def: BoardDefinition, box: BoardBox): PadPoint[] {
  const points: PadPoint[] = []
  for (const header of def.headers) {
    const n = header.pins.length
    if (n === 0) continue
    header.pins.forEach((pad, i) => {
      // Spread pads evenly along the edge, inset from the corners.
      const t = n === 1 ? 0.5 : i / (n - 1)
      if (header.edge === 'left' || header.edge === 'right') {
        const y = box.y + 18 + t * (box.h - 36)
        const x = header.edge === 'left' ? box.x + 12 : box.x + box.w - 12
        points.push({ x, y, edge: header.edge, pad })
      } else {
        const x = box.x + 18 + t * (box.w - 36)
        const y = header.edge === 'top' ? box.y + 12 : box.y + box.h - 12
        points.push({ x, y, edge: header.edge, pad })
      }
    })
  }
  return points
}

/** The onboard-LED dot position (top-right corner of the board). */
function ledPoint(box: BoardBox): { x: number; y: number } {
  return { x: box.x + box.w - 26, y: box.y + 26 }
}

/**
 * Resolve a parsed pin token to a drawn pad coordinate.
 * Matching: numeric token vs `pad.gpio`; else token vs `pad.label`
 * (case-insensitive, treating `GP12` and `12` as equivalent). The board's
 * `ledLabel` token taps the onboard-LED dot. Out-of-range numeric tokens fall
 * back to the nearest GPIO pad so a wire still draws.
 */
function padForToken(
  token: string,
  def: BoardDefinition,
  pads: PadPoint[],
  box: BoardBox
): PadPoint {
  const t = token.trim()
  const lower = t.toLowerCase()

  // Onboard-LED token taps the LED dot.
  if (def.ledLabel && def.ledLabel.toLowerCase() === lower) {
    const p = ledPoint(box)
    return { x: p.x, y: p.y, edge: 'led', pad: { label: def.ledLabel } }
  }

  const isNum = /^\d+$/.test(t)
  const num = isNum ? Number(t) : NaN

  // Exact gpio match.
  if (isNum) {
    const byGpio = pads.find((p) => p.pad.gpio === num)
    if (byGpio) return byGpio
  }

  // Label match, allowing GP12 ↔ 12 equivalence.
  const norm = (s: string): string => s.toLowerCase().replace(/^gp/, '')
  const byLabel = pads.find((p) => {
    const lbl = p.pad.label.toLowerCase()
    if (lbl === lower) return true
    if (isNum && norm(p.pad.label) === t) return true
    return false
  })
  if (byLabel) return byLabel

  // Out-of-range numeric: nearest GPIO pad so a wire still draws.
  if (isNum) {
    const gpioPads = pads.filter((p) => typeof p.pad.gpio === 'number')
    if (gpioPads.length > 0) {
      let best = gpioPads[0]
      let bestDelta = Math.abs((best.pad.gpio as number) - num)
      for (const p of gpioPads) {
        const d = Math.abs((p.pad.gpio as number) - num)
        if (d < bestDelta) {
          best = p
          bestDelta = d
        }
      }
      return best
    }
  }

  // Last resort: first pad.
  return pads[0] ?? { x: box.x, y: box.y, edge: 'left', pad: { label: t } }
}

/** A drawn connection = its pads resolved + a connection-type badge anchor. */
interface DrawnWire {
  conn: UsedPins
  color: string
  pads: PadPoint[]
  /** Badge anchor point (where the connection-type node sits). */
  px: number
  py: number
}

/** True if a connection should dock on the left (its first pad is left/top). */
function docksLeft(pads: PadPoint[]): boolean {
  const first = pads[0]
  if (!first) return true
  if (first.edge === 'right' || first.edge === 'bottom') return false
  return true
}

/** Lay the parsed connections out into drawable wires, spacing the badges. */
function layoutWires(
  conns: UsedPins[],
  def: BoardDefinition,
  pads: PadPoint[],
  box: BoardBox
): DrawnWire[] {
  const resolved = conns.map((conn) => ({
    conn,
    pads: conn.pins.map((tok) => padForToken(tok, def, pads, box))
  }))
  const leftCount = resolved.filter((r) => docksLeft(r.pads)).length
  const rightCount = resolved.length - leftCount
  let leftN = 0
  let rightN = 0
  return resolved.map(({ conn, pads: pp }) => {
    const left = docksLeft(pp)
    const slotCount = left ? leftCount : rightCount
    const slot = left ? leftN++ : rightN++
    const span = VIEW_H - 110
    const py = slotCount <= 1 ? CY : 55 + (slot * span) / (slotCount - 1)
    const px = left ? NODE_LEFT_X : NODE_RIGHT_X
    return { conn, color: PIN_TYPE_COLOR[conn.type], pads: pp, px, py }
  })
}

/** Cubic bezier from a header pad to a badge anchor (horizontal pull). */
function wirePath(pad: PadPoint, px: number, py: number): string {
  const dx = (px - pad.x) * 0.5
  return `M ${pad.x} ${pad.y} C ${pad.x + dx} ${pad.y}, ${px - dx} ${py}, ${px} ${py}`
}

export function BoardView({
  source,
  fileName,
  isPython,
  userBoards,
  asWindow = false,
  onOpenBoardsFolder,
  onClose
}: BoardViewProps): JSX.Element {
  const boards = useMemo(() => mergeBoards(userBoards ?? []), [userBoards])

  // Persisted board selection; fall back to the default when stale/missing.
  const [boardId, setBoardId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BOARD_ID
    } catch {
      return DEFAULT_BOARD_ID
    }
  })
  const def = boards.find((b) => b.id === boardId) ?? boards[0] ?? BUILTIN_BOARDS[0]

  const selectBoard = (id: string): void => {
    setBoardId(id)
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Ignore write failures (storage disabled / quota).
    }
  }

  // Re-parse on every source change → live update.
  const conns = useMemo(() => (isPython ? parsePins(source) : []), [source, isPython])

  const box = useMemo(() => boardBox(def.aspect), [def.aspect])
  const pads = useMemo(() => layoutPads(def, box), [def, box])
  const wires = useMemo(() => layoutWires(conns, def, pads, box), [conns, def, pads, box])
  const usedPads = useMemo(() => wires.flatMap((w) => w.pads), [wires])
  const ledLit = usedPads.some((p) => p.edge === 'led')

  return (
    <div className={`boardview ${asWindow ? 'boardview--window' : ''}`} aria-label="Board View">
      <header className={`boardview__bar ${asWindow ? 'boardview__bar--drag' : ''}`}>
        <span className="boardview__grip" aria-hidden="true">
          ⋮⋮
        </span>
        <span className="boardview__title">BOARD VIEW</span>
        <select
          className="boardview__select"
          value={def.id}
          onChange={(e) => selectBoard(e.target.value)}
          aria-label="Select board"
          title="Select board"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <span className="boardview__subtitle">
          {def.name} · {def.mcu}
        </span>
        <span className="boardview__live" title="Updates live as you edit">
          <span className="boardview__led" aria-hidden="true" />
          LIVE
        </span>
        {onOpenBoardsFolder && (
          <button
            type="button"
            className="boardview__folder"
            onClick={onOpenBoardsFolder}
            title="Open the boards folder (add your own board JSON here)"
            aria-label="Open boards folder"
          >
            📁
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className="boardview__close"
            onClick={onClose}
            title="Close board view (Esc)"
            aria-label="Close board view"
          >
            ✕
          </button>
        )}
      </header>

      <div className="boardview__mat">
        {conns.length === 0 ? (
          <div className="boardview__empty">
            {isPython
              ? 'No pins detected — wire up a Pin/PWM/I2C/SPI/StateMachine to see it here.'
              : 'Open a Python (.py) file to visualise its pin wiring.'}
          </div>
        ) : (
          <svg
            className="boardview__svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label={`${def.name}: ${conns.length} pin connection${
              conns.length === 1 ? '' : 's'
            }`}
          >
            <BoardOutline def={def} box={box} pads={pads} usedPads={usedPads} ledLit={ledLit} />

            {/* Wires first (under the badges). */}
            {wires.map((w, i) =>
              w.pads.map((pad, j) => (
                <path
                  key={`wire-${i}-${j}`}
                  className="boardview__wire"
                  d={wirePath(pad, w.px, w.py)}
                  stroke={w.color}
                />
              ))
            )}

            {/* Connection-type badges. */}
            {wires.map((w, i) => (
              <TypeNode
                key={`node-${i}`}
                type={w.conn.type}
                variable={w.conn.variable}
                x={w.px}
                y={w.py}
                color={w.color}
              />
            ))}
          </svg>
        )}
      </div>

      <PinsInUse conns={conns} fileName={fileName} />
    </div>
  )
}

// --- SVG drawing ------------------------------------------------------------

/** Inline SVG of a generic board outline: PCB, holes, USB, features + pads. */
function BoardOutline({
  def,
  box,
  pads,
  usedPads,
  ledLit
}: {
  def: BoardDefinition
  box: BoardBox
  pads: PadPoint[]
  usedPads: PadPoint[]
  ledLit: boolean
}): JSX.Element {
  // A pad is "used" when one of its drawn coordinates is in `usedPads`.
  const usedKeys = new Set(usedPads.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`))
  const led = ledPoint(box)

  return (
    <g>
      <defs>
        <linearGradient id="bv-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe39a" />
          <stop offset="1" stopColor="#c79a3a" />
        </linearGradient>
        <linearGradient id="bv-usb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9edf2" />
          <stop offset="1" stopColor="#9aa0a8" />
        </linearGradient>
      </defs>

      {/* PCB */}
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx="16"
        fill={def.pcbColor}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth="2"
      />
      {/* Mounting holes */}
      {[
        [box.x + 16, box.y + 16],
        [box.x + box.w - 16, box.y + 16],
        [box.x + 16, box.y + box.h - 16],
        [box.x + box.w - 16, box.y + box.h - 16]
      ].map(([cx, cy], i) => (
        <circle
          key={`hole-${i}`}
          cx={cx}
          cy={cy}
          r="5.5"
          fill="rgba(0,0,0,0.5)"
          stroke="#caa64a"
          strokeWidth="1.3"
        />
      ))}

      {/* USB nub at the top edge. */}
      <rect
        x={box.x + box.w / 2 - 24}
        y={box.y - 9}
        width="48"
        height="22"
        rx="3"
        fill="url(#bv-usb)"
        stroke="#7b8088"
        strokeWidth="1.3"
      />

      {/* Decorative features. */}
      {(def.features ?? []).map((f, i) => (
        <Feature key={`feat-${i}`} feature={f} box={box} />
      ))}

      {/* Onboard LED dot (if the board declares one). */}
      {def.ledLabel && (
        <g>
          {ledLit && <circle cx={led.x} cy={led.y} r="10" fill="#46e06a" opacity="0.3" />}
          <circle
            cx={led.x}
            cy={led.y}
            r="5.5"
            fill={ledLit ? '#46e06a' : '#2c3a30'}
            stroke="rgba(0,0,0,0.5)"
            strokeWidth="1.3"
          />
          <text x={led.x} y={led.y + 19} className="boardview__pad-label" textAnchor="middle">
            {def.ledLabel}
          </text>
        </g>
      )}

      {/* Header pads. */}
      {pads.map((p, i) => {
        const used = usedKeys.has(`${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        const vertical = p.edge === 'left' || p.edge === 'right'
        // Label placement: outside the board, anchored away from the edge.
        const lx =
          p.edge === 'left' ? p.x + 13 : p.edge === 'right' ? p.x - 13 : p.x
        const ly = vertical ? p.y + 4 : p.edge === 'top' ? p.y - 11 : p.y + 17
        const anchor: 'start' | 'middle' | 'end' =
          p.edge === 'left' ? 'start' : p.edge === 'right' ? 'end' : 'middle'
        return (
          <g key={`pad-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={PAD_R}
              fill="url(#bv-gold)"
              stroke={used ? '#fff' : '#8a6a1e'}
              strokeWidth={used ? 2.5 : 1}
            />
            {used && (
              <text x={lx} y={ly} className="boardview__pad-label" textAnchor={anchor}>
                {p.pad.label}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/** Style table for the feature kinds. */
const FEATURE_STYLE: Record<BoardFeature['kind'], { fill: string; stroke: string; text: string }> = {
  mcu: { fill: '#15171b', stroke: '#2a2d33', text: '#b9bdc6' },
  wifi: { fill: '#c2c7cf', stroke: '#8d929b', text: '#3a3d44' },
  usb: { fill: '#d7dbe1', stroke: '#7b8088', text: '#3a3d44' },
  chip: { fill: '#23262c', stroke: '#454a52', text: '#c8ccd3' },
  led: { fill: '#2c3a30', stroke: '#46e06a', text: '#cfe9d6' }
}

/** Draw one decorative feature as a labelled rounded rect (normalised coords). */
function Feature({ feature, box }: { feature: BoardFeature; box: BoardBox }): JSX.Element {
  const x = box.x + feature.x * box.w
  const y = box.y + feature.y * box.h
  const w = feature.w * box.w
  const h = feature.h * box.h
  const s = FEATURE_STYLE[feature.kind] ?? FEATURE_STYLE.chip
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill={s.fill} stroke={s.stroke} strokeWidth="1.5" />
      <text
        x={x + w / 2}
        y={y + h / 2 + 4}
        className="boardview__chip-label"
        textAnchor="middle"
        style={{ fill: s.text }}
      >
        {feature.label}
      </text>
    </g>
  )
}

/** A connection-type badge: a coloured rounded rect + UPPERCASE type + variable. */
function TypeNode({
  type,
  variable,
  x,
  y,
  color
}: {
  type: PinType
  variable: string
  x: number
  y: number
  color: string
}): JSX.Element {
  const w = 96
  const h = 38
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx="8"
        fill="#23262c"
        stroke={color}
        strokeWidth="2"
      />
      <rect x={x - w / 2} y={y - h / 2} width={w} height="9" rx="8" fill={color} opacity="0.9" />
      <text x={x} y={y + 1} className="boardview__node-type" textAnchor="middle" style={{ fill: color }}>
        {PIN_TYPE_LABEL[type]}
      </text>
      {variable && (
        <text x={x} y={y + 14} className="boardview__node-var" textAnchor="middle">
          {variable}
        </text>
      )}
    </g>
  )
}

/** The brushed-metal "pins in use" strip at the bottom. */
function PinsInUse({ conns, fileName }: { conns: UsedPins[]; fileName?: string }): JSX.Element {
  return (
    <section className="boardview__pins" aria-label="Pins in use">
      <header className="boardview__pins-head">
        <span>
          PINS IN USE — {conns.length} CONNECTION{conns.length === 1 ? '' : 'S'}
        </span>
        {fileName && <span className="boardview__pins-file">{fileName}</span>}
      </header>
      {conns.length === 0 ? (
        <p className="boardview__pins-empty">No pins detected.</p>
      ) : (
        <ul className="boardview__pins-list">
          {conns.map((c, i) => (
            <li className="boardview__pins-row" key={`${c.variable}-${i}`}>
              <span
                className="boardview__swatch"
                style={{ background: PIN_TYPE_COLOR[c.type] }}
                aria-hidden="true"
              />
              <span className="boardview__type">{PIN_TYPE_LABEL[c.type]}</span>
              <span className="boardview__pin-nums">{c.pins.join(', ')}</span>
              <span
                className="boardview__pin-src"
                title={`${c.variable ? `${c.variable} = ` : ''}${c.constructor}`}
              >
                {c.variable ? `${c.variable} = ` : ''}
                {c.constructor}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
