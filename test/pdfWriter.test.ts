import { describe, expect, it } from 'vitest'
import { PdfWriter } from '../src/renderer/src/lib/pdf/writer'
import {
  encodeWinAnsi,
  escapePdfText,
  isWinAnsiRepresentable,
  winAnsiByte
} from '../src/renderer/src/lib/pdf/winansi'
import {
  COURIER_WIDTH,
  courierCharsPerLine,
  glyphWidth,
  textWidth
} from '../src/renderer/src/lib/pdf/metrics'
import { buildImagePdf } from '../src/renderer/src/components/svg-export'
import { latin1, pageImages, pageLinks, pageStrings, pages, parsePdf } from './helpers/pdf-inspect'

/**
 * The zero-dependency PDF writer (#1113).
 *
 * These assertions are about BYTES, not about the source: a wrong xref offset
 * or a `/Length` taken from `String.length` produces a file that opens happily
 * in one reader and not at all in another, and only reading the output back
 * catches that.
 */

/** A JPEG-shaped blob — the writer never decodes it, it only embeds it. */
function fakeJpeg(n = 64): Uint8Array {
  const u = new Uint8Array(n)
  u[0] = 0xff
  u[1] = 0xd8
  for (let i = 2; i < n - 2; i++) u[i] = i & 0xff
  u[n - 2] = 0xff
  u[n - 1] = 0xd9
  return u
}

describe('WinAnsi encoding', () => {
  it('is ONE byte per character — not UTF-8', () => {
    // The trap this exists to avoid: TextEncoder would make '°' two bytes, the
    // font would read nonsense, and a /Length from String.length would lie.
    expect(encodeWinAnsi('°').length).toBe(1)
    expect(encodeWinAnsi('°')[0]).toBe(0xb0)
    expect(new TextEncoder().encode('°').length).toBe(2)
  })

  it('maps the Windows-1252 punctuation block', () => {
    expect(winAnsiByte('—'.codePointAt(0)!)).toBe(0x97)
    expect(winAnsiByte('–'.codePointAt(0)!)).toBe(0x96)
    expect(winAnsiByte('•'.codePointAt(0)!)).toBe(0x95)
    expect(winAnsiByte('…'.codePointAt(0)!)).toBe(0x85)
  })

  it('substitutes rather than emitting a malformed byte', () => {
    expect(isWinAnsiRepresentable('日本')).toBe(false)
    expect([...encodeWinAnsi('a日b')]).toEqual([0x61, 0x3f, 0x62])
    // An astral character is one code point, so it substitutes to ONE byte.
    expect(encodeWinAnsi('🐍').length).toBe(1)
  })

  it('escapes the three characters that would break a literal string', () => {
    expect(escapePdfText('a(b)c\\d')).toBe('a\\(b\\)c\\\\d')
    // A line break inside a literal would otherwise read as the stream's own.
    expect(escapePdfText('a\\nb\\r\\tc')).toBe('a\\\\nb\\\\r\\\\tc')
  })
})

describe('font metrics', () => {
  it('treats every Courier glyph as 600/1000 em', () => {
    for (const ch of 'iW (') expect(glyphWidth('Courier', ch.charCodeAt(0))).toBe(COURIER_WIDTH)
    // 10 characters at 12pt = 10 * 600 * 12 / 1000.
    expect(textWidth('0123456789', 'Courier', 12)).toBeCloseTo(72, 6)
  })

  it('measures Helvetica proportionally', () => {
    expect(glyphWidth('Helvetica', 'i'.charCodeAt(0))).toBeLessThan(
      glyphWidth('Helvetica', 'W'.charCodeAt(0))
    )
    expect(glyphWidth('Helvetica-Bold', 'a'.charCodeAt(0))).toBeGreaterThanOrEqual(
      glyphWidth('Helvetica', 'a'.charCodeAt(0))
    )
  })

  it('gives an accented letter its base letter width', () => {
    expect(glyphWidth('Helvetica', 'é'.codePointAt(0)!)).toBe(
      glyphWidth('Helvetica', 'e'.charCodeAt(0))
    )
  })

  it('computes Courier columns exactly, never negative', () => {
    expect(courierCharsPerLine(72, 12)).toBe(10)
    expect(courierCharsPerLine(71.9, 12)).toBe(9)
    expect(courierCharsPerLine(2, 12)).toBe(0)
  })
})

describe('the PDF writer', () => {
  it('needs at least one page', () => {
    expect(() => new PdfWriter().build()).toThrow(/at least one page/)
  })

  it('lands every xref offset exactly on the object it claims', () => {
    const w = new PdfWriter({ title: 'Xref' })
    const img = w.addImage({ jpeg: fakeJpeg(300), width: 40, height: 20 })
    for (let i = 0; i < 4; i++) {
      const p = w.addPage(595, 842)
      p.content.text(`page ${i}`, 50, 700, { size: 12 })
      p.drawImage(img, 50, 400, 200, 100)
      p.link(50, 380, 200, 14, `https://example.test/${i}`)
    }
    // parsePdf THROWS if any offset misses; reaching the assertions is the point.
    const pdf = parsePdf(w.build())
    expect(pdf.objects.size).toBe(pdf.size - 1)
    expect(pages(pdf)).toHaveLength(4)
  })

  it('keeps /Count honest as pages are added', () => {
    for (const n of [1, 2, 7]) {
      const w = new PdfWriter()
      for (let i = 0; i < n; i++) w.addPage(300, 300).content.text('x', 10, 10)
      const pdf = parsePdf(w.build())
      expect(pages(pdf)).toHaveLength(n)
      expect(pdf.raw).toContain(`/Count ${n}`)
    }
  })

  it('escapes parens and backslashes so the literal survives a round trip', () => {
    const tricky = 'a (b) c \\ d )) (('
    const w = new PdfWriter()
    w.addPage(400, 400).content.text(tricky, 10, 10)
    const pdf = parsePdf(w.build())
    expect(pageStrings(pdf, pages(pdf)[0])).toEqual([tricky])
  })

  it('sizes a stream from its BYTES when the text is not ASCII', () => {
    // The regression this guards: /Length taken from String.length. parsePdf
    // refuses to read a stream whose /Length does not reach `endstream`.
    const w = new PdfWriter()
    w.addPage(400, 400).content.text('30° — naïve café •', 10, 10)
    const pdf = parsePdf(w.build())
    expect(pageStrings(pdf, pages(pdf)[0])).toEqual(['30° — naïve café •'])

    const declared = Number(/\/Length (\d+)/.exec(pdf.raw)![1])
    const start = pdf.raw.indexOf('stream\n', pdf.raw.indexOf('/Length')) + 'stream\n'.length
    expect(pdf.raw.slice(start + declared, start + declared + 10)).toBe('\nendstream')
  })

  it('declares the three base-14 fonts with WinAnsiEncoding, and embeds none', () => {
    const w = new PdfWriter()
    w.addPage(400, 400).content.text('hi', 10, 10)
    const raw = latin1(w.build())
    for (const font of ['/Helvetica', '/Helvetica-Bold', '/Courier']) {
      expect(raw).toContain(`/BaseFont ${font} `)
    }
    expect(raw.match(/\/WinAnsiEncoding/g)).toHaveLength(3)
    expect(raw).not.toContain('/FontFile')
  })

  it('shares one image XObject between the pages that use it', () => {
    const w = new PdfWriter()
    const img = w.addImage({ jpeg: fakeJpeg(128), width: 10, height: 5 })
    const a = w.addPage(200, 200)
    const b = w.addPage(200, 200)
    a.drawImage(img, 0, 0, 100, 50)
    b.drawImage(img, 0, 0, 100, 50)
    const pdf = parsePdf(w.build())
    const [p1, p2] = pages(pdf)
    const i1 = pageImages(pdf, p1).get('Im0')!
    const i2 = pageImages(pdf, p2).get('Im0')!
    expect(i1.id).toBe(i2.id)
    expect(i1.body).toContain('/Filter /DCTDecode')
    expect(i1.body).toContain('/Width 10')
    expect(i1.stream).toHaveLength(128)
  })

  it('gives a page with no image no /XObject dictionary at all', () => {
    const w = new PdfWriter()
    w.addPage(200, 200).content.text('plain', 10, 10)
    expect(latin1(w.build())).not.toContain('/XObject')
  })

  it('writes URI link annotations', () => {
    const w = new PdfWriter()
    const p = w.addPage(400, 400)
    p.link(10, 10, 100, 20, 'https://app.snakie.org')
    p.link(10, 40, 100, 20, 'https://buymeacoffee.com/kevinmcaleer')
    const pdf = parsePdf(w.build())
    expect(pageLinks(pdf, pages(pdf)[0])).toEqual([
      'https://app.snakie.org',
      'https://buymeacoffee.com/kevinmcaleer'
    ])
  })

  it('is deterministic — the same document twice is the same bytes', () => {
    const make = (): Uint8Array => {
      const w = new PdfWriter({ title: 'Same', creationDate: 'D:20260919120000Z' })
      const img = w.addImage({ jpeg: fakeJpeg(96), width: 8, height: 8 })
      const p = w.addPage(300, 300)
      p.content.text('hello', 20, 20)
      p.drawImage(img, 0, 0, 50, 50)
      return w.build()
    }
    expect(latin1(make())).toBe(latin1(make()))
  })
})

describe('the breadboard image export', () => {
  it('still produces a readable single-page document (no regression from #1113)', async () => {
    const blob = buildImagePdf(fakeJpeg(256), 640, 480, 1280, 960)
    const pdf = parsePdf(new Uint8Array(await blob.arrayBuffer()))
    const [page] = pages(pdf)
    expect(page.body).toContain('/MediaBox [0 0 640 480]')
    // /Width and /Height describe the JPEG's own pixels, not the placed size.
    expect(pageImages(pdf, page).get('Im0')!.body).toContain('/Width 1280')
  })
})
