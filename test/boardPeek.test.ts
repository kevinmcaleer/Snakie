import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PEEK_INSET_PX, peekNudge, type Box } from '../src/renderer/src/components/board-finder'

/**
 * The hover preview: twice the width (#938), and always on screen (#940).
 *
 * #938 doubled the card so the photo — the fastest way to recognise a board —
 * was worth looking at. #940 is what that broke: the card decided where to grow
 * from estimates made BEFORE it existed, and a taller card made those estimates
 * wrong. Hovering the second row flipped the preview upward, because there was
 * no room below, and sent it off the top of the gallery, because nothing had
 * ever asked whether there was room above.
 *
 * So this file covers two things. The arithmetic, which must keep the card
 * exactly 2x and centred on what you are pointing at; and `peekNudge`, which
 * replaced every one of those estimates with a measurement.
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

  it('keeps the centring in the margin, and lets transform carry only the nudge', () => {
    // Two offsets, deliberately in different properties. The centring is fixed
    // and expressible in CSS, so it is a margin. The nudge (#940) can only be
    // known once the card is on screen, so it arrives as custom properties on
    // `transform` — which the open animation also uses, and therefore restates.
    expect(marginLeft).toContain('%')
    expect(rule).toMatch(/transform:\s*translate\(var\(--bf-peek-dx/)
    expect(rule).not.toMatch(/transform:[^;]*50%/)
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

describe('every edge of the preview stays inside the gallery', () => {
  // A 1000 x 600 gallery, and a card 400 wide by 380 tall — roughly the real
  // proportions once #938 doubled it.
  const view = { left: 0, right: 1000, top: 0, bottom: 600 }
  const card = (left: number, top: number, w = 400, h = 380): Box => ({
    left,
    right: left + w,
    top,
    bottom: top + h
  })

  it('leaves a card that already fits exactly where it is', () => {
    expect(peekNudge(card(300, 100), view)).toEqual({ dx: 0, dy: 0 })
  })

  it('pulls a card back off the right edge', () => {
    // Right edge at 1050, gallery ends at 1000, 8px inset ⇒ move 58 left.
    expect(peekNudge(card(650, 100), view).dx).toBe(-58)
  })

  it('pulls a card back off the left edge', () => {
    expect(peekNudge(card(-30, 100), view).dx).toBe(38)
  })

  it('pulls a card back off the bottom edge', () => {
    expect(peekNudge(card(300, 300), view).dy).toBe(-88)
  })

  it('is the bug: a card off the TOP comes back down', () => {
    // What hovering the second row used to do. Nothing checked for room above,
    // so the card flipped up and its top — the photo — went off the page.
    expect(peekNudge(card(300, -120), view).dy).toBe(128)
  })

  it('fixes both axes at once, in one move', () => {
    const n = peekNudge(card(-30, -120), view)
    expect(n).toEqual({ dx: 38, dy: 128 })
  })

  it('keeps the inset, rather than sitting flush against the edge', () => {
    const n = peekNudge(card(650, 300), view)
    expect(650 + n.dx + 400).toBe(view.right - PEEK_INSET_PX)
    expect(300 + n.dy + 380).toBe(view.bottom - PEEK_INSET_PX)
  })

  it('moves nothing that does not need moving', () => {
    // A card off the right only is not also shoved down.
    expect(peekNudge(card(650, 100), view).dy).toBe(0)
    expect(peekNudge(card(300, 300), view).dx).toBe(0)
  })

  it('saves the TOP-LEFT when the card cannot fit at all', () => {
    // A gallery shorter and narrower than the card. Something has to be lost,
    // and it should be the end of a fact list, not the photo and the name.
    const tiny = { left: 0, right: 200, top: 0, bottom: 200 }
    const n = peekNudge(card(50, 50), tiny)
    expect(50 + n.dx).toBe(tiny.left + PEEK_INSET_PX)
    expect(50 + n.dy).toBe(tiny.top + PEEK_INSET_PX)
  })

  it('measures against the gallery, not the window', () => {
    // The gallery is inset by the panel's margin and its own padding, so a card
    // flush against the window is not flush against the gallery.
    const inset = { left: 100, right: 900, top: 80, bottom: 520 }
    expect(peekNudge(card(100, 80), inset)).toEqual({ dx: 8, dy: 8 })
  })

  it('takes the inset as an argument, so the rule is not buried in a literal', () => {
    expect(peekNudge(card(650, 100), view, 0).dx).toBe(-50)
  })
})

describe('nothing is estimated any more', () => {
  const tsx = readFileSync('src/renderer/src/components/BoardFinder.tsx', 'utf8')
  const css = readFileSync('src/renderer/src/components/BoardFinder.css', 'utf8')

  it('has no hand-maintained overhang constant left to fall out of step', () => {
    // The constant had to track the card's real height by hand, and #938's
    // taller card is exactly what it failed to track.
    expect(tsx).not.toContain('PEEK_OVERHANG_PX')
  })

  it('has no placement variants left to disagree with each other', () => {
    for (const cls of ['is-up', 'is-wide-left', 'is-wide-right']) {
      expect(css, cls).not.toContain(`.bfind__peek.${cls} {`)
      expect(tsx, cls).not.toContain(cls)
    }
  })

  it('measures before the browser paints, so the card is never seen misplaced', () => {
    expect(tsx).toContain('useLayoutEffect')
    expect(tsx).toContain('peekNudge(el.getBoundingClientRect()')
  })

  it('restates the nudge inside the open animation', () => {
    // The keyframes set `transform`, so a translate left only on the base rule
    // would be dropped for the whole animation and the card would fly in from
    // the wrong place.
    const kf = css.slice(css.indexOf('@keyframes bfind-peek'))
    expect(kf.slice(0, kf.indexOf('}\n}'))).toContain('var(--bf-peek-dx')
  })
})
