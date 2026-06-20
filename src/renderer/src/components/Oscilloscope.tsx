import { useMemo, useState } from 'react'
import { InstrumentWindow, PhosphorScreen, SourceSlot, type FloatProps } from './InstrumentWindow'
import {
  formatDuty,
  formatFreq,
  formatPeriod,
  pwmConfig,
  squareWavePath,
  type PwmConfig
} from './instrument-data'
import type { UsedPins } from './parse-pins'
import './Oscilloscope.css'

/**
 * OSCILLOSCOPE (#101) — a skeuomorphic CRT scope for a PWM pin.
 * =============================================================================
 *
 * Renders the IDEALISED square wave of a PWM channel from its configured
 * frequency + duty (parsed by {@link pwmConfig} from the constructor + source,
 * with a live-duty override when the board is connected). The screen draws the
 * green graticule, a glowing `#86ffb6` square-wave trace (with a dim persistence
 * pass), and a dashed amber trigger line; below it sit the source selector, a
 * RUN pill, and a FREQ / DUTY / PERIOD readout strip.
 *
 * All the maths (the wave path, the freq/duty/period formatting) is the pure,
 * unit-tested {@link ./instrument-data}; this component is just the chrome.
 */

/** Internal screen geometry (matches the handoff's 358×172 green screen). */
const SCREEN_W = 358
const SCREEN_H = 172
const CYCLES = 4 // whole PWM periods drawn across the screen
const PAD_Y = 28 // top/bottom inset to the high/low rails

export interface OscilloscopeProps {
  /** The PWM connection this scope is currently viewing. */
  conn: UsedPins
  /** All PWM connections in use (for the source selector). */
  sources: UsedPins[]
  /** The whole active-file source (so post-construction freq/duty sets are seen). */
  fileSource: string
  /**
   * Live duty as a 0..1 fraction read from the board (`duty_u16 / 65535`), or
   * undefined when not connected → fall back to the parsed/static config.
   */
  liveDuty?: number
  /** Switch the scope to another PWM pin. */
  onSelectSource?: (conn: UsedPins) => void
  onToggleDock?: () => void
  docked?: boolean
  onClose?: () => void
  /** Floating-placement props (drag handlers + position); absent when docked. */
  float?: FloatProps
}

/** A short `GP<pin>` label for a connection's first pin (used in pills/labels). */
function gpLabel(conn: UsedPins): string {
  const pin = conn.pins[0] ?? '?'
  return /^\d+$/.test(pin) ? `GP${pin}` : pin
}

export function Oscilloscope({
  conn,
  sources,
  fileSource,
  liveDuty,
  onSelectSource,
  onToggleDock,
  docked = true,
  onClose,
  float
}: OscilloscopeProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [running, setRunning] = useState(true)

  // Static config from the constructor + the surrounding file, overridden by the
  // live duty when the board is connected (the freq still comes from the source).
  const cfg = useMemo<PwmConfig>(() => {
    const base = pwmConfig(`${conn.constructor}\n${fileSource}`)
    return liveDuty !== undefined ? { ...base, duty: liveDuty } : base
  }, [conn.constructor, fileSource, liveDuty])

  const duty = cfg.duty ?? 0.5 // a sane default picture when none is parseable
  const gp = gpLabel(conn)

  // The square-wave trace path (pure geometry). When stopped we still draw the
  // last shape (a real scope holds the trace) — only the RUN dot/label change.
  const wavePath = useMemo(
    () => squareWavePath({ width: SCREEN_W, height: SCREEN_H, duty, cycles: CYCLES, padY: PAD_Y }),
    [duty]
  )

  return (
    <InstrumentWindow
      name="OSCILLOSCOPE"
      source={`${gp} ${conn.variable || 'pwm'}`}
      onToggleDock={onToggleDock}
      docked={docked}
      onClose={onClose}
      {...float}
    >
      <PhosphorScreen className="osc__screen">
        <svg
          className="osc__svg"
          viewBox={`0 0 ${SCREEN_W} ${SCREEN_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <filter id="osc-glow" x="-20%" y="-40%" width="140%" height="180%">
              <feGaussianBlur stdDeviation="1.8" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Graticule — minor grid + brighter centre cross. */}
          <g stroke="rgba(120,220,150,.14)" strokeWidth="1">
            {[45, 90, 135, 224, 269, 314].map((x) => (
              <line key={`v${x}`} x1={x} y1="0" x2={x} y2={SCREEN_H} />
            ))}
            {[34, 68, 104, 138].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2={SCREEN_W} y2={y} />
            ))}
          </g>
          <g stroke="rgba(130,230,160,.32)" strokeWidth="1.1">
            <line x1={SCREEN_W / 2} y1="0" x2={SCREEN_W / 2} y2={SCREEN_H} />
            <line x1="0" y1={SCREEN_H / 2} x2={SCREEN_W} y2={SCREEN_H / 2} />
          </g>

          {/* Dashed amber trigger line + arrowhead at the right edge. */}
          <line
            x1="0"
            y1={SCREEN_H / 2}
            x2={SCREEN_W}
            y2={SCREEN_H / 2}
            stroke="rgba(240,185,74,.26)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          <path d={`M${SCREEN_W} ${SCREEN_H / 2} l-11 -6 l0 12 z`} fill="#f0b94a" />

          {/* The square-wave trace: a soft persistence/glow underlay + the bright
              trace. Dimmed when stopped (the trace is "held", not live). */}
          <g opacity={running ? 1 : 0.55}>
            <path
              d={wavePath}
              fill="none"
              stroke="rgba(82,224,138,.22)"
              strokeWidth="6"
              strokeLinejoin="round"
              filter="url(#osc-glow)"
            />
            <path
              d={wavePath}
              fill="none"
              stroke="#86ffb6"
              strokeWidth="2.2"
              strokeLinejoin="round"
              filter="url(#osc-glow)"
            />
          </g>
        </svg>

        {/* On-screen labels (HTML over the SVG). */}
        <span className="osc__lbl osc__lbl--ch">CH1 {gp}</span>
        <span className={`osc__lbl osc__lbl--run ${running ? '' : 'is-stopped'}`}>
          <span className="osc__run-dot" />
          {running ? 'RUN' : 'STOP'}
        </span>
        <span className="osc__lbl osc__lbl--div">200µs/div&nbsp;&nbsp;1.0V/div</span>
        <span className="osc__lbl osc__lbl--trig">T ▲ {formatDuty(duty)}</span>
      </PhosphorScreen>

      {/* Source selector + RUN pill. */}
      <div className="osc__row">
        <SourceSlot
          label={`${gp} · ${conn.variable || 'pwm'}`}
          open={pickerOpen}
          onToggle={() => setPickerOpen((o) => !o)}
          menu={sources.map((s, i) => (
            <li key={`${s.variable}-${i}`} role="option" aria-selected={s === conn}>
              <button
                type="button"
                className={`instr__menu-item ${s === conn ? 'is-active' : ''}`}
                onClick={() => {
                  onSelectSource?.(s)
                  setPickerOpen(false)
                }}
              >
                {gpLabel(s)} · {s.variable || 'pwm'}
              </button>
            </li>
          ))}
        />
        <button
          type="button"
          className={`osc__run ${running ? 'is-running' : ''}`}
          onClick={() => setRunning((r) => !r)}
          aria-pressed={running}
          title={running ? 'Stop the trace' : 'Run the trace'}
        >
          <span className="osc__run-pip" aria-hidden="true" />
          {running ? 'RUN' : 'STOPPED'}
        </button>
      </div>

      {/* FREQ / DUTY / PERIOD readout strip. */}
      <div className="osc__readout">
        <Cell label="FREQ" value={formatFreq(cfg.freq)} />
        <span className="osc__div" aria-hidden="true" />
        <Cell label="DUTY" value={formatDuty(duty)} pad />
        <span className="osc__div" aria-hidden="true" />
        <Cell label="PERIOD" value={formatPeriod(cfg.freq)} pad />
      </div>
    </InstrumentWindow>
  )
}

/** One labelled readout cell in the FREQ/DUTY/PERIOD strip. */
function Cell({ label, value, pad }: { label: string; value: string; pad?: boolean }): JSX.Element {
  return (
    <div className={`osc__cell ${pad ? 'osc__cell--pad' : ''}`}>
      <span className="osc__cell-lbl">{label}</span>
      <span className="osc__cell-val">{value}</span>
    </div>
  )
}
