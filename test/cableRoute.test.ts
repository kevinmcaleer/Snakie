import { describe, expect, it } from 'vitest'
import {
  boxesCrossed,
  cableRoute,
  cubicAt,
  directCubic,
  inBox,
  type RouteBox,
  type RouteEnd
} from '../src/renderer/src/components/cable-route'

/**
 * Cable routing (#745): a lead leaves its socket along the socket's axis, and
 * its slack falls OUTSIDE the boards rather than across their faces.
 *
 * The check that matters is geometric, not cosmetic — sample the path and prove
 * no point lands inside a body — so these tests measure the curve rather than
 * asserting a path string.
 */

/** Sample a whole route's `d` back into points, so a two-segment path can be
 *  checked the same way as a one-segment one. */
function samplePath(d: string, steps = 60): { x: number; y: number }[] {
  // `M x y C …, …, x y  C …, …, x y` — walk the cubics in order.
  const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  const pts: { x: number; y: number }[] = []
  let i = 0
  let cur: [number, number] = [nums[0], nums[1]]
  i = 2
  while (i + 5 < nums.length + 1) {
    const c = {
      p0: cur,
      p1: [nums[i], nums[i + 1]] as [number, number],
      p2: [nums[i + 2], nums[i + 3]] as [number, number],
      p3: [nums[i + 4], nums[i + 5]] as [number, number]
    }
    for (let s = 0; s <= steps; s++) pts.push(cubicAt(c, s / steps))
    cur = c.p3
    i += 6
  }
  return pts
}

const end = (x: number, y: number, ox: number, oy: number): RouteEnd => ({ x, y, ox, oy })

describe('cableRoute', () => {
  it('leaves a clear path exactly as it was — one cubic, unchanged', () => {
    // Nothing in the way, so nothing to route around: existing boards must not
    // suddenly reflow.
    const a = end(0, 0, 1, 0)
    const b = end(300, 0, -1, 0)
    const direct = directCubic(a, b)
    const r = cableRoute(a, b, [])
    expect(r.d).toBe(
      `M ${direct.p0[0]} ${direct.p0[1]} C ${direct.p1[0]} ${direct.p1[1]}, ${direct.p2[0]} ${direct.p2[1]}, ${direct.p3[0]} ${direct.p3[1]}`
    )
  })

  it('routes AROUND a board it would otherwise cross', () => {
    // The reported case: two connectors whose straight run passes over a body.
    const board: RouteBox = { x: 80, y: -60, w: 160, h: 120 }
    const a = end(0, 0, -1, 0) // leaves leftward, away from the target
    const b = end(320, 0, 1, 0)
    const direct = directCubic(a, b)
    expect(boxesCrossed(direct, [board]).length, 'the direct path really does cross').toBe(1)

    const routed = cableRoute(a, b, [board])
    const crossings = samplePath(routed.d).filter((p) => inBox(p.x, p.y, board))
    expect(crossings).toHaveLength(0)
  })

  it('goes under when under is nearer, and over when over is', () => {
    const a = end(0, 0, -1, 0)
    const b = end(320, 0, 1, 0)
    // A body sitting mostly ABOVE the lead: the short way round is underneath.
    const high: RouteBox = { x: 80, y: -200, w: 160, h: 220 }
    expect(cableRoute(a, b, [high]).my).toBeGreaterThan(0)
    // …and mirrored, the short way is over the top.
    const low: RouteBox = { x: 80, y: -20, w: 160, h: 220 }
    expect(cableRoute(a, b, [low]).my).toBeLessThan(0)
  })

  it('clears the obstacle by a visible margin, not by a hair', () => {
    const board: RouteBox = { x: 80, y: -60, w: 160, h: 120 }
    const routed = cableRoute(end(0, 0, -1, 0), end(320, 0, 1, 0), [board])
    // The waypoint sits outside the body, not on its edge.
    expect(Math.abs(routed.my)).toBeGreaterThan(60)
  })

  it('still leaves each end along its own axis', () => {
    // The lead must emerge from the plug's mouth before it turns — that is what
    // makes it read as a cable rather than a wire soldered to a pad.
    const board: RouteBox = { x: 80, y: -60, w: 160, h: 120 }
    const a = end(0, 0, 0, -1) // points UP out of its socket
    const routed = cableRoute(a, end(320, 0, 1, 0), [board])
    const pts = samplePath(routed.d)
    // A short way along, the lead is above where it started.
    expect(pts[3].y).toBeLessThan(a.y)
  })

  it('handles several obstacles by clearing the whole band', () => {
    const one: RouteBox = { x: 60, y: -40, w: 100, h: 80 }
    const two: RouteBox = { x: 200, y: -90, w: 100, h: 130 }
    const routed = cableRoute(end(0, 0, -1, 0), end(380, 0, 1, 0), [one, two])
    const pts = samplePath(routed.d)
    expect(pts.filter((p) => inBox(p.x, p.y, one) || inBox(p.x, p.y, two))).toHaveLength(0)
  })

  it('ignores contact at the very ends — a lead starts ON its own board', () => {
    // The pad is inside the body by definition, so the first and last stretch of
    // the curve can't count as a crossing or every lead would detour.
    const own: RouteBox = { x: -40, y: -40, w: 80, h: 80 }
    const direct = directCubic(end(0, 0, 1, 0), end(300, 0, -1, 0))
    expect(boxesCrossed(direct, [own])).toHaveLength(0)
  })
})

describe('inBox / cubicAt', () => {
  it('cubicAt hits both endpoints exactly', () => {
    const c = directCubic(end(10, 20, 1, 0), end(200, 90, -1, 0))
    expect(cubicAt(c, 0)).toEqual({ x: 10, y: 20 })
    expect(cubicAt(c, 1)).toEqual({ x: 200, y: 90 })
  })

  it('inBox respects the padding', () => {
    const b: RouteBox = { x: 0, y: 0, w: 10, h: 10 }
    expect(inBox(11, 5, b)).toBe(false)
    expect(inBox(11, 5, b, 2)).toBe(true)
  })
})
