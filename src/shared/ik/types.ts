/**
 * Shared IK solver — types (epic #533 §3, issue #538).
 *
 * Everything here is PURE data: no Three.js, no DOM, no Electron. The same
 * conventions are mirrored by the MicroPython implementation (`snakie_ik.py`,
 * #539) and by the language-neutral test vectors in
 * `test/fixtures/ik-vectors.json` — see `src/shared/ik/README.md` for the
 * full contract before changing anything.
 *
 * Conventions (identical in both implementations):
 * - Planar chains in the XY plane, base joint pinned at the origin.
 * - `angles[i]` is the RELATIVE angle (radians) of joint i: the absolute
 *   heading of bone i is `angles[0] + … + angles[i]`; heading 0 points +X,
 *   positive angles turn counter-clockwise.
 * - Angles are normalised to the half-open interval [-PI, PI).
 * - Joint limits are `[min, max]` on the relative angle, with
 *   `-PI <= min <= max <= PI`. A missing/null limit means the full range.
 */

/** Solver outcome. */
export type IkStatus =
  /** End effector landed within `tolerance` of the target. */
  | 'reached'
  /**
   * The target is geometrically unreachable regardless of joint limits:
   * farther than the total bone length, or (2-bone chains) inside the inner
   * dead-zone annulus `|L1 - L2|`. The returned angles are the best-effort
   * pose aiming at the target, clamped to the limits.
   */
  | 'out_of_reach'
  /**
   * The target is geometrically reachable, but the joint limits prevent the
   * chain from reaching it. The returned angles are the best clamped pose
   * the solver found.
   */
  | 'blocked_by_limits'

/** Inclusive joint limit on a relative angle, radians, within [-PI, PI]. */
export type JointLimit = readonly [min: number, max: number]

/** A planar 2D point/vector. */
export type Vec2 = readonly [x: number, y: number]

/** A kinematic chain: N bones hinged at N joints (joint i precedes bone i). */
export interface IkChain {
  /** Bone lengths, all strictly positive. `boneLengths.length` is N >= 1. */
  boneLengths: readonly number[]
  /**
   * Per-joint limits (same length as `boneLengths`), or omitted/null for an
   * unconstrained chain. Individual entries may also be null (free joint).
   */
  limits?: readonly (JointLimit | null)[] | null
}

export interface SolveOptions {
  /**
   * The chain's current relative joint angles. Used to pick between the two
   * analytical elbow configurations (closest wins) and to seed FABRIK.
   * Defaults to all zeros.
   */
  currentAngles?: readonly number[]
  /** Position tolerance for declaring `reached`. Default 1e-4. */
  tolerance?: number
  /** FABRIK iteration cap (ignored by the analytical solver). Default 64. */
  maxIterations?: number
}

export interface IkResult {
  status: IkStatus
  /** Relative joint angles (radians, in [-PI, PI)), always within limits. */
  angles: number[]
  /** End-effector position produced by `angles` (forward kinematics). */
  position: Vec2
  /** Distance from `position` to the target. `<= tolerance` iff `reached`. */
  error: number
  /** Iterations used (0 for the analytical 1/2-bone paths). */
  iterations: number
}

export const DEFAULT_TOLERANCE = 1e-4
export const DEFAULT_MAX_ITERATIONS = 64
