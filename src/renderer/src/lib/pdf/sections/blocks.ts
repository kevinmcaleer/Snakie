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
 * Everything in this module is pure arithmetic over sizes — the capturing lives
 * in `lib/pdf/capture.ts`, which is the part that needs a DOM.
 */

import { type Box, type LaidOutPage, type PdfDocument } from '../layout'
import type { PdfImageRef } from '../writer'
import { INK_MUTED, PAPER } from '../theme'
import { SECTION_HEADING_HEIGHT, drawSectionHeading } from './listing'

/** A captured top-level stack, at its natural size in points. */
export interface StackGeometry {
  /** The top block's id — the same id the generator's `functions` list uses. */
  id: string
  width: number
  height: number
  /** A caption printed above the stack, e.g. `Function: blink`. */
  label?: string
}

/** A stack placed on a page, in top-left document coordinates. */
export interface PlacedStack<T> {
  stack: T
  x: number
  y: number
  width: number
  height: number
}

/** Space between two stacks on a page. */
const STACK_GAP = 20
/** Room reserved above a stack for its caption. */
const LABEL_HEIGHT = 14

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
    const labelRoom = stack.label ? LABEL_HEIGHT : 0
    const scale = Math.min(1, box.width / stack.width, (box.height - labelRoom) / stack.height)
    const width = stack.width * scale
    const height = stack.height * scale
    const needed = labelRoom + height

    if (current.length && cursor + needed > box.y + box.height) {
      pages.push(current)
      current = []
      cursor = box.y
    }
    current.push({
      stack,
      x: box.x + (box.width - width) / 2,
      y: cursor + labelRoom,
      width,
      height
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
      if (placed.stack.label) {
        page.text(placed.stack.label, box.x, placed.y - 4, {
          font: 'Helvetica-Bold',
          size: 9,
          color: INK_MUTED
        })
      }
      page.image(placed.stack.image, placed)
    }
  })
  return out
}
