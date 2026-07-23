import { useState, type CSSProperties, type JSX } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import './PsuInstrument.css'

/**
 * BENCH PSU INSTRUMENT (epic #597 Circuit Sim, #602).
 * =============================================================================
 * An adjustable bench power supply: set an output VOLTAGE and a CURRENT LIMIT,
 * read them back on a two-line seven-segment display (V on top, A below, with
 * ghost `88.88` backing like the Multimeter), and switch the OUTPUT on/off. A
 * `CV` / `CC` annunciator shows the regulation mode.
 *
 * For now the controls hold local state — the Circuit Sim DC solver (#603) will
 * read this as a supply node (set voltage as the source, current limit as the
 * fold-back point) and drive the live current readback. Until then the "actual"
 * current mirrors the limit when the output is on, so the display is meaningful.
 *
 * Renders through the shared {@link InstrumentWindow} chrome + a
 * {@link PhosphorScreen}, themed to the registry's `psu` accent. Unique `psu__`
 * BEM prefix (instrument CSS is global); reads in both dark + light skins.
 */

export interface PsuInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

/** A generic bench PSU's ranges (matches the `bench-psu` part's supplyRange). */
const V_MAX = 30
const I_MAX = 5

const fmtV = (v: number): string => v.toFixed(2)
const fmtA = (a: number): string => a.toFixed(3)

export function PsuInstrument({ def, onClose, docked = true, onToggleDock, float }: PsuInstrumentProps): JSX.Element {
  const [output, setOutput] = useState(false)
  const [setV, setSetV] = useState(5)
  const [limitA, setLimitA] = useState(1)

  // Until the solver lands (#603), the delivered current is 0 with the output off,
  // else it "reads" the limit — enough to make the A display and CV/CC meaningful.
  const liveA = output ? limitA : 0
  // CV = regulating voltage (normal); CC = clamped at the current limit. The load
  // model that trips CC arrives with the DC solver (#603), so it stays false for
  // now — the lamp is wired, just never lit until then.
  const currentLimited = false
  const mode: 'CV' | 'CC' | 'OFF' = !output ? 'OFF' : currentLimited ? 'CC' : 'CV'

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source="ADJUSTABLE SUPPLY"
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div className="psu" style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}>
        <PhosphorScreen className="psu__screen">
          {/* Voltage line. */}
          <div className={`psu__seg-row${output ? '' : ' psu__seg-row--off'}`}>
            <div className="psu__seg">
              <span className="psu__seg-ghost" aria-hidden="true">88.88</span>
              <span className="psu__seg-live">{fmtV(output ? setV : 0)}</span>
            </div>
            <span className="psu__seg-unit">V</span>
          </div>
          {/* Current line. */}
          <div className={`psu__seg-row psu__seg-row--a${output ? '' : ' psu__seg-row--off'}`}>
            <div className="psu__seg psu__seg--a">
              <span className="psu__seg-ghost" aria-hidden="true">8.888</span>
              <span className="psu__seg-live">{fmtA(liveA)}</span>
            </div>
            <span className="psu__seg-unit">A</span>
          </div>
          {/* Regulation-mode annunciators. */}
          <div className="psu__annun" aria-hidden="true">
            <span className={`psu__annun-lamp${mode === 'CV' ? ' is-on' : ''}`}>CV</span>
            <span className={`psu__annun-lamp${mode === 'CC' ? ' is-on psu__annun-lamp--cc' : ''}`}>CC</span>
            <span className={`psu__annun-lamp${mode === 'OFF' ? ' is-on psu__annun-lamp--off' : ''}`}>OFF</span>
          </div>
        </PhosphorScreen>

        {/* Controls: voltage, current limit, and the output switch. */}
        <div className="psu__controls">
          <label className="psu__slider">
            <span className="psu__slider-lbl">VOLTAGE</span>
            <input
              type="range"
              min={0}
              max={V_MAX}
              step={0.1}
              value={setV}
              onChange={(e) => setSetV(Number(e.currentTarget.value))}
              aria-label="Output voltage"
            />
            <span className="psu__slider-val">{fmtV(setV)} V</span>
          </label>
          <label className="psu__slider">
            <span className="psu__slider-lbl">CURRENT LIMIT</span>
            <input
              type="range"
              min={0}
              max={I_MAX}
              step={0.01}
              value={limitA}
              onChange={(e) => setLimitA(Number(e.currentTarget.value))}
              aria-label="Current limit"
            />
            <span className="psu__slider-val">{fmtA(limitA)} A</span>
          </label>
          <button
            type="button"
            className={`psu__output${output ? ' psu__output--on' : ''}`}
            aria-pressed={output}
            onClick={() => setOutput((o) => !o)}
          >
            <span className="psu__output-led" aria-hidden="true" />
            OUTPUT {output ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Bottom readout strip: SET V / LIMIT A / MODE. */}
        <div className="psu__readout">
          <Cell label="SET V" value={fmtV(setV)} />
          <span className="psu__div" aria-hidden="true" />
          <Cell label="LIMIT A" value={fmtA(limitA)} />
          <span className="psu__div" aria-hidden="true" />
          <Cell label="MODE" value={mode} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="psu__cell">
      <span className="psu__cell-lbl">{label}</span>
      <span className="psu__cell-val">{value}</span>
    </div>
  )
}
