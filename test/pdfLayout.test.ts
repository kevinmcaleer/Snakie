import { describe, expect, it } from 'vitest'
import {
  A4,
  DEFAULT_MARGINS,
  LETTER,
  PdfDocument,
  expandTabs,
  fitBox,
  packUnits,
  wrapMonospace,
  wrapText
} from '../src/renderer/src/lib/pdf/layout'
import { courierCharsPerLine, textWidth } from '../src/renderer/src/lib/pdf/metrics'
import { pageStrings, pages, parsePdf } from './helpers/pdf-inspect'

/**
 * Page geometry, running furniture and text flow (#1111).
 *
 * All of it is pure arithmetic over font metrics, which is exactly why it can
 * be asserted here rather than eyeballed in a viewer.
 */

describe('page geometry', () => {
  it('defaults to A4 but takes the size as a parameter', () => {
    expect(A4.width).toBeCloseTo(595.28, 2)
    const a4 = new PdfDocument()
    expect(a4.size).toEqual(A4)
    expect(new PdfDocument({ size: LETTER }).size).toEqual(LETTER)
  })

  it('derives a content box from the margins', () => {
    const doc = new PdfDocument({ margins: { top: 10, right: 20, bottom: 30, left: 40 } })
    const page = doc.newPage()
    expect(page.content).toEqual({
      x: 40,
      y: 10,
      width: A4.width - 60,
      height: A4.height - 40
    })
  })

  it('addresses the page from the TOP left', () => {
    const doc = new PdfDocument()
    const page = doc.newPage({ footer: false })
    page.text('top', 100, 50, { size: 10 })
    const pdf = parsePdf(doc.build())
    // A baseline 50 points below the top is (height - 50) in PDF user space.
    expect(pages(pdf)[0]).toBeTruthy()
    const content = pdf.objects.get(pages(pdf)[0].id)!
    expect(content).toBeTruthy()
    expect(pdf.raw).toContain(
      `100 ${(A4.height - 50).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} Td`
    )
  })
})

describe('the running footer', () => {
  it('numbers every page but the title page', () => {
    const doc = new PdfDocument({ footerLabel: 'Robot arm' })
    doc.newPage({ footer: false }) // title
    doc.newPage()
    doc.newPage()
    const pdf = parsePdf(doc.build())
    const [title, second, third] = pages(pdf)
    expect(pageStrings(pdf, title)).toEqual([])
    expect(pageStrings(pdf, second)).toEqual(['Robot arm', 'Page 2 of 3'])
    expect(pageStrings(pdf, third)).toEqual(['Robot arm', 'Page 3 of 3'])
  })

  it('counts the TOTAL only once every page exists', () => {
    const doc = new PdfDocument()
    doc.newPage()
    doc.newPage()
    const pdf = parsePdf(doc.build())
    expect(pageStrings(pdf, pages(pdf)[0])).toEqual(['Page 1 of 2'])
  })

  it('omits the label when the document has none', () => {
    const doc = new PdfDocument()
    doc.newPage()
    const pdf = parsePdf(doc.build())
    expect(pageStrings(pdf, pages(pdf)[0])).toEqual(['Page 1 of 1'])
  })
})

describe('fitting an image to a box', () => {
  const box = { x: 100, y: 200, width: 400, height: 300 }

  it('keeps a wide image undistorted', () => {
    const fitted = fitBox(800, 200, box)
    expect(fitted.width / fitted.height).toBeCloseTo(4, 6)
    expect(fitted.width).toBeLessThanOrEqual(box.width)
    expect(fitted.height).toBeLessThanOrEqual(box.height)
  })

  it('keeps a tall image undistorted', () => {
    const fitted = fitBox(200, 800, box)
    expect(fitted.width / fitted.height).toBeCloseTo(0.25, 6)
    expect(fitted.height).toBeCloseTo(box.height, 6)
  })

  it('centres what it fits', () => {
    const fitted = fitBox(800, 200, box)
    expect(fitted.x + fitted.width / 2).toBeCloseTo(box.x + box.width / 2, 6)
    expect(fitted.y + fitted.height / 2).toBeCloseTo(box.y + box.height / 2, 6)
  })

  it('leaves a small image alone rather than blowing it up soft', () => {
    const fitted = fitBox(40, 30, box)
    expect(fitted.width).toBe(40)
    expect(fitted.height).toBe(30)
  })

  it('survives a degenerate source', () => {
    expect(fitBox(0, 0, box)).toEqual(box)
  })
})

describe('monospaced text flow', () => {
  it('wraps at the column the metrics say, not a guess', () => {
    // 400pt of content at 9pt Courier: 400 / (0.6 * 9) = 74 columns.
    const cols = courierCharsPerLine(400, 9)
    expect(cols).toBe(74)
    expect(textWidth('x'.repeat(cols), 'Courier', 9)).toBeLessThanOrEqual(400)
    expect(textWidth('x'.repeat(cols + 1), 'Courier', 9)).toBeGreaterThan(400)
  })

  it('leaves a short line alone', () => {
    expect(wrapMonospace('print("hi")', 40)).toEqual(['print("hi")'])
    expect(wrapMonospace('', 40)).toEqual([''])
  })

  it('marks a continuation so a wrap does not read as a new statement', () => {
    const wrapped = wrapMonospace('abcdefghij', 4, 2)
    expect(wrapped[0]).toBe('abcd')
    expect(wrapped.slice(1).every((l) => l.startsWith('  '))).toBe(true)
    expect(wrapped.join('').replace(/ /g, '')).toBe('abcdefghij')
    expect(wrapped.every((l) => l.length <= 4)).toBe(true)
  })

  it('expands tabs to consistent columns', () => {
    expect(expandTabs('\tx')).toBe('    x')
    expect(expandTabs('ab\tx')).toBe('ab  x')
    expect(expandTabs('abcd\tx')).toBe('abcd    x')
    expect(expandTabs('\tx', 2)).toBe('  x')
  })
})

describe('proportional text flow', () => {
  it('wraps to the measured width', () => {
    const words = 'the quick brown fox jumps over the lazy dog '.repeat(4)
    const lines = wrapText(words, 'Helvetica', 11, 200)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(textWidth(line, 'Helvetica', 11)).toBeLessThanOrEqual(200)
  })

  it('breaks a single over-long word rather than running off the edge', () => {
    const lines = wrapText('Supercalifragilisticexpialidocious'.repeat(3), 'Helvetica', 24, 80)
    for (const line of lines) expect(textWidth(line, 'Helvetica', 24)).toBeLessThanOrEqual(80)
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious'.repeat(3))
  })

  it('keeps blank lines between paragraphs', () => {
    expect(wrapText('one\n\ntwo', 'Helvetica', 11, 400)).toEqual(['one', '', 'two'])
  })
})

describe('packing units into pages', () => {
  it('never splits a unit', () => {
    const units = [3, 3, 3, 3].map((size, i) => ({ item: i, size }))
    expect(packUnits(units, 7)).toEqual([
      [0, 1],
      [2, 3]
    ])
  })

  it('fills a page exactly when it can', () => {
    const units = [2, 2, 2].map((size, i) => ({ item: i, size }))
    expect(packUnits(units, 4)).toEqual([[0, 1], [2]])
  })

  it('gives an oversized unit a page of its own rather than clipping it', () => {
    const units = [
      { item: 'big', size: 99 },
      { item: 'small', size: 1 }
    ]
    expect(packUnits(units, 10)).toEqual([['big'], ['small']])
  })

  it('paginates a 500-line listing to a predictable page count', () => {
    const lines = Array.from({ length: 500 }, (_, i) => ({ item: i, size: 1 }))
    expect(packUnits(lines, 60)).toHaveLength(Math.ceil(500 / 60))
  })

  it('returns nothing for nothing', () => {
    expect(packUnits([], 10)).toEqual([])
  })
})

describe('defaults', () => {
  it('uses the same margin all round', () => {
    const { top, right, bottom, left } = DEFAULT_MARGINS
    expect(new Set([top, right, bottom, left]).size).toBe(1)
  })
})
