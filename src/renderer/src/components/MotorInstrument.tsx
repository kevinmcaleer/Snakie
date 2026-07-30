import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { reporter } from '../lib/report-error'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import {
  MOTOR_TARGET,
  applyTrim,
  brakePayload,
  channelPayload,
  clamp,
  formatPower,
  runPayload,
  standbyPayload,
  stopPayload,
  type MotorChannel
} from './motor-logic'
import './MotorInstrument.css'

/**
 * MOTOR INSTRUMENT — the WRITE panel for a two-channel DC motor driver (#638).
 * =============================================================================
 *
 * Two signed power bars (A and B) driven by sliders, plus **STOP** (coast),
 * **BRAKE** (windings shorted) and a **STANDBY** latch. Every change writes an
 * IDE→board control line (`SNKCMD motor <payload>`) built by the pure
 * {@link ./motor-logic}, matching the on-device `motor_command` receiver.
 *
 * The panel exists for **calibration**, which is why it is built the way it is:
 *
 *  - **LINK + TRIM.** Two nominally identical motors never run at the same rate,
 *    so a rover curves. Link the channels, drive both from one slider, and adjust
 *    trim until it tracks straight — the number you land on is the trim constant
 *    the robot code then hard-codes. Doing this by editing a literal and re-running
 *    is the slow way to spend an evening.
 *  - **Finding the deadband.** Nudge a single channel up until the wheel actually
 *    starts turning; that threshold is where PWM stops being wasted heat.
 *
 * Powers are signed and normalised (-1..1) — the same unit `teleop.arcade_mix`
 * emits, so the panel is driver-agnostic: scaling to PWM counts is the device
 * driver's business, not the IDE's.
 *
 * The bars show the **applied** powers when the board reports `SNK MOTOR <a> <b>`,
 * falling back to the commanded value otherwise. That distinction is the point: a
 * driver left in standby accepts every command and moves nothing, and only the
 * read-back tells you.
 */

export interface MotorInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

/** Throttle for slider drags — one line per frame is plenty over a serial link. */
const SEND_MS = 40

export function MotorInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: MotorInstrumentProps): JSX.Element {
  // Commanded powers.
  const [a, setA] = useState(0)
  const [b, setB] = useState(0)
  // Linked driving: one master throttle + a steering trim.
  const [linked, setLinked] = useState(true)
  const [master, setMaster] = useState(0)
  const [trim, setTrim] = useState(0)
  const [standby, setStandby] = useState(false)
  // Applied powers as reported by the board (undefined until it speaks).
  const [applied, setApplied] = useState<{ a: number; b: number } | null>(null)

  const lastSend = useRef(0)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback((): void => {
    const payload = pending.current
    pending.current = null
    if (payload === null) return
    lastSend.current = Date.now()
    void window.api?.device?.sendControl?.(MOTOR_TARGET, payload)?.catch(reporter('motor send'))
  }, [])

  /** Send a payload, coalescing bursts while a slider is being dragged. */
  const send = useCallback(
    (payload: string, immediate = false): void => {
      pending.current = payload
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const since = Date.now() - lastSend.current
      if (immediate || since >= SEND_MS) {
        flush()
        return
      }
      timer.current = setTimeout(flush, SEND_MS - since)
    },
    [flush]
  )

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  // Read-back: what the board says it applied.
  useTelemetryStream(
    useCallback((t) => {
      if (t.kind === 'motor') setApplied({ a: t.a, b: t.b })
    }, [])
  )

  /** Drive both channels (used by the linked master + trim). */
  const driveBoth = useCallback(
    (power: number, tr: number, immediate = false): void => {
      const [na, nb] = applyTrim(power, tr)
      setA(na)
      setB(nb)
      send(runPayload(na, nb), immediate)
    },
    [send]
  )

  const onMaster = useCallback(
    (v: number): void => {
      setMaster(v)
      driveBoth(v, trim)
    },
    [driveBoth, trim]
  )

  const onTrim = useCallback(
    (v: number): void => {
      setTrim(v)
      driveBoth(master, v)
    },
    [driveBoth, master]
  )

  const onChannel = useCallback(
    (ch: MotorChannel, v: number): void => {
      if (ch === 'a') setA(v)
      else setB(v)
      send(channelPayload(ch, v))
    },
    [send]
  )

  /** Zero every control as well as the board — the panel must not lie after a stop. */
  const zeroLocal = useCallback((): void => {
    setA(0)
    setB(0)
    setMaster(0)
  }, [])

  const onStop = useCallback((): void => {
    zeroLocal()
    send(stopPayload(), true)
  }, [send, zeroLocal])

  const onBrake = useCallback((): void => {
    zeroLocal()
    send(brakePayload(), true)
  }, [send, zeroLocal])

  const onStandby = useCallback((): void => {
    const next = !standby
    setStandby(next)
    if (next) zeroLocal()
    send(standbyPayload(next), true)
  }, [send, standby, zeroLocal])

  // The bar reflects what the board APPLIED when it reports; otherwise what we
  // commanded. Standby forces zero: the outputs are off whatever was last asked.
  const shownA = standby ? 0 : (applied?.a ?? a)
  const shownB = standby ? 0 : (applied?.b ?? b)

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={standby ? 'STANDBY' : linked ? 'A+B linked' : 'A/B independent'}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="motorpanel"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        <PhosphorScreen className="motorpanel__screen">
          <div className="motorpanel__bars">
            {(
              [
                ['A', shownA],
                ['B', shownB]
              ] as [string, number][]
            ).map(([label, value]) => (
              <div className="motorpanel__bar" key={label}>
                <span className="motorpanel__bar-label">{label}</span>
                {/* Fill grows from the centre: right = forward, left = reverse. */}
                <div
                  className="motorpanel__track"
                  role="meter"
                  aria-label={`Motor ${label} power`}
                  aria-valuenow={Math.round(value * 100)}
                  aria-valuemin={-100}
                  aria-valuemax={100}
                >
                  <span className="motorpanel__centre" />
                  <span
                    className={`motorpanel__fill${value < 0 ? ' is-reverse' : ''}`}
                    style={{ width: `${Math.abs(value) * 50}%` }}
                  />
                </div>
                <span className="motorpanel__bar-value">{formatPower(value)}</span>
              </div>
            ))}
          </div>
          {standby && <p className="motorpanel__note">Outputs disabled — nothing will turn.</p>}
        </PhosphorScreen>

        <label className="motorpanel__row">
          <span className="motorpanel__row-label">
            <input
              type="checkbox"
              checked={linked}
              onChange={(e) => setLinked(e.target.checked)}
              aria-label="Link both channels"
            />
            Link
          </span>
        </label>

        {linked ? (
          <>
            <label className="motorpanel__row">
              <span className="motorpanel__row-label">Throttle</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={master}
                onChange={(e) => onMaster(Number(e.target.value))}
                disabled={standby}
              />
              <span className="motorpanel__row-value">{formatPower(master)}</span>
            </label>
            <label className="motorpanel__row">
              <span className="motorpanel__row-label">Trim</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={trim}
                onChange={(e) => onTrim(Number(e.target.value))}
                disabled={standby}
              />
              <span className="motorpanel__row-value">{formatPower(trim)}</span>
            </label>
          </>
        ) : (
          (['a', 'b'] as MotorChannel[]).map((ch) => (
            <label className="motorpanel__row" key={ch}>
              <span className="motorpanel__row-label">{ch.toUpperCase()}</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={ch === 'a' ? a : b}
                onChange={(e) => onChannel(ch, clamp(Number(e.target.value), -1, 1))}
                disabled={standby}
              />
              <span className="motorpanel__row-value">{formatPower(ch === 'a' ? a : b)}</span>
            </label>
          ))
        )}

        <div className="motorpanel__actions">
          <button type="button" className="motorpanel__btn" onClick={onStop} disabled={standby}>
            STOP
          </button>
          <button type="button" className="motorpanel__btn" onClick={onBrake} disabled={standby}>
            BRAKE
          </button>
          <button
            type="button"
            className={`motorpanel__btn motorpanel__btn--latch${standby ? ' is-on' : ''}`}
            onClick={onStandby}
            aria-pressed={standby}
          >
            STANDBY
          </button>
        </div>
      </div>
    </InstrumentWindow>
  )
}
