import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import { InstrumentRequirement } from './InstrumentRequirement'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import {
  dialPoint,
  pressureAngle,
  weatherWord,
  tempFraction,
  clampTemp,
  humidityAngle,
  humidityWord,
  describeArc,
  PRESS_MIN,
  PRESS_MAX,
  TEMP_MIN,
  TEMP_MAX,
  HUM_DRY,
  HUM_DAMP
} from './env-logic'
import './EnvInstrument.css'

/**
 * BAROMETER — an antique aneroid weather station (#216).
 * =============================================================================
 *
 * Shows temperature / barometric pressure / humidity from the passive telemetry
 * stream (`SNK ENV <ch> <t> <p> <h>` — `inst.env(t, p, h)` or a watched BME280
 * via `inst.watch(env=bme)` + `inst.update()`). The pressure drives a classic
 * cream-faced, brass-bezelled barometer dial (950–1050 hPa over 270°, with the
 * RAIN / CHANGE / FAIR legend); a mercury-in-glass thermometer stands alongside
 * it, and a small hygrometer dial (blue "dry" → red "damp" extremes) sits in the
 * footer. Pure dial/tube geometry lives in {@link ./env-logic}.
 */

export interface EnvInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
  /**
   * Seed readings (per channel), mirroring the scope's `samples` seam (#256):
   * lets render tests exercise the live dials without a telemetry stream
   * (effects don't run under static render). Live `SNK ENV` merges on top.
   */
  initialReadings?: Record<string, EnvReading>
}

/** One environmental reading per reporting channel. */
export interface EnvReading {
  temp: number
  pressure: number
  humidity: number
}

// Barometer dial geometry (viewBox units): pivot centre of the round face.
const CX = 100
const CY = 88
const R = 74

// Thermometer geometry (viewBox 48×178): a vertical capillary above a bulb.
const T_CX = 17 // tube centre x
const T_TOP = 16 // y of TEMP_MAX (a full tube)
const T_BOT = 150 // y of TEMP_MIN (just the bulb)
const T_BULB_CY = 160
const T_BULB_R = 11

/** y of the mercury meniscus for a temperature (SVG units). */
function tempLevelY(c: number): number {
  return T_BOT - tempFraction(c) * (T_BOT - T_TOP)
}

/** A skeuomorphic mercury-in-glass thermometer that fills to `temp` (°C). */
function Thermometer({ temp, hasData }: { temp: number; hasData: boolean }): JSX.Element {
  const level = tempLevelY(hasData ? temp : TEMP_MIN)

  // Scale ticks + numbers every 10 °C down the right of the tube.
  const ticks: JSX.Element[] = []
  for (let c = TEMP_MIN; c <= TEMP_MAX; c += 10) {
    const y = tempLevelY(c)
    ticks.push(<line key={`t${c}`} className="envtherm__tick" x1={T_CX + 6} y1={y} x2={T_CX + 10} y2={y} />)
    ticks.push(
      <text key={`n${c}`} className="envtherm__num" x={T_CX + 13} y={y} dominantBaseline="middle">
        {c}
      </text>
    )
  }

  return (
    <svg
      className="envtherm__svg"
      viewBox="0 0 48 178"
      role="img"
      aria-label={hasData ? `Thermometer ${temp.toFixed(1)} degrees Celsius` : 'Thermometer — no data'}
    >
      {/* Glass: the capillary tube + bulb behind the mercury. */}
      <rect className="envtherm__glass" x={T_CX - 6} y={T_TOP - 4} width={12} height={T_BOT - T_TOP + 12} rx={6} />
      <circle className="envtherm__glass" cx={T_CX} cy={T_BULB_CY} r={T_BULB_R + 1.5} />
      {/* Mercury: always-full bulb + the risen column. */}
      <circle className="envtherm__hg" cx={T_CX} cy={T_BULB_CY} r={T_BULB_R} />
      <rect className="envtherm__hg" x={T_CX - 3.5} y={level} width={7} height={T_BULB_CY - level} />
      <circle className="envtherm__hg" cx={T_CX} cy={level} r={3.5} />
      {/* Glass gloss highlight down the left of the tube. */}
      <rect className="envtherm__gloss" x={T_CX - 4} y={T_TOP - 2} width={2} height={T_BOT - T_TOP + 6} rx={1} />
      {ticks}
      <text className="envtherm__unit" x={T_CX} y={T_TOP - 8} textAnchor="middle">
        °C
      </text>
    </svg>
  )
}

// Hygrometer geometry (viewBox 92×92): a small humidity dial.
const H_CX = 46
const H_CY = 44
const H_R = 34

/** A small skeuomorphic hygrometer with blue "dry" and red "damp" extremes. */
function Hygrometer({ humidity, hasData }: { humidity: number; hasData: boolean }): JSX.Element {
  const angle = humidityAngle(hasData ? humidity : 0)
  const tip = dialPoint(angle, H_CX, H_CY, H_R * 0.74)
  const tail = dialPoint(angle + 180, H_CX, H_CY, H_R * 0.18)
  const arcR = H_R * 0.86
  return (
    <svg
      className="envhygro__svg"
      viewBox="0 0 92 92"
      role="img"
      aria-label={hasData ? `Hygrometer ${humidity.toFixed(0)} percent, ${humidityWord(humidity)}` : 'Hygrometer — no data'}
    >
      <circle className="envhygro__bezel" cx={H_CX} cy={H_CY} r={H_R + 5} />
      <circle className="envhygro__dial" cx={H_CX} cy={H_CY} r={H_R} />
      {/* Coloured extremes: blue = dry (0–30 %), red = damp (70–100 %). */}
      <path className="envhygro__arc envhygro__arc--dry" d={describeArc(H_CX, H_CY, arcR, humidityAngle(0), humidityAngle(HUM_DRY))} />
      <path className="envhygro__arc envhygro__arc--damp" d={describeArc(H_CX, H_CY, arcR, humidityAngle(HUM_DAMP), humidityAngle(100))} />
      <text className="envhygro__end envhygro__end--dry" x={dialPoint(humidityAngle(0), H_CX, H_CY, H_R * 0.5).x} y={dialPoint(humidityAngle(0), H_CX, H_CY, H_R * 0.5).y} textAnchor="middle" dominantBaseline="middle">
        DRY
      </text>
      <text className="envhygro__end envhygro__end--damp" x={dialPoint(humidityAngle(100), H_CX, H_CY, H_R * 0.5).x} y={dialPoint(humidityAngle(100), H_CX, H_CY, H_R * 0.5).y} textAnchor="middle" dominantBaseline="middle">
        DAMP
      </text>
      <text className="envhygro__pct" x={H_CX} y={H_CY + H_R * 0.62} textAnchor="middle">
        {hasData ? `${humidity.toFixed(0)}%` : '——'}
      </text>
      <line className="envhygro__needle" x1={tail.x} y1={tail.y} x2={tip.x} y2={tip.y} />
      <circle className="envhygro__hub" cx={H_CX} cy={H_CY} r={4} />
    </svg>
  )
}

export function EnvInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float,
  initialReadings
}: EnvInstrumentProps): JSX.Element {
  // Latest reading per channel + the user's picked channel (same pattern as the
  // Potentiometer: the sole/first reporting channel "just works").
  const [readings, setReadings] = useState<Record<string, EnvReading>>(initialReadings ?? {})
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

  // No `SNK ENV` telemetry yet → the shared how-to panel instead of a dead dial
  // (#257 increment 2, matching the scope/meter pattern from #256).
  if (!hasData) {
    return (
      <InstrumentWindow
        name={def.name.toUpperCase()}
        helpId={`inst-${def.id}`}
        source="waiting for ENV"
        docked={docked}
        onClose={onClose}
        onToggleDock={onToggleDock}
        {...float}
      >
        <InstrumentRequirement
          title="No sensor readings yet"
          lines={[
            'The barometer shows temperature, pressure and humidity from an environment sensor (like a BME280). Watch one in your program and the dials come alive.'
          ]}
          code={
            'import instruments as inst\nfrom machine import I2C, Pin\nfrom bme280 import BME280\n\nbme = BME280(I2C(0, sda=Pin(0), scl=Pin(1)))\ninst.watch(env=bme)   # then inst.update() in your loop'
          }
          helpId={`inst-${def.id}`}
          accent={def.accent}
        />
      </InstrumentWindow>
    )
  }

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
        {/* Weather station: the big aneroid dial + the thermometer beside it. */}
        <div className="envbaro__gauges">
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

        {/* The mercury-in-glass thermometer, standing alongside the dial. */}
        <div className="envbaro__therm">
          <Thermometer temp={clampTemp(reading?.temp ?? TEMP_MIN)} hasData={hasData} />
        </div>
        </div>

        {/* Footer: the small humidity dial + numeric readouts + source. */}
        <div className="envbaro__row">
          <div className="envbaro__hygro">
            <Hygrometer humidity={reading?.humidity ?? 0} hasData={hasData} />
          </div>
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
