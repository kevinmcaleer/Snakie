/**
 * INSTRUMENT TELEMETRY — pure, DOM-free parser for the on-device instruments
 * library's serial protocol (issue #107).
 * =============================================================================
 *
 * The board-side `micropython/instruments.py` library prints ONE reading per
 * line, prefixed with the sentinel token `SNK`, so a running program can feed
 * the IDE's Oscilloscope / Multimeter / Plotter live and NON-INVASIVELY — the
 * IDE parses the broadcast serial stream (exactly like the Plotter already
 * does) instead of polling the board over the raw REPL.
 *
 * The protocol (one line per `print()`, ASCII, space-delimited):
 *
 *   SNK SCOPE <ch> <value>            → a scope sample (value: float)
 *   SNK METER <ch> <value> [<unit>]   → a meter reading (default unit "V")
 *   SNK PLOT  <tok> [<tok> ...]       → plotter data, each tok name=value | number
 *
 * `<ch>` is a user label (e.g. `pwm`, `adc0`, a variable name) used to match a
 * reading to an open instrument.
 *
 * This module mirrors {@link ./Plotter.parse} / {@link ./board-values}: kept
 * React/DOM-free so it is unit-testable in plain node, and NOTHING here throws —
 * a malformed or non-telemetry line simply yields `null`. The `PLOT` payload is
 * parsed with the Plotter's own {@link parseLine} token grammar so the two
 * stay consistent.
 */

import { parseLine } from './Plotter.parse'

/** The leading token that marks a line as instruments telemetry. */
export const TELEMETRY_SENTINEL = 'SNK'

/** A single labelled value inside a `PLOT` row (mirrors the Plotter series). */
export interface TelemetrySeries {
  /** The series label, or a 1-based positional name for a bare number. */
  label: string
  value: number
}

/** A parsed telemetry reading. The shape depends on `kind`. */
export interface ScopeTelemetry {
  kind: 'scope'
  /** The user channel label (matches an open instrument's source). */
  ch: string
  value: number
}
export interface MeterTelemetry {
  kind: 'meter'
  ch: string
  value: number
  /** The unit string (defaults to `V` when the line omits it). */
  unit: string
}
export interface PlotTelemetry {
  kind: 'plot'
  /** The parsed series for this row (bare numbers get positional labels). */
  series: TelemetrySeries[]
}

export type Telemetry = ScopeTelemetry | MeterTelemetry | PlotTelemetry

/**
 * Is `line` an instruments-telemetry line? True when its first whitespace token
 * is the sentinel, so the Terminal can cheaply hide these and the Plotter can
 * skip its generic parse for them. Tolerates leading whitespace; an embedded
 * `SNK` later in the line (e.g. inside other output) does NOT count.
 */
export function isTelemetry(line: string): boolean {
  if (!line) return false
  const trimmed = line.trimStart()
  return trimmed === TELEMETRY_SENTINEL || trimmed.startsWith(`${TELEMETRY_SENTINEL} `)
}

/**
 * Parse one already-de-newlined line of telemetry. Returns the typed reading,
 * or `null` for a non-`SNK` line or a malformed/unknown one (so the caller can
 * fall through to its normal handling). Never throws.
 *
 *   - `SNK SCOPE <ch> <value>`            → `{ kind:'scope', ch, value }`
 *   - `SNK METER <ch> <value> [<unit>]`   → `{ kind:'meter', ch, value, unit }`
 *   - `SNK PLOT <tok> ...`                → `{ kind:'plot', series:[…] }`
 */
export function parseTelemetry(line: string): Telemetry | null {
  if (!isTelemetry(line)) return null
  // Split on runs of whitespace; the first token is the sentinel.
  const parts = line.trim().split(/\s+/)
  // parts[0] === SENTINEL (guaranteed by isTelemetry); parts[1] is the kind.
  const kind = parts[1]

  if (kind === 'SCOPE') {
    // SNK SCOPE <ch> <value>
    const ch = parts[2]
    const value = Number(parts[3])
    if (!ch || !Number.isFinite(value)) return null
    return { kind: 'scope', ch, value }
  }

  if (kind === 'METER') {
    // SNK METER <ch> <value> [<unit>]
    const ch = parts[2]
    const value = Number(parts[3])
    if (!ch || !Number.isFinite(value)) return null
    const unit = parts[4] ?? 'V'
    return { kind: 'meter', ch, value, unit }
  }

  if (kind === 'PLOT') {
    // SNK PLOT <tok> [<tok> ...] — reuse the Plotter's token grammar on the
    // payload (everything after `SNK PLOT`).
    const payload = parts.slice(2).join(' ')
    const parsed = parseLine(payload)
    if (parsed.length === 0) return null
    let positional = 0
    const series: TelemetrySeries[] = parsed.map(({ label, value }) => ({
      label: label ?? `series ${++positional}`,
      value
    }))
    return { kind: 'plot', series }
  }

  // Unknown SNK sub-command — ignore it (still hidden from the console because
  // isTelemetry is true, but produces no instrument data).
  return null
}
