import { describe, it, expect } from 'vitest'
import {
  pinDropAction,
  pinHitIndex,
  pinInsertIndex,
  pinnedNoodle,
  pinnedOrtho,
  pinnedPolyline,
  polylineMidpoint,
  type WireEnd
} from '../src/renderer/src/components/wire-pins'

/**
 * PINNED WIRES (#1173).
 *
 * A wire used to spring back to wherever its curve wanted to go the moment you
 * let go of it — regularly straight over the parts you were dragging it off.
 * A pin is a point the wire is MADE to pass through, and these are the sums
 * behind it: the path through the pins, which leg a new one joins, and which
 * pin a click landed on.
 */

// Two pads facing each other across the mat.
const A: WireEnd = { x: 0, y: 0, ox: 0, oy: -1 }
const B: WireEnd = { x: 400, y: 0, ox: 0, oy: -1 }

/** Every coordinate pair in an SVG path, in order. */
function coords(d: string): [number, number][] {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

describe('the noodle through a wire’s pins', () => {
  it('starts on one pad, ends on the other, and lands on every pin', () => {
    const pins = [
      { x: 120, y: -200 },
      { x: 260, y: -60 }
    ]
    const { d } = pinnedNoodle(A, B, pins, 40)
    const pts = coords(d)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[pts.length - 1]).toEqual([400, 0])
    // One cubic per leg: M + 3 points × 3 legs.
    expect(pts).toHaveLength(1 + 3 * 3)
    // Each cubic ENDS on its pin (the curve passes through the pinned point —
    // that is the whole promise), and the last on the far pad.
    expect(pts[3]).toEqual([120, -200])
    expect(pts[6]).toEqual([260, -60])
  })

  it('leaves each pad along its own normal, so a pin never drags the joint sideways', () => {
    const { d } = pinnedNoodle(A, B, [{ x: 200, y: -300 }], 40)
    const pts = coords(d)
    // First control point is straight up out of A (its normal is 0,-1)…
    expect(pts[1][0]).toBeCloseTo(0)
    expect(pts[1][1]).toBeLessThan(0)
    // …and the last is straight up out of B.
    const c2 = pts[pts.length - 2]
    expect(c2[0]).toBeCloseTo(400)
    expect(c2[1]).toBeLessThan(0)
  })

  it('does not loop back on itself when a pin is dropped right beside a pad', () => {
    // The clearance (40) is longer than this leg, so it has to be reined in —
    // reaching 40px out of a 20px hop would throw the wire back over the pad.
    const { d } = pinnedNoodle(A, B, [{ x: 0, y: -20 }], 40)
    const pts = coords(d)
    expect(pts[1][1]).toBeGreaterThanOrEqual(-20)
  })

  it('hangs its badge half-way along the run, not half-way between the pads', () => {
    const straight = pinnedNoodle(A, B, [], 40)
    expect(straight.mx).toBeCloseTo(200)
    expect(straight.my).toBeCloseTo(0)
    // Pinned high above the middle, the midpoint rides up with the wire.
    const arched = pinnedNoodle(A, B, [{ x: 200, y: -300 }], 40)
    expect(arched.my).toBeLessThan(-100)
  })

  it('measures the midpoint by length, not by vertex count', () => {
    const mid = polylineMidpoint([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 110, y: 0 }
    ])
    expect(mid).toEqual({ x: 55, y: 0 })
  })
})

describe('the schematic route through a wire’s pins', () => {
  const pins = [{ x: 150, y: -120 }]
  it('is rectilinear end to end', () => {
    const pts = pinnedOrtho(A, B, pins, 14)
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i].x - pts[i - 1].x)
      const dy = Math.abs(pts[i].y - pts[i - 1].y)
      expect(Math.min(dx, dy)).toBeCloseTo(0)
    }
  })

  it('leaves each pin perpendicular to its symbol and visits every pinned point', () => {
    const pts = pinnedOrtho(A, B, pins, 14)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[1]).toEqual({ x: 0, y: -14 }) // the stub, along A's normal
    expect(pts.some((p) => p.x === 150 && p.y === -120)).toBe(true)
    expect(pts[pts.length - 1]).toEqual({ x: 400, y: 0 })
    expect(pts[pts.length - 2]).toEqual({ x: 400, y: -14 })
  })
})

describe('where a new pin joins the list', () => {
  it('splices into the leg it was dropped nearest, keeping the run in order', () => {
    const pins = [
      { x: 100, y: -100 },
      { x: 300, y: -100 }
    ]
    // Before the first pin…
    expect(pinInsertIndex(A, B, pins, { x: 40, y: -50 })).toBe(0)
    // …between the two…
    expect(pinInsertIndex(A, B, pins, { x: 200, y: -100 })).toBe(1)
    // …and after the last.
    expect(pinInsertIndex(A, B, pins, { x: 370, y: -40 })).toBe(2)
  })

  it('puts the first pin on a bare wire at the start of the list', () => {
    expect(pinInsertIndex(A, B, [], { x: 200, y: -80 })).toBe(0)
    expect(pinnedPolyline(A, B, [{ x: 1, y: 2 }])).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 400, y: 0 }
    ])
  })
})

describe('grabbing a pin', () => {
  const pins = [
    { x: 100, y: -100 },
    { x: 300, y: -100 }
  ]
  it('picks the pin under the press, and the nearest when two are close', () => {
    expect(pinHitIndex(pins, { x: 104, y: -98 }, 9)).toBe(0)
    expect(pinHitIndex(pins, { x: 298, y: -103 }, 9)).toBe(1)
    expect(pinHitIndex([{ x: 0, y: 0 }, { x: 6, y: 0 }], { x: 5, y: 0 }, 9)).toBe(1)
  })

  it('answers -1 for a press on the wire between them', () => {
    expect(pinHitIndex(pins, { x: 200, y: -100 }, 9)).toBe(-1)
    expect(pinHitIndex([], { x: 100, y: -100 }, 9)).toBe(-1)
  })
})

describe('what letting go does', () => {
  it('pins the wire where a drag ends, and moves a pin that was dragged', () => {
    expect(pinDropAction(true)).toBe('add')
    expect(pinDropAction(true, 1)).toBe('move')
  })

  it('un-pins a pin that was clicked, and leaves a clicked wire alone', () => {
    // Clicking a pin again is how you take it out — the fix's other half.
    expect(pinDropAction(false, 0)).toBe('remove')
    // A click on the wire itself only selects it (done on pointer-DOWN).
    expect(pinDropAction(false)).toBe('none')
  })
})
