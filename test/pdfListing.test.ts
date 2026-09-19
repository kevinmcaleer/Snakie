import { describe, expect, it } from 'vitest'
import { PdfDocument } from '../src/renderer/src/lib/pdf/layout'
import {
  CONTINUATION_INDENT,
  codeForListing,
  drawListing,
  layOutListing,
  paginateListing
} from '../src/renderer/src/lib/pdf/sections/listing'
import { CODE_INTRO_WITH_BLOCKS } from '../src/renderer/src/lib/pdf/sections/narrative'
import { BLOCKS_FOOTER_TAG, writeBlocksFooter } from '../src/shared/blocks-doc'
import { pageStrings, pages, parsePdf } from './helpers/pdf-inspect'

/** The MicroPython code listing (#1107). */

describe('choosing the code to print', () => {
  it('follows the Blocks view precedence: draft, then generated, then stored', () => {
    expect(codeForListing({ draft: 'a', generated: 'b', stored: 'c' })).toBe('a')
    expect(codeForListing({ generated: 'b', stored: 'c' })).toBe('b')
    expect(codeForListing({ stored: 'c' })).toBe('c')
    expect(codeForListing({})).toBe('')
    // An EMPTY draft is still the draft — the learner cleared the pane.
    expect(codeForListing({ draft: '', generated: 'b' })).toBe('')
  })

  it('never prints the snakie-blocks footer', () => {
    const source = writeBlocksFooter('print("hi")\n', {
      blocks: { languageVersion: 0, blocks: [] }
    })
    expect(source).toContain(BLOCKS_FOOTER_TAG)
    const printed = codeForListing({ stored: source })
    expect(printed).toBe('print("hi")')
    expect(printed).not.toContain(BLOCKS_FOOTER_TAG)
  })
})

describe('laying out rows', () => {
  it('numbers every source line from 1', () => {
    const rows = layOutListing('a\nb\nc', 40)
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3])
    expect(rows.map((r) => r.text)).toEqual(['a', 'b', 'c'])
  })

  it('keeps numbering past 99 and past 999', () => {
    const rows = layOutListing(Array.from({ length: 1200 }, (_, i) => `x${i}`).join('\n'), 40)
    expect(rows[99].number).toBe(100)
    expect(rows[999].number).toBe(1000)
    expect(rows[1199].number).toBe(1200)
  })

  it('keeps a blank line as a line', () => {
    const rows = layOutListing('a\n\nb', 40)
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3])
    expect(rows[1].text).toBe('')
  })

  it('wraps a long line and marks the continuation without a number', () => {
    const line = 'x'.repeat(25)
    const rows = layOutListing(line, 10)
    expect(rows[0]).toEqual({ number: 1, text: 'x'.repeat(10), indent: 0 })
    expect(rows.slice(1).every((r) => r.number === null)).toBe(true)
    expect(rows.slice(1).every((r) => r.indent === CONTINUATION_INDENT)).toBe(true)
    // Nothing is lost and nothing is invented: the rows rejoin to the source.
    expect(rows.map((r) => r.text).join('')).toBe(line)
    // Text plus its drawn indent never exceeds the column count.
    for (const r of rows) expect(r.text.length + r.indent).toBeLessThanOrEqual(10)
  })

  it('does not put layout scaffolding into the text a reader copies', () => {
    const rows = layOutListing('y'.repeat(30), 10)
    for (const r of rows) expect(r.text).not.toMatch(/^\s/)
  })

  it('expands tabs consistently before measuring', () => {
    expect(layOutListing('\tif x:', 40)[0].text).toBe('    if x:')
    expect(layOutListing('ab\tc', 40)[0].text).toBe('ab  c')
    expect(layOutListing('\tx', 40, 2)[0].text).toBe('  x')
  })

  it('gives up on a zero-width page rather than looping forever', () => {
    expect(layOutListing('anything', 0)).toEqual([])
  })
})

describe('paginating the listing', () => {
  const rows = (n: number): ReturnType<typeof layOutListing> =>
    layOutListing(Array.from({ length: n }, (_, i) => `line ${i}`).join('\n'), 80)

  it('splits a 500-line listing into a predictable page count', () => {
    expect(paginateListing(rows(500), 60)).toHaveLength(Math.ceil(500 / 60))
  })

  it('never strands a continuation away from the line it continues', () => {
    // Four source lines, the last of which wraps into three rows, on pages of 5.
    const laid = layOutListing(['a', 'b', 'c', 'z'.repeat(25)].join('\n'), 10)
    const paged = paginateListing(laid, 5)
    for (const page of paged) {
      // A page never OPENS on a continuation: its line is on the page with it.
      expect(page[0].number).not.toBeNull()
    }
  })

  it('splits a line too long for any page, because there is nowhere else', () => {
    const laid = layOutListing('q'.repeat(100), 10)
    const paged = paginateListing(laid, 3)
    expect(paged.length).toBeGreaterThan(1)
    expect(paged.flat()).toHaveLength(laid.length)
  })

  it('has no pages for no rows', () => {
    expect(paginateListing([], 10)).toEqual([])
  })
})

describe('drawing the listing', () => {
  it('draws nothing at all for empty code — no heading with nothing under it', () => {
    const doc = new PdfDocument()
    expect(drawListing(doc, { code: '   \n\n ' })).toEqual([])
    expect(doc.pageCount).toBe(0)
  })

  it('prints the code as real text, with its line numbers', () => {
    const doc = new PdfDocument()
    drawListing(doc, { code: 'from machine import Pin\n\nled = Pin(25, Pin.OUT)\nled.on()' })
    const pdf = parsePdf(doc.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    expect(strings).toContain('MicroPython')
    expect(strings).toContain('from machine import Pin')
    expect(strings).toContain('led = Pin(25, Pin.OUT)')
    expect(strings).toContain('1')
    expect(strings).toContain('4')
  })

  it('carries non-ASCII into the PDF without corrupting the stream', () => {
    // parsePdf refuses a stream whose /Length does not reach `endstream`, so
    // reading this back at all is the assertion about byte-length correctness.
    const doc = new PdfDocument()
    drawListing(doc, { code: '# tilt 30° — naïve\nangle = 30  # café\n' })
    const pdf = parsePdf(doc.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    expect(strings).toContain('# tilt 30° — naïve')
    expect(strings).toContain('angle = 30  # café')
  })

  it('spills onto as many pages as it needs, each headed', () => {
    const doc = new PdfDocument()
    const drawn = drawListing(doc, {
      code: Array.from({ length: 400 }, (_, i) => `x${i} = ${i}`).join('\n')
    })
    expect(drawn.length).toBeGreaterThan(1)
    const pdf = parsePdf(doc.build())
    expect(pages(pdf)).toHaveLength(drawn.length)
    expect(pageStrings(pdf, pages(pdf)[0])).toContain('MicroPython')
    expect(pageStrings(pdf, pages(pdf)[1])).toContain('MicroPython (continued)')
    // Every page carries its number.
    expect(pageStrings(pdf, pages(pdf)[1])).toContain(`Page 2 of ${drawn.length}`)
  })

  it('wraps a line too wide for the page rather than letting it run off', () => {
    const doc = new PdfDocument()
    drawListing(doc, { code: `msg = "${'wide '.repeat(60)}"` })
    const pdf = parsePdf(doc.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    const printed = strings.filter((s) => s.includes('wide'))
    expect(printed.length).toBeGreaterThan(1)
    expect(printed.join('')).toContain('wide wide')
  })
})

describe('the line above the listing (#1157)', () => {
  const code = Array.from({ length: 90 }, (_, i) => `line_${i} = ${i}`).join('\n')

  it('is set once, above the first page of code', () => {
    const doc = new PdfDocument()
    drawListing(doc, { code, intro: CODE_INTRO_WITH_BLOCKS })
    const pdf = parsePdf(doc.build())
    const said = pages(pdf).map(
      (p) => pageStrings(pdf, p).filter((s) => s === CODE_INTRO_WITH_BLOCKS).length
    )
    expect(said.length).toBeGreaterThan(1)
    expect(said[0]).toBe(1)
    expect(said.slice(1).every((n) => n === 0)).toBe(true)
  })

  it('moves the lines it displaces onto the next page rather than off the foot', () => {
    const withIntro = new PdfDocument()
    drawListing(withIntro, { code, intro: CODE_INTRO_WITH_BLOCKS })
    const without = new PdfDocument()
    drawListing(without, { code })
    const linesOn = (doc: PdfDocument): number[] => {
      const pdf = parsePdf(doc.build())
      return pages(pdf).map((p) => pageStrings(pdf, p).filter((s) => /^line_\d+ = /.test(s)).length)
    }
    const shifted = linesOn(withIntro)
    const plain = linesOn(without)
    expect(shifted[0]).toBeLessThan(plain[0])
    // Not a line of code lost between the two.
    const total = (ns: number[]): number => ns.reduce((a, b) => a + b, 0)
    expect(total(shifted)).toBe(total(plain))
  })
})
