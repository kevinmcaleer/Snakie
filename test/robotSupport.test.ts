import { describe, expect, it } from 'vitest'
import {
  comStability,
  convexHull2D,
  distanceToHullEdge,
  pointInHull,
  polygonArea,
  supportPolygon,
  type Pt2
} from '../src/renderer/src/components/robot-support'

describe('convexHull2D', () => {
  it('hulls a square, dropping an interior point', () => {
    const hull = convexHull2D([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [1, 1] // interior — must be excluded
    ])
    expect(hull).toHaveLength(4)
    expect(polygonArea(hull)).toBeCloseTo(4, 9)
  })

  it('returns the input for < 3 distinct points', () => {
    expect(convexHull2D([[0, 0]])).toEqual([[0, 0]])
    expect(convexHull2D([[0, 0], [1, 1]])).toHaveLength(2)
    expect(convexHull2D([[0, 0], [0, 0], [0, 0]])).toHaveLength(1)
  })

  it('is counter-clockwise (positive signed area order)', () => {
    const hull = convexHull2D([[0, 0], [2, 0], [2, 2], [0, 2]])
    // Shoelace signed area > 0 ⇒ CCW.
    let signed = 0
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i]
      const q = hull[(i + 1) % hull.length]
      signed += p[0] * q[1] - q[0] * p[1]
    }
    expect(signed).toBeGreaterThan(0)
  })
})

describe('pointInHull', () => {
  const square: Pt2[] = [[0, 0], [2, 0], [2, 2], [0, 2]]

  it('accepts an interior point, rejects an exterior one', () => {
    expect(pointInHull([1, 1], square)).toBe(true)
    expect(pointInHull([3, 1], square)).toBe(false)
    expect(pointInHull([-0.1, 1], square)).toBe(false)
  })

  it('counts an on-edge point as inside', () => {
    expect(pointInHull([2, 1], square)).toBe(true)
    expect(pointInHull([0, 0], square)).toBe(true)
  })

  it('is false for a degenerate hull', () => {
    expect(pointInHull([0, 0], [[0, 0], [1, 1]])).toBe(false)
  })
})

describe('distanceToHullEdge', () => {
  const square: Pt2[] = [[0, 0], [2, 0], [2, 2], [0, 2]]

  it('is the distance to the nearest edge from inside', () => {
    expect(distanceToHullEdge([0.5, 1], square)).toBeCloseTo(0.5, 9) // 0.5 from the left edge
    expect(distanceToHullEdge([1, 1], square)).toBeCloseTo(1, 9) // centre → 1 to any edge
  })

  it('is the distance to the nearest edge from outside', () => {
    expect(distanceToHullEdge([3, 1], square)).toBeCloseTo(1, 9)
  })
})

describe('comStability', () => {
  // A 200 mm × 200 mm foot square (metres), √area = 0.2 m, 10% margin = 0.02 m.
  const foot: Pt2[] = [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]]

  it('is stable well inside', () => {
    const s = comStability([0.1, 0.1], foot)
    expect(s.state).toBe('stable')
    expect(s.marginMm).toBe(100) // 0.1 m to each edge
  })

  it('is marginal within 10% of the edge', () => {
    const s = comStability([0.01, 0.1], foot) // 10 mm inside the left edge < 20 mm band
    expect(s.state).toBe('marginal')
    expect(s.marginMm).toBe(10)
  })

  it('is unstable outside, with a negative margin', () => {
    const s = comStability([0.25, 0.1], foot) // 50 mm past the right edge
    expect(s.state).toBe('unstable')
    expect(s.marginMm).toBe(-50)
  })

  it('is "none" with no polygon (fewer than three contacts)', () => {
    expect(comStability([0, 0], [[0, 0], [1, 0]]).state).toBe('none')
  })

  it('honours a custom margin fraction', () => {
    // With a 0 margin band, a point just inside the edge is stable, not marginal.
    expect(comStability([0.01, 0.1], foot, 0).state).toBe('stable')
  })
})

describe('supportPolygon', () => {
  it('hulls contacts near the ground and drops a lifted foot', () => {
    // Three feet on the ground (y≈0) + one lifted 10 mm up → triangle, not quad.
    const poly = supportPolygon([
      [0, 0, 0],
      [0.2, 0, 0],
      [0.1, 0, 0.2],
      [0.1, 0.01, 0.1] // lifted 10 mm — excluded (tol 2 mm)
    ])
    expect(poly).toHaveLength(3)
    expect(polygonArea(poly)).toBeCloseTo(0.02, 6) // ½·0.2·0.2
  })

  it('keeps feet within the ground tolerance', () => {
    const poly = supportPolygon([
      [0, 0, 0],
      [0.2, 0, 0],
      [0.2, 0.001, 0.2], // 1 mm — within 2 mm tol, kept
      [0, 0.0015, 0.2]
    ])
    expect(poly).toHaveLength(4)
  })

  it('is empty with no contacts', () => {
    expect(supportPolygon([])).toEqual([])
  })
})
