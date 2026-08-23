import { describe, expect, it } from 'vitest'
import {
  opposite,
  rotateAngle,
  rotateBox,
  rotateEdge,
  rotatePart,
  rotatePoint
} from '../src/renderer/src/components/part-rotate'
import type { PartDefinition, PartEdge } from '../src/shared/part'

/**
 * Rotating a part a quarter turn (#749).
 *
 * The property that matters is that a rotate is a RIGID motion: four turns put
 * everything back exactly where it started, and one turn moves every item by
 * the same transform. Most of these tests check that rather than pinning
 * coordinates, because a coordinate assertion just restates the implementation.
 */
const base = (over: Partial<PartDefinition> = {}): PartDefinition => ({
  id: 'p',
  name: 'P',
  headers: [],
  ...over
})

describe('rotatePoint', () => {
  it('turns the top-left corner into the top-right, clockwise', () => {
    // The corner nearest the origin swings round to the far side of the x axis.
    expect(rotatePoint(0, 0, 'cw')).toEqual({ x: 1, y: 0 })
    expect(rotatePoint(1, 0, 'cw')).toEqual({ x: 1, y: 1 })
  })

  it('leaves the centre alone', () => {
    expect(rotatePoint(0.5, 0.5, 'cw')).toEqual({ x: 0.5, y: 0.5 })
    expect(rotatePoint(0.5, 0.5, 'ccw')).toEqual({ x: 0.5, y: 0.5 })
  })

  it('cw then ccw is the identity', () => {
    const p = rotatePoint(0.3, 0.8, 'cw')
    expect(rotatePoint(p.x, p.y, 'ccw')).toEqual({ x: 0.3, y: 0.8 })
  })

  it('four turns come back to the start', () => {
    let p = { x: 0.2, y: 0.7 }
    for (let i = 0; i < 4; i++) p = rotatePoint(p.x, p.y, 'cw')
    expect(p.x).toBeCloseTo(0.2, 10)
    expect(p.y).toBeCloseTo(0.7, 10)
  })
})

describe('rotateBox', () => {
  it('swaps the box dimensions', () => {
    const b = rotateBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 'cw')
    expect(b.w).toBeCloseTo(0.4)
    expect(b.h).toBeCloseTo(0.3)
  })

  it('keeps the box INSIDE the board — the anchor moves to a new corner', () => {
    // The bug this guards: mapping (x,y) as a point leaves the box hanging a
    // height outside the outline, because top-left is no longer top-left.
    const b = rotateBox({ x: 0, y: 0, w: 0.25, h: 0.5 }, 'cw')
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(1)
    expect(b.y + b.h).toBeLessThanOrEqual(1)
  })

  it('a full-board box stays a full-board box', () => {
    expect(rotateBox({ x: 0, y: 0, w: 1, h: 1 }, 'cw')).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('four turns restore it', () => {
    let b = { x: 0.1, y: 0.15, w: 0.3, h: 0.2 }
    for (let i = 0; i < 4; i++) b = rotateBox(b, 'ccw')
    expect(b.x).toBeCloseTo(0.1, 10)
    expect(b.y).toBeCloseTo(0.15, 10)
    expect(b.w).toBeCloseTo(0.3, 10)
    expect(b.h).toBeCloseTo(0.2, 10)
  })
})

describe('rotateEdge / rotateAngle', () => {
  it('clockwise, the left edge ends up on top', () => {
    expect(rotateEdge('left', 'cw')).toBe('top')
    expect(rotateEdge('top', 'cw')).toBe('right')
    expect(rotateEdge('bottom', 'ccw')).toBe('right')
  })

  it('four turns return every edge', () => {
    for (const e of ['left', 'right', 'top', 'bottom'] as const) {
      let cur = e
      for (let i = 0; i < 4; i++) cur = rotateEdge(cur, 'cw')
      expect(cur).toBe(e)
    }
  })

  it('normalises angles into 0..359 rather than drifting negative', () => {
    expect(rotateAngle(0, 'ccw')).toBe(270)
    expect(rotateAngle(270, 'cw')).toBe(0)
    expect(rotateAngle(undefined, 'cw')).toBe(90)
  })

  it('opposite really is the other way', () => {
    expect(opposite('cw')).toBe('ccw')
    expect(opposite('ccw')).toBe('cw')
  })
})

describe('the angle convention agrees with the edge convention', () => {
  // `pinOutwardDir` reads a pin's angle as a board edge: 0 right, 90 bottom,
  // 180 left, 270 top. Turning the angle and turning the edge must therefore
  // give the same answer — if they ever disagree, every pin label lands on the
  // wrong side of a rotated board, which is exactly how this surfaced.
  const edgeOf = (deg: number): PartEdge =>
    deg === 0 ? 'right' : deg === 90 ? 'bottom' : deg === 180 ? 'left' : 'top'

  it.each([0, 90, 180, 270])('%i° turns to the same edge either way', (deg) => {
    for (const dir of ['cw', 'ccw'] as const) {
      expect(edgeOf(rotateAngle(deg, dir))).toBe(rotateEdge(edgeOf(deg), dir))
    }
  })
})

describe('rotatePart', () => {
  it('swaps the board dimensions and inverts the aspect', () => {
    const p = rotatePart(base({ dimensions: { width: 41, height: 25.36 }, aspect: 41 / 25.36 }), 'cw')
    expect(p.dimensions).toEqual({ width: 25.36, height: 41 })
    expect(p.aspect).toBeCloseTo(25.36 / 41, 6)
  })

  it('turns header pins and their edge together', () => {
    const p = rotatePart(
      base({ headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', number: 1, x: 0.1, y: 0.2 }] }] }),
      'cw'
    )
    expect(p.headers[0].edge).toBe('top')
    expect(p.headers[0].pins[0].x).toBeCloseTo(0.8)
    expect(p.headers[0].pins[0].y).toBeCloseTo(0.1)
  })

  it('gives a connector the explicit quarter turn — it is drawn life-size', () => {
    // A QWIIC housing is millimetres wide whatever the board's aspect, so
    // nothing about the coordinate swap turns it. It needs the angle.
    const p = rotatePart(
      base({ connectors: [{ kind: 'qwiic', x: 0.05, y: 0.5, rotation: 270, pins: [] }] }),
      'cw'
    )
    // 270 + 90 comes back to zero, and zero is written by OMITTING the field —
    // absent already means zero, so keeping it would grow the YAML on every turn.
    expect(p.connectors?.[0].rotation).toBeUndefined()
    expect(p.connectors?.[0].x).toBeCloseTo(0.5)
    expect(p.connectors?.[0].y).toBeCloseTo(0.05)
  })

  it('does NOT add a quarter turn to a normalised component rect', () => {
    // The box map already turns it: `w` is a fraction of the board width and the
    // width becomes the old height. Adding 90 as well would turn it twice.
    const p = rotatePart(
      base({ shapes: [{ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.4 }] }),
      'cw'
    )
    expect(p.shapes?.[0].rotation).toBeUndefined()
    expect(p.shapes?.[0].w).toBeCloseTo(0.4)
    expect(p.shapes?.[0].h).toBeCloseTo(0.2)
  })

  it("rescales a circle's radius, which is a fraction of the board WIDTH", () => {
    // Board 2:1. After the turn the width is the old height, i.e. half — so a
    // radius given as a fraction of width has to double to stay the same size.
    const p = rotatePart(
      base({ dimensions: { width: 40, height: 20 }, shapes: [{ kind: 'circle', x: 0.5, y: 0.5, r: 0.1 }] }),
      'cw'
    )
    expect(p.shapes?.[0].r).toBeCloseTo(0.2)
  })

  it('turns the REAR face the other way', () => {
    // A board turned clockwise from the front is turned anticlockwise seen from
    // the back, and rear items are stored in the rear view's own space.
    const front = { kind: 'rect' as const, x: 0.1, y: 0.2, w: 0.1, h: 0.1 }
    const rear = { ...front, side: 'rear' as const }
    const p = rotatePart(base({ shapes: [front, rear] }), 'cw')
    expect(p.shapes?.[0].x).not.toBeCloseTo(p.shapes![1].x)
    // …and it is exactly the anticlockwise map of the same box.
    expect(p.shapes?.[1].x).toBeCloseTo(rotateBox(front, 'ccw').x)
  })

  it('keeps a mounting hole on the front map — it goes through the board', () => {
    const p = rotatePart(base({ mountingHoles: [{ x: 0.1, y: 0.2, diameter: 1.5 }] }), 'cw')
    expect(p.mountingHoles?.[0]).toEqual({ x: 0.8, y: 0.1, diameter: 1.5 })
  })

  it('turns the photo placement, and the rear photo the other way', () => {
    const p = rotatePart(
      base({
        imageLayer: { x: 0, y: 0.25, w: 1, h: 0.5 },
        rear: { imageLayer: { x: 0, y: 0.25, w: 1, h: 0.5 } }
      }),
      'cw'
    )
    expect(p.imageLayer).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 })
    expect(p.rear?.imageLayer).toEqual(rotateBox({ x: 0, y: 0.25, w: 1, h: 0.5 }, 'ccw'))
  })

  it('leaves the schematic symbol alone', () => {
    const schematic = { aspect: 2, pins: [{ pin: 'A', side: 'left' as const, order: 0 }] }
    expect(rotatePart(base({ schematic }), 'cw').schematic).toEqual(schematic)
  })

  it('leaves an UNSET pin rotation unset — it means "infer", not zero', () => {
    // `pinOutwardDir` reads an absent rotation as "push the label to the nearest
    // board edge". The position has just moved, so that inference re-runs and
    // comes out right on its own; writing an angle here would nail the label to
    // whichever edge 0° names instead. This was a real bug: labels on rotated
    // Modulinos pointed at the wrong edge.
    const p = rotatePart(
      base({ headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', number: 1, x: 0.1, y: 0.5 }] }] }),
      'cw'
    )
    expect(p.headers[0].pins[0].rotation).toBeUndefined()
    // …and it really did move to the edge that now faces outward.
    expect(p.headers[0].pins[0].x).toBeCloseTo(0.5)
    expect(p.headers[0].pins[0].y).toBeCloseTo(0.1)
  })

  it('KEEPS an explicit pin rotation of zero, unlike every other item', () => {
    // 0 means "label to the right"; dropping the field would hand the pin back
    // to edge inference and move its label somewhere else entirely.
    const p = rotatePart(
      base({ headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', number: 1, x: 0.5, y: 0.5, rotation: 270 }] }] }),
      'cw'
    )
    expect(p.headers[0].pins[0].rotation).toBe(0)
  })

  it('turns an explicit pin rotation with the board', () => {
    const p = rotatePart(
      base({ headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', number: 1, x: 0.5, y: 0.5, rotation: 180 }] }] }),
      'cw'
    )
    // 180 = label pushed left; a clockwise turn sends it to the bottom (90).
    expect(p.headers[0].pins[0].rotation).toBe(270)
  })

  it('does not invent fields that were absent', () => {
    // The serialiser writes whatever it is handed, so inventing `rotation: 0`
    // on every item would rewrite the whole file on a rotate.
    const p = rotatePart(base({ mountingHoles: [{ x: 0.1, y: 0.2, diameter: 1 }] }), 'cw')
    expect(p.shapes).toBeUndefined()
    expect(p.connectors).toBeUndefined()
    expect(p.labels).toBeUndefined()
  })

  it('FOUR turns restore the part exactly', () => {
    // The single strongest check: a rotate is a rigid motion, so the round trip
    // is the identity for every field at once — no drift, nothing dropped.
    const start = base({
      dimensions: { width: 41, height: 25.36 },
      aspect: 41 / 25.36,
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', number: 1, x: 0.1, y: 0.2, rotation: 90 }] }],
      mountingHoles: [{ x: 0.12, y: 0.83, diameter: 1.5 }],
      connectors: [{ kind: 'qwiic', x: 0.05, y: 0.5, rotation: 270, pins: [] }],
      shapes: [
        { kind: 'rect', x: 0.2, y: 0.3, w: 0.1, h: 0.25 },
        { kind: 'circle', x: 0.4, y: 0.6, r: 0.05 },
        { kind: 'rect', x: 0.2, y: 0.3, w: 0.1, h: 0.25, side: 'rear' }
      ],
      labels: [{ text: 'X', x: 0.5, y: 0.1 }],
      onboardLeds: [{ kind: 'single', x: 0.7, y: 0.7 }],
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 }
      ],
      imageLayer: { x: 0, y: 0, w: 1, h: 1 }
    })
    let p = start
    for (let i = 0; i < 4; i++) p = rotatePart(p, 'cw')
    expect(JSON.parse(JSON.stringify(p))).toEqual(JSON.parse(JSON.stringify(start)))
  })

  it('cw then ccw is the identity too', () => {
    const start = base({
      dimensions: { width: 41, height: 25.36 },
      connectors: [{ kind: 'qwiic', x: 0.05, y: 0.5, rotation: 270, pins: [] }],
      shapes: [{ kind: 'circle', x: 0.4, y: 0.6, r: 0.05 }]
    })
    expect(rotatePart(rotatePart(start, 'cw'), 'ccw')).toEqual(start)
  })
})
