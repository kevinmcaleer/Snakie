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
  it('takes a COLUMN of contacts off its nearer END — top or bottom', () => {
    // The lead leaves ALONG the contacts, not across them: the plug body covers
    // the column and the cable exits one end of it.
    expect(housingPlugAngle(conn(0.16, 0.83, 90))).toBe(90) //  bottom of the column
    expect(housingPlugAngle(conn(0.16, 0.2, 90))).toBe(-90) //  top of the column
  })

  it('takes a ROW off its nearer end — left or right', () => {
    expect(housingPlugAngle(conn(0.2, 0.5))).toBe(180) // left end
    expect(housingPlugAngle(conn(0.8, 0.5))).toBe(0) //   right end
  })

  it('treats 270 as a column too, like 90', () => {
    expect(housingPlugAngle(conn(0.5, 0.2, 270))).toBe(-90)
  })

  it('leaves along the contact axis, never across it', () => {
    // A column exits vertically and a row horizontally — the 90° the first
    // attempt had backwards.
    const vertical = (a: number): boolean => Math.abs(a) === 90
    expect(vertical(housingPlugAngle(conn(0.16, 0.83, 90)))).toBe(true)
    expect(vertical(housingPlugAngle(conn(0.2, 0.5)))).toBe(false)
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
    // A QWIIC in `connectors[]` used to take its angle from its contact normals,
    // which point out of the socket mouth — across the contacts, so the shell was
    // drawn end-on. Stored and housed connectors now answer the same way, which is
    // what stops the next connector kind reintroducing the split.
    const plain = conn(0.3, 0.08)
    const qwiic = { ...plain, kind: 'qwiic' as const }
    expect(housingPlugAngle(plain)).toBe(180) // along the row, off its left end
    expect(housingPlugAngle(qwiic)).toBe(housingPlugAngle(plain))
  })
})
