import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { peekSide } from '../src/renderer/src/components/board-finder'

/**
 * The hover preview at twice the width (#938).
 *
 * The preview grew a card into a slightly bigger card, and the photo — the
 * fastest way to recognise a board — stayed small. Doubling the width is the
 * whole change; the two things that can go wrong are the arithmetic (a card
 * that is not actually 2x, or is not centred on what you are pointing at) and
 * the edges (half a card hanging outside the panel). Both are covered here.
 */

const css = readFileSync('src/renderer/src/components/BoardFinder.css', 'utf8')

/**
 * Evaluate one of the peek's `calc()` expressions in pixels.
 *
 * The real rule is CSS, so the test reads the CSS rather than restating the
 * formula — a rule edited to something that is no longer 2x has to fail here,
 * which a hard-coded expectation could not do.
 */
const evalCalc = (expr: string, cellW: number, pad: number, proud: number): number => {
  const js = expr
    .replace(/calc\(/g, '(')
    .replace(/var\(--bf-cell-pad\)/g, String(pad))
    .replace(/var\(--bf-peek-proud\)/g, String(proud))
    .replace(/([\d.]+)px/g, '$1')
    .replace(/([\d.]+)%/g, (_m, n) => String((Number(n) / 100) * cellW))
  if (!/^[\d\s+\-*/().]+$/.test(js)) throw new Error(`unsafe calc: ${expr} → ${js}`)
  return Function(`"use strict";return (${js})`)() as number
}

const ruleFor = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  expect(at, `${selector} is missing`).toBeGreaterThan(-1)
  return css.slice(at, css.indexOf('}', at))
}

const declaration = (rule: string, prop: string): string => {
  const m = rule.match(new RegExp(`\\n\\s*${prop}:\\s*([^;]+);`))
  expect(m, `no ${prop} in rule`).toBeTruthy()
  return m![1].trim()
}

const PAD = 6
const PROUD = 10
/** The grid is `minmax(178px, 1fr)`, so a cell is never narrower than this and
 *  is usually a little wider. Both ends are checked. */
const CELL_WIDTHS = [178, 200, 240, 320]

describe('the preview is twice the card', () => {
  const rule = ruleFor('.bfind__peek')
  const width = declaration(rule, 'width')
  const marginLeft = declaration(rule, 'margin-left')

  it.each(CELL_WIDTHS)('is exactly 2x the old width in a %ipx cell', (cellW) => {
    // What it used to be: inset by `--bf-peek-off` on both sides, which is
    // `pad - proud` each — so it stood `proud` beyond the cell on each side.
    const before = cellW - 2 * (PAD - PROUD)
    expect(evalCalc(width, cellW, PAD, PROUD)).toBeCloseTo(2 * before, 6)
  })

  it.each(CELL_WIDTHS)('stays centred on the cell it grew from (%ipx)', (cellW) => {
    // `left: 50%` then pulled back by the margin. The card's centre must land on
    // the cell's centre, or the preview drifts off the thing under the pointer.
    const w = evalCalc(width, cellW, PAD, PROUD)
    const left = cellW / 2 + evalCalc(marginLeft, cellW, PAD, PROUD)
    expect(left + w / 2).toBeCloseTo(cellW / 2, 6)
  })

  it('leaves `transform` to the open animation', () => {
    // The offset is a negative margin on purpose: `transform` carries the scale
    // keyframes, and sharing it would mean restating the centring inside them
    // and in both edge variants.
    expect(rule).not.toMatch(/\n\s*transform:\s*translate/)
    expect(css).toContain('@keyframes bfind-peek')
  })

  it('keeps the image box ratio, so the photo grows both ways', () => {
    // Every bundled thumbnail is 320px wide with a median aspect of 1.20, so in
    // a 4/3 box most are HEIGHT-constrained and have width to spare. Widening
    // the box alone would have shown no more image at all.
    expect(ruleFor('.bfind__peek-img')).toContain('aspect-ratio: 4 / 3')
    expect(ruleFor('.bfind__peek-img img')).toContain('object-fit: contain')
  })
})

describe('a doubled card still fits the panel', () => {
  // A 200px cell in a 1000px-wide scroller.
  const view = { left: 0, right: 1000 }
  const cell = (left: number, w = 200): { left: number; right: number } => ({
    left,
    right: left + w
  })

  it('centres a card with room on both sides', () => {
    expect(peekSide(cell(400), view)).toBe('centre')
  })

  it('grows inward from the first column', () => {
    expect(peekSide(cell(0), view)).toBe('left')
  })

  it('grows inward from the last column', () => {
    expect(peekSide(cell(800), view)).toBe('right')
  })

  it('measures against the scroller, not the window', () => {
    // The gallery is inset by its panel's margin, so a cell flush against the
    // window's edge is not flush against the scroller's.
    const inset = { left: 100, right: 900 }
    expect(peekSide(cell(100), inset)).toBe('left')
    expect(peekSide(cell(120), inset)).toBe('left')
    expect(peekSide(cell(400), inset)).toBe('centre')
  })

  it('holds at the exact boundary rather than one pixel past it', () => {
    // A 200px cell needs 100px of room each side. At exactly 100 it fits.
    expect(peekSide(cell(100), view)).toBe('centre')
    expect(peekSide(cell(99), view)).toBe('left')
    expect(peekSide(cell(700), view)).toBe('centre')
    expect(peekSide(cell(701), view)).toBe('right')
  })

  it('keeps the photo on screen when nothing can fit', () => {
    // A viewport too narrow for the doubled card at all: both tests pass, and
    // anchoring left keeps the start of the card — the picture — visible.
    expect(peekSide(cell(0, 300), { left: 0, right: 320 })).toBe('left')
  })
})

describe('the flip estimate moved with the card', () => {
  const tsx = readFileSync('src/renderer/src/components/BoardFinder.tsx', 'utf8')

  it('allows for a preview that is now twice as tall in its image', () => {
    // The estimate decides whether the bottom row grows up. Left at its old
    // value it would flip a row too late and open into the scroller's edge.
    const m = tsx.match(/const PEEK_OVERHANG_PX = (\d+)/)
    expect(m).toBeTruthy()
    expect(Number(m![1])).toBeGreaterThanOrEqual(300)
  })
})
