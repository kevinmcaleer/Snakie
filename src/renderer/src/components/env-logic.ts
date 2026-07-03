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
