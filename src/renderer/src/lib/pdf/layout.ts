/**
 * Page geometry, running furniture and text flow (#1111) — the layer between
 * "I can emit PDF objects" and "I have a page that looks like a page".
 *
 * Everything here works in TOP-LEFT document coordinates (y grows downward,
 * like reading order); {@link LaidOutPage} is the single place that flips into
 * PDF's bottom-left user space.
 *
 * Measurement is exact rather than approximate. `/Courier` advances 600/1000 em
 * for every glyph, so the number of characters on a listing line is arithmetic —
 * which is why this module is pure, node-testable, and has no DOM in it at all.
 */

import { type PdfFont, textWidth } from './metrics'
import { type PaintMode, type Rgb, hexRgb } from './content'
import { type PdfImageRef, type PdfInfo, PdfPageBuilder, PdfWriter } from './writer'

/** A page size in POINTS. */
export interface PageSize {
  width: number
  height: number
}

/** ISO A4 — the default, but a parameter rather than a constant sprinkled about. */
export const A4: PageSize = { width: 595.28, height: 841.89 }

/** US Letter, for anyone who would rather print on it. */
export const LETTER: PageSize = { width: 612, height: 792 }

/** Page margins in points. */
export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export const DEFAULT_MARGINS: Margins = { top: 54, right: 54, bottom: 54, left: 54 }

/** A rectangle in top-left document coordinates. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The footer's ink — quiet enough not to compete with the page. */
const FOOTER_COLOR: Rgb = hexRgb('#8a8477')
const FOOTER_SIZE = 8
/** Distance from the page's bottom edge up to the footer baseline. */
const FOOTER_BASELINE = 30

/**
 * One page, addressed from its top-left corner.
 *
 * `y` for text is the BASELINE's distance from the top of the page: flowing text
 * then means advancing y by the leading, which is the thing every caller wants
 * to do.
 */
export class LaidOutPage {
  /** The content box every section lays out inside. */
  readonly content: Box

  constructor(
    readonly page: PdfPageBuilder,
    readonly size: PageSize,
    readonly margins: Margins,
    /** Whether the running footer is stamped on this page. */
    readonly showFooter: boolean
  ) {
    this.content = {
      x: margins.left,
      y: margins.top,
      width: size.width - margins.left - margins.right,
      height: size.height - margins.top - margins.bottom
    }
  }

  /** Flip a top-left y into PDF user space. */
  private flip(y: number): number {
    return this.size.height - y
  }

  /** Show `text` with its baseline `y` points below the top of the page. */
  text(
    text: string,
    x: number,
    y: number,
    opts: { font?: PdfFont; size?: number; color?: Rgb; align?: 'left' | 'center' | 'right' } = {}
  ): void {
    this.page.content.text(text, x, this.flip(y), opts)
  }

  /** A rectangle whose TOP-left corner is (`x`, `y`). */
  rect(box: Box, opts: { fill?: Rgb; stroke?: Rgb; lineWidth?: number } = {}): void {
    const cs = this.page.content
    cs.save()
    let mode: PaintMode = 'fill'
    if (opts.fill) cs.fillColor(opts.fill)
    if (opts.stroke) {
      cs.strokeColor(opts.stroke)
      cs.lineWidth(opts.lineWidth ?? 1)
      mode = opts.fill ? 'fillStroke' : 'stroke'
    }
    cs.rect(box.x, this.flip(box.y + box.height), box.width, box.height, mode)
    cs.restore()
  }

  /** A straight rule between two top-left points. */
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    opts: { color?: Rgb; width?: number } = {}
  ): void {
    const cs = this.page.content
    cs.save()
    cs.strokeColor(opts.color ?? FOOTER_COLOR)
    cs.lineWidth(opts.width ?? 0.75)
    cs.line(x1, this.flip(y1), x2, this.flip(y2))
    cs.restore()
  }

  /** Place an image into `box` (top-left coordinates), exactly as given. */
  image(ref: PdfImageRef, box: Box): void {
    this.page.drawImage(ref, box.x, this.flip(box.y + box.height), box.width, box.height)
  }

  /** Place an image scaled to fit `box`, preserving its aspect ratio. */
  imageFitted(ref: PdfImageRef, box: Box): Box {
    const fitted = fitBox(ref.width, ref.height, box)
    this.image(ref, fitted)
    return fitted
  }

  /** Make `box` clickable. */
  link(box: Box, url: string): void {
    this.page.link(box.x, this.flip(box.y + box.height), box.width, box.height, url)
  }

  /**
   * Flow `text` into `width`, one wrapped line per `leading`, starting with its
   * first baseline at `y`. Returns the baseline the NEXT line would take, so
   * sections can stack without each one re-deriving the leading.
   */
  paragraph(
    text: string,
    x: number,
    y: number,
    opts: {
      width: number
      font?: PdfFont
      size?: number
      color?: Rgb
      align?: 'left' | 'center' | 'right'
      leading?: number
    }
  ): number {
    const font = opts.font ?? 'Helvetica'
    const size = opts.size ?? 11
    const leading = opts.leading ?? size * 1.45
    let baseline = y
    for (const line of wrapText(text, font, size, opts.width)) {
      if (line) this.text(line, x, baseline, { font, size, color: opts.color, align: opts.align })
      baseline += leading
    }
    return baseline
  }

  /** A link whose hit box is derived from a piece of text already drawn. */
  linkText(
    text: string,
    x: number,
    baselineY: number,
    url: string,
    opts: { font?: PdfFont; size?: number; align?: 'left' | 'center' | 'right' } = {}
  ): void {
    const font = opts.font ?? 'Helvetica'
    const size = opts.size ?? 11
    const w = textWidth(text, font, size)
    const align = opts.align ?? 'left'
    const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    // A hit box a shade taller than the glyphs, so the link is easy to hit.
    this.link({ x: left, y: baselineY - size * 0.82, width: w, height: size * 1.1 }, url)
  }
}

/** Options for a {@link PdfDocument}. */
export interface DocumentOptions {
  size?: PageSize
  margins?: Margins
  info?: PdfInfo
  /** Shown at the footer's left on every numbered page. */
  footerLabel?: string
}

/**
 * A paginated document: pages with a shared geometry and a running footer.
 *
 * Footers are stamped in {@link build}, once the page count is known — which is
 * the only way "Page 3 of 12" can be honest.
 */
export class PdfDocument {
  readonly writer: PdfWriter
  readonly size: PageSize
  readonly margins: Margins
  private readonly pages: LaidOutPage[] = []
  private readonly footerLabel: string

  constructor(opts: DocumentOptions = {}) {
    this.size = opts.size ?? A4
    this.margins = opts.margins ?? DEFAULT_MARGINS
    this.footerLabel = opts.footerLabel ?? ''
    this.writer = new PdfWriter(opts.info)
  }

  /**
   * Append a page. `footer` defaults to true — the title page is the one that
   * should pass false, since a cover with a page number on it looks like a
   * mistake.
   */
  newPage(opts: { footer?: boolean } = {}): LaidOutPage {
    const page = new LaidOutPage(
      this.writer.addPage(this.size.width, this.size.height),
      this.size,
      this.margins,
      opts.footer ?? true
    )
    this.pages.push(page)
    return page
  }

  get pageCount(): number {
    return this.pages.length
  }

  /**
   * The content box every page of this document will have.
   *
   * Every page shares one geometry, so a section can PLAN its pagination before
   * it adds a page — which is how a section that turns out to be empty manages
   * to leave no blank page behind (#1108).
   */
  get contentBox(): Box {
    return {
      x: this.margins.left,
      y: this.margins.top,
      width: this.size.width - this.margins.left - this.margins.right,
      height: this.size.height - this.margins.top - this.margins.bottom
    }
  }

  /** Register a JPEG for use on any page. */
  addImage(data: Parameters<PdfWriter['addImage']>[0]): PdfImageRef {
    return this.writer.addImage(data)
  }

  /** Stamp the running footers, then assemble the bytes. */
  build(): Uint8Array<ArrayBuffer> {
    const total = this.pages.length
    this.pages.forEach((page, i) => {
      if (!page.showFooter) return
      const y = this.size.height - FOOTER_BASELINE
      if (this.footerLabel) {
        page.text(this.footerLabel, page.content.x, y, {
          size: FOOTER_SIZE,
          color: FOOTER_COLOR
        })
      }
      page.text(`Page ${i + 1} of ${total}`, page.content.x + page.content.width, y, {
        size: FOOTER_SIZE,
        color: FOOTER_COLOR,
        align: 'right'
      })
    })
    return this.writer.build()
  }
}

/**
 * Scale `srcW`×`srcH` to fit inside `box` without distortion, centred. An image
 * SMALLER than the box is left at its natural size rather than blown up, since
 * enlarging a raster only makes it softer.
 */
export function fitBox(srcW: number, srcH: number, box: Box): Box {
  if (srcW <= 0 || srcH <= 0) return { ...box }
  const scale = Math.min(box.width / srcW, box.height / srcH, 1)
  const width = srcW * scale
  const height = srcH * scale
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height
  }
}

/** Expand tabs to `tabWidth` columns, so a line measures the same as it prints. */
export function expandTabs(line: string, tabWidth = 4): string {
  let out = ''
  for (const ch of line) {
    if (ch === '\t') out += ' '.repeat(tabWidth - (out.length % tabWidth))
    else out += ch
  }
  return out
}

/**
 * Break one monospaced line into display lines of at most `cols` characters,
 * indenting every continuation by `continuationIndent` so a wrap does not read
 * as a new statement.
 *
 * Returns `['']` for an empty line: a blank line in a listing is a line.
 */
export function wrapMonospace(line: string, cols: number, continuationIndent = 0): string[] {
  if (cols <= 0) return [line]
  if (line.length <= cols) return [line]
  const indent = ' '.repeat(Math.max(0, Math.min(continuationIndent, cols - 1)))
  const out: string[] = [line.slice(0, cols)]
  let rest = line.slice(cols)
  const room = cols - indent.length
  while (rest.length > 0) {
    out.push(indent + rest.slice(0, room))
    rest = rest.slice(room)
  }
  return out
}

/**
 * Greedy word wrap for proportional text, measured with the real font metrics.
 * A single word longer than `width` is broken rather than allowed to run off
 * the edge.
 */
export function wrapText(text: string, font: PdfFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (textWidth(candidate, font, size) <= width) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      if (textWidth(word, font, size) <= width) {
        current = word
        continue
      }
      // A single over-long word: break it at the last character that fits.
      let chunk = ''
      for (const ch of word) {
        if (textWidth(chunk + ch, font, size) > width && chunk) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      current = chunk
    }
    if (current) lines.push(current)
  }
  return lines
}

/** An indivisible run of content, measured in whatever unit `capacity` uses. */
export interface PackUnit<T> {
  item: T
  /** The unit's extent — lines for text, points for an image. */
  size: number
}

/**
 * Pack units into pages of `capacity`, NEVER splitting a unit.
 *
 * This is what makes "don't break a block across a page" (#1112) and "don't
 * strand a wrapped continuation" (#1111) true by construction rather than by
 * fiddling with offsets: a unit is atomic, and a page is a set of whole units.
 *
 * A unit larger than `capacity` gets a page to itself — the caller is expected
 * to have scaled it down first, since clipping is not an option.
 */
export function packUnits<T>(units: ReadonlyArray<PackUnit<T>>, capacity: number): T[][] {
  const pages: T[][] = []
  let current: T[] = []
  let used = 0
  for (const unit of units) {
    if (current.length && used + unit.size > capacity) {
      pages.push(current)
      current = []
      used = 0
    }
    current.push(unit.item)
    used += unit.size
  }
  if (current.length) pages.push(current)
  return pages
}
