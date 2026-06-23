/**
 * ENCODER LOGIC — pure, DOM-free helpers for the rotary encoder input panel
 * (issue #117).
 * =============================================================================
 *
 * Everything the skeuomorphic encoder window needs to turn a stream of raw
 * counter values (the on-device quadrature/rotary count) into the numbers the
 * UI draws: the spin DIRECTION between two successive counts, the angular
 * ROTATION of the knob pointer from an absolute count, the VELOCITY / RPM from a
 * count delta over a time slice, and the push-button passthrough. Kept
 * React/DOM-free (mirrors {@link ./instrument-data} / {@link ./instrument-telemetry-feed})
 * so each piece is unit-testable in plain node.
 *
 * NONE of these throw: a missing / non-finite input degrades to a sensible
 * neutral result (`'idle'`, `0`, etc.) so the UI never has to guard.
 */

/** Spin direction inferred from two successive counts. */
export type EncoderDirection = 'cw' | 'ccw' | 'idle'

/** A short human label for an {@link EncoderDirection} (readout text). */
export const DIRECTION_LABEL: Record<EncoderDirection, string> = {
  cw: 'CW',
  ccw: 'CCW',
  idle: 'IDLE'
}

/**
 * Direction of travel from `prev` → `next` count.
 *
 *   - increasing count → `'cw'`  (clockwise)
 *   - decreasing count → `'ccw'` (counter-clockwise)
 *   - no change / a non-finite input → `'idle'`
 *
 * The mapping (rising = CW) matches the convention the on-device library uses
 * when it increments on a clockwise detent. Pure + total.
 */
export function direction(prev: number, next: number): EncoderDirection {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return 'idle'
  if (next > prev) return 'cw'
  if (next < prev) return 'ccw'
  return 'idle'
}

/**
 * The angular ROTATION (degrees) of the knob pointer for an absolute `count`,
 * given how many detents/counts make one full revolution (`countsPerRev`).
 *
 * Returns a continuous, unwrapped angle (it keeps growing past 360° as the
 * count climbs) so the caller can either apply it raw to a CSS `rotate()` —
 * which spins past a full turn naturally — or wrap it itself. A clockwise
 * (rising) count yields a positive (clockwise) angle. A non-positive
 * `countsPerRev` or a non-finite count degrades to `0`.
 */
export function rotationAngle(count: number, countsPerRev: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(countsPerRev) || countsPerRev <= 0) return 0
  return (count / countsPerRev) * 360
}

/**
 * The same rotation WRAPPED into the half-open range `[0, 360)` — handy when the
 * pointer should show its position within the current turn (e.g. a detent tick
 * highlight) rather than the accumulated spin. Negative counts wrap correctly
 * (e.g. an angle of `-90` → `270`).
 */
export function wrappedAngle(count: number, countsPerRev: number): number {
  const raw = rotationAngle(count, countsPerRev)
  if (raw === 0) return 0
  const mod = raw % 360
  return mod < 0 ? mod + 360 : mod
}

/**
 * Angular VELOCITY in revolutions-per-minute from a count `delta` accumulated
 * over `dtMs` milliseconds, given `countsPerRev` counts per revolution.
 *
 *   rev = delta / countsPerRev
 *   rpm = rev / (dtMs / 60000)
 *
 * The sign follows the spin (a negative delta → negative RPM, i.e. CCW). A
 * non-positive `dtMs` or `countsPerRev`, or any non-finite input, yields `0`
 * (no time elapsed ⇒ no measurable speed). Pure + total.
 */
export function rpm(delta: number, dtMs: number, countsPerRev: number): number {
  if (!Number.isFinite(delta) || !Number.isFinite(dtMs) || !Number.isFinite(countsPerRev)) return 0
  if (dtMs <= 0 || countsPerRev <= 0) return 0
  const revolutions = delta / countsPerRev
  const minutes = dtMs / 60000
  return revolutions / minutes
}

/**
 * The push-button state passthrough. The on-device telemetry's `pressed` flag is
 * optional (`undefined` when the encoder has no switch / it wasn't reported);
 * this normalises it to a strict boolean so the UI can light/clear the "click"
 * indicator without re-checking for `undefined`. Anything truthy → `true`.
 */
export function buttonState(pressed: boolean | undefined): boolean {
  return pressed === true
}

/** A short human label for a button state (readout text). */
export function buttonLabel(pressed: boolean | undefined): string {
  return buttonState(pressed) ? 'DOWN' : 'UP'
}

/**
 * A compact derived snapshot of the encoder: everything the readout strip + the
 * knob need, computed from the latest two counts, a `dtMs`, the configured
 * `countsPerRev`, and the optional button flag. Pure — slots straight into React
 * state. `prev` defaults to `count` (first sample ⇒ no movement ⇒ idle, 0 rpm).
 */
export interface EncoderSnapshot {
  /** Absolute current count. */
  count: number
  /** Signed change since the previous count. */
  delta: number
  /** Spin direction (`cw` | `ccw` | `idle`). */
  direction: EncoderDirection
  /** Unwrapped knob angle in degrees (grows past 360°). */
  angle: number
  /** Knob angle wrapped into `[0, 360)`. */
  angleWrapped: number
  /** Velocity in RPM (signed; 0 when no dt). */
  rpm: number
  /** Normalised push-button state. */
  pressed: boolean
}

/** Inputs for {@link encoderSnapshot}. */
export interface EncoderInputs {
  /** Latest absolute count. */
  count: number
  /** Previous count (defaults to `count` — no movement on the first sample). */
  prev?: number
  /** Milliseconds since the previous count (for RPM; defaults to 0 ⇒ no RPM). */
  dtMs?: number
  /** Counts per full revolution (defaults to a common 20-detent encoder). */
  countsPerRev?: number
  /** Optional push-button state. */
  pressed?: boolean
}

/** A common knurled-knob detent encoder makes 20 counts per revolution. */
export const DEFAULT_COUNTS_PER_REV = 20

/** Build the full {@link EncoderSnapshot} from the latest counts + config. */
export function encoderSnapshot({
  count,
  prev,
  dtMs = 0,
  countsPerRev = DEFAULT_COUNTS_PER_REV,
  pressed
}: EncoderInputs): EncoderSnapshot {
  const safeCount = Number.isFinite(count) ? count : 0
  const safePrev = prev === undefined || !Number.isFinite(prev) ? safeCount : prev
  const delta = safeCount - safePrev
  return {
    count: safeCount,
    delta,
    direction: direction(safePrev, safeCount),
    angle: rotationAngle(safeCount, countsPerRev),
    angleWrapped: wrappedAngle(safeCount, countsPerRev),
    rpm: rpm(delta, dtMs, countsPerRev),
    pressed: buttonState(pressed)
  }
}

/** Format an RPM value for the readout (1 dp, signed sense shown by DIR). */
export function formatRpm(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  // Show the magnitude — direction is conveyed separately by the DIR readout.
  return Math.abs(value).toFixed(1)
}

/** Format a signed delta for the readout (e.g. `+3`, `-1`, `0`). */
export function formatDelta(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value > 0) return `+${value}`
  return `${value}`
}
