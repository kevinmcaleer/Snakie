import { useMemo, useState } from 'react'
import {
  parsePins,
  PIN_TYPE_COLOR,
  PIN_TYPE_LABEL,
  PIN_TYPE_TAG,
  type PinType,
  type UsedPins
} from './parse-pins'
import {
  BUILTIN_BOARDS,
  DEFAULT_BOARD_ID,
  mergeBoards,
  type BoardDefinition
} from './board-defs'
import './BoardGraph.css'

/**
 * BOARD GRAPH (node-graph live Board View)
 * ========================================
 *
 * The live, read-only Board View rendered as a **node graph**: one dark node
 * card per parsed connection on the left, each wired by a drooping blue/coloured
 * "noodle" cable to a gold castellated GPIO pad on the board's left edge, the
 * board drawn on the right, and a light "pins in use" table below.
 *
 * It re-derives entirely from `{ source, fileName, isPython }` + the persisted
 * board selection (shared with {@link BoardView} via the `snakie.board.id` key),
 * so it updates live as the parent re-streams the active file. It draws the
 * board itself (PCB / MCU / LED / pads) directly here — the generic
 * {@link BoardView} drawer is kept for the Board Creator's preview and is NOT
 * reused for this layout.
 *
 * NOTE: node values are **idle placeholders** (a dim dot + `1` for boolean
 * input/output, `—` for bus types). Live device values are a follow-up: it would
 * need the main process to stream the board's actual pin state into this window
 * (device polling) — intentionally not implemented here.
 */

export interface BoardGraphProps {
  /** The active file's content (already a `.py` file when meaningful). */
  source: string
  /** The active file's base name, shown in the pins table header. */
  fileName?: string
  /** Whether the active file is a Python file (gates the empty states). */
  isPython: boolean
  /** User-authored board definitions to merge with the built-ins (optional). */
  userBoards?: BoardDefinition[]
  /** When true, render the window title-bar chrome (drag region + selector). */
  asWindow?: boolean
  /** Close the view. When set, a ✕ key is shown in the header. */
  onClose?: () => void
  /** Enter the Board Creator. When set, the gold edit knob is shown. */
  onEnterCreator?: () => void
  /** Open the user's boards folder (wired in the floating window). */
  onOpenBoardsFolder?: () => void
}

/** localStorage key shared with {@link BoardView} so board choice persists across both. */
const STORAGE_KEY = 'snakie.board.id'

// --- Node-graph geometry (mirrors the design mockup) ------------------------
// Everything is laid out in a single SVG coordinate space so the noodle wires,
// the gold pads and the HTML node cards all line up on the same row Y.
const PITCH = 46 // vertical distance between node rows
const NODE_H = 36 // node card height
const NODE_W = 252 // node card width
const NODE_LEFT = 36 // node card left inset
const FIRST_Y = 149 // centre Y of the first row (and its pad / wire ends)
const NODE_DOT_X = 288 // node right-edge solder dot X (wire start)
const PAD_X = 742 // gold GPIO pad X (wire end + board left edge)
const SAG = 32 // downward bezier sag for the drooping noodle
const CANVAS_W = 1180 // canvas / SVG width
const BOARD_X = 720 // PCB rect left
const BOARD_W = 300 // PCB rect width
const BOARD_TOP_PAD = 31 // PCB top above the first pad row
const BOARD_BOT_PAD = 33 // PCB bottom below the last pad row

/** Centre Y of row `i` (node card, pad and wire all share it). */
function rowY(i: number): number {
  return FIRST_Y + i * PITCH
}

/**
 * Resolve a parsed pin token to the label drawn on its gold pad. Numeric tokens
 * become `GP<n>` (the RP2040/RP2350 convention); a board's `ledLabel` and any
 * other non-numeric label pass through unchanged (mirrors BoardView's matching).
 */
function padLabelForToken(token: string, def: BoardDefinition): string {
  const t = token.trim()
  if (/^\d+$/.test(t)) return `GP${t}`
  if (def.ledLabel && def.ledLabel.toLowerCase() === t.toLowerCase()) return def.ledLabel
  return t
}

/** One drawable connection row: its node, its pad and the wire between them. */
interface GraphRow {
  conn: UsedPins
  y: number
  color: string
  /** The pad label (e.g. `GP2`) — a connection's FIRST pin owns the row. */
  padLabel: string
}

export function BoardGraph({
  source,
  fileName,
  isPython,
  userBoards,
  asWindow = false,
  onClose,
  onEnterCreator,
  onOpenBoardsFolder
}: BoardGraphProps): JSX.Element {
  const boards = useMemo(() => mergeBoards(userBoards ?? []), [userBoards])

  // Persisted board selection (shared with BoardView); default when stale.
  const [boardId, setBoardId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BOARD_ID
    } catch {
      return DEFAULT_BOARD_ID
    }
  })
  const def = boards.find((b) => b.id === boardId) ?? boards[0] ?? BUILTIN_BOARDS[0]

  // Custom dropdown open state — a native <select> popup is unreliable inside a
  // frameless, always-on-top window with a drag region (same as BoardView).
  const [pickerOpen, setPickerOpen] = useState(false)
  const selectBoard = (id: string): void => {
    setBoardId(id)
    setPickerOpen(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Ignore write failures (storage disabled / quota).
    }
  }

  // Re-parse on every source change → live update.
  const conns = useMemo(() => (isPython ? parsePins(source) : []), [source, isPython])

  // One row per connection, evenly spaced from the 46px pitch — the first pin of
  // each connection owns the row (a bus's other pins ride the same node card).
  const rows = useMemo<GraphRow[]>(
    () =>
      conns.map((conn, i) => ({
        conn,
        y: rowY(i),
        color: PIN_TYPE_COLOR[conn.type],
        padLabel: padLabelForToken(conn.pins[0] ?? '', def)
      })),
    [conns, def]
  )

  // Synthesise the board + canvas height to span every pad row so a large N
  // never clips: the canvas grows and (via CSS) scrolls vertically when needed.
  const lastY = rows.length > 0 ? rowY(rows.length - 1) : FIRST_Y
  const boardYTop = FIRST_Y - BOARD_TOP_PAD
  const boardH = lastY - boardYTop + BOARD_BOT_PAD
  // Canvas is at least the mockup height; grows for large N.
  const canvasH = Math.max(680, boardYTop + boardH + 40)

  const hasRows = rows.length > 0

  return (
    <div className={`boardgraph ${asWindow ? 'boardgraph--window' : ''}`} aria-label="Board View">
      <header className={`boardgraph__bar ${asWindow ? 'boardgraph__bar--drag' : ''}`}>
        <span className="boardgraph__grip" aria-hidden="true">
          {/* 6-dot drag grip (2×3). */}
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="boardgraph__grip-dot" />
          ))}
        </span>
        <span className="boardgraph__title">BOARD&nbsp;VIEW</span>

        <div className="boardgraph__picker">
          <button
            type="button"
            className="boardgraph__picker-btn"
            onClick={() => setPickerOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            title="Select board"
          >
            <span className="boardgraph__picker-name">{def.name}</span>
            <span className="boardgraph__picker-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {pickerOpen && (
            <>
              <button
                type="button"
                className="boardgraph__picker-backdrop"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setPickerOpen(false)}
              />
              <ul className="boardgraph__picker-menu" role="listbox" aria-label="Select board">
                {boards.map((b) => (
                  <li key={b.id} role="option" aria-selected={b.id === def.id}>
                    <button
                      type="button"
                      className={`boardgraph__picker-item ${b.id === def.id ? 'is-active' : ''}`}
                      onClick={() => selectBoard(b.id)}
                    >
                      <span className="boardgraph__picker-item-name">{b.name}</span>
                      <span className="boardgraph__picker-item-mcu">{b.mcu}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <span className="boardgraph__chip">{def.mcu}</span>

        <div className="boardgraph__actions">
          <span className="boardgraph__live" title="Updates live as you edit">
            <span className="boardgraph__led" aria-hidden="true" />
            LIVE
          </span>
          {onEnterCreator && (
            <button
              type="button"
              className="boardgraph__knob"
              onClick={onEnterCreator}
              title="Create or edit a custom board"
              aria-label="Open the Board Creator"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M4 20l4-1 11-11-3-3L5 16l-1 4z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {onOpenBoardsFolder && (
            <button
              type="button"
              className="boardgraph__key"
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
              className="boardgraph__key boardgraph__key--close"
              onClick={onClose}
              title="Close board view (Esc)"
              aria-label="Close board view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="boardgraph__canvas">
        {!hasRows ? (
          <div className="boardgraph__empty">
            {isPython
              ? 'No pins detected — wire up a Pin/PWM/I2C/SPI/StateMachine to see it here.'
              : 'Open a Python (.py) file to visualise its pin wiring.'}
          </div>
        ) : (
          <div className="boardgraph__stage" style={{ width: CANVAS_W, height: canvasH }}>
            <svg
              className="boardgraph__svg"
              xmlns="http://www.w3.org/2000/svg"
              width={CANVAS_W}
              height={canvasH}
              viewBox={`0 0 ${CANVAS_W} ${canvasH}`}
              role="img"
              aria-label={`${def.name}: ${rows.length} pin connection${
                rows.length === 1 ? '' : 's'
              }`}
            >
              <defs>
                <linearGradient id="bg-pcb" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0"
                    stopColor={def.pcbColor || '#1f7a44'}
                  />
                  <stop offset="1" stopColor="#13592f" />
                </linearGradient>
                <linearGradient id="bg-gold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#f6dd92" />
                  <stop offset="1" stopColor="#caa23e" />
                </linearGradient>
                <linearGradient id="bg-silver" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e9ecf0" />
                  <stop offset="0.5" stopColor="#b7bcc4" />
                  <stop offset="1" stopColor="#8d939c" />
                </linearGradient>
                <filter id="bg-glow" x="-40%" y="-300%" width="180%" height="700%">
                  <feGaussianBlur stdDeviation="2" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Drooping noodle wires (under the board), coloured by type. */}
              <g fill="none" strokeLinecap="round" filter="url(#bg-glow)" opacity="0.92">
                {rows.map((r, i) => (
                  <path key={`wire-${i}`} d={noodlePath(r.y)} stroke={r.color} strokeWidth="2.6" />
                ))}
              </g>
              {/* Node-side solder dots. */}
              <g>
                {rows.map((r, i) => (
                  <circle key={`dot-${i}`} cx={NODE_DOT_X} cy={r.y} r="4.5" fill={r.color} />
                ))}
              </g>

              <Board def={def} yTop={boardYTop} height={boardH} rows={rows} />
            </svg>

            {/* Node cards (HTML, over the SVG) — one per connection. */}
            {rows.map((r, i) => (
              <NodeCard key={`node-${i}`} row={r} />
            ))}
          </div>
        )}
      </div>

      <PinsInUse conns={conns} fileName={fileName} />
    </div>
  )
}

// --- SVG drawing ------------------------------------------------------------

/**
 * A drooping cubic bezier from the node solder dot to its aligned gold pad —
 * horizontal tangents and a ~32px downward sag (matches the mockup's
 * `M288 y C 462 y+32 568 y+32 742 y`). Same Y at both ends so the pad row is
 * exactly aligned to its node row.
 */
function noodlePath(y: number): string {
  const c1x = NODE_DOT_X + 174 // 462
  const c2x = PAD_X - 174 // 568
  const cy = y + SAG
  return `M${NODE_DOT_X} ${y} C ${c1x} ${cy} ${c2x} ${cy} ${PAD_X} ${y}`
}

/** The green PCB, USB nub, MCU block, onboard LED, decorative + GPIO pads. */
function Board({
  def,
  yTop,
  height,
  rows
}: {
  def: BoardDefinition
  yTop: number
  height: number
  rows: GraphRow[]
}): JSX.Element {
  const cx = BOARD_X + BOARD_W / 2 // board centre X
  const mcuY = yTop + height / 2 - 58
  const ledY = yTop + 50
  const firstY = rows[0]?.y ?? FIRST_Y
  const lastY = rows[rows.length - 1]?.y ?? FIRST_Y
  return (
    <g>
      {/* PCB + dashed silkscreen inset. */}
      <rect
        x={BOARD_X}
        y={yTop}
        width={BOARD_W}
        height={height}
        rx="18"
        fill="url(#bg-pcb)"
        stroke="#0c3a23"
        strokeWidth="1.5"
      />
      <rect
        x={BOARD_X + 10}
        y={yTop + 10}
        width={BOARD_W - 20}
        height={height - 20}
        rx="12"
        fill="none"
        stroke="rgba(255,255,255,.32)"
        strokeWidth="1"
        strokeDasharray="2 5"
      />

      {/* USB connector nub on top. */}
      <rect
        x={cx - 28}
        y={yTop - 16}
        width="56"
        height="24"
        rx="4"
        fill="url(#bg-silver)"
        stroke="#6c727b"
        strokeWidth="1"
      />

      {/* Onboard LED dot + 3V3 / LED labels. */}
      <circle cx={cx + 42} cy={ledY} r="7" fill="#e23b2b" />
      <text
        x={cx + 20}
        y={ledY + 4}
        textAnchor="end"
        className="boardgraph__svg-label"
        fill="#cfe8d4"
      >
        3V3
      </text>
      <text
        x={cx + 42}
        y={ledY + 28}
        textAnchor="middle"
        className="boardgraph__svg-label"
        fill="#bcd9c4"
      >
        {def.ledLabel ?? 'LED'}
      </text>

      {/* MCU block. */}
      <rect
        x={cx - 58}
        y={mcuY}
        width="116"
        height="116"
        rx="7"
        fill="#1c1d20"
        stroke="#0c0d0f"
        strokeWidth="1"
      />
      <rect x={cx - 50} y={mcuY + 8} width="100" height="100" rx="4" fill="#26282c" />
      <text
        x={cx}
        y={mcuY + 62}
        textAnchor="middle"
        className="boardgraph__svg-mcu"
        fill="#cfd3d8"
      >
        {def.mcu}
      </text>
      <text
        x={cx}
        y={mcuY + 80}
        textAnchor="middle"
        className="boardgraph__svg-sub"
        fill="#8a8f98"
      >
        MCU
      </text>

      {/* A few decorative right-edge pads. */}
      {[firstY, (firstY + lastY) / 2, lastY].map((y, i) => (
        <circle
          key={`deco-${i}`}
          cx={BOARD_X + BOARD_W - 22}
          cy={y}
          r="6.5"
          fill="url(#bg-gold)"
          stroke="#9a7a1e"
          strokeWidth="0.7"
        />
      ))}

      {/* Left-edge GPIO pads — one per connection row, aligned to its node Y. */}
      <g className="boardgraph__svg-pad-text">
        {rows.map((r, i) => (
          <g key={`pad-${i}`}>
            <circle
              cx={PAD_X}
              cy={r.y}
              r="7"
              fill="url(#bg-gold)"
              stroke="#9a7a1e"
              strokeWidth="0.8"
            />
            <circle cx={PAD_X} cy={r.y} r="2.6" fill="#5a4a1a" />
            <text x={PAD_X + 16} y={r.y + 4} fill="#cfe8d4">
              {r.padLabel}
            </text>
          </g>
        ))}
      </g>
    </g>
  )
}

/** One node card: type tag inline beside the variable + an idle value. */
function NodeCard({ row }: { row: GraphRow }): JSX.Element {
  const { conn, color } = row
  return (
    <div
      className="boardgraph__node"
      style={{
        left: NODE_LEFT,
        top: row.y - NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
        borderColor: color
      }}
    >
      <span className="boardgraph__node-tag" style={{ background: color }}>
        {PIN_TYPE_TAG[conn.type]}
      </span>
      <span className="boardgraph__node-var">{conn.variable || conn.constructor}</span>
      <NodeValue type={conn.type} />
    </div>
  )
}

/**
 * The right-hand value on a node card. These are **idle placeholders**: we don't
 * have live device pin state yet (a follow-up — it would need the main process to
 * stream the board's actual values into this window). Boolean input/output show a
 * dim dot + `1`; bus types (pwm/i2c/spi/pio) show a dim dot + `—`.
 */
function NodeValue({ type }: { type: PinType }): JSX.Element {
  const boolean = type === 'input' || type === 'output'
  return (
    <span className="boardgraph__node-val">
      <span className="boardgraph__node-dot" />
      {boolean ? '1' : '—'}
    </span>
  )
}

/** The light "pins in use" table at the bottom (one row per connection). */
function PinsInUse({ conns, fileName }: { conns: UsedPins[]; fileName?: string }): JSX.Element {
  return (
    <section className="boardgraph__pins" aria-label="Pins in use">
      <header className="boardgraph__pins-head">
        <span>
          PINS IN USE — {conns.length} CONNECTION{conns.length === 1 ? '' : 'S'}
        </span>
        {fileName && <span className="boardgraph__pins-file">{fileName}</span>}
      </header>
      {conns.length === 0 ? (
        <p className="boardgraph__pins-empty">No pins detected.</p>
      ) : (
        <ul className="boardgraph__pins-list">
          {conns.map((c, i) => (
            <li className="boardgraph__pins-row" key={`${c.variable}-${i}`}>
              <span
                className="boardgraph__swatch"
                style={{ background: PIN_TYPE_COLOR[c.type] }}
                aria-hidden="true"
              />
              <span className="boardgraph__pins-type">{PIN_TYPE_LABEL[c.type]}</span>
              <span className="boardgraph__pins-num">{c.pins.join(', ')}</span>
              <span
                className="boardgraph__pins-src"
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
