import { describe, expect, it } from 'vitest'
import { PdfDocument } from '../src/renderer/src/lib/pdf/layout'
import {
  UNTITLED_PROJECT,
  drawClosingPage,
  drawTitlePage,
  fitTitle,
  formatCoverDate,
  resolveProjectName
} from '../src/renderer/src/lib/pdf/sections/cover'
import { textWidth } from '../src/renderer/src/lib/pdf/metrics'
import { COFFEE_URL, SNAKIE_WEB_HOST, SNAKIE_WEB_URL } from '../src/shared/links'
import { pageLinks, pageStrings, pages, parsePdf } from './helpers/pdf-inspect'

/** The title page and the "Made with Snakie" closing page (#1109). */

describe('the project name fallback chain', () => {
  it('prefers the name the user typed into robot.yml', () => {
    expect(resolveProjectName({ robotName: 'Servo arm', folder: '/home/kev/arm' })).toBe(
      'Servo arm'
    )
  })

  it('falls back to the folder, on either separator and with a trailing one', () => {
    expect(resolveProjectName({ folder: '/home/kev/projects/line-follower' })).toBe('line-follower')
    expect(resolveProjectName({ folder: 'C:\\Users\\kev\\rover\\' })).toBe('rover')
  })

  it('falls back again when there is neither', () => {
    expect(resolveProjectName({})).toBe(UNTITLED_PROJECT)
    // Whitespace is not a name.
    expect(resolveProjectName({ robotName: '   ', folder: '  ' })).toBe(UNTITLED_PROJECT)
    expect(resolveProjectName({ robotName: null, folder: null })).toBe(UNTITLED_PROJECT)
  })

  it('treats a folder of only separators as no folder', () => {
    expect(resolveProjectName({ folder: '///' })).toBe(UNTITLED_PROJECT)
  })
})

describe('fitting the title', () => {
  const WIDTH = 487 // A4 content width at the default margins

  it('keeps a short name at the largest size, on one line', () => {
    const { size, lines } = fitTitle('Servo arm', WIDTH)
    expect(size).toBe(32)
    expect(lines).toEqual(['Servo arm'])
  })

  it('steps the size down before it wraps three times', () => {
    const long = 'A rather long robot project name that will not fit on one line'
    const fitted = fitTitle(long, WIDTH)
    expect(fitted.lines.length).toBeLessThanOrEqual(3)
    for (const line of fitted.lines) {
      expect(textWidth(line, 'Helvetica-Bold', fitted.size)).toBeLessThanOrEqual(WIDTH)
    }
  })

  it('truncates with an ellipsis rather than running off the page', () => {
    const absurd = 'Supercalifragilistic'.repeat(40)
    const fitted = fitTitle(absurd, WIDTH)
    expect(fitted.lines).toHaveLength(3)
    expect(fitted.lines[2].endsWith('…')).toBe(true)
    for (const line of fitted.lines) {
      expect(textWidth(line, 'Helvetica-Bold', fitted.size)).toBeLessThanOrEqual(WIDTH)
    }
  })
})

describe('the cover date', () => {
  it('reads as a human date, from an injected clock', () => {
    expect(formatCoverDate(new Date(2026, 8, 19))).toBe('19 September 2026')
    expect(formatCoverDate(new Date(2026, 0, 1))).toBe('1 January 2026')
  })
})

describe('the title page', () => {
  it('prints the name, the entry file and the date, and carries no page number', () => {
    const doc = new PdfDocument()
    drawTitlePage(doc, {
      projectName: 'Servo arm',
      entryFile: 'sweep.py',
      date: new Date(2026, 8, 19)
    })
    doc.newPage() // a second page, so a footer would have something to say
    const pdf = parsePdf(doc.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    expect(strings).toContain('Servo arm')
    expect(strings).toContain('sweep.py')
    expect(strings).toContain('19 September 2026')
    expect(strings).toContain(SNAKIE_WEB_HOST)
    expect(strings.some((s) => /^Page \d+ of \d+$/.test(s))).toBe(false)
    // …while the page that follows it IS numbered.
    expect(pageStrings(pdf, pages(pdf)[1])).toContain('Page 2 of 2')
  })

  it('omits the optional lines cleanly', () => {
    const doc = new PdfDocument()
    drawTitlePage(doc, { projectName: UNTITLED_PROJECT })
    const pdf = parsePdf(doc.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    expect(strings).toContain(UNTITLED_PROJECT)
    expect(strings.some((s) => /\d{4}$/.test(s))).toBe(false)
  })

  it('never lets a very long name overflow the page', () => {
    const doc = new PdfDocument()
    const name = 'Ridiculously Long Name '.repeat(30)
    const page = drawTitlePage(doc, { projectName: name })
    const fitted = fitTitle(name, page.content.width)
    const pdf = parsePdf(doc.build())
    const strings = pageStrings(pdf, pages(pdf)[0])
    // The cover draws exactly the lines fitTitle chose, and each one fits.
    for (const line of fitted.lines) {
      expect(strings).toContain(line)
      expect(textWidth(line, 'Helvetica-Bold', fitted.size)).toBeLessThanOrEqual(page.content.width)
    }
    expect(page.showFooter).toBe(false)
  })
})

describe('the closing page', () => {
  it('links both URLs for real, from the shared constants', () => {
    const doc = new PdfDocument()
    doc.newPage()
    drawClosingPage(doc)
    const pdf = parsePdf(doc.build())
    const last = pages(pdf)[1]
    expect(pageLinks(pdf, last)).toEqual([SNAKIE_WEB_URL, COFFEE_URL])
    // …and prints them, so a printout is still useful.
    const strings = pageStrings(pdf, last)
    expect(strings).toContain(SNAKIE_WEB_URL)
    expect(strings).toContain(COFFEE_URL)
  })

  it('says what Snakie is and how to support it', () => {
    const doc = new PdfDocument()
    drawClosingPage(doc)
    const pdf = parsePdf(doc.build())
    const text = pageStrings(pdf, pages(pdf)[0]).join(' ')
    expect(text).toContain('Made with Snakie')
    expect(text).toContain('Support Snakie')
    expect(text).toMatch(/MicroPython/)
  })

  it('is a numbered page, unlike the cover', () => {
    const doc = new PdfDocument()
    expect(drawClosingPage(doc).showFooter).toBe(true)
  })
})
