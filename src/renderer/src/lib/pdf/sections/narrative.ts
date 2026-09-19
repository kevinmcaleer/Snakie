/**
 * WHAT THE DOCUMENT SAYS TO THE READER (#1157).
 *
 * Up to now the printed project was a set of pictures with headings over them:
 * `Blocks`, `MicroPython`, `Electronics`. That reads fine to whoever built the
 * project and not at all to whoever was handed it — a heading names a thing, it
 * does not say what to DO with it. #1157 asks each section to open with a line
 * of ordinary English, so the document reads as instructions rather than as an
 * inventory of screenshots.
 *
 * The copy for every section lives HERE rather than in the four drawing
 * modules: the document's voice is one thing, and it should be possible to read
 * all of it — and change all of it — in one place. The sections stay pure
 * layout and take the words as an option.
 *
 * The measuring is shared for a duller reason. A section plans its pagination
 * BEFORE it adds a page (#1108), so it has to know how much room the intro will
 * take before anything is drawn; {@link introHeight} is what it asks, and
 * {@link drawIntro} sets exactly the lines that were measured.
 */

import { type LaidOutPage, wrapText } from '../layout'
import { INK_MUTED } from '../theme'

/** The bill of materials (#1157) — the first thing the reader needs. */
export const BOM_INTRO = 'For this project, you will need the following items:'

/** The blocks pages. */
export const BLOCKS_INTRO = 'Drag these blocks to program the robot:'

/** The wiring diagram. */
export const WIRING_INTRO =
  'Wire up the robot like the picture below; use DuPont cables or solder wires for a more ' +
  'permanent connection.'

/** The listing, for a project that was built out of blocks. */
export const CODE_INTRO_WITH_BLOCKS =
  'You can also type the code below into the code workspace instead of using the blocks:'

/** The listing, for a project that is hand-written Python and never had any. */
export const CODE_INTRO = 'Type the code below into the code workspace, then run it on your board:'

export const INTRO_SIZE = 10.5
/** Baseline to baseline for a wrapped intro. */
export const INTRO_LEADING = 14.5
/** Breathing room between an intro and what it introduces. */
export const INTRO_GAP = 10

/** The intro wrapped to `width`; empty for no intro at all. */
export function introLines(text: string | undefined, width: number): string[] {
  const copy = text?.trim()
  if (!copy || width <= 0) return []
  return wrapText(copy, 'Helvetica', INTRO_SIZE, width)
}

/**
 * The vertical room an intro takes, gap to the body included. Zero when there
 * is no intro — a section that is given none loses nothing to it.
 */
export function introHeight(text: string | undefined, width: number): number {
  const lines = introLines(text, width)
  return lines.length ? lines.length * INTRO_LEADING + INTRO_GAP : 0
}

/**
 * Set the intro with its block starting at `top`, returning the y the section's
 * body continues at — exactly `top + introHeight(...)`, so a caller that
 * measured first and a caller that draws first agree.
 */
export function drawIntro(
  page: LaidOutPage,
  text: string | undefined,
  x: number,
  top: number,
  width: number
): number {
  const lines = introLines(text, width)
  if (!lines.length) return top
  let baseline = top + INTRO_SIZE
  for (const line of lines) {
    if (line) page.text(line, x, baseline, { size: INTRO_SIZE, color: INK_MUTED })
    baseline += INTRO_LEADING
  }
  return top + lines.length * INTRO_LEADING + INTRO_GAP
}
