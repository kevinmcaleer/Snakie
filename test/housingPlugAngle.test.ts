import { describe, it, expect } from 'vitest'
import { housingPlugAngle, plugAngle } from '../src/renderer/src/components/cable'
import type { PartConnector } from '../src/shared/part'

/**
 * The plug angle for a housed group (#697).
 *
 * A stored connector's contacts share one outward normal, so averaging them is
 * exact. A housed group's are ordinary pins that each work out their own facing —
 * in a servo trio only the signal carries a rotation — so the average lands on a
 * diagonal and the plug draws at an angle.
 */
const conn = (x: number, y: number, rotation?: number): PartConnector =>
  ({ kind: 'dupont', x, y, rotation, pins: [] }) as unknown as PartConnector

describe('housingPlugAngle (#697)', () => {
  it('enters a COLUMN of contacts from the nearer side', () => {
    expect(housingPlugAngle(conn(0.16, 0.83, 90))).toBe(180) // left edge
    expect(housingPlugAngle(conn(0.9, 0.5, 90))).toBe(0) //     right edge
  })

  it('enters a ROW of contacts from above or below', () => {
    expect(housingPlugAngle(conn(0.5, 0.2))).toBe(-90) // top edge
    expect(housingPlugAngle(conn(0.5, 0.8))).toBe(90) //  bottom edge
  })

  it('treats 270 as a column too, like 90', () => {
    expect(housingPlugAngle(conn(0.2, 0.5, 270))).toBe(180)
  })

  it('is always square — never the diagonal that averaging produced', () => {
    // The reported bug, reproduced: a real PCA9685 trio's three pins face
    // bottom, left and bottom, which average to ~117°.
    const skew = plugAngle([
      { ox: 0, oy: 1 },
      { ox: -1, oy: 0 },
      { ox: 0, oy: 1 }
    ])
    expect(Math.abs(skew % 90)).toBeGreaterThan(1) // diagonal
    for (const a of [
      housingPlugAngle(conn(0.16, 0.83, 90)),
      housingPlugAngle(conn(0.5, 0.2)),
      housingPlugAngle(conn(0.9, 0.5, 90)),
      housingPlugAngle(conn(0.5, 0.8))
    ]) {
      expect(Math.abs(a % 90)).toBe(0) // Math.abs: -90 % 90 is -0, which Object.is separates from 0
    }
  })
})
