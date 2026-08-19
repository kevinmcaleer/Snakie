import { describe, it, expect } from 'vitest'
import { housingPlugAngle } from '../src/renderer/src/components/cable'
import type { PartConnector } from '../src/shared/part'

/**
 * The plug angle — one rule for every connector kind (#697).
 *
 * It used to be two: stored connectors averaged their contacts' outward normals
 * (exact, because those contacts share a normal) while a housed group's contacts
 * are ordinary pins that each work out their own facing. In a servo trio only the
 * signal pin carries a rotation, so the three disagreed and the average landed on
 * a diagonal — the plug drawn at an angle.
 */

/** The retired rule, kept HERE only to prove what it did to the trio. */
const averageNormals = (ns: { ox: number; oy: number }[]): number => {
  const nx = ns.reduce((a, n) => a + n.ox, 0) / ns.length
  const ny = ns.reduce((a, n) => a + n.oy, 0) / ns.length
  return (Math.atan2(ny, nx) * 180) / Math.PI
}
const conn = (x: number, y: number, rotation?: number): PartConnector =>
  ({ kind: 'dupont', x, y, rotation, pins: [] }) as unknown as PartConnector

describe('housingPlugAngle (#697)', () => {
  it('takes a COLUMN of contacts out its nearer SIDE — left or right', () => {
    // The plug body covers the column and the cable exits through its face —
    // toward the nearer SIDE of the part, which is the outside.
    expect(housingPlugAngle(conn(0.16, 0.83, 90))).toBe(180) // left of centre → out left
    expect(housingPlugAngle(conn(0.84, 0.2, 90))).toBe(0) //    right of centre → out right
  })

  it('takes a ROW out its nearer face — top or bottom', () => {
    expect(housingPlugAngle(conn(0.5, 0.83))).toBe(90) //  lower half → out the bottom
    expect(housingPlugAngle(conn(0.5, 0.2))).toBe(-90) //  upper half → out the top
  })

  it('treats 270 as a column too, like 90', () => {
    expect(housingPlugAngle(conn(0.2, 0.5, 270))).toBe(180)
  })

  it('leaves ACROSS the contact axis — through the mouth, never off an end', () => {
    // A row of contacts runs horizontally, so its mouth faces up or down; a
    // column runs vertically, so its mouth faces left or right. Exactly the
    // opposite of leaving off an end.
    const vertical = (a: number): boolean => Math.abs(a) === 90
    expect(vertical(housingPlugAngle(conn(0.5, 0.2))), 'a row exits vertically').toBe(true)
    expect(vertical(housingPlugAngle(conn(0.2, 0.5, 90))), 'a column exits sideways').toBe(false)
  })

  it('is always square — never the diagonal that averaging produced', () => {
    // The reported bug, reproduced: a real PCA9685 trio's three pins face
    // bottom, left and bottom, which average to ~117°.
    const skew = averageNormals([
      { ox: 0, oy: 1 },
      { ox: -1, oy: 0 },
      { ox: 0, oy: 1 }
    ])
    expect(Math.abs(skew % 90)).toBeGreaterThan(1) // diagonal
    for (const a of [
      housingPlugAngle(conn(0.16, 0.83, 90)),
      housingPlugAngle(conn(0.5, 0.2)),
      housingPlugAngle(conn(0.9, 0.5, 90)),
      housingPlugAngle(conn(0.2, 0.5))
    ]) {
      expect(Math.abs(a % 90)).toBe(0) // Math.abs: -90 % 90 is -0, which Object.is separates from 0
    }
  })

  it('is the ONE rule — a stored connector uses it too, not averaged normals', () => {
    // A QWIIC in `connectors[]` used to take its angle from its contact normals
    // while a housed group derived its own; stored and housed connectors now
    // answer the same way, which is what stops the next connector kind
    // reintroducing the split. (Those normals were right about the DIRECTION all
    // along — out of the mouth — which is what the rule now says too.)
    const plain = conn(0.3, 0.08)
    const qwiic = { ...plain, kind: 'qwiic' as const }
    expect(housingPlugAngle(plain)).toBe(-90) // a row near the top → out the top
    expect(housingPlugAngle(qwiic)).toBe(housingPlugAngle(plain))
  })
})
