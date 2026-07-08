import { describe, it, expect } from 'vitest'
import {
  classifyFace,
  faceSnapPoints,
  nearestIndex,
  worldDeltaToParent,
  movedJointOrigin,
  jointOriginForCoincident,
  type Vec3
} from '../src/renderer/src/components/robot-build'
import { addPrimitive, readJoint, blankUrdf } from '../src/renderer/src/components/robot-assembly'

describe('faceSnapPoints (#335)', () => {
  it('gives a box face 9 handles (4 corners, 4 edge-mids, centre) in the link frame', () => {
    const geom = { kind: 'box' as const, dims: [0.04, 0.06, 0.02], origin: [0, 0, 0] as Vec3 }
    const face = classifyFace([1, 0, 0], 'box') // +X
    const pts = faceSnapPoints(geom, face)
    expect(pts).toHaveLength(9)
    expect(pts.filter((p) => p.role === 'corner')).toHaveLength(4)
    expect(pts.filter((p) => p.role === 'edge')).toHaveLength(4)
    const centre = pts.find((p) => p.role === 'centre')!
    expect(centre.p).toEqual([0.02, 0, 0]) // face plane at +x half-extent
    expect(pts.some((p) => p.role === 'corner' && p.p[1] === 0.03 && p.p[2] === 0.01)).toBe(true)
  })
  it('offsets all handles by the visual origin', () => {
    const geom = { kind: 'box' as const, dims: [0.04, 0.04, 0.04], origin: [0.1, 0, 0] as Vec3 }
    const c = faceSnapPoints(geom, classifyFace([1, 0, 0], 'box')).find((p) => p.role === 'centre')!
    expect(c.p[0]).toBeCloseTo(0.12) // 0.1 origin + 0.02 half
    expect(c.p[1]).toBe(0)
    expect(c.p[2]).toBe(0)
  })
  it('gives a cylinder cap a rim circle + centre at the cap plane', () => {
    const geom = { kind: 'cylinder' as const, dims: [0.02, 0.06], origin: [0, 0, 0] as Vec3 }
    const pts = faceSnapPoints(geom, classifyFace([0, 0, 1], 'cylinder')) // +Z cap
    expect(pts).toHaveLength(9)
    expect(pts[0]).toEqual({ p: [0, 0, 0.03], role: 'centre' }) // cz = +length/2
    expect(pts.some((p) => p.p[0] === 0.02 && p.p[2] === 0.03)).toBe(true) // rim
  })
  it('gives a sphere just its centre', () => {
    const pts = faceSnapPoints({ kind: 'sphere', dims: [0.03], origin: [0, 0.05, 0] }, classifyFace([0, 1, 0], 'sphere'))
    expect(pts).toEqual([{ p: [0, 0.05, 0], role: 'centre' }])
  })
})

describe('nearestIndex (#335)', () => {
  it('picks the closest candidate; empty → -1', () => {
    const cands: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    expect(nearestIndex(cands, [0.9, 0.1, 0]).index).toBe(1)
    expect(nearestIndex([], [0, 0, 0])).toEqual({ index: -1, dist: Infinity })
  })
})

describe('world → parent-frame maths (#335)', () => {
  it('identity basis passes the delta through', () => {
    expect(worldDeltaToParent([0.01, -0.02, 0.03], [1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual([0.01, -0.02, 0.03])
  })
  it('a 90° about-X basis maps world +Y to parent −Z', () => {
    // R = Rx(90): columns [1,0,0],[0,0,1],[0,-1,0] (col-major)
    const basis = [1, 0, 0, 0, 0, 1, 0, -1, 0]
    const out = worldDeltaToParent([0, 1, 0], basis)
    expect(out[0]).toBeCloseTo(0)
    expect(out[1]).toBeCloseTo(0)
    expect(out[2]).toBeCloseTo(-1)
  })
  it('movedJointOrigin adds the parent-frame delta and grid-snaps', () => {
    const r = movedJointOrigin([0.06, 0, 0], [0.013, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1], { step: 0.005 })
    expect(r[0]).toBeCloseTo(0.075) // 0.06 + 0.013 = 0.073 → snap 5mm → 0.075
  })
  it('jointOriginForCoincident is B − A', () => {
    expect(jointOriginForCoincident([0.02, 0, 0], [0, 0.01, 0.03])).toEqual([-0.02, 0.01, 0.03])
  })
})

describe('readJoint (#335)', () => {
  it('reads a fixed joint origin/parent/type for a child; null for the root', () => {
    const u = addPrimitive(blankUrdf('bot'), { kind: 'box', linkBase: 'arm', parent: 'base_link' }).urdf
    const j = readJoint(u, 'arm')!
    expect(j.parent).toBe('base_link')
    expect(j.type).toBe('fixed')
    expect(j.xyz).toEqual([0.06, 0, 0])
    expect(readJoint(u, 'base_link')).toBeNull() // root has no parent joint → move refused
    expect(readJoint(u, 'ghost')).toBeNull()
  })
})
