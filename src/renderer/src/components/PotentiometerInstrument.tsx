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

// Ammeter face geometry (viewBox 0 0 220 200). The needle pivots low-centre and
// sweeps a shallow arc across the top; the scale/numbers sit on those radii.
const CX = 110
const CY = 122
const RS = 82 // scale-arc radius
const RN = 74 // needle length
const RNUM = 62 // number radius

const MINOR_TICKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
const LABELS = [0, 25, 50, 75, 100]

// The cream face's scalloped "brow" outline (a vintage panel-meter cue): a broad
// domed top, straight sides, and a wavy bottom that dips at the corners and rises
// to a central hump over the medallion.
const FACE_PATH =
  'M 26 58 Q 26 16 68 14 L 152 14 Q 194 16 194 58 L 194 102 ' +
  'Q 194 120 174 126 C 150 135 130 133 110 120 C 90 133 70 135 46 126 ' +
  'Q 26 120 26 102 Z'

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
  const p0 = needlePoint(0, CX, CY, RS)
  const p100 = needlePoint(100, CX, CY, RS)
  const tip = needlePoint(pct, CX, CY, RN)
  const arc = `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${RS} ${RS} 0 0 1 ${p100.x.toFixed(1)} ${p100.y.toFixed(1)}`

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
        {/* A vintage B.S. First Grade moving-coil panel meter. */}
        <div className="potmeter__face">
          <svg className="potmeter__svg" viewBox="0 0 220 200" role="img" aria-label={`Potentiometer ${pct} percent`}>
            <defs>
              <radialGradient id="potmeter-bezel" cx="42%" cy="30%" r="80%">
                <stop offset="0%" stopColor="#7c6949" />
                <stop offset="52%" stopColor="#4c3f2c" />
                <stop offset="100%" stopColor="#261d12" />
              </radialGradient>
              <radialGradient id="potmeter-medal" cx="38%" cy="32%" r="74%">
                <stop offset="0%" stopColor="#dcb75f" />
                <stop offset="55%" stopColor="#a17e35" />
                <stop offset="100%" stopColor="#5c451b" />
              </radialGradient>
              {/* Hammered cast-metal grain over the bezel. */}
              <filter id="potmeter-hammered">
                <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n" />
                <feColorMatrix
                  in="n"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.16 0"
                />
              </filter>
            </defs>

            {/* Cast-metal round bezel + hammered grain + corner screws. */}
            <rect className="potmeter__bezel" x="4" y="4" width="212" height="192" rx="46" fill="url(#potmeter-bezel)" />
            <rect x="4" y="4" width="212" height="192" rx="46" filter="url(#potmeter-hammered)" />
            {[[24, 24], [196, 24], [24, 176], [196, 176]].map(([x, y], i) => (
              <circle key={i} className="potmeter__screw" cx={x} cy={y} r="4.5" />
            ))}

            {/* Cream scalloped "brow" face. */}
            <path className="potmeter__face-shape" d={FACE_PATH} />

            {/* Maker shield + the big PERCENT legend (the AMPERES analogue). */}
            <g className="potmeter__shield" transform="translate(110 32)">
              <path className="potmeter__shield-body" d="M -6 -8 h12 v5 q0 7 -6 10 q-6 -3 -6 -10 Z" />
              <path className="potmeter__shield-h" d="M -2.6 -5 v8 M 2.6 -5 v8 M -2.6 -1.2 h5.2" />
            </g>
            <text className="potmeter__big" x={CX} y="50" textAnchor="middle">
              PERCENT
            </text>

            {/* Scale arc + ticks + numbers. */}
            <path className="potmeter__arc" d={arc} />
            {MINOR_TICKS.map((t) => {
              const a = needlePoint(t, CX, CY, RS)
              const b = needlePoint(t, CX, CY, RS - (LABELS.includes(t) ? 11 : 6))
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
            {LABELS.map((t) => {
              const l = needlePoint(t, CX, CY, RNUM)
              return (
                <text key={t} className="potmeter__num" x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle">
                  {t}
                </text>
              )
            })}

            {/* Maker's marks, in the lower brow clear of the 0/100 numerals. */}
            <text className="potmeter__maker" x={CX} y="106" textAnchor="middle">
              BRITISH MANUFACTURE
            </text>
            <text className="potmeter__grade" x={CX} y="114" textAnchor="middle">
              B.S. FIRST GRADE
            </text>

            {/* Thin black needle. */}
            <line className="potmeter__needle" x1={CX} y1={CY} x2={tip.x} y2={tip.y} />

            {/* Brass monogram medallion at the bottom-centre. */}
            <circle className="potmeter__medal" cx={CX} cy="160" r="17" fill="url(#potmeter-medal)" />
            <circle className="potmeter__medal-ring" cx={CX} cy="160" r="17" />
            <text className="potmeter__medal-mono" x={CX} y="160" textAnchor="middle" dominantBaseline="central">
              S
            </text>
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
