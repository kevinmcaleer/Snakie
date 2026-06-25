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
  type BoardPad,
  type BoardPadType,
  type BoardFeature
} from './board-defs'
import {
  boardBox,
  busLabel,
  layoutPads,
  ledPoint,
  padForToken,
  padLabelPlacement,
  padsBounds,
  type BoardBox,
  type PadPoint
} from './board-layout'
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
  /** Enter the Board Creator. When set, a brass knob button shows in the bar. */
  onEnterCreator?: () => void
  /**
   * Preview mode for the Board Creator: when set, this exact definition is drawn
   * (bypassing the picker + persisted selection) so the creator shows the same
   * SVG the live view will produce. The board-id selector is hidden in this mode.
   */
  previewDef?: BoardDefinition
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

/** This view's box-fitting geometry (centred on the 760×480 mat). */
const BOX_GEOM = { cx: CX, cy: CY, maxW: MAX_BOARD_W, maxH: MAX_BOARD_H }

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
  onClose,
  onEnterCreator,
  previewDef
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
  // In preview mode the creator's working definition wins (no picker / storage).
  const def =
    previewDef ?? boards.find((b) => b.id === boardId) ?? boards[0] ?? BUILTIN_BOARDS[0]

  // Custom dropdown open state. We avoid a native <select>: its popup is
  // unreliable inside a frameless, always-on-top window with a drag region.
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

  const box = useMemo(() => boardBox(def.aspect, BOX_GEOM), [def.aspect])
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
        {!previewDef && (
        <div className="boardview__picker">
          <button
            type="button"
            className="boardview__picker-btn"
            onClick={() => setPickerOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            title="Select board"
          >
            <span className="boardview__picker-name">{def.name}</span>
            <span className="boardview__picker-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {pickerOpen && (
            <>
              <button
                type="button"
                className="boardview__picker-backdrop"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setPickerOpen(false)}
              />
              <ul className="boardview__picker-menu" role="listbox" aria-label="Select board">
                {boards.map((b) => (
                  <li key={b.id} role="option" aria-selected={b.id === def.id}>
                    <button
                      type="button"
                      className={`boardview__picker-item ${b.id === def.id ? 'is-active' : ''}`}
                      onClick={() => selectBoard(b.id)}
                    >
                      <span className="boardview__picker-item-name">{b.name}</span>
                      <span className="boardview__picker-item-mcu">{b.mcu}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        )}
        <span className="boardview__subtitle">{def.mcu}</span>
        <span className="boardview__live" title="Updates live as you edit">
          <span className="boardview__led" aria-hidden="true" />
          LIVE
        </span>
        {onEnterCreator && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--knob boardview__create"
            onClick={onEnterCreator}
            title="Create or edit a custom board"
            aria-label="Open the Board Creator"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              {/* A pencil-on-board glyph for "design a board". */}
              <path
                fill="currentColor"
                d="M10.6 1.6l3.8 3.8-1.4 1.4-3.8-3.8 1.4-1.4zM8.5 3.7l3.8 3.8L5.9 13.9 1.5 14.5l.6-4.4L8.5 3.7z"
              />
            </svg>
          </button>
        )}
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
        {conns.length === 0 && !previewDef ? (
          <div className="boardview__empty">
            {isPython
              ? 'No pins detected — wire up a Pin/PWM/I2C/SPI/StateMachine to see it here.'
              : 'Open a Python (.py) file to visualise its pin wiring.'}
          </div>
        ) : (
          <svg
            className="boardview__svg"
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label={`${def.name}: ${conns.length} pin connection${
              conns.length === 1 ? '' : 's'
            }`}
          >
            <BoardOutline def={def} box={box} pads={pads} usedPads={usedPads} ledLit={ledLit} />

            {/* Bus groups (#147): outline + bus tag + per-pin roles, under wires. */}
            {wires.map((w, i) => (
              <BusGroup key={`bus-${i}`} wire={w} />
            ))}

            {/* Wires (under the badges). */}
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
                bus={w.conn.bus}
                variable={w.conn.variable}
                x={w.px}
                y={w.py}
                color={w.color}
              />
            ))}
          </svg>
        )}
      </div>

      {!previewDef && <PinsInUse conns={conns} fileName={fileName} />}
    </div>
  )
}

// --- SVG drawing ------------------------------------------------------------

/**
 * Pad fill by electrical role. GPIO pads keep the gold gradient (and can be
 * highlighted as "used"); power/other pads get a distinct, never-highlighted
 * colour so the board reads correctly (gnd = dark, vcc = red, other = grey).
 */
function padFill(type: BoardPadType | undefined): string {
  switch (type) {
    case 'gnd':
      return '#2b2f36'
    case 'vcc':
      return '#c0392b'
    case 'other':
      return '#8a9099'
    default:
      return 'url(#bv-gold)'
  }
}

/** Whether a pad can ever be wired/highlighted (only true GPIO pads). */
function padIsGpio(pad: BoardPad): boolean {
  return (pad.type ?? 'gpio') === 'gpio'
}

/**
 * The silver USB-nub rect, docked at the board's REAL connector edge (#109): we
 * centre it on a declared `usb` feature and place it just outside the nearer
 * short edge (top in the upper half, bottom otherwise — so the ESP32's bottom
 * USB renders correctly). Falls back to the top centre when no `usb` feature is
 * declared (the Pico-family convention).
 */
function usbNub(def: BoardDefinition, box: BoardBox): { x: number; y: number; w: number; h: number } {
  const usb = def.features?.find((f) => f.kind === 'usb')
  const w = 48
  const h = 22
  if (usb) {
    const x = box.x + (usb.x + usb.w / 2) * box.w - w / 2
    const bottom = usb.y + usb.h / 2 > 0.5
    const y = bottom ? box.y + box.h - 13 : box.y - 9
    return { x, y, w, h }
  }
  return { x: box.x + box.w / 2 - w / 2, y: box.y - 9, w, h }
}

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

      {/* A board photo/SVG (data URL) is clipped to the rounded PCB rect. */}
      {def.image && (
        <clipPath id="bv-pcb-clip">
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="16" />
        </clipPath>
      )}

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
      {/* Optional uploaded board image drawn over the PCB fill. */}
      {def.image && (
        <image
          href={def.image}
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#bv-pcb-clip)"
        />
      )}
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

      {/* USB nub at the board's REAL connector edge (#109). */}
      {(() => {
        const nub = usbNub(def, box)
        return (
          <rect
            x={nub.x}
            y={nub.y}
            width={nub.w}
            height={nub.h}
            rx="3"
            fill="url(#bv-usb)"
            stroke="#7b8088"
            strokeWidth="1.3"
          />
        )
      })()}

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
        const isGpio = padIsGpio(p.pad)
        // Only GPIO pads can be highlighted as "used" (power pads never wire).
        const used = isGpio && usedKeys.has(`${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        // Label placement (#109): OUTSIDE the board on the pad's own side — see
        // {@link padLabelPlacement} (shared with the live BoardGraph + export).
        const place = padLabelPlacement(p.edge, 13)
        const lx = p.x + place.dx
        const ly = p.y + place.dy
        const anchor = place.anchor
        // Power/other pads always show their label so the silk is readable; GPIO
        // pads only label when wired (to avoid a busy board in the live view).
        const showLabel = used || !isGpio
        return (
          <g key={`pad-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={PAD_R}
              fill={padFill(p.pad.type)}
              stroke={used ? '#fff' : isGpio ? '#8a6a1e' : 'rgba(0,0,0,0.5)'}
              strokeWidth={used ? 2.5 : 1}
            />
            {showLabel && (
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
  bus,
  variable,
  x,
  y,
  color
}: {
  type: PinType
  /** Hardware bus number for i2c/spi — appended to the label (I2C0, SPI1). */
  bus?: number
  variable: string
  x: number
  y: number
  color: string
}): JSX.Element {
  const w = 96
  const h = 38
  // i2c/spi show the bus number (I2C0/I2C1); everything else its plain type.
  const label = type === 'i2c' || type === 'spi' ? busLabel(type, bus) : PIN_TYPE_LABEL[type]
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
        {label}
      </text>
      {variable && (
        <text x={x} y={y + 14} className="boardview__node-var" textAnchor="middle">
          {variable}
        </text>
      )}
    </g>
  )
}

/**
 * Bus group (#147): for an i2c/spi connection with ≥2 pads, frame the bus's pads
 * with a dashed rounded rect in the bus colour, tag it with the bus label
 * (I2C0…), and label each pad with its role (SDA/SCL) just OUTSIDE the board,
 * stacked above the silk GPIO label — so the pair reads as one bus. Non-bus (or
 * single-pad) connections draw nothing.
 */
function BusGroup({ wire }: { wire: DrawnWire }): JSX.Element | null {
  const { conn, color, pads } = wire
  if ((conn.type !== 'i2c' && conn.type !== 'spi') || pads.length < 2) return null
  const bounds = padsBounds(pads, 13)
  if (!bounds) return null
  const tag = busLabel(conn.type, conn.bus)
  const tagW = 13 + tag.length * 7
  return (
    <g className="boardview__bus" aria-hidden="true">
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.w}
        height={bounds.h}
        rx="9"
        fill={color}
        fillOpacity="0.06"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.85"
      />
      {/* Bus tag, pinned to the group's top-left with a solid chip for contrast. */}
      <rect x={bounds.x + 6} y={bounds.y - 9} width={tagW} height="16" rx="5" fill={color} />
      <text
        x={bounds.x + 6 + tagW / 2}
        y={bounds.y + 2}
        className="boardview__bus-tag"
        textAnchor="middle"
      >
        {tag}
      </text>
      {/* Per-pin role labels (SDA/SCL …), stacked above each pad's silk label. */}
      {pads.map((pad, i) => {
        const role = conn.roles?.[i]
        if (!role) return null
        const place = padLabelPlacement(pad.edge, 13)
        return (
          <text
            key={`role-${i}`}
            x={pad.x + place.dx}
            y={pad.y + place.dy - 9}
            className="boardview__bus-role"
            textAnchor={place.anchor}
            style={{ fill: color }}
          >
            {role}
          </text>
        )
      })}
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
              {c.instrument && (
                <span
                  className="boardview__pin-inst"
                  title={`Used by the ${c.instrument} instrument library`}
                >
                  {c.instrument} instrument
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
