/**
 * The blocks pages (#1112) — functions first, main program after, and never a
 * block cut in half.
 *
 * #1105 asks for "try not to break the blocks across pages". Rather than
 * screenshotting the whole canvas and slicing the bitmap, each top-level stack
 * is captured as its OWN image and whole stacks are packed onto pages. That
 * makes the promise true by construction: a stack is atomic, and a page is a
 * set of whole stacks.
 *
 * Each stack is headed by a caption — its name at the section heading's size,
 * and, for a function with a docstring, that docstring set underneath it as a
 * description (#1147). The caption is MEASURED before the page is planned, so
 * the room it takes is room the stack does not.
 *
 * Everything in this module is pure arithmetic over sizes — the capturing lives
 * in `lib/pdf/capture.ts`, which is the part that needs a DOM.
 */

import { type Box, type LaidOutPage, type PdfDocument, wrapText } from '../layout'
import type { PdfImageRef } from '../writer'
import { INK, INK_MUTED, PAPER } from '../theme'
import { SECTION_HEADING_HEIGHT, drawSectionHeading } from './listing'

/** A captured top-level stack, at its natural size in points. */
export interface StackGeometry {
  /** The top block's id — the same id the generator's `functions` list uses. */
  id: string
  width: number
  height: number
  /** A caption printed above the stack, e.g. `Function: blink`. */
  label?: string
  /**
   * The function's docstring, printed under its name as a description (#1147).
   *
   * A `def` block's description IS its docstring — `lib/blocks/docstring.ts`
   * makes the comment bubble and the `"""…"""` line one idea in two
   * notations — so what the learner wrote about the function travels onto the
   * page with it.
   */
  description?: string
}

/** A stack placed on a page, in top-left document coordinates. */
export interface PlacedStack<T> {
  stack: T
  x: number
  y: number
  width: number
  height: number
  /** The name-and-description block sitting directly above `y`. */
  caption: Caption
}

/** Space between two stacks on a page. */
const STACK_GAP = 20

/**
 * A stack's name is set at the SECTION HEADING's size (#1147).
 *
 * `Function: blink` heads its own little section of the document, so it is
 * lettered like one: the same 13pt Helvetica-Bold ink as the `Blocks` heading
 * above it, rather than the 9pt muted caption it used to be.
 */
export const LABEL_SIZE = 13
/** Room reserved above a stack for its name, baseline and descender included. */
const LABEL_HEIGHT = 19
/** The docstring description under the name. */
export const DESCRIPTION_SIZE = 9.5
/** Baseline-to-baseline for a wrapped description. */
const DESCRIPTION_LEADING = 12
/** Breathing room between a caption and the stack it heads. */
const CAPTION_GAP = 5

/**
 * Functions first, in the order the GENERATOR hoisted them, then everything
 * else in workspace order.
 *
 * The function ids come from `GeneratedProgram.functions`, so the PDF's ordering
 * and the generated `.py` agree by construction. If they ever disagree, that is
 * a bug in one of them rather than a difference of opinion between two ideas of
 * what a function is.
 */
export function orderStacks<T extends { id: string }>(
  stacks: readonly T[],
  functionIds: readonly string[]
): T[] {
  const byId = new Map(stacks.map((s) => [s.id, s]))
  const functions: T[] = []
  const seen = new Set<string>()
  for (const id of functionIds) {
    const stack = byId.get(id)
    if (!stack || seen.has(id)) continue
    functions.push(stack)
    seen.add(id)
  }
  return [...functions, ...stacks.filter((s) => !seen.has(s.id))]
}

/**
 * A stack's caption — its name, and the description wrapped to the page.
 *
 * Measured once, by {@link captionFor}, and carried on the {@link PlacedStack}:
 * the planner has to know how tall it is to leave room for it, and the drawing
 * has to set exactly the lines that were measured, so a wrap that disagreed
 * between the two would push a stack off the bottom of the page.
 */
export interface Caption {
  /** The name line, e.g. `Function: blink`. */
  label?: string
  /** The description, already wrapped to the content width. */
  lines: string[]
  /** Total height, gap to the stack included. Zero when there is no caption. */
  height: number
}

/**
 * Measure a stack's caption at `width`.
 *
 * A docstring's own line breaks are kept — a PEP 257 summary line followed by a
 * paragraph is a shape somebody chose — and each of those lines is then wrapped
 * to the page. Blank lines separate paragraphs rather than accumulating.
 */
export function captionFor(stack: StackGeometry, width: number): Caption {
  const lines: string[] = []
  const description = (stack.description ?? '').replace(/\r\n?/g, '\n').trim()
  if (description && width > 0) {
    for (const paragraph of description.split('\n')) {
      if (paragraph.trim() === '') {
        // Never open with a blank, and never double one.
        if (lines.length && lines[lines.length - 1] !== '') lines.push('')
        continue
      }
      lines.push(...wrapText(paragraph.trim(), 'Helvetica', DESCRIPTION_SIZE, width))
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
  }
  const label = stack.label
  if (!label && !lines.length) return { lines: [], height: 0 }
  return {
    label,
    lines,
    height: (label ? LABEL_HEIGHT : 0) + lines.length * DESCRIPTION_LEADING + CAPTION_GAP
  }
}

/** Draw a caption at `x`, its block ending at `bottom` — the stack's top edge. */
function drawCaption(page: LaidOutPage, caption: Caption, x: number, bottom: number): void {
  if (caption.height <= 0) return
  const top = bottom - caption.height
  if (caption.label) {
    page.text(caption.label, x, top + LABEL_SIZE, {
      font: 'Helvetica-Bold',
      size: LABEL_SIZE,
      color: INK
    })
  }
  let baseline = top + (caption.label ? LABEL_HEIGHT : 0) + DESCRIPTION_SIZE
  for (const line of caption.lines) {
    if (line) {
      page.text(line, x, baseline, { size: DESCRIPTION_SIZE, color: INK_MUTED })
    }
    baseline += DESCRIPTION_LEADING
  }
}

/**
 * Scale and place every stack, page by page.
 *
 * A stack TALLER (or wider) than a page is scaled down to fit — scaling is
 * fine, clipping is not — and then, being a whole page's worth, gets a page to
 * itself. A stack is never split.
 */
export function planBlocksPages<T extends StackGeometry>(
  stacks: readonly T[],
  box: Box,
  opts: { gap?: number } = {}
): PlacedStack<T>[][] {
  const gap = opts.gap ?? STACK_GAP
  const pages: PlacedStack<T>[][] = []
  let current: PlacedStack<T>[] = []
  let cursor = box.y

  for (const stack of stacks) {
    if (stack.width <= 0 || stack.height <= 0) continue
    const caption = captionFor(stack, box.width)
    // A caption taller than the page would otherwise scale the stack to nothing
    // (or to a negative size); leave it a sliver of room rather than an
    // impossible one. That only happens for a docstring of several pages.
    const room = Math.max(1, box.height - caption.height)
    const scale = Math.min(1, box.width / stack.width, room / stack.height)
    const width = stack.width * scale
    const height = stack.height * scale
    const needed = caption.height + height

    if (current.length && cursor + needed > box.y + box.height) {
      pages.push(current)
      current = []
      cursor = box.y
    }
    current.push({
      stack,
      x: box.x + (box.width - width) / 2,
      y: cursor + caption.height,
      width,
      height,
      caption
    })
    cursor += needed + gap
  }
  if (current.length) pages.push(current)
  return pages
}

/** A stack ready to draw: geometry plus the image registered with the document. */
export interface DrawableStack extends StackGeometry {
  image: PdfImageRef
}

/**
 * Draw the blocks pages, returning them.
 *
 * No stacks means NO pages — a project with no blocks (a plain hand-written
 * `.py`) skips the section cleanly rather than leaving an empty page or a
 * heading with nothing under it.
 */
export function drawBlocksPages(
  doc: PdfDocument,
  stacks: readonly DrawableStack[],
  opts: { heading?: string } = {}
): LaidOutPage[] {
  if (!stacks.length) return []
  const heading = opts.heading ?? 'Blocks'

  // Plan against the geometry every page shares, BEFORE adding one: stacks that
  // all turn out to be unmeasurable must leave no blank page behind (#1108).
  const box = doc.contentBox
  const body: Box = {
    x: box.x,
    y: box.y + SECTION_HEADING_HEIGHT,
    width: box.width,
    height: box.height - SECTION_HEADING_HEIGHT
  }

  const planned = planBlocksPages(stacks, body)
  const out: LaidOutPage[] = []
  planned.forEach((placements, i) => {
    const page = doc.newPage()
    out.push(page)
    page.rect({ x: 0, y: 0, width: doc.size.width, height: doc.size.height }, { fill: PAPER })
    drawSectionHeading(page, i === 0 ? heading : `${heading} (continued)`)
    for (const placed of placements) {
      drawCaption(page, placed.caption, box.x, placed.y)
      page.image(placed.stack.image, placed)
    }
  })
  return out
}
