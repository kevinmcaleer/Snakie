import { describe, it, expect } from 'vitest'
import { solveCCD, type IkJoint } from '../src/renderer/src/components/robot-ik'

// A 2-link planar arm in the XY plane, both joints rotating about +Z.
// base joint A at origin → link1 (len 1) → elbow joint B at [1,0,0] → link2 (len 1)
// → effector at [2,0,0]. CCD order is NEAREST-to-effector first, so joints = [B, A].
const chain = (limit = Math.PI): IkJoint[] => [
  { pivot: [1, 0, 0], axis: [0, 0, 1], angle: 0, lower: -limit, upper: limit }, // elbow (near)
  { pivot: [0, 0, 0], axis: [0, 0, 1], angle: 0, lower: -limit, upper: limit } //  base (far)
]
const EFFECTOR: [number, number, number] = [2, 0, 0]

// Planar forward kinematics for THIS chain: angles = [thetaB (elbow), thetaA (base)].
function effOf(angles: number[]): { x: number; y: number } {
  const b = angles[0]
  const a = angles[1]
  return {
    x: Math.cos(a) + Math.cos(a + b),
    y: Math.sin(a) + Math.sin(a + b)
  }
}

describe('solveCCD — inverse kinematics (#410)', () => {
  it('reaches a reachable target (effector lands on the target)', () => {
    const target: [number, number, number] = [1, 1, 0] // |t| = √2 < reach 2
    const angles = solveCCD(chain(), EFFECTOR, target, { iterations: 30 })
    const e = effOf(angles)
    expect(e.x).toBeCloseTo(1, 2)
    expect(e.y).toBeCloseTo(1, 2)
  })

  it('reaches a second reachable target', () => {
    const target: [number, number, number] = [0.4, -1.3, 0]
    const angles = solveCCD(chain(), EFFECTOR, target, { iterations: 40 })
    const e = effOf(angles)
    expect(e.x).toBeCloseTo(0.4, 1)
    expect(e.y).toBeCloseTo(-1.3, 1)
  })

  it('leaves a target it can already touch (target == effector) essentially unchanged', () => {
    const angles = solveCCD(chain(), EFFECTOR, EFFECTOR, { iterations: 10 })
    expect(Math.abs(angles[0])).toBeLessThan(1e-3)
    expect(Math.abs(angles[1])).toBeLessThan(1e-3)
  })

  it('respects joint limits on an UNREACHABLE target (clamps, best limited reach)', () => {
    const lim = 0.2 // radians — a very restricted arm
    const target: [number, number, number] = [0, 5, 0] // far out of reach, straight up
    const angles = solveCCD(chain(lim), EFFECTOR, target, { iterations: 40 })
    // Every returned angle stays within its limit.
    for (const a of angles) {
      expect(a).toBeGreaterThanOrEqual(-lim - 1e-9)
      expect(a).toBeLessThanOrEqual(lim + 1e-9)
    }
    // And it does NOT teleport to the target — the effector stays within the arm's reach.
    const e = effOf(angles)
    expect(Math.hypot(e.x, e.y)).toBeLessThanOrEqual(2 + 1e-6)
    expect(e.y).toBeLessThan(5) // nowhere near the unreachable target
  })

  it('honours an asymmetric limit on the base joint', () => {
    // Base joint capped at +0.3 rad; a target that wants a big positive base turn.
    const joints: IkJoint[] = [
      { pivot: [1, 0, 0], axis: [0, 0, 1], angle: 0, lower: -Math.PI, upper: Math.PI },
      { pivot: [0, 0, 0], axis: [0, 0, 1], angle: 0, lower: -0.3, upper: 0.3 }
    ]
    const angles = solveCCD(joints, EFFECTOR, [0, 2, 0], { iterations: 40 })
    expect(angles[1]).toBeLessThanOrEqual(0.3 + 1e-9)
    expect(angles[1]).toBeGreaterThanOrEqual(-0.3 - 1e-9)
  })
})
