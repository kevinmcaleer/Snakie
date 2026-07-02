import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import {
  SERVO_TARGET,
  SERVO_MIN_DEG,
  SERVO_MAX_DEG,
  anglePayload,
  pinPayload,
  detachPayload,
  angleToDuty,
  dutyToAngle,
  sweepAngle
} from './servo-logic'
import './ServoInstrument.css'

/**
 * SERVO INSTRUMENT — the WRITE panel for a hobby servo (SG90 etc.).
 * =============================================================================
 *
 * A top-down dial shows the servo's current angle; the arm is a **knob you drag**
 * to set it (or the slider below). A **SWEEP** button ping-pongs between the
 * min/max limits, and the two limit fields cap the travel. The chosen signal
 * GPIO is set with the PIN field. Every change WRITES an IDE→board control line
 * (`SNKCMD servo <payload>\n`) via `window.api.device.sendControl('servo', …)` —
 * `angle <deg>` / `pin <n>` / `detach` — built by the pure {@link ./servo-logic}
 * so the payloads match the on-device `Servo` receiver (`instruments.py`). Sends
 * are fire-and-forget + throttled while dragging/sweeping; the dial reflects the
 * commanded angle optimistically, and a passive `SNK PWM servo …` reading (if the
 * program prints one) draws a faint MEASURED arm.
 */

export interface ServoInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

// Dial geometry (viewBox units). The pivot sits low-centre; the arm sweeps the
// top semicircle: 0° = left, 90° = up, 180° = right.
const CX = 100
const CY = 98
const R = 76
const ARM = R * 0.82

function clamp(n: number, lo: number, hi: number): number {
  return !Number.isFinite(n) ? lo : n < lo ? lo : n > hi ? hi : n
}

/** Point on the sweep arc for a servo angle (deg): tip of the arm at radius `rad`. */
function armPoint(deg: number, rad: number): { x: number; y: number } {
  const t = (clamp(deg, 0, 180) * Math.PI) / 180
  return { x: CX - rad * Math.cos(t), y: CY - rad * Math.sin(t) }
}

export function ServoInstrument({ def, onClose, docked = true, onToggleDock, float }: ServoInstrumentProps): JSX.Element {
  const [angle, setAngle] = useState(90) // optimistic commanded angle
  const [minA, setMinA] = useState(SERVO_MIN_DEG)
  const [maxA, setMaxA] = useState(SERVO_MAX_DEG)
  const [pin, setPin] = useState(16)
  const [sweeping, setSweeping] = useState(false)
  const [measured, setMeasured] = useState<number | undefined>(undefined)
  const lastSent = useRef(0)
  const dialRef = useRef<SVGSVGElement>(null)
  const phase = useRef(0)

  /** Send a servo payload; throttle rapid streams (drag / sweep) like the gamepad. */
  const send = useCallback((payload: string, throttle = false): void => {
    if (throttle) {
      const now = Date.now()
      if (now - lastSent.current < 40) return
      lastSent.current = now
    }
    void window.api.device.sendControl(SERVO_TARGET, payload).catch(() => {})
  }, [])

  /** Set + command an angle, clamped to the current limits. */
  const commit = useCallback(
    (deg: number, throttle = false): void => {
      const a = clamp(Math.round(deg), minA, maxA)
      setAngle(a)
      send(anglePayload(a), throttle)
    },
    [minA, maxA, send]
  )

  // Passive read-back: a `SNK PWM servo <freq> <duty>` reading → a MEASURED angle.
  useTelemetryStream((r) => {
    if (r.kind === 'pwm' && r.ch === SERVO_TARGET) setMeasured(Math.round(dutyToAngle(r.duty)))
  })

  // Auto-sweep: ping-pong between the limits while SWEEP is engaged (~25 Hz).
  useEffect(() => {
    if (!sweeping) return
    phase.current = 0
    const id = window.setInterval(() => {
      phase.current = (phase.current + 0.02) % 1 // ~2 s per full there-and-back
      commit(sweepAngle(minA, maxA, phase.current), true)
    }, 40)
    return () => window.clearInterval(id)
  }, [sweeping, minA, maxA, commit])

  // Keep the commanded angle inside the limits if they tighten.
  useEffect(() => {
    setAngle((a) => clamp(a, minA, maxA))
  }, [minA, maxA])

  const onPin = (n: number): void => {
    const g = Math.trunc(clamp(n, 0, 40))
    setPin(g)
    send(pinPayload(g))
  }

  // Drag the dial (the knob): map the pointer to a servo angle on the top arc.
  const dialAngle = (e: ReactPointerEvent): number | null => {
    const svg = dialRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const p = svg.createSVGPoint()
    p.x = e.clientX
    p.y = e.clientY
    const q = p.matrixTransform(ctm.inverse())
    const deg = (Math.atan2(CY - q.y, CX - q.x) * 180) / Math.PI
    return clamp(deg, 0, 180)
  }
  const dragging = useRef(false)
  const onDialDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (sweeping) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const d = dialAngle(e)
    if (d !== null) commit(d, true)
  }
  const onDialMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!dragging.current) return
    const d = dialAngle(e)
    if (d !== null) commit(d, true)
  }
  const onDialUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    dragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    commit(angle) // a final un-throttled send so the last position always lands
  }

  const pulseMs = (angleToDuty(angle) * 20).toFixed(2) // duty(0..1) × 20 ms period
  const tip = armPoint(angle, ARM)
  const measTip = measured !== undefined ? armPoint(measured, ARM) : null
  const lo = armPoint(minA, R)
  const hi = armPoint(maxA, R)
  // Active range arc (min→max). Large-arc flag when the span exceeds 180° (never here).
  const rangePath = `M ${lo.x.toFixed(1)} ${lo.y.toFixed(1)} A ${R} ${R} 0 0 1 ${hi.x.toFixed(1)} ${hi.y.toFixed(1)}`

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source={`GP${pin} · 50 Hz`}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="servopanel"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        <PhosphorScreen className="servopanel__screen">
          <svg
            ref={dialRef}
            className="servopanel__dial"
            viewBox="0 0 200 132"
            role="img"
            aria-label={`Servo angle ${angle} degrees`}
            onPointerDown={onDialDown}
            onPointerMove={onDialMove}
            onPointerUp={onDialUp}
            onPointerCancel={onDialUp}
          >
            {/* Full sweep track (0–180°). */}
            <path className="servopanel__track" d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} />
            {/* Active range (min→max limits). */}
            <path className="servopanel__range" d={rangePath} />
            {/* 0/90/180 tick labels. */}
            {[0, 90, 180].map((tk) => {
              const a = armPoint(tk, R + 9)
              return (
                <text key={tk} className="servopanel__tick" x={a.x} y={a.y} textAnchor="middle" dominantBaseline="middle">
                  {tk}
                </text>
              )
            })}
            {/* The servo body (top-down) below the pivot. */}
            <rect className="servopanel__body" x={CX - 34} y={CY - 2} width={68} height={30} rx={4} />
            {/* Measured (ghost) arm from live telemetry, if any. */}
            {measTip && (
              <line className="servopanel__arm servopanel__arm--ghost" x1={CX} y1={CY} x2={measTip.x} y2={measTip.y} />
            )}
            {/* The commanded arm — the draggable knob. */}
            <line className="servopanel__arm" x1={CX} y1={CY} x2={tip.x} y2={tip.y} />
            <circle className="servopanel__knob" cx={tip.x} cy={tip.y} r={7} />
            <circle className="servopanel__hub" cx={CX} cy={CY} r={9} />
            <text className="servopanel__angle" x={CX} y={CY + 22} textAnchor="middle">
              {angle}°
            </text>
          </svg>
        </PhosphorScreen>

        {/* Angle slider (precise) + SWEEP. */}
        <div className="servopanel__row">
          <input
            className="servopanel__slider"
            type="range"
            min={minA}
            max={maxA}
            step={1}
            value={angle}
            onChange={(e) => commit(Number(e.currentTarget.value))}
            disabled={sweeping}
            aria-label="Servo angle"
          />
          <button
            type="button"
            className={`servopanel__sweep ${sweeping ? 'is-on' : ''}`}
            onClick={() => setSweeping((s) => !s)}
            aria-pressed={sweeping}
            title="Sweep between the min and max limits"
          >
            {sweeping ? 'STOP' : 'SWEEP'}
          </button>
        </div>

        {/* Limits + pin + detach. */}
        <div className="servopanel__opts">
          <label className="servopanel__opt">
            <span>MIN</span>
            <input
              type="number"
              min={SERVO_MIN_DEG}
              max={maxA}
              value={minA}
              onChange={(e) => setMinA(clamp(Number(e.currentTarget.value), SERVO_MIN_DEG, maxA))}
            />
          </label>
          <label className="servopanel__opt">
            <span>MAX</span>
            <input
              type="number"
              min={minA}
              max={SERVO_MAX_DEG}
              value={maxA}
              onChange={(e) => setMaxA(clamp(Number(e.currentTarget.value), minA, SERVO_MAX_DEG))}
            />
          </label>
          <label className="servopanel__opt">
            <span>PIN</span>
            <input type="number" min={0} max={40} value={pin} onChange={(e) => onPin(Number(e.currentTarget.value))} />
          </label>
          <button
            type="button"
            className="servopanel__detach"
            onClick={() => send(detachPayload())}
            title="Release the servo (stop holding torque)"
          >
            DETACH
          </button>
        </div>

        {/* Readout strip. */}
        <div className="servopanel__readout">
          <Cell label="ANGLE" value={`${angle}°`} />
          <span className="servopanel__div" aria-hidden="true" />
          <Cell label="PULSE" value={`${pulseMs} ms`} />
          <span className="servopanel__div" aria-hidden="true" />
          <Cell label="RANGE" value={`${minA}–${maxA}°`} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="servopanel__cell">
      <span className="servopanel__cell-lbl">{label}</span>
      <span className="servopanel__cell-val">{value}</span>
    </div>
  )
}
