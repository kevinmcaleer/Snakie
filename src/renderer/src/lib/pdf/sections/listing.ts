/**
 * The MicroPython code listing (#1107).
 *
 * REAL PDF text in `/Courier` — selectable and copyable, not a screenshot —
 * with line numbers in a gutter and long lines wrapped at the content width.
 *
 * The wrap indent is drawn as an x OFFSET rather than as spaces in the string,
 * and the continuation's gutter mark is a separate piece of text, so nothing the
 * layout adds ends up in what a reader copies back out.
 */

import { stripBlocksFooter } from '../../../../../shared/blocks-doc'
import { type Box, type LaidOutPage, type PdfDocument, expandTabs, packUnits } from '../layout'
import { COURIER_WIDTH, courierCharsPerLine } from '../metrics'
import { GUTTER, INK, INK_MUTED, PAPER, RULE } from '../theme'

/** One printed row: a source line, or one of its wrapped continuations. */
export interface ListingRow {
  /** The 1-based source line number, or null on a continuation. */
  number: number | null
  /** The text to show — free of any layout scaffolding. */
  text: string
  /** Columns to shift the text right by (continuations only). */
  indent: number
}

/** Columns a wrapped continuation is indented by, so it does not read as a
 *  statement of its own. */
export const CONTINUATION_INDENT = 2

/** The mark drawn in the gutter beside a continuation, in place of a number. */
const CONTINUATION_MARK = '·'

/**
 * Choose the text to print, in the same precedence the Blocks view shows it
 * (`BlocksSplit.tsx`): the learner's own draft while they are typing it, the
 * generator's output otherwise, the file's stored code until there is any.
 *
 * A blocks project stores its workspace in a footer appended to the `.py`
 * (`shared/blocks-doc.ts`), and that footer — a marker plus a screenful of
 * base64 — must never appear in the printed listing.
 */
export function codeForListing(sources: {
  /** What the user is typing in the Python pane, if anything. */
  draft?: string | null
  /** The generator's output for a blocks project. */
  generated?: string | null
  /** The file's stored content. */
  stored?: string | null
}): string {
  const chosen = sources.draft ?? sources.generated ?? sources.stored ?? ''
  return stripBlocksFooter(chosen).replace(/\s+$/, '')
}

/** Split `code` into rows, wrapping anything wider than `cols`. */
export function layOutListing(code: string, cols: number, tabWidth = 4): ListingRow[] {
  const rows: ListingRow[] = []
  if (cols <= 0) return rows
  const lines = code.split('\n')
  const contCols = Math.max(1, cols - CONTINUATION_INDENT)
  lines.forEach((raw, i) => {
    const line = expandTabs(raw, tabWidth).replace(/\s+$/, '')
    rows.push({ number: i + 1, text: line.slice(0, cols), indent: 0 })
    let rest = line.slice(cols)
    while (rest.length > 0) {
      rows.push({ number: null, text: rest.slice(0, contCols), indent: CONTINUATION_INDENT })
      rest = rest.slice(contCols)
    }
  })
  return rows
}

/**
 * Pack rows into pages of `capacity`, keeping a source line and its
 * continuations together — a continuation stranded at the top of the next page,
 * away from the line it continues, is the orphan #1111 is about.
 *
 * A single line too long to fit a whole page is split anyway; there is nowhere
 * else for it to go.
 */
export function paginateListing(rows: readonly ListingRow[], capacity: number): ListingRow[][] {
  if (capacity <= 0) return rows.length ? [[...rows]] : []
  const groups: ListingRow[][] = []
  for (const row of rows) {
    if (row.number !== null || !groups.length) groups.push([row])
    else groups[groups.length - 1].push(row)
  }
  const splittable: ListingRow[][] = []
  for (const group of groups) {
    for (let i = 0; i < group.length; i += capacity) splittable.push(group.slice(i, i + capacity))
  }
  return packUnits(
    splittable.map((group) => ({ item: group, size: group.length })),
    capacity
  ).map((page) => page.flat())
}

/** How the listing is set. */
export interface ListingOptions {
  /** The code to print — already chosen and footer-free. */
  code: string
  /** Section heading. */
  heading?: string
  fontSize?: number
  tabWidth?: number
}

const DEFAULT_FONT_SIZE = 8.5
/** Vertical space a section heading and its rule occupy. */
export const SECTION_HEADING_HEIGHT = 32

/** Width of the line-number gutter, sized for the highest number present. */
function gutterWidth(maxLine: number, fontSize: number): number {
  const digits = Math.max(3, String(Math.max(1, maxLine)).length)
  return ((digits + 2) * COURIER_WIDTH * fontSize) / 1000
}

/** Draw a section heading at the top of `page`'s content box, returning the y
 *  the body should start at. */
export function drawSectionHeading(page: LaidOutPage, heading: string): number {
  const box = page.content
  page.text(heading, box.x, box.y + 12, { font: 'Helvetica-Bold', size: 13, color: INK })
  page.line(box.x, box.y + 20, box.x + box.width, box.y + 20, { color: RULE, width: 0.75 })
  return box.y + SECTION_HEADING_HEIGHT
}

/**
 * Draw the listing across as many pages as it needs, returning them.
 *
 * Empty code draws nothing at all — a section heading with nothing under it is
 * worse than no section (#1108).
 */
export function drawListing(doc: PdfDocument, opts: ListingOptions): LaidOutPage[] {
  const code = opts.code.replace(/\s+$/, '')
  if (!code) return []

  const fontSize = opts.fontSize ?? DEFAULT_FONT_SIZE
  const leading = fontSize * 1.34
  const charWidth = (COURIER_WIDTH * fontSize) / 1000
  const lineCount = code.split('\n').length
  // Plan against the geometry every page shares, BEFORE adding one: a section
  // that turns out to need no pages must leave none behind (#1108).
  const box: Box = doc.contentBox
  const gutter = gutterWidth(lineCount, fontSize)
  const textX = box.x + gutter + 6
  const cols = courierCharsPerLine(box.x + box.width - textX, fontSize)
  const capacity = Math.max(1, Math.floor((box.height - SECTION_HEADING_HEIGHT) / leading))

  const pagesOfRows = paginateListing(layOutListing(code, cols, opts.tabWidth), capacity)
  const heading = opts.heading ?? 'MicroPython'
  const out: LaidOutPage[] = []

  pagesOfRows.forEach((rows, i) => {
    const page = doc.newPage()
    out.push(page)
    page.rect({ x: 0, y: 0, width: doc.size.width, height: doc.size.height }, { fill: PAPER })
    const top = drawSectionHeading(page, i === 0 ? heading : `${heading} (continued)`)
    const bodyHeight = rows.length * leading

    page.rect(
      { x: box.x, y: top - leading + 2, width: gutter, height: bodyHeight },
      { fill: GUTTER }
    )
    page.line(box.x + gutter, top - leading + 2, box.x + gutter, top - leading + 2 + bodyHeight, {
      color: RULE,
      width: 0.75
    })

    rows.forEach((row, n) => {
      const y = top + n * leading
      if (row.number === null) {
        page.text(CONTINUATION_MARK, box.x + gutter - charWidth, y, {
          font: 'Courier',
          size: fontSize,
          color: INK_MUTED,
          align: 'right'
        })
      } else {
        page.text(String(row.number), box.x + gutter - charWidth, y, {
          font: 'Courier',
          size: fontSize,
          color: INK_MUTED,
          align: 'right'
        })
      }
      if (row.text) {
        page.text(row.text, textX + row.indent * charWidth, y, {
          font: 'Courier',
          size: fontSize,
          color: INK
        })
      }
    })
  })

  return out
}
