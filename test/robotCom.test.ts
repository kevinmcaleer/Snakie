import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import {
  centreOfMass,
  groundProjection,
  readLinkMasses,
  robotWorldCoM,
  type Vec3
} from '../src/renderer/src/components/robot-com'
import { setInertial } from '../src/renderer/src/components/robot-assembly'

const closeVec = (got: Vec3, want: Vec3, tol = 1e-6): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(tol)
}

describe('centreOfMass — pure weighted average', () => {
  it('two equal masses balance at the midpoint', () => {
    const r = centreOfMass([
      { massKg: 1, comWorld: [0, 0, 0] },
      { massKg: 1, comWorld: [10, 0, 0] }
    ])
    expect(r!.massKg).toBe(2)
    closeVec(r!.comWorld, [5, 0, 0])
  })

  it('a heavier mass pulls the CoM toward it', () => {
    // 3 kg at x=0, 1 kg at x=8 → CoM = (3*0 + 1*8)/4 = 2.
    const r = centreOfMass([
      { massKg: 3, comWorld: [0, 0, 0] },
      { massKg: 1, comWorld: [8, 0, 0] }
    ])
    expect(r!.massKg).toBe(4)
    closeVec(r!.comWorld, [2, 0, 0])
  })

  it('combines all three axes', () => {
    const r = centreOfMass([
      { massKg: 2, comWorld: [1, 2, 3] },
      { massKg: 2, comWorld: [3, 6, 9] }
    ])
    closeVec(r!.comWorld, [2, 4, 6])
  })

  it('skips non-positive / non-finite masses (a half-weighed robot)', () => {
    const r = centreOfMass([
      { massKg: 5, comWorld: [4, 0, 0] },
      { massKg: 0, comWorld: [100, 0, 0] },
      { massKg: Number.NaN, comWorld: [200, 0, 0] }
    ])
    expect(r!.massKg).toBe(5)
    closeVec(r!.comWorld, [4, 0, 0])
  })

  it('returns null when nothing has mass', () => {
    expect(centreOfMass([])).toBeNull()
    expect(centreOfMass([{ massKg: 0, comWorld: [1, 1, 1] }])).toBeNull()
  })
})

describe('robotWorldCoM — transforms local CoMs by matrixWorld', () => {
  /** A link object at a world translation, with matrixWorld computed. */
  const linkAt = (x: number, y: number, z: number): Object3D => {
    const o = new Object3D()
    o.position.set(x, y, z)
    o.updateMatrixWorld(true)
    return o
  }

  it('applies each link’s world transform to its local CoM', () => {
    // Link A sits at world (10,0,0) with local CoM at origin → world (10,0,0).
    // Link B sits at world (0,0,0) with local CoM at (2,0,0) → world (2,0,0).
    // Equal masses → CoM at (6,0,0).
    const links: Record<string, Object3D> = {
      a: linkAt(10, 0, 0),
      b: linkAt(0, 0, 0)
    }
    const r = robotWorldCoM(
      (l) => links[l]?.matrixWorld ?? null,
      { a: { massKg: 1, comLocalM: [0, 0, 0] }, b: { massKg: 1, comLocalM: [2, 0, 0] } }
    )
    expect(r!.massKg).toBe(2)
    closeVec(r!.comWorld, [6, 0, 0])
  })

  it('skips links whose matrix is missing', () => {
    const links: Record<string, Object3D> = { a: linkAt(4, 0, 0) }
    const r = robotWorldCoM((l) => links[l]?.matrixWorld ?? null, {
      a: { massKg: 2, comLocalM: [0, 0, 0] },
      gone: { massKg: 99, comLocalM: [0, 0, 0] }
    })
    expect(r!.massKg).toBe(2)
    closeVec(r!.comWorld, [4, 0, 0])
  })

  it('returns null when no masses resolve', () => {
    expect(robotWorldCoM(() => null, {})).toBeNull()
  })

  it('respects a rotated link frame', () => {
    // A link rotated 90° about Y, local CoM at (1,0,0), placed at world origin.
    const o = new Object3D()
    o.rotation.y = Math.PI / 2
    o.updateMatrixWorld(true)
    // +X rotated +90° about Y → -Z (three.js right-handed).
    const r = robotWorldCoM(() => o.matrixWorld, { a: { massKg: 1, comLocalM: [1, 0, 0] } })
    closeVec(r!.comWorld, [0, 0, -1], 1e-6)
  })
})

describe('readLinkMasses — pulls mass + local CoM from the URDF', () => {
  const BASE =
    `<?xml version="1.0"?>\n<robot name="r">\n` +
    `  <link name="a"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>\n` +
    `  <link name="b"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>\n` +
    `</robot>\n`

  it('reads the inertials that are set, omits the rest', () => {
    let urdf = setInertial(BASE, 'a', { mass: 0.5, com: [0, 0, 0.02] })
    urdf = setInertial(urdf, 'b', { mass: 0.009, com: [0, 0, 0] })
    const masses = readLinkMasses(urdf, ['a', 'b'])
    expect(masses.a).toEqual({ massKg: 0.5, comLocalM: [0, 0, 0.02] })
    expect(masses.b.massKg).toBeCloseTo(0.009, 6)
  })

  it('omits a link with no inertial', () => {
    const urdf = setInertial(BASE, 'a', { mass: 1, com: [0, 0, 0] })
    const masses = readLinkMasses(urdf, ['a', 'b'])
    expect(masses.a).toBeDefined()
    expect(masses.b).toBeUndefined()
  })
})

describe('groundProjection', () => {
  it('zeroes the up (Y) axis by default', () => {
    expect(groundProjection([3, 5, 7])).toEqual([3, 0, 7])
  })

  it('drops onto a given ground height', () => {
    expect(groundProjection([3, 5, 7], -0.2)).toEqual([3, -0.2, 7])
  })
})
