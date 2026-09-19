/**
 * The electronics wiring diagram page (#1110).
 *
 * Pure: the capture — which needs a live, mounted `<svg>` — is in
 * `lib/pdf/wiring-capture.ts`. This decides whether there is a page to draw at
 * all, and where the picture goes on it.
 */

import type { RobotDefinition } from '../../../../../shared/robot'
import { type Box, type LaidOutPage, type PdfDocument, fitBox } from '../layout'
import type { PdfImageRef } from '../writer'
import { INK_MUTED, PAPER } from '../theme'
import { SECTION_HEADING_HEIGHT, drawSectionHeading } from './listing'
import { drawIntro, introHeight } from './narrative'

/**
 * Whether this project HAS any wiring to show.
 *
 * A project with no `robot.yml`, or one with no parts on the canvas, must skip
 * the page entirely — a blank wiring page is worse than no wiring page.
 */
export function hasWiring(robot: RobotDefinition | null | undefined): boolean {
  if (!robot) return false
  return robot.parts.length > 0
}

/** A rasterised diagram, at its natural size in points. */
export interface WiringArt {
  image: PdfImageRef
  width: number
  height: number
}

/** A one-line summary under the diagram, e.g. `6 parts · 11 connections`. */
export function wiringSummary(robot: RobotDefinition): string {
  const parts = robot.parts.length
  const wires = robot.connections.length
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  return `${plural(parts, 'part')} · ${plural(wires, 'connection')}`
}

/**
 * Draw the diagram on a page of its own, scaled to fit and never clipped.
 * Returns null when there is no art — the caller then leaves the section out
 * rather than emitting a blank page.
 */
export function drawWiringPage(
  doc: PdfDocument,
  art: WiringArt | null,
  opts: { heading?: string; summary?: string; intro?: string } = {}
): LaidOutPage | null {
  if (!art || art.width <= 0 || art.height <= 0) return null

  const page = doc.newPage()
  page.rect({ x: 0, y: 0, width: doc.size.width, height: doc.size.height }, { fill: PAPER })
  drawSectionHeading(page, opts.heading ?? 'Electronics')

  const box = page.content
  const summaryRoom = opts.summary ? 22 : 0
  // The instruction goes ABOVE the picture (#1157) — it is what to do with it,
  // so it is read first; the summary stays a caption underneath.
  const top = drawIntro(page, opts.intro, box.x, box.y + SECTION_HEADING_HEIGHT, box.width)
  const body: Box = {
    x: box.x,
    y: top,
    width: box.width,
    height: box.height - SECTION_HEADING_HEIGHT - summaryRoom - introHeight(opts.intro, box.width)
  }
  const placed = fitBox(art.width, art.height, body)
  page.image(art.image, placed)

  if (opts.summary) {
    page.text(opts.summary, box.x + box.width / 2, box.y + box.height, {
      size: 9,
      color: INK_MUTED,
      align: 'center'
    })
  }
  return page
}
