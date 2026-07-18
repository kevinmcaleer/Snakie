/**
 * Shared IK solver — pure math helpers used by both the analytical 2-bone
 * solver and FABRIK (issue #538). No external dependencies.
 */
import type { IkChain, JointLimit, Vec2 } from './types'

/** Geometric slack used for reach classification (NOT the solve tolerance). */
export const REACH_EPS = 1e-9
/** Slack used when testing whether an angle sits within its limit. */
export const LIMIT_EPS = 1e-9

/** Normalise an angle to the half-open interval [-PI, PI). */
export function wrapToPi(a: number): number {
  const twoPi = 2 * Math.PI
  let r = (a + Math.PI) % twoPi
  if (r < 0) r += twoPi
  return r - Math.PI
}

/** Clamp `x` into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Resolve the effective [min, max] limit for joint i (full range if free). */
export function limitOf(chain: IkChain, i: number): JointLimit {
  const lim = chain.limits?.[i]
  return lim ?? [-Math.PI, Math.PI]
}

/** Wrap then clamp every angle into its joint limit. Returns a new array. */
export function clampAngles(chain: IkChain, angles: readonly number[]): number[] {
  return angles.map((a, i) => {
    const [lo, hi] = limitOf(chain, i)
    return clamp(wrapToPi(a), lo, hi)
  })
}

/** True when every angle already sits inside its limit (with slack). */
export function withinLimits(chain: IkChain, angles: readonly number[]): boolean {
  return angles.every((a, i) => {
    const [lo, hi] = limitOf(chain, i)
    return a >= lo - LIMIT_EPS && a <= hi + LIMIT_EPS
  })
}

/**
 * Forward kinematics: joint positions [p0 … pN] for the given relative
 * angles. p0 is the base at the origin; pN is the end effector.
 */
export function jointPositions(
  boneLengths: readonly number[],
  angles: readonly number[]
): [number, number][] {
  const pts: [number, number][] = [[0, 0]]
  let heading = 0
  let x = 0
  let y = 0
  for (let i = 0; i < boneLengths.length; i++) {
    heading += angles[i]
    x += boneLengths[i] * Math.cos(heading)
    y += boneLengths[i] * Math.sin(heading)
    pts.push([x, y])
  }
  return pts
}

/** End-effector position only. */
export function forwardKinematics(boneLengths: readonly number[], angles: readonly number[]): Vec2 {
  const pts = jointPositions(boneLengths, angles)
  return pts[pts.length - 1]
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/**
 * Convert joint positions back to relative angles (inverse of
 * `jointPositions`). Degenerate zero-length segments keep the previous
 * heading so the conversion never produces NaN.
 */
export function anglesFromPositions(points: readonly Vec2[]): number[] {
  const angles: number[] = []
  let prevHeading = 0
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0]
    const dy = points[i + 1][1] - points[i][1]
    const heading = Math.hypot(dx, dy) < 1e-12 ? prevHeading : Math.atan2(dy, dx)
    angles.push(wrapToPi(heading - prevHeading))
    prevHeading = heading
  }
  return angles
}

/** Sum of absolute wrapped differences — "distance" between two poses. */
export function poseDistance(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(wrapToPi(a[i] - b[i]))
  return sum
}

/**
 * Validate a chain + options and throw `Error` with a stable, test-vector
 * addressable message code on bad input:
 * - `invalid_chain`  — empty chain
 * - `invalid_bone_length` — zero/negative/non-finite bone length
 * - `invalid_limits` — limit list length mismatch, min > max, or outside
 *   [-PI, PI]
 */
export function validateChain(chain: IkChain, currentAngles?: readonly number[]): void {
  const n = chain.boneLengths.length
  if (n === 0) throw new Error('invalid_chain')
  for (const len of chain.boneLengths) {
    if (!Number.isFinite(len) || len <= 0) throw new Error('invalid_bone_length')
  }
  if (chain.limits != null) {
    if (chain.limits.length !== n) throw new Error('invalid_limits')
    for (const lim of chain.limits) {
      if (lim == null) continue
      const [lo, hi] = lim
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('invalid_limits')
      if (lo > hi || lo < -Math.PI - LIMIT_EPS || hi > Math.PI + LIMIT_EPS) {
        throw new Error('invalid_limits')
      }
    }
  }
  if (currentAngles != null && currentAngles.length !== n) throw new Error('invalid_angles')
}
