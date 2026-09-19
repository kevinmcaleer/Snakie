import { describe, it, expect } from 'vitest'
import {
  arrangeRoots,
  COLUMN_GAP,
  ROOT_GUTTER,
  ROOT_ORIGIN,
  separateRoots,
  type PlacedRoot,
  type RootBox
} from '../src/renderer/src/lib/blocks/arrange'

/**
 * WHERE THE ROOTS GO.
 * =============================================================================
 *
 * Two properties, and everything here is one of them:
 *
 *  1. NOTHING OVERLAPS. A `def` drawn on top of the program is a program you
 *     cannot read, and it is what a converted file did whenever the old
 *     estimate came in short.
 *  2. THE FUNCTIONS ARE BESIDE THE PROGRAM, not above it. A file with four
 *     `def`s used to open with the program a screen and a half below the last
 *     one.
 *
 * The measuring is Blockly's (`getHeightWidth` on a rendered block); this is
 * the arithmetic that takes those boxes and hands back positions, which is why
 * it can be a unit test at all.
 */

const program = (width: number, height: number): RootBox => ({ definition: false, width, height })
const definition = (width: number, height: number): RootBox => ({ definition: true, width, height })

/** Do two placed boxes share any pixels? */
const overlaps = (
  a: { x: number; y: number; box: RootBox },
  b: { x: number; y: number; box: RootBox }
): boolean =>
  a.x < b.x + b.box.width &&
  b.x < a.x + a.box.width &&
  a.y < b.y + b.box.height &&
  b.y < a.y + a.box.height

/** Place the boxes and pair each with where it went. */
const placed = (boxes: readonly RootBox[]): { x: number; y: number; box: RootBox }[] =>
  arrangeRoots(boxes).map((at, i) => ({ ...at, box: boxes[i] }))

describe('the program and the functions are two columns', () => {
  it('puts the program on the left and every definition to the right of it', () => {
    const boxes = [program(400, 200), definition(300, 500), program(650, 120), definition(300, 90)]
    const out = placed(boxes)
    expect(out[0].x).toBe(ROOT_ORIGIN)
    expect(out[2].x).toBe(ROOT_ORIGIN)
    // Past the WIDEST program stack, not the first — a long line halfway down
    // the program would otherwise reach in under the functions.
    const column = ROOT_ORIGIN + 650 + COLUMN_GAP
    expect(out[1].x).toBe(column)
    expect(out[3].x).toBe(column)
  })

  it('keeps a screen of functions in one column when the program is shorter', () => {
    // Without a viewport, a column is a screen's worth tall — not the height
    // of a three-line program, which would fan four short functions out into
    // four columns.
    const out = placed([program(200, 60), definition(250, 150), definition(250, 150), definition(250, 150)])
    const first = ROOT_ORIGIN + 200 + COLUMN_GAP
    expect(out.slice(1).map((p) => p.x)).toEqual([first, first, first])
  })

  it('gives the functions the left-hand column when there is no program', () => {
    // A library module is all `def`s and nothing else. Indenting the only
    // column on the canvas past a program that isn't there would open the file
    // on empty canvas.
    const out = placed([definition(300, 200), definition(300, 200)])
    expect(out.map((p) => p.x)).toEqual([ROOT_ORIGIN, ROOT_ORIGIN])
  })

  it('starts both columns at the top', () => {
    const out = placed([program(400, 200), definition(300, 500)])
    expect(out[0].y).toBe(ROOT_ORIGIN)
    // The first function is level with the start of the program, not below it:
    // that is the whole point of a second column.
    expect(out[1].y).toBe(ROOT_ORIGIN)
  })
})

describe('nothing overlaps anything', () => {
  it('clears each root of the one above it in its own column', () => {
    const out = placed([program(400, 200), program(400, 1000), program(400, 30)])
    expect(out[1].y).toBe(out[0].y + 200 + ROOT_GUTTER)
    expect(out[2].y).toBe(out[1].y + 1000 + ROOT_GUTTER)
  })

  it('holds for a real-shaped module: a header, two tall functions, a program', () => {
    const boxes = [
      program(451, 283),
      definition(1061, 219),
      definition(1061, 219),
      program(717, 646)
    ]
    const out = placed(boxes)
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect([i, j, overlaps(out[i], out[j])]).toEqual([i, j, false])
      }
    }
  })

  it('holds when a function is wider than the whole program', () => {
    // The functions column is placed off the PROGRAM's width, so a function
    // that runs off to the right is free to — nothing is to the right of it.
    const boxes = [program(200, 100), definition(4000, 100), program(200, 100)]
    const out = placed(boxes)
    expect(overlaps(out[1], out[0])).toBe(false)
    expect(overlaps(out[1], out[2])).toBe(false)
  })

  it('holds for a zero-sized root, which is what an unrendered block measures', () => {
    const boxes = [program(0, 0), program(0, 0)]
    const out = placed(boxes)
    // Still separated by the gutter, so a canvas measured before it was drawn
    // is untidy rather than a single illegible pile.
    expect(out[1].y).toBe(out[0].y + ROOT_GUTTER)
  })
})

describe('the order the file had them in survives', () => {
  it('runs each column down the canvas in the order it was given', () => {
    const boxes = [program(10, 10), definition(10, 10), program(10, 10), definition(10, 10)]
    const out = placed(boxes)
    // The program stacks generate in canvas order, so theirs is the order that
    // has to be right. The functions interleave into that walk wherever their
    // y lands and it changes nothing — a `def` emits into the generator's
    // functions section rather than into the body.
    expect(out[2].y).toBeGreaterThan(out[0].y)
    expect(out[3].y).toBeGreaterThan(out[1].y)
  })

  it('places nothing for no roots', () => {
    expect(arrangeRoots([])).toEqual([])
  })
})

describe('the functions flow into columns across the viewport', () => {
  const view = { width: 2000, height: 800 }

  it('starts a second column when the first would run past the program', () => {
    // A program 300 tall, three functions of 200: only one fits beside it
    // (200 + 48 + 200 = 448 > 300), so each of the rest opens a column.
    const boxes = [program(300, 300), definition(200, 200), definition(200, 200), definition(200, 200)]
    // A viewport no taller than the program, so the program's height is the
    // limit; wide enough that every column is welcome.
    const out = arrangeRoots(boxes, { width: 5000, height: 300 + ROOT_ORIGIN })
    const first = ROOT_ORIGIN + 300 + COLUMN_GAP
    expect(out[1]).toMatchObject({ x: first, y: ROOT_ORIGIN })
    expect(out[2].x).toBe(first + 200 + COLUMN_GAP)
    expect(out[2].y).toBe(ROOT_ORIGIN)
    expect(out[3].x).toBe(out[2].x + 200 + COLUMN_GAP)
  })

  it('fills a screen before starting a column when the program is short', () => {
    // Three lines of program and eight functions: the screen is 800 tall, so
    // the functions column may run to the bottom of it before it wraps.
    const boxes = [program(200, 60), ...Array.from({ length: 8 }, () => definition(250, 150))]
    const out = arrangeRoots(boxes, view)
    const first = ROOT_ORIGIN + 200 + COLUMN_GAP
    // 150 + 48 per function: four end at 40 + 4*150 + 3*48 = 784 ≤ 800, a
    // fifth would not.
    expect(out.slice(1, 5).map((p) => p.x)).toEqual([first, first, first, first])
    expect(out[5].x).toBe(first + 250 + COLUMN_GAP)
    expect(out[5].y).toBe(ROOT_ORIGIN)
  })

  it('carries on downwards once the viewport is used up, never sideways off screen', () => {
    const narrow = { width: 700, height: 300 }
    // First column at 40 + 200 + 72 = 312, 250 wide → ends 562. A second would
    // start at 634 and end at 884, past the 660 edge, so it never opens.
    const boxes = [program(200, 100), definition(250, 200), definition(250, 200), definition(250, 200)]
    const out = arrangeRoots(boxes, narrow)
    const first = ROOT_ORIGIN + 200 + COLUMN_GAP
    expect(out.slice(1).map((p) => p.x)).toEqual([first, first, first])
    expect(out[2].y).toBe(out[1].y + 200 + ROOT_GUTTER)
    expect(out[3].y).toBe(out[2].y + 200 + ROOT_GUTTER)
  })

  it('keeps every column clear of every other, whatever the widths', () => {
    const boxes = [
      program(451, 283),
      definition(1061, 219),
      definition(300, 500),
      definition(700, 90),
      definition(120, 640),
      program(717, 646),
      definition(400, 200)
    ]
    const out = arrangeRoots(boxes, { width: 4000, height: 900 }).map((at, i) => ({ ...at, box: boxes[i] }))
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect([i, j, overlaps(out[i], out[j])]).toEqual([i, j, false])
      }
    }
    // And more than one column was actually used.
    expect(new Set(out.filter((p) => p.box.definition).map((p) => p.x)).size).toBeGreaterThan(1)
  })
})

describe('a layout somebody made is separated, not rearranged', () => {
  const root = (x: number, y: number, width: number, height: number, fixed = false): PlacedRoot => ({
    x,
    y,
    width,
    height,
    fixed
  })

  it('leaves a layout with no overlaps exactly as it is', () => {
    const roots = [root(40, 40, 300, 200), root(500, 40, 300, 900), root(40, 400, 300, 100)]
    expect(separateRoots(roots)).toEqual(roots.map(({ x, y }) => ({ x, y })))
  })

  it('pushes the later root down until its box is clear', () => {
    // The first has grown to 400 tall and now covers the one at 300.
    const roots = [root(40, 40, 300, 400), root(40, 300, 300, 100)]
    const out = separateRoots(roots)
    expect(out[0]).toEqual({ x: 40, y: 40 })
    expect(out[1]).toEqual({ x: 40, y: 40 + 400 + ROOT_GUTTER })
  })

  it('does not touch a root in a different column', () => {
    const roots = [root(40, 40, 300, 400), root(500, 300, 300, 100)]
    expect(separateRoots(roots)[1]).toEqual({ x: 500, y: 300 })
  })

  it('keeps a fixed root where it is and moves the other, whichever is higher', () => {
    // The learner just dropped the second root onto the first: the drop stays.
    const roots = [root(40, 40, 300, 400), root(60, 100, 300, 100, true)]
    const out = separateRoots(roots)
    expect(out[1]).toEqual({ x: 60, y: 100 })
    expect(out[0]).toEqual({ x: 40, y: 100 + 100 + ROOT_GUTTER })
  })

  it('settles a chain of overlaps in one pass', () => {
    const roots = [root(40, 40, 300, 300), root(40, 200, 300, 300), root(40, 360, 300, 300)]
    const out = separateRoots(roots).map((at, i) => ({ ...at, box: { ...roots[i], definition: false } }))
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect([i, j, overlaps(out[i], out[j])]).toEqual([i, j, false])
      }
    }
    expect(out[1].y).toBe(40 + 300 + ROOT_GUTTER)
    expect(out[2].y).toBe(out[1].y + 300 + ROOT_GUTTER)
  })

  it('treats touching edges as clear', () => {
    const roots = [root(40, 40, 300, 100), root(40, 140, 300, 100)]
    expect(separateRoots(roots)[1]).toEqual({ x: 40, y: 140 })
  })
})
