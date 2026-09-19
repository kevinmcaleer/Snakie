import { describe, expect, it } from 'vitest'
import { PdfDocument } from '../src/renderer/src/lib/pdf/layout'
import {
  type DrawableStack,
  drawBlocksPages,
  orderStacks,
  planBlocksPages
} from '../src/renderer/src/lib/pdf/sections/blocks'
import { pageStrings, pages, parsePdf } from './helpers/pdf-inspect'
import type { PdfImageRef } from '../src/renderer/src/lib/pdf/writer'

/** The blocks pages (#1112). */

const BOX = { x: 50, y: 80, width: 400, height: 600 }

/** A stand-in image handle — the planner never looks inside one. */
function ref(i = 0): PdfImageRef {
  return { index: i, width: 100, height: 100 }
}

describe('ordering the stacks', () => {
  it('puts the hoisted functions first, in the generator order', () => {
    const stacks = [{ id: 'main' }, { id: 'f2' }, { id: 'loose' }, { id: 'f1' }]
    expect(orderStacks(stacks, ['f1', 'f2']).map((s) => s.id)).toEqual([
      'f1',
      'f2',
      'main',
      'loose'
    ])
  })

  it('keeps the workspace order among the rest', () => {
    const stacks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(orderStacks(stacks, []).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a function id with no stack behind it', () => {
    // The generator hoists by block id; a stack deleted between generating and
    // exporting must not become a hole in the ordering.
    expect(orderStacks([{ id: 'a' }], ['ghost', 'a']).map((s) => s.id)).toEqual(['a'])
  })

  it('never lists a stack twice, even for a repeated function id', () => {
    expect(orderStacks([{ id: 'a' }, { id: 'b' }], ['a', 'a']).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('planning the pages', () => {
  it('packs whole stacks and never splits one', () => {
    const stacks = [
      { id: 'a', width: 200, height: 250 },
      { id: 'b', width: 200, height: 250 },
      { id: 'c', width: 200, height: 250 }
    ]
    const planned = planBlocksPages(stacks, BOX)
    // 250 + gap + 250 fits in 600; a third does not.
    expect(planned.map((p) => p.map((x) => x.stack.id))).toEqual([['a', 'b'], ['c']])
    for (const page of planned) {
      for (const placed of page) {
        expect(placed.y).toBeGreaterThanOrEqual(BOX.y)
        expect(placed.y + placed.height).toBeLessThanOrEqual(BOX.y + BOX.height + 0.001)
      }
    }
  })

  it('scales an oversized stack down rather than clipping it', () => {
    const planned = planBlocksPages([{ id: 'huge', width: 1600, height: 2400 }], BOX)
    const [placed] = planned[0]
    expect(placed.width / placed.height).toBeCloseTo(1600 / 2400, 6)
    expect(placed.width).toBeLessThanOrEqual(BOX.width + 0.001)
    expect(placed.height).toBeLessThanOrEqual(BOX.height + 0.001)
  })

  it('gives a page-filling stack a page of its own', () => {
    const stacks = [
      { id: 'small', width: 100, height: 40 },
      { id: 'huge', width: 400, height: 4000 },
      { id: 'small2', width: 100, height: 40 }
    ]
    const planned = planBlocksPages(stacks, BOX)
    expect(planned.map((p) => p.map((x) => x.stack.id))).toEqual([['small'], ['huge'], ['small2']])
  })

  it('leaves a small stack at its natural size, centred', () => {
    const planned = planBlocksPages([{ id: 'a', width: 100, height: 40 }], BOX)
    const [placed] = planned[0]
    expect(placed.width).toBe(100)
    expect(placed.x + placed.width / 2).toBeCloseTo(BOX.x + BOX.width / 2, 6)
  })

  it('reserves room above a labelled stack', () => {
    const [[plain]] = planBlocksPages([{ id: 'a', width: 100, height: 40 }], BOX)
    const [[labelled]] = planBlocksPages([{ id: 'a', width: 100, height: 40, label: 'Fn' }], BOX)
    expect(labelled.y).toBeGreaterThan(plain.y)
  })

  it('skips a stack with no measurable size', () => {
    expect(planBlocksPages([{ id: 'a', width: 0, height: 0 }], BOX)).toEqual([])
  })

  it('plans nothing for nothing', () => {
    expect(planBlocksPages([], BOX)).toEqual([])
  })
})

describe('drawing the pages', () => {
  const stack = (id: string, label?: string): DrawableStack => ({
    id,
    width: 200,
    height: 150,
    label,
    image: ref()
  })

  it('draws no pages at all when the project has no blocks', () => {
    const doc = new PdfDocument()
    expect(drawBlocksPages(doc, [])).toEqual([])
    expect(doc.pageCount).toBe(0)
  })

  it('leaves no empty page behind when nothing is measurable', () => {
    const doc = new PdfDocument()
    expect(drawBlocksPages(doc, [{ id: 'a', width: 0, height: 0, image: ref() }])).toEqual([])
    expect(doc.pageCount).toBe(0)
  })

  it('heads the first page and marks the rest as continued', () => {
    const doc = new PdfDocument()
    const drawn = drawBlocksPages(
      doc,
      Array.from({ length: 12 }, (_, i) => stack(`s${i}`))
    )
    expect(drawn.length).toBeGreaterThan(1)
    const pdf = parsePdf(doc.build())
    expect(pageStrings(pdf, pages(pdf)[0])).toContain('Blocks')
    expect(pageStrings(pdf, pages(pdf)[1])).toContain('Blocks (continued)')
  })

  it('prints each stack caption', () => {
    const doc = new PdfDocument()
    drawBlocksPages(doc, [stack('f1', 'Function: blink'), stack('m', 'Main program')])
    const pdf = parsePdf(doc.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    expect(strings).toContain('Function: blink')
    expect(strings).toContain('Main program')
    // The caption comes before the main program's, because functions come first.
    expect(strings.indexOf('Function: blink')).toBeLessThan(strings.indexOf('Main program'))
  })

  it('puts every stack image on a page', () => {
    const doc = new PdfDocument()
    const images = [0, 1, 2].map(() =>
      doc.addImage({ jpeg: new Uint8Array(8), width: 10, height: 10 })
    )
    drawBlocksPages(
      doc,
      images.map((image, i) => ({ id: `s${i}`, width: 200, height: 150, image }))
    )
    const pdf = parsePdf(doc.build())
    const drawn = pages(pdf).flatMap((p) => [...pageStrings(pdf, p)])
    expect(drawn.length).toBeGreaterThan(0)
    expect(pdf.raw.match(/\/Im\d+ Do/g) ?? []).toHaveLength(3)
  })
})
