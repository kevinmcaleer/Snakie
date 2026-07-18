/**
 * JOINT FRAME FROM TWO PICKS (#354) — compute a joint's origin (xyz + rpy) so the
 * child block's picked FACE mates against the parent's: the child is rotated so
 * its picked normal is anti-parallel to the parent's (the faces meet flush) and
 * its picked point lands on the parent's picked point (+ an optional offset).
 *
 * All inputs are in the respective link's LOCAL frame (parent point/normal in the
 * parent frame, child point/normal in the child frame). The returned rpy is in the
 * URDF convention (fixed-axis roll-pitch-yaw = intrinsic Z·Y·X), so it round-trips
 * through a `<joint><origin rpy>`.
 */
import * as THREE from 'three'
import type { Vec3 } from './robot-build'

export function jointFromPicks(
  parentLocal: Vec3,
  parentNormal: Vec3,
  childLocal: Vec3,
  childNormal: Vec3,
  offset: Vec3 = [0, 0, 0],
  /** Extra spin (degrees) of the child ABOUT the mating normal — the shared axis
   *  through the joint. Keeps the faces flush; just rolls the child around it. */
  angleDeg = 0
): { xyz: Vec3; rpy: Vec3 } {
  const pn = new THREE.Vector3(parentNormal[0], parentNormal[1], parentNormal[2]).normalize()
  const cn = new THREE.Vector3(childNormal[0], childNormal[1], childNormal[2]).normalize()
  // Rotate the child so its picked normal faces OPPOSITE the parent's (flush mate).
  const q = new THREE.Quaternion().setFromUnitVectors(cn, pn.clone().negate())
  // Then roll it about the shared normal (through the joint) by `angleDeg`.
  if (angleDeg) {
    const spin = new THREE.Quaternion().setFromAxisAngle(pn, (angleDeg * Math.PI) / 180)
    q.premultiply(spin)
  }
  // origin so the rotated child point lands on the parent point (+ offset):
  //   origin + R·childLocal = parentLocal + offset
  const rc = new THREE.Vector3(childLocal[0], childLocal[1], childLocal[2]).applyQuaternion(q)
  const xyz: Vec3 = [
    parentLocal[0] - rc.x + offset[0],
    parentLocal[1] - rc.y + offset[1],
    parentLocal[2] - rc.z + offset[2]
  ]
  // URDF rpy is fixed-axis XYZ ≡ intrinsic ZYX; three's Euler order 'ZYX' matches.
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX')
  return { xyz, rpy: [e.x, e.y, e.z] }
}
