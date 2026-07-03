/**
 * POTENTIOMETER instrument logic (#212) — pure, DOM-free helpers backing the
 * skeuomorphic vintage-ammeter panel that reads an ADC as a 0–100% position.
 * =============================================================================
 *
 * The board reports a pot's wiper as an ADC voltage on the passive telemetry
 * stream (`SNK METER <ch> <volts>` — e.g. via `inst.meter(v, ch='pot')` or
 * `inst.watch(pot=adc)` + `inst.update()`). This module turns that reading into
 * a **percentage** (0–100) and the geometry the panel draws: the ammeter NEEDLE
 * angle and the rotary KNOB angle. Kept React/DOM-free so it is unit-testable.
 */

/** The ADC reference voltage a raw wiper reading is scaled against (RP2040 3V3). */
export const POT_VREF = 3.3

/** The default telemetry channel the panel reads (matches `inst.watch(pot=…)`). */
export const POT_CHANNEL = 'pot'

function clamp(n: number, lo: number, hi: number): number {
  return !Number.isFinite(n) ? lo : n < lo ? lo : n > hi ? hi : n
}

/**
 * A wiper VOLTAGE (0..`vref`) → percentage (0..100, rounded). A non-finite or
 * out-of-range input is clamped. `vref` defaults to {@link POT_VREF}.
 */
export function pctFromVolts(volts: number, vref = POT_VREF): number {
  const ref = vref > 0 ? vref : POT_VREF
  return clamp(Math.round((volts / ref) * 100), 0, 100)
}

// The ammeter needle sweeps a shallow arc across the TOP: 0% points up-left, 50%
// straight up, 100% up-right — a symmetric 120° span (standard-math degrees, with
// 0° = right, 90° = up). The needle pivots at the bottom-centre of the face.
const NEEDLE_START = 150 // degrees at 0%
const NEEDLE_SPAN = 120 // total sweep (150° → 30°)

/** The needle angle (standard-math degrees) for a percentage (0..100). */
export function needleAngle(pct: number): number {
  return NEEDLE_START - (clamp(pct, 0, 100) / 100) * NEEDLE_SPAN
}

/**
 * The needle tip for `pct`, pivoting at (`cx`, `cy`) with length `r`. Y grows
 * DOWN in SVG, so the sine term is subtracted. Used for both the needle line and
 * the scale ticks (call with different radii).
 */
export function needlePoint(
  pct: number,
  cx: number,
  cy: number,
  r: number
): { x: number; y: number } {
  const t = (needleAngle(pct) * Math.PI) / 180
  return { x: cx + r * Math.cos(t), y: cy - r * Math.sin(t) }
}

/**
 * The rotary-KNOB pointer rotation (CSS degrees, clockwise) for a percentage: a
 * real pot turns ~270°, so 0% = −135°, 50% = 0° (up), 100% = +135°.
 */
export function knobRotation(pct: number): number {
  return -135 + (clamp(pct, 0, 100) / 100) * 270
}
