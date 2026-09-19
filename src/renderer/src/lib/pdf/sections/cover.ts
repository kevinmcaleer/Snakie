/**
 * The two pages that bookend the document (#1109).
 *
 * Pure and DOM-free like the rest of `lib/pdf`: the caller resolves the project
 * name and rasterises the mark, this decides where the ink goes.
 */

import { COFFEE_URL, SNAKIE_WEB_HOST, SNAKIE_WEB_URL } from '../../../../../shared/links'
import { type LaidOutPage, type PdfDocument, wrapText } from '../layout'
import { type PdfFont, textWidth } from '../metrics'
import type { PdfImageRef } from '../writer'
import { BRASS, BRASS_BRIGHT, GREEN, INK, INK_MUTED, PAPER, RULE } from '../theme'

/** The last rung of the project-name fallback chain. */
export const UNTITLED_PROJECT = 'Untitled project'

/** Where a project's name can come from, best first. */
export interface ProjectNameSources {
  /** `RobotDefinition.name` from `robot.yml` — the only one the user typed. */
  robotName?: string | null
  /** The workspace's `currentFolder`, whose last segment names the project. */
  folder?: string | null
}

/** Last path segment of `folder`, tolerating either separator and a trailing one. */
function folderName(folder: string): string {
  const parts = folder.split(/[/\\]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * The project's name, from the first source that actually has one. None of the
 * three is guaranteed, so all three rungs matter — a project opened from a
 * folder has no `robot.yml` name, and an unsaved one has no folder either.
 */
export function resolveProjectName(sources: ProjectNameSources): string {
  const robot = sources.robotName?.trim()
  if (robot) return robot
  const folder = sources.folder?.trim()
  if (folder) {
    const name = folderName(folder).trim()
    if (name) return name
  }
  return UNTITLED_PROJECT
}

/** A long, human date — injected rather than read from the clock, so an export
 *  can be reproduced byte for byte (#1108). */
export function formatCoverDate(date: Date): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

/** Sizes the title tries, largest first, before it starts truncating. */
const TITLE_SIZES = [32, 27, 22, 18]
const TITLE_MAX_LINES = 3

/**
 * Lay a project name out at the largest size that fits `width` in at most
 * {@link TITLE_MAX_LINES} lines, truncating with an ellipsis if even the
 * smallest size cannot. A name that runs off the edge of the cover is the one
 * outcome not on the table.
 */
export function fitTitle(
  name: string,
  width: number,
  font: PdfFont = 'Helvetica-Bold'
): { size: number; lines: string[] } {
  for (const size of TITLE_SIZES) {
    const lines = wrapText(name, font, size, width)
    if (lines.length <= TITLE_MAX_LINES) return { size, lines }
  }
  const size = TITLE_SIZES[TITLE_SIZES.length - 1]
  const lines = wrapText(name, font, size, width).slice(0, TITLE_MAX_LINES)
  const last = lines[TITLE_MAX_LINES - 1] ?? ''
  let trimmed = last
  while (trimmed && textWidth(`${trimmed}…`, font, size) > width) trimmed = trimmed.slice(0, -1)
  lines[TITLE_MAX_LINES - 1] = `${trimmed.trimEnd()}…`
  return { size, lines }
}

/** What the title page needs to know. */
export interface TitlePageOptions {
  projectName: string
  /** The program the project opens on, e.g. `sweep.py`. */
  entryFile?: string
  /** Injected for reproducibility; omit for no date line. */
  date?: Date
  /** The Snakie mark — the app icon, rasterised by the caller. */
  logo?: PdfImageRef
}

/**
 * The cover: the mark, the project's name, and the date.
 *
 * Carries NO page-number footer — a number on a cover looks like a mistake.
 */
export function drawTitlePage(doc: PdfDocument, opts: TitlePageOptions): LaidOutPage {
  const page = doc.newPage({ footer: false })
  const { width, height } = doc.size
  const centre = width / 2
  const box = page.content

  page.rect({ x: 0, y: 0, width, height }, { fill: PAPER })

  // A brass band across the head of the page, with the wordmark sitting on it.
  page.rect({ x: 0, y: 0, width, height: 10 }, { fill: BRASS_BRIGHT })

  if (opts.logo) {
    page.imageFitted(opts.logo, { x: centre - 56, y: height * 0.17, width: 112, height: 112 })
  }

  const { size, lines } = fitTitle(opts.projectName, box.width)
  let baseline = height * 0.42
  for (const line of lines) {
    page.text(line, centre, baseline, { font: 'Helvetica-Bold', size, color: INK, align: 'center' })
    baseline += size * 1.22
  }

  // A short green rule under the title, the Soft Shell primary.
  page.line(centre - 40, baseline + 6, centre + 40, baseline + 6, { color: GREEN, width: 2 })
  baseline += 34

  if (opts.entryFile) {
    page.text(opts.entryFile, centre, baseline, {
      font: 'Courier',
      size: 12,
      color: INK_MUTED,
      align: 'center'
    })
    baseline += 22
  }
  if (opts.date) {
    page.text(formatCoverDate(opts.date), centre, baseline, {
      size: 11,
      color: INK_MUTED,
      align: 'center'
    })
  }

  // The mark, quietly, at the foot of the cover.
  page.line(centre - 90, height - 96, centre + 90, height - 96, { color: RULE, width: 0.75 })
  page.text('Made with Snakie', centre, height - 74, {
    font: 'Helvetica-Bold',
    size: 11,
    color: BRASS,
    align: 'center'
  })
  page.text(SNAKIE_WEB_HOST, centre, height - 58, { size: 9.5, color: INK_MUTED, align: 'center' })
  return page
}

const CLOSING_BLURB =
  'This project was built in Snakie, a free, open MicroPython editor for the Raspberry Pi ' +
  'Pico, the micro:bit, the ESP32 and friends. Drag blocks or write Python, wire up the ' +
  'electronics on a breadboard that knows what your parts are, and run it on real hardware.'

const SUPPORT_BLURB =
  'Snakie is made in the open, and stays free. If it saved you an evening, you can buy its ' +
  'author a coffee — it is the whole funding model, and it genuinely helps.'

/**
 * The closing page: what made this, where to find it, and how to support it.
 *
 * Both URLs come from `shared/links.ts` and are real, clickable link
 * annotations. A printed URL in a PDF that isn't a link is a small, avoidable
 * disappointment.
 */
export function drawClosingPage(doc: PdfDocument): LaidOutPage {
  const page = doc.newPage()
  const { width, height } = doc.size
  const centre = width / 2
  const box = page.content

  page.rect({ x: 0, y: 0, width, height }, { fill: PAPER })
  page.rect({ x: 0, y: 0, width, height: 10 }, { fill: BRASS_BRIGHT })

  let y = height * 0.3
  page.text('Made with Snakie', centre, y, {
    font: 'Helvetica-Bold',
    size: 26,
    color: INK,
    align: 'center'
  })
  y += 18
  page.line(centre - 40, y, centre + 40, y, { color: GREEN, width: 2 })
  y += 42

  const textWidthBox = Math.min(box.width, 360)
  y = page.paragraph(CLOSING_BLURB, centre, y, {
    width: textWidthBox,
    size: 11,
    color: INK_MUTED,
    align: 'center',
    leading: 17
  })
  y += 18

  page.text(SNAKIE_WEB_URL, centre, y, {
    font: 'Helvetica-Bold',
    size: 13,
    color: GREEN,
    align: 'center'
  })
  page.linkText(SNAKIE_WEB_URL, centre, y, SNAKIE_WEB_URL, {
    font: 'Helvetica-Bold',
    size: 13,
    align: 'center'
  })
  y += 52

  page.text('Support Snakie', centre, y, {
    font: 'Helvetica-Bold',
    size: 14,
    color: INK,
    align: 'center'
  })
  y += 24
  y = page.paragraph(SUPPORT_BLURB, centre, y, {
    width: textWidthBox,
    size: 11,
    color: INK_MUTED,
    align: 'center',
    leading: 17
  })
  y += 14

  page.text(COFFEE_URL, centre, y, {
    font: 'Helvetica-Bold',
    size: 12,
    color: BRASS,
    align: 'center'
  })
  page.linkText(COFFEE_URL, centre, y, COFFEE_URL, {
    font: 'Helvetica-Bold',
    size: 12,
    align: 'center'
  })
  return page
}
