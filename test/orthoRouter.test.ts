import { describe, it, expect } from 'vitest'
import {
  routeOrthogonal,
  sideFromEdge,
  toRoundedPath,
  toSvgPath,
  type RBox,
  type RWire
} from '../src/renderer/src/components/ortho-router'

type P = { x: number; y: number }

const isOrthogonal = (pts: P[]): boolean => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (Math.abs(a.x - b.x) > 0.01 && Math.abs(a.y - b.y) > 0.01) return false
  }
  return true
}

/** Does any segment pass through the box's strict interior? */
const crossesInterior = (pts: P[], box: RBox): boolean => {
  const e = 0.01
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (Math.abs(a.y - b.y) < e) {
      const lo = Math.min(a.x, b.x)
      const hi = Math.max(a.x, b.x)
      if (a.y > box.y + e && a.y < box.y + box.h - e && lo < box.x + box.w - e && hi > box.x + e) return true
    } else {
      const lo = Math.min(a.y, b.y)
      const hi = Math.max(a.y, b.y)
      if (a.x > box.x + e && a.x < box.x + box.w - e && lo < box.y + box.h - e && hi > box.y + e) return true
    }
  }
  return false
}

describe('sideFromEdge', () => {
  it('maps part/board edges to router sides', () => {
    expect(sideFromEdge('left')).toBe('W')
    expect(sideFromEdge('right')).toBe('E')
    expect(sideFromEdge('top')).toBe('N')
    expect(sideFromEdge('bottom')).toBe('S')
  })
})

describe('routeOrthogonal', () => {
  it('connects the two pins and only uses right-angle segments', () => {
    const wires: RWire[] = [{ id: 'w', src: { x: 0, y: 0, side: 'E' }, dst: { x: 200, y: 60, side: 'W' } }]
    const pts = routeOrthogonal([], wires).get('w') as P[]
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 60 })
    expect(isOrthogonal(pts)).toBe(true)
  })

  it('leaves each pin perpendicular to its side (a stub in the normal direction)', () => {
    const wires: RWire[] = [{ id: 'w', src: { x: 0, y: 0, side: 'E' }, dst: { x: 200, y: 0, side: 'W' } }]
    const pts = routeOrthogonal([], wires).get('w') as P[]
    expect(pts[1].x).toBeGreaterThan(pts[0].x)
    expect(pts[1].y).toBeCloseTo(pts[0].y, 5)
    expect(pts[pts.length - 1].x).toBeGreaterThan(pts[pts.length - 2].x)
  })

  it('routes around an obstacle blocking the straight line', () => {
    const box: RBox = { x: 80, y: -25, w: 40, h: 50 }
    const wires: RWire[] = [{ id: 'w', src: { x: 0, y: 0, side: 'E' }, dst: { x: 200, y: 0, side: 'W' } }]
    const pts = routeOrthogonal([box], wires).get('w') as P[]
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 200, y: 0 })
    expect(isOrthogonal(pts)).toBe(true)
    expect(crossesInterior(pts, box)).toBe(false)
    expect(pts.length).toBeGreaterThan(2)
  })

  it('nudges parallel wires sharing a corridor onto different channels', () => {
    const wires: RWire[] = [
      { id: 'a', src: { x: 0, y: 0, side: 'E' }, dst: { x: 200, y: 0, side: 'W' } },
      { id: 'b', src: { x: 0, y: 0, side: 'E' }, dst: { x: 200, y: 0, side: 'W' } }
    ]
    const out = routeOrthogonal([], wires, { sharePenalty: 100 })
    const a = out.get('a') as P[]
    const b = out.get('b') as P[]
    expect(a[0]).toEqual({ x: 0, y: 0 })
    expect(isOrthogonal(a)).toBe(true)
    expect(isOrthogonal(b)).toBe(true)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('still routes a large fan of wires (grid guard keeps it bounded)', () => {
    const wires: RWire[] = Array.from({ length: 24 }, (_, i) => ({
      id: `w${i}`,
      src: { x: 0, y: i * 12, side: 'E' as const },
      dst: { x: 300, y: i * 12, side: 'W' as const }
    }))
    const out = routeOrthogonal([{ x: 120, y: 0, w: 60, h: 300 }], wires)
    expect(out.size).toBe(24)
    for (const w of wires) expect(isOrthogonal(out.get(w.id) as P[])).toBe(true)
  })
})

describe('toSvgPath / toRoundedPath', () => {
  it('toSvgPath emits a sharp M/L polyline', () => {
    expect(toSvgPath([{ x: 1, y: 2 }, { x: 10, y: 2 }, { x: 10, y: 20 }])).toBe('M 1 2 L 10 2 L 10 20')
  })

  it('toRoundedPath rounds corners with quadratic curves and keeps the endpoints', () => {
    const d = toRoundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 14)
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d).toContain('Q 100 0') // the corner becomes a quadratic through the vertex
    expect(d.trimEnd().endsWith('100 100')).toBe(true)
  })

  it('toRoundedPath falls back to a straight line for < 3 points', () => {
    expect(toRoundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M 0 0 L 10 0')
  })
})
