import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import {
  applyCalibration,
  eulerToCssTransform,
  formatAngle,
  NEUTRAL_EULER,
  parseImu,
  readingToEuler,
  type Euler
} from './imu-logic'
import './ImuInstrument.css'

/**
 * IMU 3D ORIENTATION VIEWER (#111) — a self-contained dock panel that shows a
 * board's live orientation as a small CSS-3D model that tilts in real time from
 * roll/pitch/yaw OR a quaternion, with body axes, a horizon/level indicator and
 * a numeric ROLL / PITCH / YAW readout.
 * =============================================================================
 *
 * SELF-CONTAINED by design. The shared telemetry parser only knows
 * SCOPE/METER/PLOT and must not be edited, so this panel carries its OWN
 * `SNK IMU` / `SNK IMUQ` grammar (in the pure `imu-logic.ts`) and subscribes to
 * the broadcast serial stream directly via `window.api.device.onData` — exactly
 * the same passive, REPL-free source the scope/meter feed uses — instead of a
 * shared subscription hook. All the maths (quaternion→Euler, the CSS-transform
 * string, calibration subtraction, angle wrap) lives in `imu-logic.ts` and is
 * unit-tested; this file is just the React shell + the local subscription.
 *
 * NO three.js / no new dependency: the 3D model is a CSS `preserve-3d` cube
 * (the "board") plus three coloured body-axis bars, rotated by a single CSS
 * transform string. The horizon strip is a 2D element driven by roll + pitch.
 * Neutral (level) pose is shown until the first reading arrives.
 */

/** How often the panel re-renders from the latest reading (ms) — gentle on React. */
const IMU_FLUSH_MS = 60

const imuDecoder = new TextDecoder()

/**
 * Subscribe to the broadcast serial stream and deliver each parsed IMU reading
 * to `onReading`. Buffers partial lines (CRLF-tolerant) and parses every
 * completed line with {@link parseImu}; non-IMU lines are ignored. The callback
 * is held in a ref so a changing closure never re-subscribes. Self-contained —
 * mirrors the host's `useTelemetryFeed`, but local to this panel.
 */
function useImuStream(onReading: (r: ReturnType<typeof parseImu>) => void): void {
  const cbRef = useRef(onReading)
  cbRef.current = onReading

  useEffect(() => {
    let buf = ''
    const unsubscribe = window.api.device.onData((chunk) => {
      buf += imuDecoder.decode(chunk, { stream: true })
      const normalised = buf.replace(/\r\n?/g, '\n')
      const parts = normalised.split('\n')
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const reading = parseImu(line)
        if (reading) cbRef.current(reading)
      }
    })
    return unsubscribe
  }, [])
}

export interface ImuInstrumentProps {
  /** The registry def driving the name, accent and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other dock windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
  /** Float ⟷ dock toggle (the dock-to-side key) + drag placement when floating. */
  onToggleDock?: () => void
  float?: FloatProps
}

export function ImuInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: ImuInstrumentProps): JSX.Element {
  // The LATEST raw orientation (last channel wins) + whether any data has arrived.
  const [raw, setRaw] = useState<Euler>(NEUTRAL_EULER)
  const [hasData, setHasData] = useState(false)
  // The active source kind + channel label (for the source pill / readout).
  const [mode, setMode] = useState<'imu' | 'imuq' | null>(null)
  const [channel, setChannel] = useState<string | null>(null)
  // The captured calibration offset; subtracting it "levels" the board locally.
  const [offset, setOffset] = useState<Euler>(NEUTRAL_EULER)

  // Coalesce the (potentially fast) stream into a gentle re-render cadence: the
  // newest reading lands in a ref and a timer publishes it to state.
  const pending = useRef<{ e: Euler; mode: 'imu' | 'imuq'; ch: string } | null>(null)

  useImuStream((reading) => {
    if (!reading) return
    pending.current = {
      e: readingToEuler(reading),
      mode: reading.kind,
      ch: reading.ch
    }
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      const p = pending.current
      if (!p) return
      pending.current = null
      setRaw(p.e)
      setMode(p.mode)
      setChannel(p.ch)
      setHasData(true)
    }, IMU_FLUSH_MS)
    return () => window.clearInterval(id)
  }, [])

  // Capture the current orientation as the calibration offset (level / zero).
  const onLevel = useCallback(() => setOffset(raw), [raw])
  // Drop the calibration offset (back to the raw board frame).
  const onReset = useCallback(() => setOffset(NEUTRAL_EULER), [])

  // The displayed orientation = raw − calibration offset, axis-wise + wrapped.
  const shown = applyCalibration(raw, offset)
  const transform = eulerToCssTransform(shown)
  // Horizon: pitch slides the band vertically, roll tilts it (CSS-2D).
  const horizonStyle: CSSProperties = {
    transform: `translateY(${(-shown.pitch / 90) * 40}%) rotate(${-shown.roll}deg)`
  }
  const calibrated = offset.roll !== 0 || offset.pitch !== 0 || offset.yaw !== 0

  const source = `IMU · 9-DOF${channel ? ` · ${channel}` : ''}`

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={source}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="imu"
        style={
          {
            '--accent': def.accent,
            '--accent-border': def.border
          } as CSSProperties
        }
      >
        <PhosphorScreen className="imu__screen">
          {/* Horizon / artificial-level band behind the 3D board. */}
          <div className="imu__horizon-wrap" aria-hidden="true">
            <div className="imu__horizon" style={horizonStyle}>
              <span className="imu__sky" />
              <span className="imu__ground" />
              <span className="imu__horizon-line" />
            </div>
            <span className="imu__crosshair" />
          </div>

          {/* The CSS-3D board (a thin cube) + its body axes, rotated as one. */}
          <div className="imu__stage" aria-hidden="true">
            <div className="imu__model" style={{ transform }}>
              <div className="imu__board">
                <span className="imu__face imu__face--top" />
                <span className="imu__face imu__face--bottom" />
                <span className="imu__face imu__face--front" />
                <span className="imu__face imu__face--back" />
                <span className="imu__face imu__face--left" />
                <span className="imu__face imu__face--right" />
              </div>
              {/* Body axes: X (nose, red), Y (right, green), Z (up, blue). */}
              <span className="imu__axis imu__axis--x" />
              <span className="imu__axis imu__axis--y" />
              <span className="imu__axis imu__axis--z" />
            </div>
          </div>

          {/* Mode + calibration status / controls. */}
          <div className="imu__hud">
            <span className="imu__mode" title="Active orientation source">
              {!hasData ? 'NO DATA' : mode === 'imuq' ? 'QUAT' : 'EULER'}
            </span>
            <span className="imu__controls">
              <button
                type="button"
                className="imu__btn"
                onClick={onLevel}
                disabled={!hasData}
                title="Capture the current orientation as level (zero)"
              >
                LEVEL
              </button>
              <button
                type="button"
                className={`imu__btn${calibrated ? ' imu__btn--active' : ''}`}
                onClick={onReset}
                disabled={!calibrated}
                title="Clear the calibration offset"
              >
                RESET
              </button>
            </span>
          </div>
        </PhosphorScreen>

        {/* Numeric ROLL / PITCH / YAW readout — mirrors placeholder__readout. */}
        <div className="imu__readout">
          <Cell label="ROLL" value={hasData ? formatAngle(shown.roll) : '——'} />
          <span className="imu__div" aria-hidden="true" />
          <Cell label="PITCH" value={hasData ? formatAngle(shown.pitch) : '——'} />
          <span className="imu__div" aria-hidden="true" />
          <Cell label="YAW" value={hasData ? formatAngle(shown.yaw) : '——'} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One labelled readout cell, mirroring the scope/meter/placeholder readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="imu__cell">
      <span className="imu__cell-lbl">{label}</span>
      <span className="imu__cell-val">{value}</span>
    </div>
  )
}
