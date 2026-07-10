/**
 * INVERSE KINEMATICS — Cyclic Coordinate Descent (#410). Pure three.js math (no
 * scene/DOM) so it's cheap to unit-test. The Robot View's Grab tool snapshots the
 * live world pivot + axis of each movable joint on the base→grabbed-link chain and
 * calls `solveCCD` every pointer-move to re-pose the chain so the grabbed point
 * follows the cursor. CCD is angle-native: it works directly with each joint's
 * arbitrary 3-D axis and its `[lower, upper]` limits, which map 1:1 onto URDF
 * revolute/continuous joints and their `effectiveLimit`.
 */
import * as THREE from 'three'
import type { Vec3 } from './robot-build'

/** One participating joint, in WORLD space at the moment of the solve. */
export interface IkJoint {
  /** World position of the joint's rotation centre. */
  pivot: Vec3
  /** World rotation axis (need not be pre-normalised). */
  axis: Vec3
  /** The joint's current angle (native radians). */
  angle: number
  /** Native lower/upper limit (radians). */
  lower: number
  upper: number
}

export interface CcdOptions {
  /** Max full sweeps over the chain per call (a small fixed budget for live drag). */
  iterations?: number
  /** Stop early once the effector is within this many metres of the target. */
  tolerance?: number
}

function rotatePointAbout(p: THREE.Vector3, pivot: THREE.Vector3, q: THREE.Quaternion): void {
  p.sub(pivot).applyQuaternion(q).add(pivot)
}

/**
 * Solve the chain so `effector` reaches `target`, returning each joint's new angle
 * (native radians, same order as `joints`). `joints` are ordered NEAREST-to-effector
 * first (CCD sweeps from the tip toward the base). Angles are clamped to each joint's
 * `[lower, upper]`, so an unreachable target yields the best limited reach. The inputs
 * are a world-space snapshot; the caller re-snapshots + re-solves each frame, so the
 * fixed-pivot approximation within a call is corrected as the drag proceeds.
 */
export function solveCCD(
  joints: IkJoint[],
  effector: Vec3,
  target: Vec3,
  opts: CcdOptions = {}
): number[] {
  const iterations = opts.iterations ?? 10
  const tol = opts.tolerance ?? 1e-4

  const eff = new THREE.Vector3(effector[0], effector[1], effector[2])
  const tgt = new THREE.Vector3(target[0], target[1], target[2])
  const pivots = joints.map((j) => new THREE.Vector3(j.pivot[0], j.pivot[1], j.pivot[2]))
  const axes = joints.map((j) => new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]).normalize())
  // Start each joint at its CLAMPED current angle. A continuous joint driven past its
  // ±range elsewhere (e.g. by unclamped live telemetry) must not snap on the first
  // solve — clamping here keeps every applied delta a genuine incremental move.
  const angles = joints.map((j) => Math.min(j.upper, Math.max(j.lower, j.angle)))

  const q = new THREE.Quaternion()
  const toEff = new THREE.Vector3()
  const toTgt = new THREE.Vector3()

  for (let it = 0; it < iterations; it++) {
    if (eff.distanceTo(tgt) <= tol) break
    for (let i = 0; i < joints.length; i++) {
      const pivot = pivots[i]
      const axis = axes[i]
      if (axis.lengthSq() < 1e-12) continue
      // In-plane (⟂ axis) directions from the pivot to the effector and the target.
      toEff.copy(eff).sub(pivot).projectOnPlane(axis)
      toTgt.copy(tgt).sub(pivot).projectOnPlane(axis)
      if (toEff.lengthSq() < 1e-12 || toTgt.lengthSq() < 1e-12) continue
      toEff.normalize()
      toTgt.normalize()
      // Signed angle about `axis` that rotates the effector toward the target.
      const cos = THREE.MathUtils.clamp(toEff.dot(toTgt), -1, 1)
      const sign = Math.sign(toEff.clone().cross(toTgt).dot(axis)) || 1
      const delta = Math.acos(cos) * sign
      const next = Math.min(joints[i].upper, Math.max(joints[i].lower, angles[i] + delta))
      const applied = next - angles[i]
      angles[i] = next
      if (Math.abs(applied) < 1e-9) continue
      // Rotate the effector + every joint CLOSER to it (already-processed, downstream)
      // rigidly about this joint — their world pivots AND axes move with the link.
      q.setFromAxisAngle(axis, applied)
      rotatePointAbout(eff, pivot, q)
      for (let k = 0; k < i; k++) {
        rotatePointAbout(pivots[k], pivot, q)
        axes[k].applyQuaternion(q)
      }
    }
  }
  return angles
}
