import { useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import {
  applyButtonReading,
  buttonList,
  buttonCount,
  lastButton,
  totalEdges,
  emptyButtonMap,
  type ButtonMap
} from './button-logic'
import './ButtonInstrument.css'

/**
 * BUTTON INSTRUMENT (#114) — the READ panel for digital inputs.
 * =============================================================================
 *
 * Watches `SNK BTN <name> <0|1>` telemetry from the broadcast serial stream and
 * shows a live, multimeter-free view of a bank of buttons / switches: each named
 * input gets a row with a lit **PRESSED / released** indicator and a **rising-edge
 * counter** (how many times it's been pressed). The whole thing is driven by the
 * pure {@link applyButtonReading} reducer (rising-edge count, first-seen init),
 * so this component is just the skeuomorphic shell + the telemetry subscription.
 *
 * Like the Oscilloscope / Multimeter it renders through the shared
 * {@link InstrumentWindow} chrome + a {@link PhosphorScreen}, themed to the
 * registry's `button` accent (`#6fb4ee`) via the `--accent` / `--accent-border`
 * custom properties, and closes with the same close→hide model. The bottom strip
 * is the standard 3-column readout: **BUTTONS / LAST / EDGES**.
 *
 * NON-INVASIVE: the subscription reads the same `device.onData` stream the
 * Plotter/Terminal use — it never enters the raw REPL, so a `while True:` loop
 * printing `inst.button(...)` drives it live without being interrupted.
 */

export interface ButtonInstrumentProps {
  /** The registry def driving the name, accent and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other dock windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
}

export function ButtonInstrument({
  def,
  onClose,
  docked = true
}: ButtonInstrumentProps): JSX.Element {
  const [map, setMap] = useState<ButtonMap>(emptyButtonMap)

  // Fold every `SNK BTN …` reading into the rising-edge map. Other telemetry
  // kinds are ignored. The callback is held in a ref by the hook, so this stays
  // a single subscription for the life of the panel.
  useTelemetryStream((reading) => {
    if (reading.kind === 'btn') {
      setMap((prev) => applyButtonReading(prev, { name: reading.name, pressed: reading.pressed }))
    }
  })

  const rows = buttonList(map)
  const count = buttonCount(map)
  const last = lastButton(map)
  const edges = totalEdges(map)

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source="DIGITAL IN"
      docked={docked}
      onClose={onClose}
    >
      <div
        className="btnpanel"
        style={
          {
            '--accent': def.accent,
            '--accent-border': def.border
          } as CSSProperties
        }
      >
        <PhosphorScreen className="btnpanel__screen">
          {rows.length === 0 ? (
            <div className="btnpanel__empty">
              <svg
                className="btnpanel__empty-icon"
                width="34"
                height="34"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d={def.icon}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <span className="btnpanel__empty-text">waiting for input…</span>
              <span className="btnpanel__empty-hint">print SNK BTN &lt;name&gt; 0|1</span>
            </div>
          ) : (
            <ul className="btnpanel__list" aria-label="Watched buttons">
              {rows.map((b) => (
                <li
                  key={b.name}
                  className={`btnpanel__row ${b.pressed ? 'btnpanel__row--on' : ''}`}
                >
                  <span
                    className={`btnpanel__led ${b.pressed ? 'btnpanel__led--on' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="btnpanel__name">{b.name}</span>
                  <span className="btnpanel__state">{b.pressed ? 'PRESSED' : 'released'}</span>
                  <span className="btnpanel__edges">
                    <span className="btnpanel__edges-num">{b.edgeCount}</span>
                    <span className="btnpanel__edges-lbl">edges</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PhosphorScreen>

        {/* Standard bottom 3-column readout strip: BUTTONS / LAST / EDGES. */}
        <div className="btnpanel__readout">
          <Cell label="BUTTONS" value={String(count)} />
          <span className="btnpanel__div" aria-hidden="true" />
          <Cell label="LAST" value={last ?? '——'} />
          <span className="btnpanel__div" aria-hidden="true" />
          <Cell label="EDGES" value={String(edges)} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="btnpanel__cell">
      <span className="btnpanel__cell-lbl">{label}</span>
      <span className="btnpanel__cell-val">{value}</span>
    </div>
  )
}
