/**
 * FABRIK iterative solver for planar chains of 3+ bones (issue #538).
 *
 * Forward And Backward Reaching Inverse Kinematics (Aristidou & Lasenby
 * 2011), specialised to a 2D chain with a fixed base at the origin, plus a
 * joint-limit projection step so the chain never folds through its limits.
 *
 * The solve pipeline is deterministic and mirrored step-for-step by the
 * MicroPython implementation (`snakie_ik.py`, #539):
 *
 * 0. Out-of-reach targets (|target| > total length) skip iteration: every
 *    bone is stretched straight towards the target (the classic FABRIK
 *    unreachable case), then projected onto the limits once.
 * 1. FABRIK passes from the (limit-clamped) current pose. One iteration:
 *    backward pass (pin effector on target, walk to base restoring bone
 *    lengths), forward pass (pin base on origin, walk back out), then limit
 *    projection: positions -> relative angles -> wrap to [-PI, PI) ->
 *    clamp -> forward kinematics. Stop at error <= tolerance.
 * 2. CCD refinement if still short: sweeping end -> base, each joint
 *    rotates the effector towards the target, clamped to its limit. FABRIK
 *    alone converges slowly near the straight-arm singularity and can pin
 *    against clamped limits; CCD covers both. Stops when a sweep no longer
 *    improves the error.
 * 3. Analytic two-group fallback: for each split k the chain is treated as
 *    a 2-bone arm with straight segments A = l[0..k-1], B = l[k..n-1] and
 *    solved exactly (both elbow signs, splits in ascending k, elbow + then
 *    elbow -); the first clamped candidate that reaches wins. Exact at the
 *    reach boundary where iteration converges slowly.
 * 4. Perturbed-seed retry: phases 1-2 re-run once from the current pose
 *    bent by +/-0.5 rad on alternating joints (clamped) — this escapes
 *    singular straight-line seeds (e.g. target at the base). The best
 *    result seen anywhere wins.
 *
 * Status: `reached` when the final error <= tolerance; otherwise
 * `out_of_reach` when the target is beyond the total bone length, else
 * `blocked_by_limits` (the target is geometrically reachable but the
 * solver could not get there within the limits).
 */
import {
  anglesFromPositions,
  clamp,
  clampAngles,
  distance,
  jointPositions,
  limitOf,
  REACH_EPS,
  wrapToPi
} from './common'
import type { IkChain, IkResult, Vec2 } from './types'

interface Attempt {
  angles: number[]
  position: Vec2
  error: number
  iterations: number
}

/** Move from `from` towards `to`, landing exactly `length` away from `to`. */
function place(to: Vec2, from: Vec2, length: number): [number, number] {
  const dx = from[0] - to[0]
  const dy = from[1] - to[1]
  const r = Math.hypot(dx, dy)
  if (r < 1e-12) return [to[0] + length, to[1]] // degenerate: pick +X
  const s = length / r
  return [to[0] + dx * s, to[1] + dy * s]
}

/** Project joint positions onto the joint limits; returns angles+positions. */
function projectToLimits(
  chain: IkChain,
  points: readonly Vec2[]
): { angles: number[]; points: [number, number][] } {
  const angles = clampAngles(chain, anglesFromPositions(points))
  return { angles, points: jointPositions(chain.boneLengths, angles) }
}

/** Phases 1-2: FABRIK iterations then CCD refinement, from `seed` angles. */
function runPasses(
  chain: IkChain,
  target: Vec2,
  seed: readonly number[],
  tolerance: number,
  maxIterations: number
): Attempt {
  const lengths = chain.boneLengths
  const n = lengths.length
  let angles = clampAngles(chain, seed)
  let points = jointPositions(lengths, angles)
  let error = distance(points[n], target)
  let iterations = 0

  // Phase 1 — FABRIK backward/forward passes with limit projection.
  while (error > tolerance && iterations < maxIterations) {
    iterations++
    const back: [number, number][] = new Array(n + 1)
    back[n] = [target[0], target[1]]
    for (let i = n - 1; i >= 0; i--) back[i] = place(back[i + 1], points[i], lengths[i])
    const fwd: [number, number][] = new Array(n + 1)
    fwd[0] = [0, 0]
    for (let i = 0; i < n; i++) fwd[i + 1] = place(fwd[i], back[i + 1], lengths[i])
    ;({ angles, points } = projectToLimits(chain, fwd))
    error = distance(points[n], target)
  }

  // Phase 2 — CCD refinement (helps near-boundary + limit-pinned poses).
  let sweeps = 0
  while (error > tolerance && sweeps < maxIterations) {
    sweeps++
    for (let j = n - 1; j >= 0; j--) {
      const pivot = points[j]
      const eff = points[n]
      const toEff = Math.hypot(eff[0] - pivot[0], eff[1] - pivot[1])
      const toTarget = Math.hypot(target[0] - pivot[0], target[1] - pivot[1])
      if (toEff < 1e-12 || toTarget < 1e-12) continue // undefined rotation
      const delta = wrapToPi(
        Math.atan2(target[1] - pivot[1], target[0] - pivot[0]) -
          Math.atan2(eff[1] - pivot[1], eff[0] - pivot[0])
      )
      const [lo, hi] = limitOf(chain, j)
      angles[j] = clamp(wrapToPi(angles[j] + delta), lo, hi)
      points = jointPositions(lengths, angles)
    }
    const newError = distance(points[n], target)
    const improved = newError < error - 1e-15
    error = newError
    if (!improved) break // stalled — local minimum (or done)
  }

  return { angles, position: points[n], error, iterations: iterations + sweeps }
}

/**
 * Phase 3 — exact two-group reduction: straight segment A (first k bones)
 * and straight segment B (the rest) solved as a 2-bone arm. Returns the
 * first clamped candidate whose FK error is <= tolerance, else the best
 * candidate found (or null when no split admits a triangle).
 */
function twoGroupCandidate(chain: IkChain, target: Vec2, tolerance: number): Attempt | null {
  const lengths = chain.boneLengths
  const n = lengths.length
  const d = Math.hypot(target[0], target[1])
  const heading = Math.atan2(target[1], target[0])
  let best: Attempt | null = null
  for (let k = 1; k < n; k++) {
    let A = 0
    for (let i = 0; i < k; i++) A += lengths[i]
    let B = 0
    for (let i = k; i < n; i++) B += lengths[i]
    if (d > A + B + REACH_EPS || d < Math.abs(A - B) - REACH_EPS) continue
    const cosT2 = clamp((d * d - A * A - B * B) / (2 * A * B), -1, 1)
    const t2 = Math.acos(cosT2)
    for (const elbow of [t2, -t2]) {
      const t1 = heading - Math.atan2(B * Math.sin(elbow), A + B * Math.cos(elbow))
      const raw = new Array<number>(n).fill(0)
      raw[0] = t1
      raw[k] = elbow
      const angles = clampAngles(chain, raw)
      const points = jointPositions(lengths, angles)
      const error = distance(points[n], target)
      const attempt: Attempt = { angles, position: points[n], error, iterations: 0 }
      if (error <= tolerance) return attempt
      if (best === null || error < best.error) best = attempt
    }
  }
  return best
}

export function solveFabrik(
  chain: IkChain,
  target: Vec2,
  currentAngles: readonly number[],
  tolerance: number,
  maxIterations: number
): IkResult {
  const lengths = chain.boneLengths
  const n = lengths.length
  const totalLength = lengths.reduce((s, l) => s + l, 0)
  const d = Math.hypot(target[0], target[1])

  if (d > totalLength + REACH_EPS) {
    // Phase 0 — unreachable: stretch every bone straight towards the target,
    // then project onto the limits — the best-effort "point at it" pose.
    const stretched: [number, number][] = [[0, 0]]
    for (let i = 0; i < n; i++) {
      const p = stretched[i]
      const r = Math.hypot(target[0] - p[0], target[1] - p[1])
      const s = r < 1e-12 ? 0 : lengths[i] / r
      stretched.push([p[0] + (target[0] - p[0]) * s, p[1] + (target[1] - p[1]) * s])
    }
    const { angles, points } = projectToLimits(chain, stretched)
    const position = points[n]
    return {
      status: 'out_of_reach',
      angles,
      position,
      error: distance(position, target),
      iterations: 0
    }
  }

  // Phases 1-2 from the current pose.
  let best = runPasses(chain, target, currentAngles, tolerance, maxIterations)

  // Phase 3 — analytic two-group fallback.
  if (best.error > tolerance) {
    const cand = twoGroupCandidate(chain, target, tolerance)
    if (cand !== null && cand.error < best.error) {
      best = { ...cand, iterations: best.iterations }
    }
  }

  // Phase 4 — retry from a deterministic bent seed (escapes singular seeds).
  if (best.error > tolerance) {
    const bentSeed = currentAngles.map((a, i) => wrapToPi(a + (i % 2 === 0 ? 0.5 : -0.5)))
    const retry = runPasses(chain, target, bentSeed, tolerance, maxIterations)
    if (retry.error < best.error) {
      best = { ...retry, iterations: best.iterations + retry.iterations }
    }
  }

  return {
    status: best.error <= tolerance ? 'reached' : 'blocked_by_limits',
    angles: best.angles,
    position: best.position,
    error: best.error,
    iterations: best.iterations
  }
}

/** Total reach of a chain (sum of bone lengths). */
export function totalReach(boneLengths: readonly number[]): number {
  return boneLengths.reduce((s, l) => s + l, 0)
}
