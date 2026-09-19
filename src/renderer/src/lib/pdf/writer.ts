/**
 * A small, dependency-free multi-page PDF writer (#1113).
 *
 * It grew out of {@link buildImagePdf} in `components/svg-export.ts`, which
 * hand-assembled a single image-only page. The epic (#1105) needs a *document* —
 * a title page, blocks pages, a code listing, a wiring page and a closing page —
 * so this generalises that trick to:
 *
 *  - many pages, under a proper `/Pages` tree with a truthful `/Count`,
 *  - base-14 text (`/Helvetica`, `/Helvetica-Bold`, `/Courier`), which needs no
 *    font embedding — so the listing is REAL selectable text, not a picture of
 *    text, and anyone can copy a snippet back out,
 *  - several `/DCTDecode` (JPEG) image XObjects per document,
 *  - `/URI` link annotations, for the closing page's links.
 *
 * Getting the bytes right, since a wrong offset opens in one reader and not
 * another:
 *
 *  - xref entries are BYTE offsets, so every chunk is measured as bytes.
 *  - `/Length` is taken from the ENCODED stream, never `String.length`.
 *  - text is WinAnsi (see `winansi.ts`) — one byte per glyph, substituting
 *    rather than emitting something malformed.
 *  - `(`, `)` and `\` are escaped inside every string literal.
 */

import { ContentStream } from './content'
import { encodeWinAnsi, pdfString } from './winansi'

/** A JPEG ready to be embedded as an image XObject. */
export interface PdfImageData {
  jpeg: Uint8Array
  /** Pixel width — the XObject's `/Width`, not its placed size. */
  width: number
  /** Pixel height — the XObject's `/Height`, not its placed size. */
  height: number
  colorSpace?: 'DeviceRGB' | 'DeviceGray'
}

/** An opaque handle to an image registered with {@link PdfWriter.addImage}. */
export interface PdfImageRef {
  readonly index: number
  readonly width: number
  readonly height: number
}

/** Document metadata for the `/Info` dictionary. */
export interface PdfInfo {
  title?: string
  author?: string
  subject?: string
  /** Defaults to `Snakie`. */
  producer?: string
  /** A PDF date string, e.g. `D:20260919120000Z`. Omitted when absent, which
   *  keeps an export byte-for-byte reproducible (#1108). */
  creationDate?: string
}

/** A link annotation in raw PDF user space (origin bottom-left). */
interface LinkAnnot {
  x: number
  y: number
  w: number
  h: number
  url: string
}

/** One page under construction. */
export class PdfPageBuilder {
  /** Operators for this page, in raw PDF user space (origin bottom-left). */
  readonly content = new ContentStream()
  private readonly images: PdfImageRef[] = []
  private readonly links: LinkAnnot[] = []

  constructor(
    readonly width: number,
    readonly height: number
  ) {}

  /** Publish `image` in this page's `/XObject` resources, returning its name. */
  useImage(image: PdfImageRef): string {
    const existing = this.images.indexOf(image)
    if (existing >= 0) return `Im${existing}`
    this.images.push(image)
    return `Im${this.images.length - 1}`
  }

  /** Register + draw in one step: the common case. */
  drawImage(image: PdfImageRef, x: number, y: number, w: number, h: number): void {
    this.content.image(this.useImage(image), x, y, w, h)
  }

  /**
   * Make the rectangle whose lower-left corner is (`x`, `y`) a clickable link to
   * `url`. A printed URL that isn't a link is a small, avoidable disappointment.
   */
  link(x: number, y: number, w: number, h: number, url: string): void {
    this.links.push({ x, y, w, h, url })
  }

  /** @internal */
  get imageRefs(): readonly PdfImageRef[] {
    return this.images
  }

  /** @internal */
  get linkAnnots(): readonly LinkAnnot[] {
    return this.links
  }
}

/** The `/Font` entries every page carries. Three tiny dictionaries, shared. */
const FONTS: ReadonlyArray<readonly [resource: string, baseFont: string]> = [
  ['F1', 'Helvetica'],
  ['F2', 'Helvetica-Bold'],
  ['F3', 'Courier']
]

/** The four high bytes conventionally placed after the header so that tools
 *  treating the file as text notice it is binary. */
const BINARY_MARKER = new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])

/**
 * Collects pages and images, then assembles the file.
 *
 * Pure and DOM-free on purpose: it unit-tests in node, which is where the xref
 * invariants are actually worth asserting.
 */
export class PdfWriter {
  private readonly pages: PdfPageBuilder[] = []
  private readonly images: PdfImageData[] = []

  constructor(private readonly info: PdfInfo = {}) {}

  /** Register a JPEG once; the handle may be drawn on any number of pages. */
  addImage(data: PdfImageData): PdfImageRef {
    const index = this.images.length
    this.images.push(data)
    return { index, width: data.width, height: data.height }
  }

  /** Append a page of `width`×`height` POINTS and return it for drawing. */
  addPage(width: number, height: number): PdfPageBuilder {
    const page = new PdfPageBuilder(width, height)
    this.pages.push(page)
    return page
  }

  /** How many pages have been added so far. */
  get pageCount(): number {
    return this.pages.length
  }

  /** Assemble the document bytes. */
  build(): Uint8Array<ArrayBuffer> {
    if (!this.pages.length) throw new Error('A PDF needs at least one page')

    const chunks: Uint8Array[] = []
    let length = 0
    /** Byte offset of object N, indexed by `N - 1`. */
    const offsets: number[] = []

    const push = (chunk: Uint8Array | string): void => {
      // encodeWinAnsi, NOT TextEncoder: one byte per character, so what we
      // measure here is exactly what a reader will see.
      const u = typeof chunk === 'string' ? encodeWinAnsi(chunk) : chunk
      chunks.push(u)
      length += u.length
    }

    // --- object numbering -------------------------------------------------
    // Every number is settled before a byte is written, because /Pages must
    // list its kids and a page must point back at its parent.
    let next = 1
    const catalogId = next++
    const pagesId = next++
    const fontIds = FONTS.map(() => next++)
    const imageIds = this.images.map(() => next++)
    const pageIds: number[] = []
    const contentIds: number[] = []
    const annotIds: number[][] = []
    for (const page of this.pages) {
      pageIds.push(next++)
      contentIds.push(next++)
      annotIds.push(page.linkAnnots.map(() => next++))
    }
    const infoId = next++ // /Producer is always written, so there is always an /Info dict.
    const objectCount = next - 1

    /** Open object `id`, recording where its `N 0 obj` starts. */
    const beginObj = (id: number): void => {
      offsets[id - 1] = length
      push(`${id} 0 obj\n`)
    }
    const endObj = (): void => push('endobj\n')

    // --- header -----------------------------------------------------------
    push('%PDF-1.4\n')
    push(BINARY_MARKER)

    // --- catalog + page tree ---------------------------------------------
    beginObj(catalogId)
    push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>\n`)
    endObj()

    beginObj(pagesId)
    const kids = pageIds.map((id) => `${id} 0 R`).join(' ')
    push(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>\n`)
    endObj()

    // --- fonts ------------------------------------------------------------
    FONTS.forEach(([, baseFont], i) => {
      beginObj(fontIds[i])
      push(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont} ` + `/Encoding /WinAnsiEncoding >>\n`
      )
      endObj()
    })

    // --- images -----------------------------------------------------------
    this.images.forEach((img, i) => {
      beginObj(imageIds[i])
      push(
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(img.width)} ` +
          `/Height ${Math.round(img.height)} /ColorSpace /${img.colorSpace ?? 'DeviceRGB'} ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
      )
      push(img.jpeg)
      push('\nendstream\n')
      endObj()
    })

    // --- pages ------------------------------------------------------------
    this.pages.forEach((page, i) => {
      const fontRes = FONTS.map(([res], f) => `/${res} ${fontIds[f]} 0 R`).join(' ')
      const xobjRes = page.imageRefs.length
        ? ` /XObject << ${page.imageRefs
            .map((ref, n) => `/Im${n} ${imageIds[ref.index]} 0 R`)
            .join(' ')} >>`
        : ''
      const annots = annotIds[i].length
        ? ` /Annots [${annotIds[i].map((id) => `${id} 0 R`).join(' ')}]`
        : ''
      beginObj(pageIds[i])
      push(
        `<< /Type /Page /Parent ${pagesId} 0 R ` +
          `/MediaBox [0 0 ${fmt(page.width)} ${fmt(page.height)}] ` +
          `/Resources << /Font << ${fontRes} >>${xobjRes} >> ` +
          `/Contents ${contentIds[i]} 0 R${annots} >>\n`
      )
      endObj()

      // The stream is encoded FIRST so /Length is the byte count, not a guess.
      const streamBytes = encodeWinAnsi(page.content.toString())
      beginObj(contentIds[i])
      push(`<< /Length ${streamBytes.length} >>\nstream\n`)
      push(streamBytes)
      push('\nendstream\n')
      endObj()

      page.linkAnnots.forEach((a, n) => {
        beginObj(annotIds[i][n])
        push(
          `<< /Type /Annot /Subtype /Link ` +
            `/Rect [${fmt(a.x)} ${fmt(a.y)} ${fmt(a.x + a.w)} ${fmt(a.y + a.h)}] ` +
            `/Border [0 0 0] /A << /S /URI /URI ${pdfString(a.url)} >> >>\n`
        )
        endObj()
      })
    })

    // --- info -------------------------------------------------------------
    {
      beginObj(infoId)
      const entries: string[] = []
      const { title, author, subject, creationDate } = this.info
      if (title) entries.push(`/Title ${pdfString(title)}`)
      if (author) entries.push(`/Author ${pdfString(author)}`)
      if (subject) entries.push(`/Subject ${pdfString(subject)}`)
      entries.push(`/Producer ${pdfString(this.info.producer ?? 'Snakie')}`)
      if (creationDate) entries.push(`/CreationDate ${pdfString(creationDate)}`)
      push(`<< ${entries.join(' ')} >>\n`)
      endObj()
    }

    // --- xref + trailer ---------------------------------------------------
    const startxref = length
    let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`
    for (let id = 1; id <= objectCount; id++) {
      const off = offsets[id - 1]
      /* c8 ignore next */
      if (off === undefined) throw new Error(`PDF object ${id} was numbered but never written`)
      xref += `${off.toString().padStart(10, '0')} 00000 n \n`
    }
    push(xref)
    push(
      `trailer\n<< /Size ${objectCount + 1} /Root ${catalogId} 0 R` +
        ` /Info ${infoId} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`
    )

    const out = new Uint8Array(length)
    let pos = 0
    for (const c of chunks) {
      out.set(c, pos)
      pos += c.length
    }
    return out
  }
}

/** Round a page/rect coordinate to 4 decimals for the object dictionaries. */
function fmt(n: number): string {
  const r = Math.round(n * 10000) / 10000
  return Number.isInteger(r) ? String(r) : r.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}
