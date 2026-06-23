import { type CSSProperties } from 'react'
import { InstrumentWindow } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import './PlaceholderInstrument.css'

/**
 * PLACEHOLDER INSTRUMENT (#119) — a real, toggleable dock window for a NEW
 * instrument whose body hasn't been built yet.
 * =============================================================================
 *
 * The instrument-dock framework (#119) is scaffolding: it lists ~13 instruments,
 * but the real bodies for the new ones (Gamepad, Range, IMU, LED, Button,
 * Buzzer, Encoder, I²C display, Wi-Fi scan, Bluetooth, I²C detect) land in
 * SEPARATE panel issues (#110–#121). Until then each renders through this shared
 * stub so the dock shows the COMPLETE set and the grouping/palette/visibility
 * wiring can be exercised end-to-end.
 *
 * Each stub reuses the shared {@link InstrumentWindow} chrome (title bar, accent
 * source pill, dock/close keys) and drops a minimal skeuomorphic "screen": the
 * instrument's own accent-tinted icon + name + a "coming soon" caption + a
 * representative readout strip (dashes), so it READS like the instrument it will
 * become. The accent/border come straight from the registry def, applied via CSS
 * custom properties so one stub themes itself per-instrument.
 *
 * ── INTEGRATION SEAM (for the #110–#121 panel issues) ──────────────────────
 * To replace a placeholder with the real instrument body:
 *   1. Build the real component (e.g. `RangeFinder.tsx`) using the same
 *      `InstrumentWindow` chrome + a `PhosphorScreen` body, exactly like
 *      `Oscilloscope` / `Multimeter` / `Plotter`.
 *   2. In `InstrumentHost.tsx`'s `renderSingleton(...)`, switch on the def `id`
 *      and return your real component for that id instead of falling through to
 *      `<PlaceholderInstrument>`. The visibility toggle, dock placement, the
 *      "Add instrument" palette entry and the in-use derivation already exist
 *      (they read the registry), so no other wiring changes.
 *   3. No registry change is needed unless the instrument's accent / group /
 *      in-use `uses`/`hints` change.
 */

export interface PlaceholderInstrumentProps {
  /** The registry def driving the name, accent, icon and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other dock windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
}

/** A short in/out tag for the accent pill, derived from the group. */
function groupTag(group: InstrumentDef['group']): string {
  if (group === 'output') return 'OUT'
  if (group === 'both') return 'IN · OUT'
  return 'IN'
}

export function PlaceholderInstrument({
  def,
  onClose,
  docked = true
}: PlaceholderInstrumentProps): JSX.Element {
  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source={`${groupTag(def.group)} · coming soon`}
      docked={docked}
      onClose={onClose}
    >
      <div
        className="placeholder"
        style={
          {
            '--ph-accent': def.accent,
            '--ph-border': def.border
          } as CSSProperties
        }
      >
        {/* The skeuomorphic "screen" — accent-tinted glass with the instrument's
            own icon, name and a coming-soon caption. */}
        <div className="placeholder__screen">
          <svg
            className="placeholder__icon"
            width="44"
            height="44"
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
          <span className="placeholder__name">{def.name}</span>
          <span className="placeholder__soon">coming soon</span>
          <div className="placeholder__scanlines" aria-hidden="true" />
        </div>

        {/* A representative readout strip (dashes) so the stub reads like a real
            instrument window. The real body (#110–#121) replaces this whole block. */}
        <div className="placeholder__readout">
          <Cell label="STATUS" value="standby" />
          <span className="placeholder__div" aria-hidden="true" />
          <Cell label="VALUE" value="——" />
          <span className="placeholder__div" aria-hidden="true" />
          <Cell label="RATE" value="—— Hz" />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="placeholder__cell">
      <span className="placeholder__cell-lbl">{label}</span>
      <span className="placeholder__cell-val">{value}</span>
    </div>
  )
}
