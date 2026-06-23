import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen } from './InstrumentWindow'
import {
  buttonLabel,
  DEFAULT_COUNTS_PER_REV,
  DIRECTION_LABEL,
  encoderSnapshot,
  formatDelta,
  formatRpm,
  type EncoderDirection,
  type EncoderSnapshot
} from './encoder-logic'
import './EncoderInstrument.css'

/**
 * ENCODER INSTRUMENT — the rotary encoder input panel (issue #117).
 * =============================================================================
 *
 * A SELF-CONTAINED skeuomorphic dock panel that visualises a live rotary
 * encoder: a knurled brass knob with a pointer + detent ticks that rotates to
 * the encoder's running COUNT, a CW/CCW direction lamp, an absolute counter, an
 * optional RPM, and — when the encoder has a push-button — a "click" lamp that
 * lights while the shaft switch is pressed.
 *
 * It reuses the shared instrument CHROME ({@link InstrumentWindow} +
 * {@link PhosphorScreen}) for the title bar + CRT bezel, then draws the knob on
 * the phosphor screen and mirrors the scope/meter's bottom 3-column readout
 * strip (COUNT / DIR / BUTTON|RPM).
 *
 * DESIGN NOTE — self-containment: at the time this panel was built the shared
 * instrument framework here is the #101/#102/#107 scope/meter/telemetry-feed,
 * which has no encoder registry entry, no `enc` telemetry kind, and no shared
 * subscription hook. So — to touch NO shared file — this module declares its own
 * `InstrumentDef`-shaped {@link InstrumentDef} type, its own
 * {@link EncoderTelemetry} reading shape (`kind:'enc'`), and its own
 * {@link useEncoderTelemetry} hook that subscribes to the SAME broadcast
 * `window.api.device.onData` serial stream the rest of the instruments use,
 * parsing `SNK ENC <ch> <count> [<pressed>]` lines NON-INVASIVELY. All pure
 * maths lives in the unit-tested {@link ./encoder-logic} module.
 */

// --- The instrument-definition shape (self-contained) -----------------------

/**
 * The registry-def shape this panel is themed/named from. Mirrors the
 * `InstrumentDef` the dock framework passes to a panel (`id`, display `name`,
 * accent colours), kept local so the panel adds NO shared file. The dock would
 * supply `{ id:'encoder', name:'Encoder', accent:'#c8ff86', border:'rgba(170,224,82,.45)' }`.
 */
export interface InstrumentDef {
  /** Stable id — `'encoder'` for this panel. */
  id: string
  /** Display name shown in the title bar (upper-cased by the chrome). */
  name: string
  /** Accent colour (CSS) — the registry accent for the encoder is ~lime. */
  accent: string
  /** Accent border colour (CSS, usually a translucent variant of `accent`). */
  border: string
  /** Optional configured counts-per-revolution for the knob/RPM maths. */
  countsPerRev?: number
}

/** The default def used when the panel is shown standalone (e.g. in isolation). */
export const ENCODER_DEF: InstrumentDef = {
  id: 'encoder',
  name: 'Encoder',
  accent: '#c8ff86',
  border: 'rgba(170,224,82,.45)',
  countsPerRev: DEFAULT_COUNTS_PER_REV
}

// --- Telemetry (self-contained, `kind:'enc'`) -------------------------------

/**
 * A parsed encoder reading. Matches the contract's `EncoderTelemetry` shape:
 * `kind:'enc'`, a channel label, the absolute `count`, and an optional `pressed`
 * push-button flag. Declared here (not in the shared parser) so the panel stays
 * additive.
 */
export interface EncoderTelemetry {
  kind: 'enc'
  /** The user channel label (matches this panel's source). */
  ch: string
  /** Absolute encoder count. */
  count: number
  /** Push-button state, when the encoder has a switch (omitted otherwise). */
  pressed?: boolean
}

/** The sentinel that marks a telemetry line (shared with the rest of the IDE). */
const TELEMETRY_SENTINEL = 'SNK'

/**
 * Parse one already-de-newlined line into an {@link EncoderTelemetry}, or `null`
 * for a non-encoder / malformed line. Grammar (space-delimited ASCII, matching
 * the rest of the instruments library):
 *
 *   SNK ENC <ch> <count> [<pressed>]
 *
 * `<count>` is an integer; the optional `<pressed>` is `1`/`0`/`true`/`false`.
 * Never throws.
 */
export function parseEncoderTelemetry(line: string): EncoderTelemetry | null {
  if (!line) return null
  const trimmed = line.trimStart()
  if (trimmed !== TELEMETRY_SENTINEL && !trimmed.startsWith(`${TELEMETRY_SENTINEL} `)) return null
  const parts = trimmed.trim().split(/\s+/)
  if (parts[1] !== 'ENC') return null
  const ch = parts[2]
  const count = Number(parts[3])
  if (!ch || !Number.isFinite(count)) return null
  let pressed: boolean | undefined
  if (parts[4] !== undefined) {
    const tok = parts[4].toLowerCase()
    pressed = tok === '1' || tok === 'true' || tok === 'on'
  }
  return { kind: 'enc', ch, count, pressed }
}

/** The latest-by-channel encoder reading plus the dt since the prior count. */
interface EncoderTick {
  count: number
  prevCount: number
  dtMs: number
  pressed?: boolean
}

/**
 * Subscribe to the broadcast serial stream and track the LATEST encoder reading
 * (last-wins per channel, the whole-singleton view this panel renders). Returns
 * the most recent {@link EncoderTick}, or `undefined` until the board prints an
 * `SNK ENC …` line. Mirrors the instrument-host telemetry feed: buffers partial
 * lines, NEVER enters the raw REPL, and republishes on a gentle interval so a
 * fast stream doesn't thrash React.
 */
const decoder = new TextDecoder()
const FLUSH_MS = 100

export function useEncoderTelemetry(): EncoderTick | undefined {
  const [tick, setTick] = useState<EncoderTick | undefined>(undefined)
  const lineBuf = useRef('')
  const last = useRef<{ count: number; at: number; pressed?: boolean } | null>(null)
  const pending = useRef<EncoderTick | null>(null)

  useEffect(() => {
    // `window.api` is absent outside Electron (tests/SSR); guard so the panel
    // renders inertly rather than throwing. In the app it's always present.
    const device = typeof window !== 'undefined' ? window.api?.device : undefined
    if (!device?.onData) return

    const unsubscribe = device.onData((chunk) => {
      lineBuf.current += decoder.decode(chunk, { stream: true })
      const normalised = lineBuf.current.replace(/\r\n?/g, '\n')
      const lines = normalised.split('\n')
      lineBuf.current = lines.pop() ?? ''
      for (const line of lines) {
        const r = parseEncoderTelemetry(line)
        if (!r) continue
        const now = Date.now()
        const prior = last.current
        const dtMs = prior ? now - prior.at : 0
        const prevCount = prior ? prior.count : r.count
        pending.current = { count: r.count, prevCount, dtMs, pressed: r.pressed }
        last.current = { count: r.count, at: now, pressed: r.pressed }
      }
    })

    const id = window.setInterval(() => {
      if (pending.current) {
        setTick(pending.current)
        pending.current = null
      }
    }, FLUSH_MS)

    return () => {
      unsubscribe()
      window.clearInterval(id)
    }
  }, [])

  return tick
}

// --- The knurled knob SVG ---------------------------------------------------

/** How many detent ticks to draw around the dial face. */
const DETENT_TICKS = 24
/** How many knurl ridges to draw around the knob edge. */
const KNURL_RIDGES = 40

/**
 * The skeuomorphic knurled rotary knob. Draws a brass dial face with knurled
 * edge ridges, a ring of detent ticks, and a pointer that rotates to `angle`
 * (degrees, clockwise). When `pressed` the knob "clicks" — the hub lights up.
 * Themed by the panel's `--accent` custom prop (set on the SVG root).
 */
function Knob({
  angle,
  pressed,
  direction
}: {
  angle: number
  pressed: boolean
  direction: EncoderDirection
}): JSX.Element {
  const ticks = Array.from({ length: DETENT_TICKS }, (_, i) => (i / DETENT_TICKS) * 360)
  const ridges = Array.from({ length: KNURL_RIDGES }, (_, i) => (i / KNURL_RIDGES) * 360)
  return (
    <svg
      className={`enc__knob${pressed ? ' enc__knob--pressed' : ''}`}
      viewBox="0 0 200 200"
      role="img"
      aria-label={`Encoder knob at ${Math.round(angle)} degrees, ${DIRECTION_LABEL[direction]}`}
    >
      {/* detent tick ring */}
      <g className="enc__ticks">
        {ticks.map((a, i) => (
          <line
            key={`t${i}`}
            x1="100"
            y1="14"
            x2="100"
            y2={i % (DETENT_TICKS / 8) === 0 ? '26' : '20'}
            transform={`rotate(${a} 100 100)`}
            className={i % (DETENT_TICKS / 8) === 0 ? 'enc__tick enc__tick--major' : 'enc__tick'}
          />
        ))}
      </g>

      {/* the rotating knob group */}
      <g className="enc__dial" transform={`rotate(${angle} 100 100)`}>
        {/* knurled outer edge — a ring of short ridges */}
        <g className="enc__knurl">
          {ridges.map((a, i) => (
            <line
              key={`r${i}`}
              x1="100"
              y1="36"
              x2="100"
              y2="44"
              transform={`rotate(${a} 100 100)`}
              className="enc__ridge"
            />
          ))}
        </g>
        <circle cx="100" cy="100" r="60" className="enc__face" />
        <circle cx="100" cy="100" r="60" className="enc__face-ring" />
        {/* the pointer + a seated indicator dot at the top of the knob */}
        <line x1="100" y1="100" x2="100" y2="52" className="enc__pointer" />
        <circle cx="100" cy="56" r="6" className="enc__pointer-dot" />
        <circle cx="100" cy="100" r="14" className="enc__hub" />
      </g>
    </svg>
  )
}

// --- The bottom 3-column readout strip --------------------------------------

/** One readout cell (mirrors the scope/meter readout cells). */
function Cell({
  label,
  value,
  pad,
  state
}: {
  label: string
  value: string
  pad?: boolean
  state?: EncoderDirection | 'down' | 'up'
}): JSX.Element {
  return (
    <div className={`enc__cell${pad ? ' enc__cell--pad' : ''}`} data-state={state}>
      <span className="enc__cell-lbl">{label}</span>
      <span className="enc__cell-val">{value}</span>
    </div>
  )
}

// --- The panel --------------------------------------------------------------

/**
 * The rotary encoder input panel. Same prop shape as the scope/meter bodies: a
 * registry `def` (for the name + accent theming), an optional `onClose`, and a
 * `docked` flag (passed through to the shared chrome). It self-subscribes to the
 * telemetry stream; no host wiring required.
 */
export function EncoderInstrument({
  def,
  onClose,
  docked = true
}: {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
}): JSX.Element {
  const tick = useEncoderTelemetry()
  const countsPerRev = def.countsPerRev ?? DEFAULT_COUNTS_PER_REV

  const snap: EncoderSnapshot = encoderSnapshot({
    count: tick?.count ?? 0,
    prev: tick?.prevCount,
    dtMs: tick?.dtMs,
    countsPerRev,
    pressed: tick?.pressed
  })

  // Has the encoder reported a button at all this session? (Show BUTTON vs RPM.)
  const hasButton = tick?.pressed !== undefined

  // Theme the body via the panel's accent (the chrome itself is dark/neutral).
  const themeStyle = {
    '--accent': def.accent,
    '--accent-border': def.border
  } as CSSProperties

  return (
    <InstrumentWindow name={def.name.toUpperCase()} source="A·B · SW" docked={docked} onClose={onClose}>
      <div className="enc" style={themeStyle}>
        <PhosphorScreen>
          <div className="enc__screen-inner">
            <Knob angle={snap.angle} pressed={snap.pressed} direction={snap.direction} />
            <div className="enc__overlay">
              <span className={`enc__dir-lamp enc__dir-lamp--${snap.direction}`} aria-hidden="true">
                {snap.direction === 'ccw' ? '↺' : snap.direction === 'cw' ? '↻' : '•'}
              </span>
              <span className="enc__delta" aria-hidden="true">
                Δ {formatDelta(snap.delta)}
              </span>
            </div>
          </div>
        </PhosphorScreen>

        {/* bottom 3-column readout: COUNT / DIR / (BUTTON or RPM) */}
        <div className="enc__readout">
          <Cell label="COUNT" value={String(snap.count)} />
          <Cell label="DIR" value={DIRECTION_LABEL[snap.direction]} state={snap.direction} pad />
          {hasButton ? (
            <Cell
              label="BUTTON"
              value={buttonLabel(snap.pressed)}
              state={snap.pressed ? 'down' : 'up'}
            />
          ) : (
            <Cell label="RPM" value={formatRpm(snap.rpm)} />
          )}
        </div>
      </div>
    </InstrumentWindow>
  )
}
