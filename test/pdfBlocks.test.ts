import { describe, expect, it } from 'vitest'
import { PdfDocument } from '../src/renderer/src/lib/pdf/layout'
import {
  DESCRIPTION_SIZE,
  type DrawableStack,
  LABEL_SIZE,
  captionFor,
  drawBlocksPages,
  orderStacks,
  planBlocksPages
} from '../src/renderer/src/lib/pdf/sections/blocks'
import { BLOCKS_INTRO } from '../src/renderer/src/lib/pdf/sections/narrative'
import { pageRuns, pageStrings, pages, parsePdf } from './helpers/pdf-inspect'
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

  it('reserves more room again for a description under the name', () => {
    const base = { id: 'a', width: 100, height: 40, label: 'Function: blink' }
    const [[plain]] = planBlocksPages([base], BOX)
    const [[described]] = planBlocksPages([{ ...base, description: 'Flash the LED.' }], BOX)
    expect(described.y).toBeGreaterThan(plain.y)
    // …and the caption travels with the placement, so drawing cannot wrap it
    // differently from the way it was measured.
    expect(described.caption.lines).toEqual(['Flash the LED.'])
  })

  it('still leaves a stack room beside a docstring longer than the page', () => {
    const planned = planBlocksPages(
      [
        {
          id: 'a',
          width: 100,
          height: 400,
          label: 'Function: essay',
          description: 'word '.repeat(4000)
        }
      ],
      BOX
    )
    const [placed] = planned[0]
    expect(placed.width).toBeGreaterThan(0)
    expect(placed.height).toBeGreaterThan(0)
  })

  it('skips a stack with no measurable size', () => {
    expect(planBlocksPages([{ id: 'a', width: 0, height: 0 }], BOX)).toEqual([])
  })

  it('plans nothing for nothing', () => {
    expect(planBlocksPages([], BOX)).toEqual([])
  })
})

describe('the caption under a function name (#1147)', () => {
  const stack = { id: 'f', width: 100, height: 40, label: 'Function: blink' }

  it('is just the name when the function has no docstring', () => {
    const caption = captionFor(stack, 400)
    expect(caption.label).toBe('Function: blink')
    expect(caption.lines).toEqual([])
    expect(caption.height).toBeGreaterThan(0)
  })

  it('carries a one-line docstring through as it was written', () => {
    const caption = captionFor({ ...stack, description: 'Flash the LED twice.' }, 400)
    expect(caption.lines).toEqual(['Flash the LED twice.'])
  })

  it('wraps a long docstring to the page and grows to fit it', () => {
    const long = 'Flash the on-board LED so you can see the program is running. '.repeat(4)
    const caption = captionFor({ ...stack, description: long }, 200)
    expect(caption.lines.length).toBeGreaterThan(1)
    expect(caption.height).toBeGreaterThan(captionFor(stack, 200).height)
  })

  it("keeps the docstring's own paragraphs, without opening or closing on a blank", () => {
    const caption = captionFor(
      { ...stack, description: '\n\nBlink the LED.\n\n\nTwice, briefly.\n\n' },
      400
    )
    expect(caption.lines).toEqual(['Blink the LED.', '', 'Twice, briefly.'])
  })

  it('is nothing at all for a stack with neither name nor docstring', () => {
    expect(captionFor({ id: 'a', width: 10, height: 10 }, 400)).toEqual({ lines: [], height: 0 })
  })

  it('describes a stack that has a docstring but no name', () => {
    const caption = captionFor({ id: 'a', width: 10, height: 10, description: 'A note.' }, 400)
    expect(caption.label).toBeUndefined()
    expect(caption.lines).toEqual(['A note.'])
  })
})

describe('drawing the pages', () => {
  const stack = (id: string, label?: string, description?: string): DrawableStack => ({
    id,
    width: 200,
    height: 150,
    label,
    description,
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

  it("letters a function name at the section heading's size (#1147)", () => {
    const doc = new PdfDocument()
    drawBlocksPages(doc, [stack('f1', 'Function: blink')])
    const pdf = parsePdf(doc.build())
    const runs = pageRuns(pdf, pages(pdf)[0])
    const heading = runs.find((r) => r.text === 'Blocks')
    const name = runs.find((r) => r.text === 'Function: blink')
    expect(heading).toBeDefined()
    expect(name).toEqual({ font: heading!.font, size: heading!.size, text: 'Function: blink' })
    expect(name!.size).toBe(LABEL_SIZE)
  })

  it('prints the docstring under the name, smaller (#1147)', () => {
    const doc = new PdfDocument()
    drawBlocksPages(doc, [stack('f1', 'Function: blink', 'Flash the LED twice.')])
    const pdf = parsePdf(doc.build())
    const runs = pageRuns(pdf, pages(pdf)[0])
    const name = runs.findIndex((r) => r.text === 'Function: blink')
    const description = runs.findIndex((r) => r.text === 'Flash the LED twice.')
    expect(description).toBeGreaterThan(name)
    expect(runs[description].size).toBe(DESCRIPTION_SIZE)
    expect(runs[description].size).toBeLessThan(runs[name].size)
  })

  it('prints a wrapped docstring line by line, in order', () => {
    const doc = new PdfDocument()
    const description =
      'Sweep the servo from one end of its travel to the other and back again, ' +
      'slowly enough that the arm never jerks, and leave it where it started.'
    drawBlocksPages(doc, [stack('f1', 'Function: sweep', description)])
    const pdf = parsePdf(doc.build())
    const printed = pageRuns(pdf, pages(pdf)[0])
      .filter((r) => r.size === DESCRIPTION_SIZE)
      .map((r) => r.text)
    expect(printed.length).toBeGreaterThan(1)
    expect(printed.join(' ')).toBe(description)
  })

  it('prints nothing extra for a function with no docstring', () => {
    const doc = new PdfDocument()
    drawBlocksPages(doc, [stack('f1', 'Function: blink')])
    const pdf = parsePdf(doc.build())
    expect(pageRuns(pdf, pages(pdf)[0]).some((r) => r.size === DESCRIPTION_SIZE)).toBe(false)
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

describe('the line above the blocks (#1157)', () => {
  it('says what to do with them, once, on the first page', () => {
    const stacks: DrawableStack[] = Array.from({ length: 6 }, (_, i) => ({
      id: `s${i}`,
      label: `Stack ${i}`,
      width: 300,
      height: 300,
      image: ref(i)
    }))
    const doc = new PdfDocument()
    const drawn = drawBlocksPages(doc, stacks, { intro: BLOCKS_INTRO })
    expect(drawn.length).toBeGreaterThan(1)
    const pdf = parsePdf(doc.build())
    const said = pages(pdf).map((p) => pageStrings(pdf, p).filter((s) => s === BLOCKS_INTRO).length)
    expect(said[0]).toBe(1)
    expect(said.slice(1).every((n) => n === 0)).toBe(true)
  })

  it('costs the first page its room, and no other page any', () => {
    const one = [{ id: 'a', width: 200, height: 100 }]
    const [first] = planBlocksPages(one, BOX, { firstInset: 40 })
    const [plain] = planBlocksPages(one, BOX, {})
    expect(first[0].y).toBe(plain[0].y + 40)

    // A stack that only just fits is pushed off the first page, not clipped.
    const tall = [
      { id: 'a', width: 100, height: BOX.height - 20 },
      { id: 'b', width: 100, height: 100 }
    ]
    const planned = planBlocksPages(tall, BOX, { firstInset: 40 })
    expect(planned).toHaveLength(2)
    expect(planned[1][0].y).toBe(BOX.y)
    for (const page of planned) {
      for (const placed of page) {
        expect(placed.y + placed.height).toBeLessThanOrEqual(BOX.y + BOX.height + 0.001)
      }
    }
  })
})
