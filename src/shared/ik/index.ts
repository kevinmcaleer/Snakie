/**
 * Shared IK solver — public API (epic #533 §3, issue #538).
 *
 * Pure TypeScript, zero dependencies (no Three.js, no DOM, no Electron):
 * usable from the renderer (Robot View goal gizmo), the web app, tests, and
 * mirrored 1:1 by the MicroPython implementation `snakie_ik.py` (#539).
 * Both implementations are verified against the language-neutral vectors in
 * `test/fixtures/ik-vectors.json` — see `src/shared/ik/README.md`.
 *
 *   solveIk({ boneLengths: [60, 40], limits: [[-1.57, 1.57], [0, 2.6]] },
 *           [50, 30], { currentAngles: [0, 0.5] })
 *   // -> { status: 'reached', angles: [...], position: [...], error, ... }
 *
 * Dispatch: 1 bone -> analytical aim, 2 bones -> exact law-of-cosines
 * solver, 3+ bones -> FABRIK.
 */
import { validateChain } from './common'
import { solveFabrik } from './fabrik'
import { solveOneBone, solveTwoBone } from './two-bone'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_TOLERANCE } from './types'
import type { IkChain, IkResult, SolveOptions, Vec2 } from './types'

/**
 * Solve a planar chain for `target`. Throws `Error('invalid_chain' |
 * 'invalid_bone_length' | 'invalid_limits' | 'invalid_angles')` on bad
 * input; otherwise always returns a limit-respecting pose plus a status —
 * see `IkResult`.
 */
export function solveIk(chain: IkChain, target: Vec2, options: SolveOptions = {}): IkResult {
  validateChain(chain, options.currentAngles ?? undefined)
  const n = chain.boneLengths.length
  const current = options.currentAngles ?? new Array(n).fill(0)
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS

  if (n === 1) return solveOneBone(chain, target, current, tolerance)
  if (n === 2) return solveTwoBone(chain, target, current, tolerance)
  return solveFabrik(chain, target, current, tolerance, maxIterations)
}

export { solveOneBone, solveTwoBone } from './two-bone'
export { solveFabrik, totalReach } from './fabrik'
export {
  anglesFromPositions,
  clampAngles,
  forwardKinematics,
  jointPositions,
  withinLimits,
  wrapToPi
} from './common'
export type { IkChain, IkResult, IkStatus, JointLimit, SolveOptions, Vec2 } from './types'
export { DEFAULT_MAX_ITERATIONS, DEFAULT_TOLERANCE } from './types'
