import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import { dialPoint, pressureAngle, weatherWord, PRESS_MIN, PRESS_MAX } from './env-logic'
import './EnvInstrument.css'

/**
 * BAROMETER — an antique aneroid weather instrument (#216).
 * =============================================================================
 *
 * Shows temperature / barometric pressure / humidity from the passive telemetry
 * stream (`SNK ENV <ch> <t> <p> <h>` — `inst.env(t, p, h)` or a watched BME280
 * via `inst.watch(env=bme)` + `inst.update()`). The pressure drives a classic
 * cream-faced, brass-bezelled barometer dial (950–1050 hPa over 270°, with the
 * RAIN / CHANGE / FAIR legend); temperature + humidity read out beneath it.
 * Pure dial geometry lives in {@link ./env-logic}.
 */

export interface EnvInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

/** One environmental reading per reporting channel. */
interface EnvReading {
  temp: number
  pressure: number
  humidity: number
}

// Dial geometry (viewBox units): pivot centre of the round face.
const CX = 100
const CY = 88
const R = 74

export function EnvInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: EnvInstrumentProps): JSX.Element {
  // Latest reading per channel + the user's picked channel (same pattern as the
  // Potentiometer: the sole/first reporting channel "just works").
  const [readings, setReadings] = useState<Record<string, EnvReading>>({})
  const [picked, setPicked] = useState<string>('env')

  useTelemetryStream(
    useCallback((r) => {
      if (r.kind !== 'env') return
      setReadings((m) => ({ ...m, [r.ch]: { temp: r.temp, pressure: r.pressure, humidity: r.humidity } }))
    }, [])
  )

  const channels = Object.keys(readings)
  const channel = readings[picked] !== undefined ? picked : (channels[0] ?? picked)
  const reading = readings[channel]
  const hasData = reading !== undefined
  const pressure = reading?.pressure ?? PRESS_MIN
  const angle = pressureAngle(pressure)
  const tip = dialPoint(angle, CX, CY, R * 0.78)
  const tail = dialPoint(angle + 180, CX, CY, R * 0.16)

  // Scale furniture: minor ticks every 5 hPa, majors (numbered) every 25.
  const ticks: JSX.Element[] = []
  for (let p = PRESS_MIN; p <= PRESS_MAX; p += 5) {
    const major = (p - PRESS_MIN) % 25 === 0
    const a = pressureAngle(p)
    const o = dialPoint(a, CX, CY, R * 0.94)
    const i = dialPoint(a, CX, CY, R * (major ? 0.83 : 0.88))
    ticks.push(
      <line
        key={p}
        className={major ? 'envbaro__tick envbaro__tick--major' : 'envbaro__tick'}
        x1={o.x}
        y1={o.y}
        x2={i.x}
        y2={i.y}
      />
    )
    if (major) {
      const l = dialPoint(a, CX, CY, R * 0.72)
      ticks.push(
        <text key={`n${p}`} className="envbaro__num" x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle">
          {p}
        </text>
      )
    }
  }

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={`${channel} · ENV`}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="envbaro"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        {/* The aneroid dial: brass bezel, cream face, 270° pressure scale. */}
        <div className="envbaro__face">
          <svg
            className="envbaro__svg"
            viewBox="0 0 200 176"
            role="img"
            aria-label={hasData ? `Barometer ${pressure.toFixed(1)} hectopascal, ${weatherWord(pressure)}` : 'Barometer — no data'}
          >
            <circle className="envbaro__bezel" cx={CX} cy={CY} r={R + 8} />
            <circle className="envbaro__dial" cx={CX} cy={CY} r={R} />
            {ticks}
            {/* The antique weather legend. */}
            <text className="envbaro__word" x={dialPoint(-100, CX, CY, R * 0.5).x} y={dialPoint(-100, CX, CY, R * 0.5).y} textAnchor="middle">
              RAIN
            </text>
            <text className="envbaro__word" x={CX} y={CY - R * 0.5} textAnchor="middle">
              CHANGE
            </text>
            <text className="envbaro__word" x={dialPoint(100, CX, CY, R * 0.5).x} y={dialPoint(100, CX, CY, R * 0.5).y} textAnchor="middle">
              FAIR
            </text>
            <text className="envbaro__maker" x={CX} y={CY + R * 0.36} textAnchor="middle">
              ANEROID · hPa
            </text>
            {/* Pressure readout under the hub, like an inset plaque. */}
            <text className="envbaro__press" x={CX} y={CY + R * 0.62} textAnchor="middle">
              {hasData ? pressure.toFixed(1) : '——'}
            </text>
            {/* The needle (black, counterweighted) + brass hub. */}
            <line className="envbaro__needle" x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
            <circle className="envbaro__hub" cx={CX} cy={CY} r={5.5} />
          </svg>
        </div>

        {/* Temperature + humidity + source. */}
        <div className="envbaro__row">
          <div className="envbaro__cell">
            <span className="envbaro__cell-lbl">TEMP</span>
            <span className="envbaro__cell-val">{hasData ? `${reading.temp.toFixed(1)}°C` : '——'}</span>
          </div>
          <div className="envbaro__cell">
            <span className="envbaro__cell-lbl">HUMIDITY</span>
            <span className="envbaro__cell-val">{hasData ? `${reading.humidity.toFixed(0)}%` : '——'}</span>
          </div>
          <div className="envbaro__cell">
            <span className="envbaro__cell-lbl">OUTLOOK</span>
            <span className="envbaro__cell-val">{hasData ? weatherWord(pressure) : '—'}</span>
          </div>
          <label className="envbaro__src">
            <span className="envbaro__cell-lbl">SRC</span>
            <select
              className="envbaro__select"
              value={channel}
              onChange={(e) => setPicked(e.currentTarget.value)}
              aria-label="Environment sensor channel"
            >
              {(channels.length > 0 ? channels : ['env']).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </InstrumentWindow>
  )
}

// Quick sanity anchors for the render tests: the dial's printed range.
export const ENV_DIAL_RANGE = [PRESS_MIN, PRESS_MAX] as const
