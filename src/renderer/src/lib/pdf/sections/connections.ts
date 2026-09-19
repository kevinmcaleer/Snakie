/**
 * THE CONNECTIONS TABLE (#1170) — the wiring as a list you can work down.
 *
 * The diagram before it shows where everything goes; a picture is a poor thing
 * to wire FROM, though, because following one curve out of a dozen across a
 * page and landing on the right pin is exactly the part a beginner gets wrong.
 * This is the same wiring written out, one row per wire, with a box to tick as
 * each one is made.
 *
 * ONE ORDER, TWO PLACES. The Board Viewer's Markdown pinout export
 * (`shared/robot-docs.ts`, #143) already had an answer to "which pin goes
 * where", and it sorts the board's pins by number with the named rails after
 * them. This page borrows that ordering — `pinSortKey` is shared, not copied —
 * so a reader holding the printed table and the exported Markdown finds the
 * same wire in the same place in both.
 *
 * Two halves, the usual split for this folder: {@link buildConnections} is
 * arithmetic over the model and the installed libraries — no DOM, no document,
 * unit-tested on its own — and {@link drawConnectionsPages} is where the ink
 * goes.
 *
 * What a row says: the two ends of the wire, each as `<thing> · <pin>`, and the
 * net it belongs to. The board's end comes first wherever a wire touches the
 * board, because that is the end you count pins to find.
 */

import type { PartLibraryWithParts } from '../../../../../shared/part'
import type { RobotDefinition } from '../../../../../shared/robot'
import { parseEndpoint, pinSortKey } from '../../../../../shared/robot-docs'
import { type Box, type LaidOutPage, type PdfDocument, packUnits, wrapText } from '../layout'
import { BRASS, INK, INK_MUTED, PANEL, PAPER, RULE } from '../theme'
import { type BomCatalog, findPart } from './bom'
import { SECTION_HEADING_HEIGHT, drawSectionHeading } from './listing'
import { drawIntro, introHeight } from './narrative'

/** The heading over the table. */
export const CONNECTIONS_HEADING = 'Connections'

/** One wire. */
export interface ConnectionRow {
  /** The connection's own id — stable, and a handle for tests. */
  key: string
  /** The end to count pins to: the board's, wherever the wire touches it. */
  from: string
  /** The other end. */
  to: string
  /** `GND`, `VCC`, `SIGNAL`… — upper-cased, as the Markdown export writes it. */
  net: string
  /** The bundle a QWIIC / Grove wire belongs to: four wires in one plug are one
   *  thing to connect, and a reader who is told so does not go looking for four
   *  jumper leads. */
  cable?: string
}

/** What the board is called, for the end of a wire that lands on it. */
function boardName(robot: RobotDefinition, libraries: readonly PartLibraryWithParts[], catalog: BomCatalog): string {
  const id = robot.board?.trim()
  if (!id) return 'Board'
  return catalog.boards?.find((b) => b.id === id)?.name?.trim() || findPart(libraries, '', id)?.name?.trim() || id
}

/** `<thing> · <pin>`, or just the thing when the endpoint names no pin. */
function cell(name: string, pin: string): string {
  return pin ? `${name} · ${pin}` : name
}

/**
 * Every wire in the project, board-end first and in pin order.
 *
 * Returns an empty list for a project with no wiring, and the caller then
 * leaves the page out rather than printing an empty table (#1108).
 */
export function buildConnections(
  robot: RobotDefinition | null | undefined,
  catalog: BomCatalog = {}
): ConnectionRow[] {
  if (!robot?.connections?.length) return []
  const libraries = catalog.libraries ?? []
  const board = boardName(robot, libraries, catalog)

  /** What the project calls a placed part: its own label first — `Left motor`
   *  is more use on a bench than `mx1508` — then the catalogue name. */
  const nameOf = (key: string): string => {
    if (key === 'board') return board
    const placed = robot.parts.find((p) => p.id === key)
    if (!placed) return key
    return placed.label?.trim() || findPart(libraries, placed.lib, placed.part)?.name?.trim() || placed.part
  }

  const rows = robot.connections.map((c) => {
    const a = parseEndpoint(c.from)
    const b = parseEndpoint(c.to)
    // The board's end leads, whichever way round the wire was drawn.
    const [first, second] = b.key === 'board' && a.key !== 'board' ? [b, a] : [a, b]
    return {
      row: {
        key: c.id,
        from: cell(nameOf(first.key), first.pin),
        to: cell(nameOf(second.key), second.pin),
        net: (c.net ?? 'signal').toUpperCase(),
        cable: c.cable || undefined
      } satisfies ConnectionRow,
      // Sort handles: board wires first, by the same pin order as the Markdown
      // pinout table; everything else after, alphabetically by its first end.
      onBoard: first.key === 'board',
      pin: first.key === 'board' ? first.pin : ''
    }
  })

  rows.sort((x, y) => {
    if (x.onBoard !== y.onBoard) return x.onBoard ? -1 : 1
    if (x.onBoard) {
      const kx = pinSortKey(x.pin)
      const ky = pinSortKey(y.pin)
      if (kx.group !== ky.group) return kx.group - ky.group
      if (kx.group === 0 && kx.num !== ky.num) return kx.num - ky.num
      return x.pin.localeCompare(y.pin) || x.row.to.localeCompare(y.row.to)
    }
    return x.row.from.localeCompare(y.row.from) || x.row.to.localeCompare(y.row.to)
  })

  return rows.map((r) => r.row)
}

// --- The table ---------------------------------------------------------------

/** The tick box column: the box, and the gap to the first end. */
const TICK_WIDTH = 24
const TICK_SIZE = 9
/** The net column, wide enough for `SIGNAL` and its gap. */
const NET_WIDTH = 62
/** The gap either side of the arrow between the two ends. */
const ARROW_WIDTH = 18
const TEXT_SIZE = 10.5
const LEADING = 13
/** Padding above and below a row's contents. */
const ROW_PAD = 6
/** The column headings and their rule. */
const HEAD_HEIGHT = 20

/** A row wrapped to the table's columns, with its height known. */
export interface MeasuredConnectionRow {
  row: ConnectionRow
  from: string[]
  to: string[]
  height: number
}

/** The width one END of a wire is set in, for a table `width` points wide. */
export function endColumnWidth(width: number): number {
  return Math.max(1, (width - TICK_WIDTH - NET_WIDTH - ARROW_WIDTH) / 2)
}

/** Wrap and measure every row against a table `width` points wide. */
export function measureConnectionRows(
  rows: readonly ConnectionRow[],
  width: number
): MeasuredConnectionRow[] {
  const col = endColumnWidth(width)
  return rows.map((row) => {
    const from = wrapText(row.from, 'Helvetica-Bold', TEXT_SIZE, col)
    // The cable note rides under the second end: it belongs to the wire, and
    // that is where there is room for it.
    const to = [
      ...wrapText(row.to, 'Helvetica-Bold', TEXT_SIZE, col),
      ...(row.cable ? wrapText(`in the ${row.cable} cable`, 'Helvetica', TEXT_SIZE, col) : [])
    ]
    return {
      row,
      from,
      to,
      height: ROW_PAD * 2 + Math.max(from.length, to.length) * LEADING
    }
  })
}

/** Draw the column headings at `top`, returning the y the first row starts at. */
function drawColumnHeads(page: LaidOutPage, box: Box, top: number): number {
  const col = endColumnWidth(box.width)
  const head = { font: 'Helvetica-Bold' as const, size: 9, color: INK_MUTED }
  page.text('From', box.x + TICK_WIDTH, top + 9, head)
  page.text('To', box.x + TICK_WIDTH + col + ARROW_WIDTH, top + 9, head)
  page.text('Net', box.x + box.width, top + 9, { ...head, align: 'right' })
  page.line(box.x, top + HEAD_HEIGHT - 5, box.x + box.width, top + HEAD_HEIGHT - 5, {
    color: RULE,
    width: 0.75
  })
  return top + HEAD_HEIGHT
}

/** A small right-pointing arrow: a shaft and two barbs, `width` points long,
 *  its tip at `x + width` on the line `y`. */
function drawArrow(page: LaidOutPage, x: number, y: number, width: number): void {
  const barb = 2.6
  const pen = { color: BRASS, width: 0.9 }
  page.line(x, y, x + width, y, pen)
  page.line(x + width - barb, y - barb, x + width, y, pen)
  page.line(x + width - barb, y + barb, x + width, y, pen)
}

/** Draw one row with its top edge at `top`. */
function drawConnectionRow(
  page: LaidOutPage,
  box: Box,
  measured: MeasuredConnectionRow,
  top: number,
  shaded: boolean
): void {
  if (shaded) {
    page.rect({ x: box.x, y: top, width: box.width, height: measured.height }, { fill: PANEL })
  }
  const baseline = top + ROW_PAD + TEXT_SIZE
  const col = endColumnWidth(box.width)
  const toX = box.x + TICK_WIDTH + col + ARROW_WIDTH

  // The box to tick as the wire goes in. Drawn on the first line's centre, so
  // it sits against the row's first end however many lines that end wrapped to.
  page.rect(
    { x: box.x, y: baseline - TICK_SIZE + 1, width: TICK_SIZE, height: TICK_SIZE },
    { stroke: INK_MUTED, lineWidth: 0.75 }
  )

  measured.from.forEach((line, i) => {
    page.text(line, box.x + TICK_WIDTH, baseline + i * LEADING, {
      font: 'Helvetica-Bold',
      size: TEXT_SIZE,
      color: INK
    })
  })
  // The arrow is the sentence: THIS pin goes to THAT one. Drawn rather than
  // set, because the document's base-14 fonts are WinAnsi-encoded and WinAnsi
  // has no arrow in it — `→` comes out as a question mark, which asks the
  // reader something instead of telling them.
  drawArrow(page, toX - ARROW_WIDTH + 3, baseline - TEXT_SIZE / 3, ARROW_WIDTH - 8)
  measured.to.forEach((line, i) => {
    const isCable = !!measured.row.cable && i >= measured.to.length - 1
    page.text(line, toX, baseline + i * LEADING, {
      font: isCable ? 'Helvetica' : 'Helvetica-Bold',
      size: TEXT_SIZE,
      color: isCable ? INK_MUTED : INK
    })
  })
  page.text(measured.row.net, box.x + box.width, baseline, {
    size: TEXT_SIZE,
    color: INK_MUTED,
    align: 'right'
  })
}

/** How the table is set. */
export interface ConnectionsOptions {
  heading?: string
  /** The line of English above the table — see `sections/narrative.ts`. */
  intro?: string
}

/**
 * Draw the table across as many pages as it needs, returning them.
 *
 * No rows means NO pages. A row is never split across pages
 * ({@link packUnits}), and the intro only costs the FIRST page its room.
 */
export function drawConnectionsPages(
  doc: PdfDocument,
  rows: readonly ConnectionRow[],
  opts: ConnectionsOptions = {}
): LaidOutPage[] {
  if (!rows.length) return []
  // Plan against the geometry every page shares, BEFORE adding one (#1108).
  const box = doc.contentBox
  const measured = measureConnectionRows(rows, box.width)
  const capacity = box.height - SECTION_HEADING_HEIGHT - HEAD_HEIGHT
  const firstCapacity = capacity - introHeight(opts.intro, box.width)
  const paged = packUnits(
    measured.map((m) => ({ item: m, size: m.height })),
    capacity,
    firstCapacity
  )

  const heading = opts.heading ?? CONNECTIONS_HEADING
  const out: LaidOutPage[] = []
  paged.forEach((pageRows, i) => {
    const page = doc.newPage()
    out.push(page)
    page.rect({ x: 0, y: 0, width: doc.size.width, height: doc.size.height }, { fill: PAPER })
    drawSectionHeading(page, i === 0 ? heading : `${heading} (continued)`)
    let y = box.y + SECTION_HEADING_HEIGHT
    if (i === 0) y = drawIntro(page, opts.intro, box.x, y, box.width)
    y = drawColumnHeads(page, box, y)
    pageRows.forEach((row, n) => {
      drawConnectionRow(page, box, row, y, n % 2 === 1)
      y += row.height
    })
  })
  return out
}
