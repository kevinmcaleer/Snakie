/**
 * Analytical planar solvers (issue #538): the exact law-of-cosines 2-bone
 * solution (both elbow configurations), plus the trivial 1-bone "aim" case.
 *
 * Algorithm (mirrored by `snakie_ik.py`, #539):
 *   d  = |target|
 *   cos(t2) = (d^2 - L1^2 - L2^2) / (2 L1 L2)      (clamped into [-1, 1])
 *   t2 = +/- acos(...)                              (elbow up / elbow down)
 *   t1 = atan2(ty, tx) - atan2(L2 sin t2, L1 + L2 cos t2)
 *
 * Candidate selection: the "+acos" candidate is A, "-acos" is B.
 *   1. If exactly one candidate satisfies the joint limits, take it.
 *   2. If both do, take the one closest to the current pose (tie -> A).
 *   3. If neither does, clamp both into the limits and take the one whose
 *      forward-kinematics error is smaller (tie -> closest to current,
 *      then A).
 * Status: `reached` when the final error <= tolerance; otherwise
 * `out_of_reach` when d lies outside the reachable annulus
 * [|L1 - L2|, L1 + L2] (this wins over limit trouble), else
 * `blocked_by_limits`.
 */
import {
  clamp,
  clampAngles,
  distance,
  forwardKinematics,
  poseDistance,
  REACH_EPS,
  withinLimits,
  wrapToPi
} from './common'
import type { IkChain, IkResult, IkStatus, Vec2 } from './types'

interface Candidate {
  angles: number[]
  error: number
  position: Vec2
  free: boolean
}

function makeCandidate(chain: IkChain, raw: number[], target: Vec2): Candidate {
  const wrapped = raw.map(wrapToPi)
  const free = withinLimits(chain, wrapped)
  const angles = clampAngles(chain, wrapped)
  const position = forwardKinematics(chain.boneLengths, angles)
  const error = distance(position, target)
  return { angles, error, position, free }
}

function finish(best: Candidate, tolerance: number, geometricallyReachable: boolean): IkResult {
  let status: IkStatus
  if (best.error <= tolerance) status = 'reached'
  else if (!geometricallyReachable) status = 'out_of_reach'
  else status = 'blocked_by_limits'
  return {
    status,
    angles: best.angles,
    position: best.position,
    error: best.error,
    iterations: 0
  }
}

/** 1-bone chain: aim straight at the target; reachable only on the circle. */
export function solveOneBone(
  chain: IkChain,
  target: Vec2,
  currentAngles: readonly number[],
  tolerance: number
): IkResult {
  const L = chain.boneLengths[0]
  const d = Math.hypot(target[0], target[1])
  // Aim at the target; a target at the exact origin keeps the current heading.
  const raw = [d < 1e-12 ? currentAngles[0] : Math.atan2(target[1], target[0])]
  const cand = makeCandidate(chain, raw, target)
  const reachable = Math.abs(d - L) <= tolerance + REACH_EPS
  return finish(cand, tolerance, reachable)
}

/** Exact 2-bone (two-link planar) solver — see module docs for selection. */
export function solveTwoBone(
  chain: IkChain,
  target: Vec2,
  currentAngles: readonly number[],
  tolerance: number
): IkResult {
  const [L1, L2] = chain.boneLengths
  const [tx, ty] = target
  const d = Math.hypot(tx, ty)
  const outer = L1 + L2
  const inner = Math.abs(L1 - L2)
  const geometricallyReachable = d <= outer + REACH_EPS && d >= inner - REACH_EPS

  const cosT2 = clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1)
  const t2 = Math.acos(cosT2)
  const heading = Math.atan2(ty, tx) // atan2(0,0) = 0 for a target at the base

  const candidates: Candidate[] = [t2, -t2].map((elbow) => {
    const t1 = heading - Math.atan2(L2 * Math.sin(elbow), L1 + L2 * Math.cos(elbow))
    return makeCandidate(chain, [t1, elbow], target)
  })
  const [a, b] = candidates

  let best: Candidate
  if (a.free !== b.free) {
    best = a.free ? a : b
  } else if (a.free) {
    // Both satisfy limits: prefer the pose closest to the current one.
    best =
      poseDistance(b.angles, currentAngles) < poseDistance(a.angles, currentAngles) - 1e-12
        ? b
        : a
  } else {
    // Neither satisfies limits: prefer the smaller clamped FK error, then the
    // pose closest to the current one, then A.
    if (b.error < a.error - 1e-12) best = b
    else if (a.error < b.error - 1e-12) best = a
    else
      best =
        poseDistance(b.angles, currentAngles) < poseDistance(a.angles, currentAngles) - 1e-12
          ? b
          : a
  }
  return finish(best, tolerance, geometricallyReachable)
}
