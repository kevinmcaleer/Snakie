/**
 * BAROMETER / ENV instrument logic (#216) — pure helpers for the antique
 * aneroid-barometer dial: pressure→needle-angle mapping over a classic 270°
 * sweep, tip geometry, and the weather legend an old barometer prints on its
 * face. DOM-free and unit-tested.
 *
 * Scale: 950…1050 hPa across 270°, needle straight DOWN-LEFT (−135° from 12
 * o'clock) at 950 and DOWN-RIGHT (+135°) at 1050 — so 1000 hPa points straight
 * up, like the CHANGE mark on a hallway barometer.
 */

export const PRESS_MIN = 950
export const PRESS_MAX = 1050

/** The dial sweep in degrees (a classic three-quarter circle). */
export const SWEEP_DEG = 270

/** Clamp a pressure to the dial's printed range. Non-finite → the minimum. */
export function clampPressure(hPa: number): number {
  if (!Number.isFinite(hPa)) return PRESS_MIN
  return Math.min(PRESS_MAX, Math.max(PRESS_MIN, hPa))
}

/**
 * Needle angle for a pressure, in degrees CLOCKWISE from 12 o'clock:
 * −135° at 950 hPa … 0° at 1000 … +135° at 1050. Input clamped.
 */
export function pressureAngle(hPa: number): number {
  const f = (clampPressure(hPa) - PRESS_MIN) / (PRESS_MAX - PRESS_MIN)
  return -SWEEP_DEG / 2 + f * SWEEP_DEG
}

/** The point at `angleDeg` (clockwise from 12 o'clock) and radius `r` from (cx, cy). */
export function dialPoint(
  angleDeg: number,
  cx: number,
  cy: number,
  r: number
): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

/** The face legend under the needle — what an antique barometer prints. */
export function weatherWord(hPa: number): 'RAIN' | 'CHANGE' | 'FAIR' {
  const p = clampPressure(hPa)
  if (p < 985) return 'RAIN'
  if (p < 1015) return 'CHANGE'
  return 'FAIR'
}

/* -------------------------------------------------------------------------- *
 * Thermometer — a mercury-in-glass column beside the barometer.
 * -------------------------------------------------------------------------- */

/** The thermometer's printed range in °C (a household indoor/outdoor scale). */
export const TEMP_MIN = -10
export const TEMP_MAX = 50

/** Clamp a temperature to the tube's printed range. Non-finite → the minimum. */
export function clampTemp(c: number): number {
  if (!Number.isFinite(c)) return TEMP_MIN
  return Math.min(TEMP_MAX, Math.max(TEMP_MIN, c))
}

/**
 * How far the column has risen, 0…1: 0 at TEMP_MIN (just the bulb) up to 1 at
 * TEMP_MAX (a full tube). Input clamped.
 */
export function tempFraction(c: number): number {
  return (clampTemp(c) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)
}

/* -------------------------------------------------------------------------- *
 * Hygrometer — a small humidity dial with blue (dry) / red (damp) extremes.
 * -------------------------------------------------------------------------- */

export const HUM_MIN = 0
export const HUM_MAX = 100

/** Where the blue "dry" band ends / the red "damp" band begins (% RH). */
export const HUM_DRY = 30
export const HUM_DAMP = 70

/** Clamp a relative humidity to 0…100 %. Non-finite → 0. */
export function clampHumidity(h: number): number {
  if (!Number.isFinite(h)) return HUM_MIN
  return Math.min(HUM_MAX, Math.max(HUM_MIN, h))
}

/**
 * Needle angle for a humidity, clockwise from 12 o'clock over the same 270°
 * sweep as the barometer: −135° at 0 % … +135° at 100 %. Input clamped.
 */
export function humidityAngle(h: number): number {
  const f = clampHumidity(h) / HUM_MAX
  return -SWEEP_DEG / 2 + f * SWEEP_DEG
}

/** The hygrometer legend: DRY below 30 %, DAMP above 70 %, else NORMAL. */
export function humidityWord(h: number): 'DRY' | 'NORMAL' | 'DAMP' {
  const v = clampHumidity(h)
  if (v < HUM_DRY) return 'DRY'
  if (v > HUM_DAMP) return 'DAMP'
  return 'NORMAL'
}

/**
 * SVG arc path between two angles (clockwise from 12 o'clock) at radius `r`
 * about (cx, cy) — used to paint the coloured humidity zones.
 */
export function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const p1 = dialPoint(startDeg, cx, cy, r)
  const p2 = dialPoint(endDeg, cx, cy, r)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  const sweep = endDeg >= startDeg ? 1 : 0
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
}
