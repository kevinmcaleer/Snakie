import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { jointFromPicks } from '../src/renderer/src/components/robot-joint-frame'
import type { Vec3 } from '../src/renderer/src/components/robot-build'

/** Reconstruct the joint rotation from a URDF rpy (fixed-axis XYZ ≡ intrinsic ZYX). */
const rotOf = (rpy: Vec3): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX'))

const v = (a: Vec3): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2])
const near = (a: THREE.Vector3, b: THREE.Vector3): boolean => a.distanceTo(b) < 1e-6

describe('jointFromPicks — mate two picked faces (#354)', () => {
  const check = (pL: Vec3, pN: Vec3, cL: Vec3, cN: Vec3, off: Vec3 = [0, 0, 0]): void => {
    const { xyz, rpy } = jointFromPicks(pL, pN, cL, cN, off)
    const R = rotOf(rpy)
    // 1) the child's picked normal, rotated, faces OPPOSITE the parent's.
    const mated = v(cN).normalize().applyQuaternion(R)
    expect(near(mated, v(pN).normalize().negate())).toBe(true)
    // 2) the child's picked point, rotated + translated, lands on the parent's (+off).
    const landed = v(cL).applyQuaternion(R).add(v(xyz))
    expect(near(landed, v(pL).add(v(off)))).toBe(true)
  }

  it('mates two upward faces (needs a 180° flip)', () => {
    check([0, 0, 0], [0, 0, 1], [0, 0, 0], [0, 0, 1])
  })
  it('is identity when the child already faces the parent', () => {
    const { rpy } = jointFromPicks([0, 0, 0], [0, 0, 1], [0, 0, 0], [0, 0, -1])
    expect(rpy.map((x) => Math.round(x * 1000))).toEqual([0, 0, 0])
    check([0, 0, 0], [0, 0, 1], [0, 0, 0], [0, 0, -1])
  })
  it('mates perpendicular faces + meets offset points', () => {
    check([0.05, 0, 0.02], [1, 0, 0], [0, 0.03, 0], [0, 1, 0], [0, 0, 0.01])
  })
  it('handles an arbitrary pick', () => {
    check([0.1, -0.05, 0.2], [0.3, 0.6, 0.74], [-0.02, 0.04, 0.01], [-0.5, 0.5, 0.707])
  })
})
