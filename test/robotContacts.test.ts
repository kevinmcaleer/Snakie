import { describe, expect, it } from 'vitest'
import { Object3D } from 'three'
import {
  addContact,
  contactCount,
  contactWorldPoints,
  removeContact,
  setContact,
  type Vec3
} from '../src/renderer/src/components/robot-contacts'

const closeVec = (got: Vec3, want: Vec3, tol = 1e-6): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThan(tol)
}

describe('contactWorldPoints', () => {
  const linkAt = (x: number, y: number, z: number): Object3D => {
    const o = new Object3D()
    o.position.set(x, y, z)
    o.updateMatrixWorld(true)
    return o
  }

  it('transforms each link’s local contacts by its world matrix', () => {
    const links: Record<string, Object3D> = { foot: linkAt(1, 0, 3) }
    const out = contactWorldPoints((l) => links[l]?.matrixWorld ?? null, {
      foot: [
        [0, 0, 0],
        [0.5, 0, 0]
      ]
    })
    expect(out).toHaveLength(2)
    expect(out[0].link).toBe('foot')
    closeVec(out[0].world, [1, 0, 3])
    closeVec(out[1].world, [1.5, 0, 3])
  })

  it('spans multiple links (both feet of the polygon)', () => {
    const links: Record<string, Object3D> = { l: linkAt(-1, 0, 0), r: linkAt(1, 0, 0) }
    const out = contactWorldPoints((k) => links[k]?.matrixWorld ?? null, {
      l: [[0, 0, 0]],
      r: [[0, 0, 0]]
    })
    expect(out.map((c) => c.world[0]).sort()).toEqual([-1, 1])
  })

  it('skips a link whose matrix is missing', () => {
    const links: Record<string, Object3D> = { a: linkAt(2, 0, 0) }
    const out = contactWorldPoints((k) => links[k]?.matrixWorld ?? null, {
      a: [[0, 0, 0]],
      gone: [[0, 0, 0]]
    })
    expect(out).toHaveLength(1)
  })

  it('applies a rotated link frame', () => {
    const o = new Object3D()
    o.rotation.y = Math.PI / 2
    o.updateMatrixWorld(true)
    const out = contactWorldPoints(() => o.matrixWorld, { a: [[1, 0, 0]] })
    closeVec(out[0].world, [0, 0, -1]) // +X about +90° Y → -Z
  })
})

describe('contactCount', () => {
  it('counts across links', () => {
    expect(contactCount({ a: [[0, 0, 0], [1, 0, 0]], b: [[0, 0, 0]] })).toBe(3)
    expect(contactCount({})).toBe(0)
    expect(contactCount(undefined)).toBe(0)
  })
})

describe('immutable edits', () => {
  it('addContact appends without mutating', () => {
    const before = { foot: [[0, 0, 0] as Vec3] }
    const after = addContact(before, 'foot', [1, 2, 3])
    expect(after.foot).toHaveLength(2)
    expect(before.foot).toHaveLength(1) // untouched
  })

  it('addContact starts a new link', () => {
    expect(addContact(undefined, 'foot', [0, 0, 0])).toEqual({ foot: [[0, 0, 0]] })
  })

  it('removeContact drops one point, and the key when it empties', () => {
    const c = { foot: [[0, 0, 0] as Vec3, [1, 0, 0] as Vec3] }
    expect(removeContact(c, 'foot', 0).foot).toEqual([[1, 0, 0]])
    expect(removeContact({ foot: [[0, 0, 0] as Vec3] }, 'foot', 0).foot).toBeUndefined()
  })

  it('setContact replaces one point in place', () => {
    const c = { foot: [[0, 0, 0] as Vec3, [1, 0, 0] as Vec3] }
    const out = setContact(c, 'foot', 1, [9, 9, 9])
    expect(out.foot).toEqual([[0, 0, 0], [9, 9, 9]])
    expect(c.foot[1]).toEqual([1, 0, 0]) // original untouched
  })

  it('setContact ignores an out-of-range index', () => {
    const c = { foot: [[0, 0, 0] as Vec3] }
    expect(setContact(c, 'foot', 5, [9, 9, 9]).foot).toEqual([[0, 0, 0]])
  })
})
