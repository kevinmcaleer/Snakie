import { useEffect, useMemo } from 'react'
import { parsePins, BUS_COLOR, BUS_PERIPHERAL, type PinBus, type UsedPins } from './parse-pins'
import './BoardView.css'

/**
 * BOARD VIEW POPUP
 * ================
 *
 * A centered modal that parses the active editor file for pin usage
 * ({@link parsePins}) and visualises a Raspberry Pi Pico 2 W / RP2350 with every
 * used pin wired to a representative peripheral, plus a "pins in use" table at
 * the bottom. It re-derives entirely from the passed `source`, so the parent can
 * re-render it on every active-file change and it updates live.
 *
 * Closing: the ✕ button, a click on the scrim, or Escape (mirrors
 * {@link SettingsDialog}). `window.prompt` is never used (it doesn't work in the
 * Electron renderer).
 *
 * The board drawing is a faithful-but-stylised inline SVG — green PCB, USB
 * connector, two rows of gold castellated header pads, the RP2350, the CYW43439
 * Wi-Fi can and the onboard LED — not a photoreal render; the functional core is
 * the parser → wiring → table mapping.
 */

export interface BoardViewProps {
  /** The active file's content (already a `.py` file when meaningful). */
  source: string
  /** The active file's base name, shown for context. May be empty/undefined. */
  fileName?: string
  /** Whether the active file is a Python file (gates the "no pins" empty state). */
  isPython: boolean
  onClose: () => void
}

// --- Board geometry ---------------------------------------------------------
// The SVG is drawn in a 720×420 viewBox. The board sits centred; the two header
// rows run down its long edges. Pin pads are indexed 0..19 top→bottom.

const VIEW_W = 720
const VIEW_H = 460
const BOARD_X = 250
const BOARD_Y = 30
const BOARD_W = 220
const BOARD_H = 400
const PADS_PER_SIDE = 20
const PAD_TOP = BOARD_Y + 28
const PAD_GAP = (BOARD_H - 56) / (PADS_PER_SIDE - 1)
const PAD_R = 7
const LEFT_PAD_X = BOARD_X + 12
const RIGHT_PAD_X = BOARD_X + BOARD_W - 12

/**
 * The Pico's physical GPIO → header-pad layout (subset that matters for wiring).
 * Each side has 20 pads; we map a GPIO number to {side, row}. Unknown/labelled
 * pins ("LED") fall back to the onboard LED tap. This is the standard Pico
 * pinout for GP0..GP28 down the two edges.
 */
const LEFT_GPIO = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const
const RIGHT_GPIO = [28, 27, 26, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6] as const

interface PadPoint {
  x: number
  y: number
  side: 'left' | 'right' | 'led'
  label: string
}

/** Resolve a parsed pin token to a header-pad coordinate to wire from. */
function padForPin(token: string): PadPoint {
  // The onboard LED is GP-less ("LED" label) on the Pico 2 W — tap the LED.
  if (!/^\d+$/.test(token)) {
    return { x: LED_X, y: LED_Y, side: 'led', label: token }
  }
  const gp = Number(token)
  const li = LEFT_GPIO.indexOf(gp as (typeof LEFT_GPIO)[number])
  if (li >= 0) {
    return { x: LEFT_PAD_X, y: PAD_TOP + li * PAD_GAP, side: 'left', label: `GP${gp}` }
  }
  const ri = RIGHT_GPIO.indexOf(gp as (typeof RIGHT_GPIO)[number])
  if (ri >= 0) {
    return { x: RIGHT_PAD_X, y: PAD_TOP + ri * PAD_GAP, side: 'right', label: `GP${gp}` }
  }
  // Out-of-range GPIO: clamp onto the nearest left pad so the wire still draws.
  const idx = Math.min(PADS_PER_SIDE - 1, Math.max(0, gp))
  return { x: LEFT_PAD_X, y: PAD_TOP + idx * PAD_GAP, side: 'left', label: `GP${gp}` }
}

// Onboard LED position (top of the board, beside the Wi-Fi can).
const LED_X = BOARD_X + BOARD_W - 60
const LED_Y = BOARD_Y + 56

// Peripheral drop zones: left-side buses dock on the far left, right-side on the
// far right, so wires fan out without crossing the board.
const PERIPH_LEFT_X = 70
const PERIPH_RIGHT_X = VIEW_W - 70

/** A drawn connection = parsed pins resolved to pads + a peripheral anchor. */
interface DrawnWire {
  conn: UsedPins
  color: string
  pads: PadPoint[]
  /** Peripheral anchor point (where the device sits). */
  px: number
  py: number
}

/** Lay the parsed connections out into drawable wires, spacing peripherals. */
function layout(conns: UsedPins[]): DrawnWire[] {
  let leftN = 0
  let rightN = 0
  const leftCount = conns.filter((c) => onLeft(c)).length
  const rightCount = conns.length - leftCount
  return conns.map((conn) => {
    const pads = conn.pins.map(padForPin)
    const left = onLeft(conn)
    const slotCount = left ? leftCount : rightCount
    const slot = left ? leftN++ : rightN++
    // Spread peripherals vertically over the mat height.
    const span = VIEW_H - 120
    const py = slotCount <= 1 ? VIEW_H / 2 : 60 + (slot * span) / (slotCount - 1)
    const px = left ? PERIPH_LEFT_X : PERIPH_RIGHT_X
    return { conn, color: BUS_COLOR[conn.bus], pads, px, py }
  })
}

/** Heuristic: dock a connection on the left if its first pad is a left pad. */
function onLeft(conn: UsedPins): boolean {
  const first = padForPin(conn.pins[0])
  if (first.side === 'left') return true
  if (first.side === 'right') return false
  return true // led / fallback → left
}

/** Cubic bezier from a header pad to a peripheral anchor (horizontal pull). */
function wirePath(pad: PadPoint, px: number, py: number): string {
  const dx = (px - pad.x) * 0.5
  return `M ${pad.x} ${pad.y} C ${pad.x + dx} ${pad.y}, ${px - dx} ${py}, ${px} ${py}`
}

export function BoardView({ source, fileName, isPython, onClose }: BoardViewProps): JSX.Element {
  // Re-parse on every source change → live update while open.
  const conns = useMemo(() => (isPython ? parsePins(source) : []), [source, isPython])
  const wires = useMemo(() => layout(conns), [conns])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="boardview-scrim" onClick={onClose} role="presentation">
      <div
        className="boardview"
        role="dialog"
        aria-modal="true"
        aria-label="Board View"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="boardview__bar">
          <span className="boardview__grip" aria-hidden="true">
            ⋮⋮
          </span>
          <span className="boardview__title">BOARD VIEW</span>
          <span className="boardview__subtitle">Raspberry Pi Pico 2 W · RP2350</span>
          <span className="boardview__live" title="Updates live as you edit">
            <span className="boardview__led" aria-hidden="true" />
            LIVE
          </span>
          <button
            type="button"
            className="boardview__close"
            onClick={onClose}
            aria-label="Close board view"
            title="Close"
          >
            ✕
          </button>
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
              aria-label={`${conns.length} pin connection${conns.length === 1 ? '' : 's'}`}
            >
              <PicoBoard usedPads={wires.flatMap((w) => w.pads)} />

              {/* Wires first (under peripherals) */}
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

              {/* Peripherals + their labels */}
              {wires.map((w, i) => (
                <Peripheral key={`periph-${i}`} bus={w.conn.bus} x={w.px} y={w.py} color={w.color} />
              ))}
            </svg>
          )}
        </div>

        <PinsInUse conns={conns} fileName={fileName} />
      </div>
    </div>
  )
}

/** Inline SVG of the Pico 2 W with the used header pads highlighted. */
function PicoBoard({ usedPads }: { usedPads: PadPoint[] }): JSX.Element {
  const usedLeft = new Set(usedPads.filter((p) => p.side === 'left').map((p) => p.y.toFixed(1)))
  const usedRight = new Set(usedPads.filter((p) => p.side === 'right').map((p) => p.y.toFixed(1)))
  const ledLit = usedPads.some((p) => p.side === 'led')

  return (
    <g>
      <defs>
        <linearGradient id="bv-pcb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d6b3a" />
          <stop offset="1" stopColor="#0f4d28" />
        </linearGradient>
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
        x={BOARD_X}
        y={BOARD_Y}
        width={BOARD_W}
        height={BOARD_H}
        rx="18"
        fill="url(#bv-pcb)"
        stroke="#0a3a1e"
        strokeWidth="2"
      />
      {/* Mounting holes */}
      {[
        [BOARD_X + 16, BOARD_Y + 16],
        [BOARD_X + BOARD_W - 16, BOARD_Y + 16],
        [BOARD_X + 16, BOARD_Y + BOARD_H - 16],
        [BOARD_X + BOARD_W - 16, BOARD_Y + BOARD_H - 16]
      ].map(([cx, cy], i) => (
        <circle key={`hole-${i}`} cx={cx} cy={cy} r="6" fill="#0a3a1e" stroke="#caa64a" strokeWidth="1.5" />
      ))}

      {/* USB connector at the top */}
      <rect
        x={BOARD_X + BOARD_W / 2 - 26}
        y={BOARD_Y - 10}
        width="52"
        height="26"
        rx="4"
        fill="url(#bv-usb)"
        stroke="#7b8088"
        strokeWidth="1.5"
      />

      {/* CYW43439 Wi-Fi can (shielded metal box) */}
      <rect
        x={BOARD_X + 22}
        y={BOARD_Y + 44}
        width="84"
        height="56"
        rx="4"
        fill="#c2c7cf"
        stroke="#8d929b"
        strokeWidth="2"
      />
      <text x={BOARD_X + 64} y={BOARD_Y + 76} className="boardview__chip-label" textAnchor="middle">
        CYW43439
      </text>

      {/* RP2350 chip (black QFN) */}
      <rect
        x={BOARD_X + BOARD_W / 2 - 42}
        y={BOARD_Y + BOARD_H / 2 - 42}
        width="84"
        height="84"
        rx="6"
        fill="#15171b"
        stroke="#2a2d33"
        strokeWidth="2"
      />
      <circle cx={BOARD_X + BOARD_W / 2 - 28} cy={BOARD_Y + BOARD_H / 2 - 28} r="3.5" fill="#3a3d44" />
      <text x={BOARD_X + BOARD_W / 2} y={BOARD_Y + BOARD_H / 2 + 4} className="boardview__chip-label boardview__chip-label--dark" textAnchor="middle">
        RP2350
      </text>

      {/* Onboard LED */}
      <circle
        cx={LED_X}
        cy={LED_Y}
        r="6"
        fill={ledLit ? '#46e06a' : '#244a30'}
        stroke="#0a3a1e"
        strokeWidth="1.5"
      />
      {ledLit && <circle cx={LED_X} cy={LED_Y} r="11" fill="#46e06a" opacity="0.28" />}
      <text x={LED_X} y={LED_Y + 22} className="boardview__pad-label" textAnchor="middle">
        LED
      </text>

      {/* Header pads — two rows of gold castellated half-circles. */}
      {Array.from({ length: PADS_PER_SIDE }).map((_, i) => {
        const y = PAD_TOP + i * PAD_GAP
        const lUsed = usedLeft.has(y.toFixed(1))
        const rUsed = usedRight.has(y.toFixed(1))
        return (
          <g key={`pad-${i}`}>
            <circle
              cx={LEFT_PAD_X}
              cy={y}
              r={PAD_R}
              fill="url(#bv-gold)"
              stroke={lUsed ? '#fff' : '#8a6a1e'}
              strokeWidth={lUsed ? 2.5 : 1}
            />
            <circle
              cx={RIGHT_PAD_X}
              cy={y}
              r={PAD_R}
              fill="url(#bv-gold)"
              stroke={rUsed ? '#fff' : '#8a6a1e'}
              strokeWidth={rUsed ? 2.5 : 1}
            />
            {lUsed && (
              <text x={LEFT_PAD_X + 14} y={y + 4} className="boardview__pad-label" textAnchor="start">
                GP{LEFT_GPIO[i]}
              </text>
            )}
            {rUsed && (
              <text x={RIGHT_PAD_X - 14} y={y + 4} className="boardview__pad-label" textAnchor="end">
                GP{RIGHT_GPIO[i]}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}

/** A small representative peripheral drawing, anchored at (x, y). */
function Peripheral({
  bus,
  x,
  y,
  color
}: {
  bus: PinBus
  x: number
  y: number
  color: string
}): JSX.Element {
  const label = BUS_PERIPHERAL[bus]
  // All peripherals are drawn as a labelled board/box with a bus-coloured strip;
  // a tiny bus-specific glyph distinguishes them (faithful enough at this size).
  return (
    <g>
      <rect x={x - 40} y={y - 22} width="80" height="44" rx="6" fill="#23262c" stroke={color} strokeWidth="2" />
      <rect x={x - 40} y={y - 22} width="80" height="8" rx="6" fill={color} opacity="0.85" />
      {bus === 'digital' && <circle cx={x} cy={y + 4} r="7" fill={color} />}
      {bus === 'pwm' && (
        // servo horn
        <g stroke={color} strokeWidth="3" strokeLinecap="round">
          <line x1={x - 12} y1={y + 6} x2={x + 12} y2={y + 6} />
          <circle cx={x} cy={y + 6} r="3" fill={color} stroke="none" />
        </g>
      )}
      {bus === 'i2c' && (
        <g fill={color}>
          <rect x={x - 14} y={y} width="6" height="10" />
          <rect x={x - 3} y={y} width="6" height="10" />
          <rect x={x + 8} y={y} width="6" height="10" />
        </g>
      )}
      {bus === 'pio' && (
        // WS2812 LEDs
        <g>
          {[-14, 0, 14].map((dx, i) => (
            <circle key={i} cx={x + dx} cy={y + 5} r="4" fill={color} />
          ))}
        </g>
      )}
      {bus === 'spi' && (
        // TFT screen
        <rect x={x - 16} y={y - 2} width="32" height="14" rx="2" fill="#0d1b2a" stroke={color} strokeWidth="1.5" />
      )}
      <text x={x} y={y + 34} className="boardview__periph-label" textAnchor="middle">
        {label}
      </text>
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
                style={{ background: BUS_COLOR[c.bus] }}
                aria-hidden="true"
              />
              <span className="boardview__bus">{c.bus}</span>
              <span className="boardview__pin-nums">{c.pins.join(', ')}</span>
              <span className="boardview__pin-src" title={`${c.variable ? `${c.variable} = ` : ''}${c.constructor}`}>
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
