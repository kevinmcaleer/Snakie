/**
 * PLANAR IK MAPPING (#540, epic #533 §5) — glue between a robot's 3-D kinematic
 * chain (URDF joints with arbitrary world axes) and the shared PLANAR solver in
 * `src/shared/ik`. Pure maths (three.js vectors only, no scene / DOM / React) so
 * the goal-gizmo logic stays unit-testable.
 *
 * ── Scope: PLANAR chains ────────────────────────────────────────────────────
 * The shared solver is planar (all bones in one XY plane, relative angles about
 * a single normal). A real arm/leg whose joints all spin about PARALLEL axes IS
 * such a planar chain — its bones sweep one plane. We map that chain onto the
 * solver like so:
 *   • The working plane's NORMAL is the (shared) joint axis; its ORIGIN is the
 *     base joint's pivot. An in-plane basis (u, v) gives 2-D coordinates.
 *   • Each joint pivot + the end effector projects to the plane; consecutive
 *     points give the planar bone lengths and current relative angles.
 *   • A joint's NATIVE angle maps to the solver's RELATIVE angle up to a sign
 *     `s = sign(axis · normal)` (a joint whose axis points the other way turns
 *     the bone clockwise). So `native = nativeCurrent + s·Δrelative`, and native
 *     joint limits map to a relative-angle window the solver clamps within.
 * `planarity` reports how far the chain departs from a single plane (0 = perfect)
 * so the caller can warn; a non-planar chain is still solved as its best planar
 * projection rather than faking full 3-D IK — that's a deliberate v1 limitation.
 */
import * as THREE from 'three'
import {
  solveIk,
  wrapToPi,
  jointPositions,
  type IkChain,
  type IkResult,
  type IkStatus,
  type JointLimit,
  type SolveOptions,
  type Vec2
} from '../../../shared/ik'
import type { Vec3 } from './robot-build'

/** One revolute/continuous joint of a chain, ordered BASE-first, world-space. */
export interface ChainJoint {
  name: string
  /** World position of the joint's rotation centre. */
  pivot: Vec3
  /** World rotation axis (need not be pre-normalised). */
  axis: Vec3
  /** The joint's current NATIVE angle (radians). */
  angle: number
  /** Native lower/upper limit (radians). */
  lower: number
  upper: number
}

/** The plane a chain works in (base pivot origin + orthonormal frame). */
export interface PlanarFrame {
  origin: Vec3
  normal: Vec3
  u: Vec3
  v: Vec3
}

/** A chain flattened onto the shared solver's planar convention. */
export interface PlanarChainMap {
  /** What `solveIk` consumes: planar bone lengths + relative-angle limits. */
  chain: IkChain
  frame: PlanarFrame
  jointNames: string[]
  /** Per joint: +1 if native +angle turns the bone CCW about `normal`, else −1. */
  signs: number[]
  /** Current relative planar angles — the solver's `currentAngles` seed. */
  currentRelative: number[]
  nativeCurrent: number[]
  nativeLower: number[]
  nativeUpper: number[]
  /** Current end-effector position, in plane coordinates. */
  effector: Vec2
  /**
   * Chain non-planarity: `max(1 − |axis·normal|)` over the joints (0 = every
   * axis parallel to the plane normal → a true planar chain; →1 = perpendicular).
   */
  planarity: number
}

const EPS = 1e-9

function v3(a: Vec3): THREE.Vector3 {
  return new THREE.Vector3(a[0], a[1], a[2])
}

/** A unit vector perpendicular to `n` (stable: avoids the near-parallel axis). */
function anyPerpendicular(n: THREE.Vector3): THREE.Vector3 {
  const helper =
    Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  return helper.cross(n).normalize()
}

/** World point → plane coordinates `[u, v]` (relative to the frame origin). */
export function worldToPlanar(p: Vec3, frame: PlanarFrame): Vec2 {
  const d = v3(p).sub(v3(frame.origin))
  return [d.dot(v3(frame.u)), d.dot(v3(frame.v))]
}

/** Plane coordinates `[u, v]` → world point. */
export function planarToWorld(uv: Vec2, frame: PlanarFrame): Vec3 {
  const o = v3(frame.origin)
  o.addScaledVector(v3(frame.u), uv[0])
  o.addScaledVector(v3(frame.v), uv[1])
  return [o.x, o.y, o.z]
}

/**
 * Map a joint's native `[lower, upper]` onto the solver's RELATIVE-angle window.
 * Returns `null` (free joint) when the native span covers a full turn, or when
 * the mapped window can't be represented inside `[-PI, PI]` — the solver treats
 * `null` as unconstrained. `cr` is the joint's current relative angle, `nc` its
 * current native angle, `s` its sign.
 */
export function relativeLimit(
  cr: number,
  nc: number,
  lower: number,
  upper: number,
  s: number
): JointLimit | null {
  if (upper - lower >= 2 * Math.PI - 1e-6) return null
  // native = nc + s·(rel − cr)  ⇒  rel = cr + s·(native − nc)
  const a = cr + s * (lower - nc)
  const b = cr + s * (upper - nc)
  let lo = Math.min(a, b)
  let hi = Math.max(a, b)
  if (hi - lo >= 2 * Math.PI - 1e-6) return null
  // The solver requires −PI ≤ min ≤ max ≤ PI; clamp the window into range. A
  // window fully outside collapses — fall back to free rather than an empty span.
  lo = Math.max(-Math.PI, Math.min(Math.PI, lo))
  hi = Math.max(-Math.PI, Math.min(Math.PI, hi))
  if (!(hi > lo)) return null
  return [lo, hi]
}

/**
 * Flatten a base-first chain of joints (+ its world end-effector point) onto the
 * shared planar solver. Returns `null` for an empty chain. Bone lengths are the
 * planar distances between consecutive pivots (and pivot→effector for the last);
 * a degenerate zero-length bone is floored to a tiny positive so the solver's
 * `invalid_bone_length` guard never trips.
 */
export function planarizeChain(joints: ChainJoint[], effector: Vec3): PlanarChainMap | null {
  const n = joints.length
  if (n === 0) return null

  // Plane normal: the base joint's axis. Track each joint's turn direction and
  // how far its axis departs from that normal (the planarity metric).
  const normal = v3(joints[0].axis)
  if (normal.lengthSq() < EPS) normal.set(0, 0, 1)
  normal.normalize()
  const signs: number[] = []
  let planarity = 0
  for (const j of joints) {
    const ax = v3(j.axis)
    if (ax.lengthSq() < EPS) {
      signs.push(1)
      continue
    }
    ax.normalize()
    const dot = ax.dot(normal)
    signs.push(dot < 0 ? -1 : 1)
    planarity = Math.max(planarity, 1 - Math.abs(dot))
  }

  const u = anyPerpendicular(normal)
  const vv = normal.clone().cross(u).normalize()
  const origin = v3(joints[0].pivot)
  const frame: PlanarFrame = {
    origin: [origin.x, origin.y, origin.z],
    normal: [normal.x, normal.y, normal.z],
    u: [u.x, u.y, u.z],
    v: [vv.x, vv.y, vv.z]
  }

  // Project pivots + the effector into plane coordinates: P0…P(n-1), P(n)=eff.
  const pts2d: Vec2[] = joints.map((j) => worldToPlanar(j.pivot, frame))
  pts2d.push(worldToPlanar(effector, frame))

  const boneLengths: number[] = []
  const headings: number[] = []
  for (let i = 0; i < n; i++) {
    const dx = pts2d[i + 1][0] - pts2d[i][0]
    const dy = pts2d[i + 1][1] - pts2d[i][1]
    const len = Math.hypot(dx, dy)
    boneLengths.push(len < EPS ? EPS : len)
    headings.push(Math.atan2(dy, dx))
  }

  const currentRelative: number[] = []
  for (let i = 0; i < n; i++) {
    currentRelative.push(i === 0 ? wrapToPi(headings[0]) : wrapToPi(headings[i] - headings[i - 1]))
  }

  const nativeCurrent = joints.map((j) => j.angle)
  const nativeLower = joints.map((j) => j.lower)
  const nativeUpper = joints.map((j) => j.upper)
  const limits = joints.map((_, i) =>
    relativeLimit(currentRelative[i], nativeCurrent[i], nativeLower[i], nativeUpper[i], signs[i])
  )

  return {
    chain: { boneLengths, limits },
    frame,
    jointNames: joints.map((j) => j.name),
    signs,
    currentRelative,
    nativeCurrent,
    nativeLower,
    nativeUpper,
    effector: pts2d[n],
    planarity
  }
}

/** The result of solving a chain toward a world target. */
export interface ChainSolveResult {
  status: IkStatus
  /** Native joint angles (radians), one per chain joint, clamped to limits. */
  nativeAngles: number[]
  /** Native angles keyed by joint name — ready for `setJointValue` / posing. */
  nativeByJoint: Record<string, number>
  /** The solver's achieved effector, back in world space (planar projection). */
  effectorWorld: Vec3
  /** The target, in plane coordinates. */
  targetPlanar: Vec2
  /** Distance (plane units) from the achieved effector to the target. */
  error: number
  planarity: number
  raw: IkResult
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Convert the solver's RELATIVE angles back to each joint's NATIVE angle,
 * clamped to the native limits. `Δrelative` is wrapped so a joint never jumps a
 * full turn between frames.
 */
export function nativeFromSolved(map: PlanarChainMap, solvedRelative: readonly number[]): number[] {
  return map.jointNames.map((_, i) => {
    const delta = wrapToPi(solvedRelative[i] - map.currentRelative[i])
    const native = map.nativeCurrent[i] + map.signs[i] * delta
    return clamp(native, map.nativeLower[i], map.nativeUpper[i])
  })
}

/**
 * Solve a planarized chain so its end effector reaches `targetWorld`, returning
 * the native joint angles to apply (plus the solver's status for UI feedback).
 * The target is projected onto the chain's working plane first, so a goal off
 * the plane is solved by its in-plane shadow.
 */
export function solveChainTarget(
  map: PlanarChainMap,
  targetWorld: Vec3,
  options: SolveOptions = {}
): ChainSolveResult {
  const targetPlanar = worldToPlanar(targetWorld, map.frame)
  const raw = solveIk(map.chain, targetPlanar, {
    currentAngles: map.currentRelative,
    ...options
  })
  const nativeAngles = nativeFromSolved(map, raw.angles)
  const nativeByJoint: Record<string, number> = {}
  map.jointNames.forEach((name, i) => (nativeByJoint[name] = nativeAngles[i]))
  return {
    status: raw.status,
    nativeAngles,
    nativeByJoint,
    effectorWorld: planarToWorld(raw.position, map.frame),
    targetPlanar,
    error: raw.error,
    planarity: map.planarity,
    raw
  }
}

/** The outer (fully-stretched) and inner (fold-limited) reach of a planar chain. */
export function reachBounds(boneLengths: readonly number[]): { outer: number; inner: number } {
  let total = 0
  let longest = 0
  for (const l of boneLengths) {
    total += l
    if (l > longest) longest = l
  }
  return { outer: total, inner: Math.max(0, longest - (total - longest)) }
}

export interface WorkspaceSample {
  /** Reachable end-effector points (plane coordinates), limit-shaped. */
  points: Vec2[]
  outer: number
  inner: number
}

/**
 * Sample a chain's REACHABLE workspace by sweeping each joint across its limits
 * and recording the forward-kinematics effector — so the point cloud is shaped
 * by the joint limits (why a goal is/ isn't reachable), not just an annulus.
 * The per-joint step count is chosen so the total stays under `maxSamples`; a
 * limitless joint sweeps `[-PI, PI]`.
 */
export function sampleWorkspace(chain: IkChain, maxSamples = 1200): WorkspaceSample {
  const n = chain.boneLengths.length
  const { outer, inner } = reachBounds(chain.boneLengths)
  if (n === 0) return { points: [], outer, inner }

  // Distribute the sample budget across joints (≥2 steps each).
  const steps = Math.max(2, Math.floor(Math.pow(maxSamples, 1 / n)))
  const ranges = chain.boneLengths.map((_, i) => {
    const lim = chain.limits?.[i] ?? null
    return lim ? { lo: lim[0], hi: lim[1] } : { lo: -Math.PI, hi: Math.PI }
  })

  const points: Vec2[] = []
  const angles = new Array<number>(n).fill(0)
  const sweep = (i: number): void => {
    if (i === n) {
      const pts = jointPositions(chain.boneLengths, angles)
      points.push(pts[pts.length - 1])
      return
    }
    const { lo, hi } = ranges[i]
    for (let s = 0; s < steps; s++) {
      angles[i] = steps === 1 ? lo : lo + ((hi - lo) * s) / (steps - 1)
      sweep(i + 1)
    }
  }
  sweep(0)
  return { points, outer, inner }
}
