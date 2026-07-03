import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import { POT_CHANNEL, knobRotation, needleAngle, needlePoint, pctFromVolts } from './pot-logic'
import './PotentiometerInstrument.css'

/**
 * POTENTIOMETER — a skeuomorphic vintage panel meter (#212).
 * =============================================================================
 *
 * Reads a pot's wiper as an ADC voltage off the passive telemetry stream
 * (`SNK METER <ch> <volts>`, e.g. `inst.meter(v, ch='pot')` or `inst.watch(pot=
 * adc)` + `inst.update()`) and shows it two ways: a cream **B.S. First Grade**
 * moving-coil ammeter reading **0–100 %** (not amps), and a rotary **knob** mirroring
 * how far the pot is turned. The source pill / SRC selector pick which reporting
 * ADC channel to read. Pure geometry lives in {@link ./pot-logic}.
 */

export interface PotentiometerInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

// Ammeter face geometry (viewBox units). Pivot low-centre; the needle sweeps the top.
const CX = 100
const CY = 104
const R = 82

const MINOR_TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const LABELS = [0, 25, 50, 75, 100]

export function PotentiometerInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: PotentiometerInstrumentProps): JSX.Element {
  const [pct, setPct] = useState(0)
  const [volts, setVolts] = useState(0)
  // The ADC channels seen on the wire + the one this meter reads.
  const [channels, setChannels] = useState<string[]>([])
  const [channel, setChannel] = useState<string>(POT_CHANNEL)

  useTelemetryStream(
    useCallback(
      (r) => {
        if (r.kind !== 'meter') return
        setChannels((cs) => (cs.includes(r.ch) ? cs : [...cs, r.ch]))
        // Read the selected channel, or fall back to the sole reporting one so a
        // single pot "just works" without matching the label.
        setChannel((cur) => {
          const match = r.ch === cur || (channels.length === 0 && cur === POT_CHANNEL)
          if (match || r.ch === cur) {
            setVolts(r.value)
            setPct(pctFromVolts(r.value))
          }
          return cur
        })
      },
      [channels.length]
    )
  )

  const onPickChannel = (ch: string): void => setChannel(ch)

  // Scale-arc endpoints + needle tip.
  const p0 = needlePoint(0, CX, CY, R)
  const p100 = needlePoint(100, CX, CY, R)
  const tip = needlePoint(pct, CX, CY, R * 0.9)
  const arc = `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${R} ${R} 0 0 1 ${p100.x.toFixed(1)} ${p100.y.toFixed(1)}`
  // Highlight the swept portion (0 → pct) in brass.
  const pTip = needlePoint(pct, CX, CY, R)
  const sweep = `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${R} ${R} 0 0 1 ${pTip.x.toFixed(1)} ${pTip.y.toFixed(1)}`

  const source = channels.length > 0 ? channel : POT_CHANNEL
  const knobDeg = useMemo(() => knobRotation(pct), [pct])

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={`${source} · ADC`}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="potmeter"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        {/* The moving-coil meter face. */}
        <div className="potmeter__face">
          <svg className="potmeter__svg" viewBox="0 0 200 118" role="img" aria-label={`Potentiometer ${pct} percent`}>
            {/* Cream dial + inner frame. */}
            <rect className="potmeter__dial" x="4" y="4" width="192" height="110" rx="6" />
            {/* Scale arc + swept fill. */}
            <path className="potmeter__arc" d={arc} />
            <path className="potmeter__sweep" d={sweep} />
            {/* Minor ticks. */}
            {MINOR_TICKS.map((t) => {
              const a = needlePoint(t, CX, CY, R)
              const b = needlePoint(t, CX, CY, R - (LABELS.includes(t) ? 12 : 7))
              return (
                <line
                  key={t}
                  className={`potmeter__tick ${LABELS.includes(t) ? 'potmeter__tick--major' : ''}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              )
            })}
            {/* Major labels. */}
            {LABELS.map((t) => {
              const l = needlePoint(t, CX, CY, R - 22)
              return (
                <text key={t} className="potmeter__num" x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle">
                  {t}
                </text>
              )
            })}
            {/* Unit + maker's mark (the vintage cue). */}
            <text className="potmeter__unit" x={CX} y={CY - 30} textAnchor="middle">
              %
            </text>
            <text className="potmeter__mark" x={CX} y={CY - 12} textAnchor="middle">
              B.S. FIRST GRADE
            </text>
            {/* Needle + hub. */}
            <line className="potmeter__needle" x1={CX} y1={CY} x2={tip.x} y2={tip.y} />
            <circle className="potmeter__hub" cx={CX} cy={CY} r={7} />
          </svg>
        </div>

        {/* Bottom row: the pot knob + a big readout + the source selector. */}
        <div className="potmeter__row">
          <div className="potmeter__knob-wrap" title="Wiper position">
            <svg className="potmeter__knob" viewBox="0 0 48 48" aria-hidden="true">
              <circle className="potmeter__knob-body" cx="24" cy="24" r="20" />
              <g style={{ transform: `rotate(${knobDeg}deg)`, transformOrigin: '24px 24px' }}>
                <line className="potmeter__knob-line" x1="24" y1="24" x2="24" y2="7" />
              </g>
              <circle className="potmeter__knob-cap" cx="24" cy="24" r="3" />
            </svg>
          </div>

          <div className="potmeter__readout">
            <span className="potmeter__pct">{pct}</span>
            <span className="potmeter__pct-unit">%</span>
            <span className="potmeter__volts">{volts.toFixed(2)} V</span>
          </div>

          <label className="potmeter__src">
            <span className="potmeter__src-lbl">SRC</span>
            <select
              className="potmeter__select"
              value={channel}
              onChange={(e) => onPickChannel(e.currentTarget.value)}
              aria-label="Potentiometer ADC channel"
            >
              {(channels.length > 0 ? channels : [POT_CHANNEL]).map((c) => (
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

// Re-exported for the registry icon / tests: the needle angle at mid-scale (50%)
// is straight up (90°), a quick sanity anchor.
export const POT_MID_ANGLE = needleAngle(50)
