import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import './Multimeter.css'
import './BoardMeter.css'

/**
 * BOARD METER (#620) — the Circuit-Sim floating multimeter.
 * =========================================================
 *
 * Reuses the skeuomorphic DMM look (the shared {@link InstrumentWindow} chrome +
 * the `dmm` styling from the Code-workspace {@link ./Multimeter}) as a draggable
 * meter that floats over the Electronics board view. Unlike the Code-workspace
 * Multimeter it reads the CIRCUIT SOLVER, not an ADC pin: tapping a point measures
 * it and the meter shows BOTH its node **voltage** and (for a wire) the **current**
 * through it — one instrument, both readings (the old separate "clamp" tool is
 * folded in). It holds NO Code-workspace instrument state, so the two uses stay
 * completely independent.
 */

export interface BoardMeterReading {
  /** Human label of the probed point (a pin name, or `A → B` for a wire). */
  label: string
  /** Node voltage (V) at the probed point, if the circuit solved. */
  voltage?: number
  /** Branch current (A) — only a WIRE carries a well-defined current. */
  current?: number
}

export interface BoardMeterProps {
  /** The last probed reading, or null before anything is tapped. */
  reading: BoardMeterReading | null
  /** The circuit's headline rail — scales the voltage bargraph. */
  refV: number
  /** Close the meter (also un-presses the toolbar toggle). */
  onClose: () => void
  /** Floating placement (drag handlers + position) from `useFloatPlacement`. */
  float?: FloatProps
}

/** Voltage → a 3dp 7-seg string (or dashes when unmeasured). */
function fmtVolts(v: number | undefined): string {
  return v === undefined ? '—.———' : v.toFixed(3)
}

/** Current → a readable number + unit (mA below 1 A), or dashes when unmeasured. */
function fmtAmps(i: number | undefined): { num: string; unit: string } {
  if (i === undefined) return { num: '—', unit: 'A' }
  const a = Math.abs(i)
  if (a > 0 && a < 1) return { num: (i * 1000).toFixed(1), unit: 'mA' }
  return { num: i.toFixed(3), unit: 'A' }
}

export function BoardMeter({ reading, refV, onClose, float }: BoardMeterProps): JSX.Element {
  const hasV = reading?.voltage !== undefined
  const hasA = reading?.current !== undefined
  const amps = fmtAmps(reading?.current)
  // Bargraph: the node voltage as a fraction of the circuit's reference rail.
  const pct = hasV ? Math.max(0, Math.min(1, Math.abs(reading!.voltage!) / Math.max(1e-3, refV))) * 100 : 0

  return (
    <InstrumentWindow
      name="MULTIMETER"
      source={reading ? reading.label : 'circuit probe'}
      onClose={onClose}
      className={`wc-meter ${float?.className ?? ''}`}
      style={float?.style}
      onTitlePointerDown={float?.onTitlePointerDown}
      onTitlePointerMove={float?.onTitlePointerMove}
      onTitlePointerUp={float?.onTitlePointerUp}
    >
      <div className="dmm">
        {/* --- Left: the handheld meter (shows the voltage) --- */}
        <div className="dmm__holster">
          <div className="dmm__body">
            <div className="dmm__brand">
              <span className="dmm__brand-name">SNAKIE</span>
              <span className="dmm__brand-model">DMM-117</span>
            </div>

            <div className="dmm__lcd">
              <div className="dmm__annun">
                <span className="dmm__annun-box">AUTO</span>
                <span className={`wc-meter__mode${hasV ? ' is-on' : ''}`}>V</span>
                <span className={`wc-meter__mode${hasA ? ' is-on' : ''}`}>A</span>
              </div>
              <div className="dmm__seg">
                <span className="dmm__seg-ghost" aria-hidden="true">
                  8.8.8.8
                </span>
                <span className="dmm__seg-live">{fmtVolts(reading?.voltage)}</span>
              </div>
              <div className="dmm__lcd-foot">
                <span className="dmm__lcd-vdc">DC VOLTS</span>
                <span className="dmm__lcd-v">V</span>
              </div>
            </div>

            <div className="dmm__dial">
              <span className="dmm__dial-lbl dmm__dial-off">OFF</span>
              <span className="dmm__dial-lbl dmm__dial-v">V</span>
              <span className="dmm__dial-lbl dmm__dial-ohm">Ω</span>
              <span className="dmm__dial-lbl dmm__dial-a">A</span>
              <span className="dmm__dial-tick" aria-hidden="true" />
              <span className="dmm__dial-knurl" aria-hidden="true" />
              <span className="dmm__dial-face" aria-hidden="true" />
              <span className="dmm__dial-needle" aria-hidden="true" />
              <span className="dmm__dial-hub" aria-hidden="true" />
            </div>

            <div className="dmm__jacks">
              <span className="dmm__jack dmm__jack--black" aria-hidden="true" />
              <span className="dmm__jack dmm__jack--red" aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* --- Right: voltage + current readouts --- */}
        <div className="dmm__readouts">
          <div className="wc-meter__probe" title={reading ? reading.label : undefined}>
            {reading ? reading.label : '— tap a pad or wire —'}
          </div>

          <div className="dmm__big">
            <span className="dmm__big-num">{fmtVolts(reading?.voltage)}</span>
            <span className="dmm__big-unit">V</span>
          </div>

          <div className="dmm__bar">
            <span className="dmm__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="dmm__bar-scale">
            <span>0 V</span>
            <span className="dmm__bar-raw">ref {refV.toFixed(1)} V</span>
            <span>{refV.toFixed(1)} V</span>
          </div>

          {/* The clamp reading, folded into the meter (#620). */}
          <div className={`wc-meter__current${hasA ? ' is-live' : ''}`}>
            <span className="wc-meter__current-lbl">CURRENT</span>
            <span className="wc-meter__current-val">
              {amps.num}
              <span className="wc-meter__current-unit">{amps.unit}</span>
            </span>
          </div>

          <p className="wc-meter__hint">
            {reading
              ? 'Tap a wire for its current + voltage, or a pad for its voltage.'
              : 'Tap a pad or a wire — the meter shows its voltage and, for a wire, its current.'}
          </p>
        </div>
      </div>
    </InstrumentWindow>
  )
}
