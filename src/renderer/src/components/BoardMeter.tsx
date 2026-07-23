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
 * Multimeter it reads the CIRCUIT SOLVER, not an ADC pin: tap a pad to read its
 * node voltage, tap a wire to read its current — one meter shows both (the old
 * separate "clamp" tool is folded in here). It holds NO Code-workspace instrument
 * state, so the two uses stay completely independent.
 */

export interface BoardMeterReading {
  /** Voltage (tapped a pad, vs ground) or current (tapped a wire). */
  kind: 'voltage' | 'current'
  /** The solved value — volts for `voltage`, amps for `current`. */
  value: number
  /** Human label of the probed point (a pin name, or `A → B` for a wire). */
  label: string
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

/** The 7-seg number + unit + sub-label for a reading (mA below 1 A for readability). */
function meterDisplay(r: BoardMeterReading | null): { seg: string; unit: string; sub: string } {
  if (!r) return { seg: '----', unit: '', sub: '— DC —' }
  if (r.kind === 'voltage') return { seg: r.value.toFixed(3), unit: 'V', sub: 'DC VOLTS' }
  const a = Math.abs(r.value)
  if (a > 0 && a < 1) return { seg: (r.value * 1000).toFixed(1), unit: 'mA', sub: 'CURRENT' }
  return { seg: r.value.toFixed(3), unit: 'A', sub: 'CURRENT' }
}

export function BoardMeter({ reading, refV, onClose, float }: BoardMeterProps): JSX.Element {
  const disp = meterDisplay(reading)
  const isV = reading?.kind === 'voltage'
  const isA = reading?.kind === 'current'
  // Bargraph: voltage only, as a fraction of the circuit's reference rail.
  const pct = reading && isV ? Math.max(0, Math.min(1, Math.abs(reading.value) / Math.max(1e-3, refV))) * 100 : 0

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
        {/* --- Left: the handheld meter --- */}
        <div className="dmm__holster">
          <div className="dmm__body">
            <div className="dmm__brand">
              <span className="dmm__brand-name">SNAKIE</span>
              <span className="dmm__brand-model">DMM-117</span>
            </div>

            <div className="dmm__lcd">
              <div className="dmm__annun">
                <span className="dmm__annun-box">AUTO</span>
                <span className={`wc-meter__mode${isV ? ' is-on' : ''}`}>V</span>
                <span className={`wc-meter__mode${isA ? ' is-on' : ''}`}>A</span>
              </div>
              <div className="dmm__seg">
                <span className="dmm__seg-ghost" aria-hidden="true">
                  8.8.8.8
                </span>
                <span className="dmm__seg-live">{disp.seg}</span>
              </div>
              <div className="dmm__lcd-foot">
                <span className="dmm__lcd-vdc">{disp.sub}</span>
                <span className="dmm__lcd-v">{disp.unit || '—'}</span>
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

        {/* --- Right: readouts --- */}
        <div className="dmm__readouts">
          <div className="wc-meter__probe" title={reading ? reading.label : undefined}>
            {reading ? reading.label : '— tap a pad or wire —'}
          </div>

          <div className="dmm__big">
            <span className="dmm__big-num">{reading ? disp.seg : '—.———'}</span>
            <span className="dmm__big-unit">{disp.unit}</span>
          </div>

          <div className="dmm__bar">
            <span className="dmm__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="dmm__bar-scale">
            <span>0{isV ? ' V' : ''}</span>
            <span className="dmm__bar-raw">{isV ? `ref ${refV.toFixed(1)} V` : isA ? 'current' : ''}</span>
            <span>{isV ? `${refV.toFixed(1)} V` : ''}</span>
          </div>

          <p className="wc-meter__hint">
            {reading
              ? isV
                ? 'Voltage to ground. Tap a wire for its current.'
                : 'Current through the wire. Tap a pad for its voltage.'
              : 'Tap a pad to read its voltage, or a wire to read its current.'}
          </p>
        </div>
      </div>
    </InstrumentWindow>
  )
}
