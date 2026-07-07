import { useEffect, useMemo, useState } from 'react'
import { InstrumentWindow, SourceSlot, type FloatProps } from './InstrumentWindow'
import { InstrumentRequirement } from './InstrumentRequirement'
import { adcChannel, ADC_MAX_RAW, type AdcSample, type Stats } from './instrument-data'
import type { MeterReading } from './instrument-telemetry-feed'
import type { UsedPins } from './parse-pins'
import './Multimeter.css'

/**
 * MULTIMETER (#102) — a skeuomorphic handheld DMM reading an ADC pin's voltage.
 * =============================================================================
 *
 * Left: a yellow-holstered handheld meter with a grey-green LCD showing a
 * 7-segment voltage (DSEG7-Classic, with ghost `8.8.8.8` segments behind), AUTO/
 * DC/GP annunciators, a knurled rotary dial at `V⎓`, and red/black banana jacks.
 * Right: an ADC source selector, the large voltage, a 0–3.3 V bargraph with the
 * raw 12-bit count, and MIN / MAX / AVG stat cells.
 *
 * The conversion (12-bit, 3.3 V ref) + the rolling stats are the pure, unit-
 * tested {@link ./instrument-data} (`adcFromU16`, `foldStat`); the host
 * (BoardGraph) feeds a live `sample` + accumulated `stats` when the board is
 * connected, else an idle placeholder reading.
 *
 * DSEG7 FONT: no clean npm/@fontsource DSEG7 package exists, and we don't vendor
 * a font binary (keeps the build + repo lean). The LCD uses
 * `font-family:'DSEG7-Classic', 'JetBrains Mono', monospace` — matching the
 * handoff's family name so a self-hosted DSEG7 would "just work" if added later —
 * and falls back to a tasteful monospaced 7-seg approximation (the ghost
 * `8.8.8.8` backing keeps the segmented-display read even in the fallback).
 */

export interface MultimeterProps {
  /** The ADC connection this meter is currently reading. */
  conn: UsedPins
  /** All ADC connections in use (for the source selector). */
  sources: UsedPins[]
  /**
   * The live ADC reading (12-bit raw + volts) from the REPL poll, or undefined
   * when not connected → the meter shows an idle placeholder.
   */
  sample?: AdcSample
  /**
   * A live `SNK METER` telemetry reading for this channel (#107): the value (in
   * the meter's own unit) + unit. PREFERRED over `sample` when present — passive,
   * always-on, no REPL interruption. No 12-bit raw count is available from
   * telemetry, so the raw readout shows `----` in that case.
   */
  liveValue?: MeterReading
  /** Rolling MIN/MAX/AVG over the volts samples received, or undefined (idle). */
  stats?: Stats
  /** Whether the global instrument live-poll is on (drives the LIVE toggle). */
  live?: boolean
  /** Flip the global live-poll (shared by all open instruments). */
  onToggleLive?: () => void
  /** Switch the meter to another ADC pin. */
  onSelectSource?: (conn: UsedPins) => void
  onToggleDock?: () => void
  docked?: boolean
  onClose?: () => void
  /** Floating-placement props (drag handlers + position); absent when docked. */
  float?: FloatProps
}

/** A short `GP<pin>` label for a connection's first pin. */
function gpLabel(conn: UsedPins): string {
  const pin = conn.pins[0] ?? '?'
  return /^\d+$/.test(pin) ? `GP${pin}` : pin
}

/** Format a voltage to 3dp for the 7-seg display (`1.652`), or a blank reading. */
function fmtVolts(v: number | undefined): string {
  return v === undefined ? '----' : v.toFixed(3)
}

export function Multimeter({
  conn,
  sources,
  sample,
  liveValue,
  stats,
  live,
  onToggleLive,
  onSelectSource,
  onToggleDock,
  docked = true,
  onClose,
  float
}: MultimeterProps): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)

  const gp = gpLabel(conn)
  const channel = useMemo(() => adcChannel(conn.pins[0]) ?? 'ADC0', [conn.pins])
  // Prefer the passive telemetry reading (#107) over the REPL-poll sample. The
  // telemetry value is in its own unit; the poll value is volts with a raw count.
  const volts = liveValue ? liveValue.value : sample?.volts
  const unit = liveValue?.unit ?? 'V'
  const raw = liveValue ? undefined : sample?.raw
  // Bargraph fill is the fraction of the 3.3 V range (0 when idle).
  const pct = volts === undefined ? 0 : Math.max(0, Math.min(1, volts / 3.3)) * 100

  // Opened from the dock with no ADC pin in the file → a placeholder connection.
  // Auto-adopt the first real ADC source when one appears; until then show the
  // requirement panel instead of an idle meter with dashes and no explanation.
  const isPlaceholder = conn.pins.length === 0 && conn.variable === ''
  useEffect(() => {
    if (isPlaceholder && sources.length > 0) onSelectSource?.(sources[0])
  }, [isPlaceholder, sources, onSelectSource])

  if (isPlaceholder && sources.length === 0 && volts === undefined) {
    return (
      <InstrumentWindow
        name="MULTIMETER"
        helpId="inst-meter"
        source="no source"
        live={live}
        onToggleLive={onToggleLive}
        onToggleDock={onToggleDock}
        docked={docked}
        onClose={onClose}
        {...float}
      >
        <InstrumentRequirement
          title="No ADC input yet"
          lines={[
            'The multimeter reads an analog pin (ADC). Add one in your program (or watch it) and the live voltage shows here.'
          ]}
          code={'import instruments as inst\nfrom machine import Pin, ADC\n\nadc = ADC(Pin(26))\ninst.watch(meter=adc)   # then inst.update() in your loop'}
          helpId="inst-meter"
          accent="#5ce08a"
        />
      </InstrumentWindow>
    )
  }

  return (
    <InstrumentWindow
      name="MULTIMETER"
      helpId="inst-meter"
      source={`${channel} ${gp}`}
      live={live}
      onToggleLive={onToggleLive}
      onToggleDock={onToggleDock}
      docked={docked}
      onClose={onClose}
      {...float}
    >
      <div className="dmm">
        {/* --- Left: the handheld meter --- */}
        <div className="dmm__holster">
          <div className="dmm__body">
            <div className="dmm__brand">
              <span className="dmm__brand-name">SNAKIE</span>
              <span className="dmm__brand-model">DMM-117</span>
            </div>

            {/* Grey-green LCD. */}
            <div className="dmm__lcd">
              <div className="dmm__annun">
                <span className="dmm__annun-box">AUTO</span>
                <span>DC</span>
                <span className="dmm__annun-gp">{gp}</span>
              </div>
              <div className="dmm__seg">
                <span className="dmm__seg-ghost" aria-hidden="true">
                  8.8.8.8
                </span>
                <span className="dmm__seg-live">{fmtVolts(volts)}</span>
              </div>
              <div className="dmm__lcd-foot">
                <span className="dmm__lcd-vdc">V • DC</span>
                <span className="dmm__lcd-v">V</span>
              </div>
            </div>

            {/* Knurled rotary dial pointing at V⎓. */}
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

            {/* Red / black banana jacks. */}
            <div className="dmm__jacks">
              <span className="dmm__jack dmm__jack--black" aria-hidden="true" />
              <span className="dmm__jack dmm__jack--red" aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* --- Right: readouts --- */}
        <div className="dmm__readouts">
          <SourceSlot
            label={`${channel} · ${gp}`}
            open={pickerOpen}
            onToggle={() => setPickerOpen((o) => !o)}
            menu={sources.map((s, i) => {
              const ch = adcChannel(s.pins[0]) ?? 'ADC?'
              return (
                <li key={`${s.variable}-${i}`} role="option" aria-selected={s === conn}>
                  <button
                    type="button"
                    className={`instr__menu-item ${s === conn ? 'is-active' : ''}`}
                    onClick={() => {
                      onSelectSource?.(s)
                      setPickerOpen(false)
                    }}
                  >
                    {ch} · {gpLabel(s)}
                    <span className="instr__menu-item-sub">{s.variable || 'adc'}</span>
                  </button>
                </li>
              )
            })}
          />

          <div className="dmm__big">
            <span className="dmm__big-num">{volts === undefined ? '—.———' : volts.toFixed(3)}</span>
            <span className="dmm__big-unit">{unit}</span>
          </div>

          <div className="dmm__bar">
            <span className="dmm__bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="dmm__bar-scale">
            <span>0 V</span>
            <span className="dmm__bar-raw">
              raw {raw === undefined ? '----' : raw}/{ADC_MAX_RAW}
            </span>
            <span>3.3 V</span>
          </div>

          <div className="dmm__stats">
            <Stat label="MIN" value={stats?.count ? stats.min.toFixed(3) : '—'} />
            <Stat label="MAX" value={stats?.count ? stats.max.toFixed(3) : '—'} />
            <Stat label="AVG" value={stats?.count ? stats.avg.toFixed(3) : '—'} />
          </div>
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One MIN/MAX/AVG stat cell. */
function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="dmm__stat">
      <span className="dmm__stat-lbl">{label}</span>
      <span className="dmm__stat-val">{value}</span>
    </div>
  )
}
