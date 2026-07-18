import { describe, it, expect } from 'vitest'
import {
  planarizeChain,
  solveChainTarget,
  nativeFromSolved,
  relativeLimit,
  sampleWorkspace,
  reachBounds,
  worldToPlanar,
  planarToWorld,
  type ChainJoint,
  type PlanarFrame
} from '../src/renderer/src/components/robot-ik-planar'
import { capturePoseValues, type JointMeta } from '../src/renderer/src/components/robot-pose'

// A 2-link planar arm in the world XY plane, both joints spinning about +Z:
//   base j0 @ origin → bone (len 1) → elbow j1 @ [1,0,0] → bone (len 1) → eff @ [2,0,0]
const twoLink = (opts: { axis1?: [number, number, number]; lim?: [number, number] } = {}): ChainJoint[] => {
  const lim = opts.lim ?? [-Math.PI, Math.PI]
  return [
    { name: 'j0', pivot: [0, 0, 0], axis: [0, 0, 1], angle: 0, lower: lim[0], upper: lim[1] },
    { name: 'j1', pivot: [1, 0, 0], axis: opts.axis1 ?? [0, 0, 1], angle: 0, lower: lim[0], upper: lim[1] }
  ]
}
const EFF: [number, number, number] = [2, 0, 0]

const near = (a: readonly number[], b: readonly number[], tol = 1e-3): void => {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol))
}

describe('planarizeChain — 3-D chain → planar solver mapping', () => {
  it('projects a +Z-axis arm onto its working plane (unit bones)', () => {
    const map = planarizeChain(twoLink(), EFF)!
    expect(map).not.toBeNull()
    near(map.chain.boneLengths, [1, 1])
    expect(map.planarity).toBeLessThan(1e-9) // every axis parallel to the normal
    expect(map.jointNames).toEqual(['j0', 'j1'])
    expect(map.signs).toEqual([1, 1])
  })

  it('flags a non-planar chain via planarity (perpendicular joint axis)', () => {
    const map = planarizeChain(twoLink({ axis1: [1, 0, 0] }), EFF)!
    expect(map.planarity).toBeGreaterThan(0.9)
  })

  it('detects a reversed joint axis as sign −1', () => {
    const map = planarizeChain(twoLink({ axis1: [0, 0, -1] }), EFF)!
    expect(map.signs).toEqual([1, -1])
  })

  it('returns null for an empty chain', () => {
    expect(planarizeChain([], EFF)).toBeNull()
  })
})

describe('solveChainTarget — live target → native angles', () => {
  it('reaches an in-workspace goal, back in world space', () => {
    const map = planarizeChain(twoLink(), EFF)!
    const res = solveChainTarget(map, [1, 1, 0])
    expect(res.status).toBe('reached')
    // The achieved effector, mapped back to world, lands on the goal.
    near(res.effectorWorld, [1, 1, 0])
    expect(res.nativeByJoint.j0).toBeTypeOf('number')
    expect(res.nativeByJoint.j1).toBeTypeOf('number')
  })

  it('reports a goal past full stretch as out_of_reach', () => {
    const map = planarizeChain(twoLink(), EFF)!
    const res = solveChainTarget(map, [5, 0, 0])
    expect(res.status).toBe('out_of_reach')
  })

  it('nativeFromSolved is the exact inverse of the native→relative mapping', () => {
    const map = planarizeChain(twoLink({ axis1: [0, 0, -1] }), EFF)!
    const res = solveChainTarget(map, [1, 0.6, 0])
    const native = nativeFromSolved(map, res.raw.angles)
    // Re-deriving relative from native must reproduce the solver's angles.
    native.forEach((nv, i) => {
      const rel = map.currentRelative[i] + map.signs[i] * (nv - map.nativeCurrent[i])
      const wrapped = Math.atan2(Math.sin(rel - res.raw.angles[i]), Math.cos(rel - res.raw.angles[i]))
      expect(Math.abs(wrapped)).toBeLessThan(1e-6)
    })
  })
})

describe('relativeLimit — native limit → solver relative window', () => {
  it('passes a modest window through unchanged (sign +1, zero current)', () => {
    expect(relativeLimit(0, 0, -1, 2, 1)).toEqual([-1, 2])
  })
  it('mirrors the window for a reversed axis (sign −1)', () => {
    const lim = relativeLimit(0, 0, -1, 2, -1)!
    near(lim as unknown as number[], [-2, 1])
  })
  it('treats a full-turn span as free (null)', () => {
    expect(relativeLimit(0, 0, -Math.PI, Math.PI, 1)).toBeNull()
  })
})

describe('reachable-workspace sampling', () => {
  it('reachBounds gives the stretched + folded radii', () => {
    expect(reachBounds([1, 1])).toEqual({ outer: 2, inner: 0 })
    expect(reachBounds([3, 1])).toEqual({ outer: 4, inner: 2 })
  })

  it('samples effector points inside the annulus, limit-shaped', () => {
    const full = sampleWorkspace({ boneLengths: [1, 1] }, 400)
    expect(full.points.length).toBeGreaterThan(0)
    for (const [x, y] of full.points) {
      expect(Math.hypot(x, y)).toBeLessThanOrEqual(full.outer + 1e-9)
    }
    // A pinned base joint collapses the reachable spread in X.
    const pinned = sampleWorkspace({ boneLengths: [1, 1], limits: [[0, 0.001], null] }, 400)
    const spread = (pts: [number, number][]): number =>
      Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]))
    expect(spread(pinned.points)).toBeLessThan(spread(full.points))
  })
})

describe('capture-pose payload construction', () => {
  it('builds a partial Motion-Studio pose (deg) from the IK-solved chain', () => {
    const map = planarizeChain(twoLink(), EFF)!
    const res = solveChainTarget(map, [1, 1, 0])
    // After a drag-release the live model IS the solve → capture from those natives.
    const meta: JointMeta[] = [
      { name: 'j0', type: 'revolute', lower: -Math.PI, upper: Math.PI, isMimic: false },
      { name: 'j1', type: 'revolute', lower: -Math.PI, upper: Math.PI, isMimic: false },
      { name: 'other', type: 'revolute', lower: -Math.PI, upper: Math.PI, isMimic: false }
    ]
    const valuesNative = { ...res.nativeByJoint, other: 0.5 }
    const payload = capturePoseValues(meta, valuesNative, res.raw.angles ? ['j0', 'j1'] : [])
    // Partial: only the chain joints, in degrees, rounded to 2dp.
    expect(Object.keys(payload).sort()).toEqual(['j0', 'j1'])
    expect(payload.j0).toBeCloseTo((res.nativeByJoint.j0 * 180) / Math.PI, 1)
    expect(payload.j1).toBeCloseTo((res.nativeByJoint.j1 * 180) / Math.PI, 1)
  })
})

describe('worldToPlanar / planarToWorld round-trip', () => {
  it('recovers a plane point through the frame (arbitrary basis)', () => {
    const frame: PlanarFrame = {
      origin: [0.2, -0.5, 1],
      normal: [0, 1, 0],
      u: [1, 0, 0],
      v: [0, 0, 1]
    }
    const uv = worldToPlanar([1.2, -0.5, 3], frame)
    near(uv as unknown as number[], [1, 2])
    near(planarToWorld(uv, frame), [1.2, -0.5, 3])
  })
})
