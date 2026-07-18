/**
 * ROBOT POSE LOGIC (#312, epic #309 Phase 2) — pure helpers for the pose tool:
 * extracting movable joints from a parsed URDF, converting between the URDF's
 * native units (radians / metres) and the human-facing display + persistence
 * units (degrees / millimetres, matching KRF `robot.yml`), and computing mimic
 * (`<mimic>`) follower values. Kept free of three.js / React so it's unit-tested.
 */

/** Joint types the pose tool exposes as a slider. */
export type MovableType = 'revolute' | 'continuous' | 'prismatic'

/** A saved pose (name + joint→display-value map). Mirrors KRF `NamedPose`. */
export interface NamedPoseLike {
  name: string
  values: Record<string, number>
}

/** What the sidebar needs to render + drive one joint. Angles are NATIVE. */
export interface JointMeta {
  name: string
  type: MovableType
  /** Native lower/upper limit (rad for revolute/continuous, m for prismatic). */
  lower: number
  upper: number
  /** True when this joint mimics another (driven; shown read-only). */
  isMimic: boolean
  /** For a mimic: the master joint + `value = multiplier * master + offset`. */
  master?: string
  multiplier?: number
  offset?: number
}

/** A joint as seen on a parsed `URDFRobot` (duck-typed so this stays testable). */
export interface JointLike {
  jointType: string
  limit?: { lower?: number; upper?: number }
  mimicJoints?: Array<{ name: string }>
  mimicJoint?: string | { name?: string } | null
  multiplier?: number
  offset?: number
}
export interface RobotLike {
  joints: Record<string, JointLike>
}

import type { ServoJointBinding } from '../../../shared/robot'
import { servoToJoint } from '../../../shared/krf'

/** A continuous (limitless) joint gets a ±180° slider range so it's usable. */
export const CONTINUOUS_RANGE = Math.PI

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

export function isAngular(type: MovableType): boolean {
  return type === 'revolute' || type === 'continuous'
}

/** Native (rad/m) → display (deg/mm). */
export function toDisplay(type: MovableType, native: number): number {
  return isAngular(type) ? native * RAD2DEG : native * 1000
}

/** Display (deg/mm) → native (rad/m). */
export function toNative(type: MovableType, display: number): number {
  return isAngular(type) ? display * DEG2RAD : display / 1000
}

/** The unit suffix shown next to a value. */
export function unitLabel(type: MovableType): string {
  return isAngular(type) ? '°' : 'mm'
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** The name of the joint a mimic follows, or undefined. */
function masterOf(j: JointLike): string | undefined {
  if (typeof j.mimicJoint === 'string') return j.mimicJoint || undefined
  if (j.mimicJoint && typeof j.mimicJoint === 'object') return j.mimicJoint.name || undefined
  return undefined
}

/**
 * The movable joints of a parsed URDF, in insertion order. `fixed`/`floating`/
 * `planar` joints are skipped. Mimic joints are flagged (and carry their master
 * + multiplier/offset) so the sidebar can show them read-only.
 */
export function extractJoints(robot: RobotLike): JointMeta[] {
  // A joint is driven if it names a master, or a master lists it as a mimic.
  const driven = new Set<string>()
  for (const [name, j] of Object.entries(robot.joints)) {
    if (masterOf(j)) driven.add(name)
    ;(j.mimicJoints ?? []).forEach((m) => m?.name && driven.add(m.name))
  }

  const out: JointMeta[] = []
  for (const [name, j] of Object.entries(robot.joints)) {
    const type = j.jointType as MovableType
    if (type !== 'revolute' && type !== 'continuous' && type !== 'prismatic') continue
    let lower = j.limit?.lower ?? 0
    let upper = j.limit?.upper ?? 0
    // Continuous / limitless joints: give a symmetric usable range.
    if (type === 'continuous' || !(upper > lower)) {
      lower = -CONTINUOUS_RANGE
      upper = CONTINUOUS_RANGE
    }
    const meta: JointMeta = { name, type, lower, upper, isMimic: driven.has(name) }
    if (meta.isMimic) {
      meta.master = masterOf(j)
      meta.multiplier = j.multiplier ?? 1
      meta.offset = j.offset ?? 0
    }
    out.push(meta)
  }
  return out
}

/** A mimic joint's native value from its master's native value. */
export function mimicValue(meta: JointMeta, masterNative: number): number {
  return (meta.multiplier ?? 1) * masterNative + (meta.offset ?? 0)
}

/** Normalise a pin token for comparison: drop a `GP`/`gp` prefix + whitespace,
 *  so `GP16`, `gp16` and `16` all match. */
export function normPin(pin: string): string {
  return String(pin).trim().replace(/^gp/i, '')
}

/**
 * Resolve a servo telemetry reading (pin + angle in degrees) to a NATIVE joint
 * value via the matching KRF binding (calibration + inversion in `servoToJoint`)
 * and the joint's type. Returns null when no binding or joint matches — the
 * live code-driven-robot pipe (#313).
 */
export function servoToJointNative(
  bindings: ServoJointBinding[],
  meta: JointMeta[],
  pin: string,
  servoAngle: number
): { joint: string; native: number } | null {
  const p = normPin(pin)
  const b = bindings.find((x) => normPin(x.pin) === p)
  if (!b) return null
  const m = meta.find((j) => j.name === b.joint)
  if (!m) return null
  // servoToJoint returns the joint value in the binding's units (deg / mm).
  return { joint: b.joint, native: toNative(m.type, servoToJoint(b, servoAngle)) }
}

/**
 * Capture the current live posture as a pose's stored values (#414): each
 * movable, non-mimic joint's NATIVE value converted to DISPLAY units (deg/mm)
 * and rounded to 2dp, matching KRF `NamedPose`. When `include` is given the pose
 * is PARTIAL — only those joints are written, so a face-only pose leaves the legs
 * out of `values` entirely (and recall then leaves them alone). Mimic joints are
 * never captured (they follow their master).
 */
export function capturePoseValues(
  meta: JointMeta[],
  valuesNative: Record<string, number>,
  include?: Iterable<string>
): Record<string, number> {
  const inc = include ? new Set(include) : null
  const out: Record<string, number> = {}
  for (const m of meta) {
    if (m.isMimic) continue
    if (inc && !inc.has(m.name)) continue
    out[m.name] = Number(toDisplay(m.type, valuesNative[m.name] ?? 0).toFixed(2))
  }
  return out
}

/**
 * The NATIVE target values for recalling a pose onto the model (#414): each
 * movable joint the pose lists is clamped into its effective limits; a joint the
 * pose OMITS (a partial pose) keeps its `current` value — so recalling a
 * face-only pose never disturbs the legs. Mimic joints follow their master and
 * are left out.
 */
export function poseTargetNative(
  meta: JointMeta[],
  current: Record<string, number>,
  poseValues: Record<string, number>,
  overrides: Record<string, { min?: number; max?: number }> = {}
): Record<string, number> {
  const target = { ...current }
  for (const m of meta) {
    if (m.isMimic) continue
    if (typeof poseValues[m.name] !== 'number') continue // partial: leave this joint alone
    const lim = effectiveLimit(m, overrides[m.name])
    target[m.name] = clamp(toNative(m.type, poseValues[m.name]), lim.lower, lim.upper)
  }
  return target
}

/**
 * A unique "<base> copy" name for duplicating a pose (#414) — `Wave` → `Wave
 * copy`, then `Wave copy 2`, `Wave copy 3`… — never colliding with an existing
 * pose so a duplicate can't clobber the original or another entry.
 */
export function uniquePoseName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  const first = `${base} copy`
  if (!taken.has(first)) return first
  let n = 2
  while (taken.has(`${base} copy ${n}`)) n++
  return `${base} copy ${n}`
}

/**
 * The EFFECTIVE native limits for a joint: the URDF limits, overridden by any
 * in-app min/max (stored in KRF as display units — deg/mm).
 */
export function effectiveLimit(
  meta: JointMeta,
  override?: { min?: number; max?: number }
): { lower: number; upper: number } {
  let lower = meta.lower
  let upper = meta.upper
  if (override) {
    if (typeof override.min === 'number') lower = toNative(meta.type, override.min)
    if (typeof override.max === 'number') upper = toNative(meta.type, override.max)
  }
  if (!(upper > lower)) upper = lower + 1e-4 // never a zero/negative span
  return { lower, upper }
}
