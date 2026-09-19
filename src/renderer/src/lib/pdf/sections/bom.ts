/**
 * THE BILL OF MATERIALS (#1157) — what has to be on the desk before any of the
 * rest of the document is any use.
 *
 * The project already knows this: `robot.yml` lists the microcontroller, every
 * part placed on the breadboard and every wire between them. Nobody had ever
 * asked it the shopping question, so the reader had to work the parts list out
 * by squinting at the wiring picture and counting.
 *
 * Two halves, and the split is the usual one for this folder: {@link buildBom}
 * is arithmetic over the model and the installed libraries — no DOM, no
 * document, unit-tested on its own — and {@link drawBomPages} is where the ink
 * goes. The catalogue is passed IN rather than read here, because the parts
 * libraries live behind `window.api` and this module has no business knowing
 * that.
 *
 * What a row says: the quantity, the part's catalogue name, and a second line
 * of whatever identifies it at a supplier — the manufacturer and part number
 * when the part carries them, its description otherwise. A part the libraries
 * no longer have is still listed, under whatever the project called it: a name
 * you have to look up beats a row that silently is not there.
 */

import type { PartDefinition, PartLibraryWithParts } from '../../../../../shared/part'
import type { RobotDefinition } from '../../../../../shared/robot'
import { type Box, type LaidOutPage, type PdfDocument, packUnits, wrapText } from '../layout'
import { BRASS, INK, INK_MUTED, PANEL, PAPER, RULE } from '../theme'
import { SECTION_HEADING_HEIGHT, drawSectionHeading } from './listing'
import { drawIntro, introHeight } from './narrative'

/** The heading over the table. */
export const BOM_HEADING = 'What you will need'

/** One line of the table. */
export interface BomRow {
  /** Stable identity — `<lib>:<part>` for a placed part, a fixed token
   *  otherwise. Keeps a repeated part to one row, and gives tests a handle. */
  key: string
  /** What to call the item: the catalogue name where there is one. */
  name: string
  /** The second line — manufacturer and part number, or a description. */
  detail?: string
  quantity: number
}

/** Where the names come from. Both halves are optional: a project whose
 *  libraries could not be read still gets a table, of ids. */
export interface BomCatalog {
  /** The installed part libraries, as `parts.listLibraries()` returns them. */
  libraries?: readonly PartLibraryWithParts[]
  /** The resolved boards, for naming `RobotDefinition.board`. */
  boards?: readonly { id: string; name?: string }[]
}

/** Keys for the two rows that are not placed parts. */
export const JUMPER_KEY = 'wire:jumper'
export const CABLE_KEY = 'wire:cable'

/** A description longer than this is cut on a word boundary — the table is a
 *  shopping list, not the part's help page. */
const DETAIL_MAX = 140

/** The part with `id` in `lib`, or — when the library was renamed or removed —
 *  the first part of that id anywhere, which is nearly always the same part.
 *  Shared with the connections table (#1170), which names the same parts. */
export function findPart(
  libraries: readonly PartLibraryWithParts[],
  lib: string,
  id: string
): PartDefinition | null {
  const own = libraries.find((l) => l.id === lib)?.parts?.find((p) => p.id === id)
  if (own) return own
  for (const l of libraries) {
    const part = l.parts?.find((p) => p.id === id)
    if (part) return part
  }
  return null
}

/** Trim `text` to {@link DETAIL_MAX}, on a word boundary, with an ellipsis. */
function shorten(text: string): string {
  if (text.length <= DETAIL_MAX) return text
  const cut = text.slice(0, DETAIL_MAX)
  const space = cut.lastIndexOf(' ')
  return `${(space > DETAIL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** The identifying line under a part's name, if it has anything to say. */
export function partDetail(def: PartDefinition | null | undefined): string | undefined {
  if (!def) return undefined
  const spec = [def.manufacturer, def.partNumber]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
  if (spec.length) return spec.join(' · ')
  const description = def.description?.replace(/\s+/g, ' ').trim()
  return description ? shorten(description) : undefined
}

/**
 * The bill of materials for a project, in the order it is built: the
 * microcontroller, the parts as they were placed, then the wire to join them.
 *
 * A part placed twice is ONE row of quantity two — a table that listed
 * `SG90 micro servo` four times over would be a placement log, not a shopping
 * list. Returns an empty list for a project with nothing in it, and the caller
 * then leaves the page out entirely (#1108).
 */
export function buildBom(
  robot: RobotDefinition | null | undefined,
  catalog: BomCatalog = {}
): BomRow[] {
  if (!robot) return []
  const libraries = catalog.libraries ?? []
  const rows: BomRow[] = []

  const boardId = robot.board?.trim()
  if (boardId) {
    const def = findPart(libraries, '', boardId)
    const name = catalog.boards?.find((b) => b.id === boardId)?.name?.trim() || def?.name || boardId
    const detail = ['Microcontroller', def?.manufacturer?.trim()].filter(Boolean).join(' · ')
    rows.push({ key: `board:${boardId}`, name, detail, quantity: 1 })
  }

  // A row is a KIND of part, so what the project called each instance of it —
  // `Shoulder servo`, `Elbow servo` — cannot be its name: two of them would
  // then be listed under whichever was placed first. They are worth keeping
  // though, so a part the libraries can no longer name still says what it is
  // FOR, on the detail line.
  const byKey = new Map<string, { row: BomRow; labels: Set<string> }>()
  for (const placed of robot.parts) {
    const key = `${placed.lib}:${placed.part}`
    const label = placed.label?.trim()
    const seen = byKey.get(key)
    if (seen) {
      seen.row.quantity += 1
      if (label) seen.labels.add(label)
      continue
    }
    const def = findPart(libraries, placed.lib, placed.part)
    const row: BomRow = {
      key,
      name: def?.name?.trim() || placed.part,
      detail: partDetail(def),
      quantity: 1
    }
    byKey.set(key, { row, labels: new Set(label ? [label] : []) })
    rows.push(row)
  }
  for (const { row, labels } of byKey.values()) {
    if (!row.detail && labels.size) row.detail = shorten([...labels].join(', '))
  }

  // The wire is a real thing to buy, and the one item the parts list never
  // holds: the wiring diagram is drawn in connections, so count them.
  const jumpers = robot.connections.filter((c) => !c.cable).length
  if (jumpers) {
    rows.push({
      key: JUMPER_KEY,
      name: 'Jumper wires',
      detail: 'DuPont leads — one for each connection on the wiring diagram',
      quantity: jumpers
    })
  }
  const cables = new Set(robot.connections.map((c) => c.cable).filter(Boolean))
  if (cables.size) {
    rows.push({
      key: CABLE_KEY,
      name: 'Connector cables',
      detail: 'QWIIC / STEMMA QT / Grove cables — one for each bundle',
      quantity: cables.size
    })
  }

  return rows
}

// --- The table ---------------------------------------------------------------

/** The quantity column, wide enough for `100×` and its gap. */
const QTY_WIDTH = 46
/** The gap between the quantity's right edge and the column rule. */
const QTY_INSET = 12
const NAME_SIZE = 11
/** Room from a row's top to its name's baseline's line, descender included. */
const NAME_HEIGHT = 14
const DETAIL_SIZE = 9.5
const DETAIL_LEADING = 12
/** Padding above and below a row's contents. */
const ROW_PAD = 6
/** The column headings and their rule. */
const HEAD_HEIGHT = 20

/** A row with its detail wrapped and its height known. */
export interface MeasuredBomRow {
  row: BomRow
  /** The detail, wrapped to the item column. */
  lines: string[]
  height: number
}

/** Wrap and measure every row against a table `width` points wide. */
export function measureBomRows(rows: readonly BomRow[], width: number): MeasuredBomRow[] {
  const itemWidth = Math.max(1, width - QTY_WIDTH)
  return rows.map((row) => {
    const lines = row.detail ? wrapText(row.detail, 'Helvetica', DETAIL_SIZE, itemWidth) : []
    return {
      row,
      lines,
      height: ROW_PAD * 2 + NAME_HEIGHT + lines.length * DETAIL_LEADING
    }
  })
}

/** Draw the column headings at `top`, returning the y the first row starts at. */
function drawColumnHeads(page: LaidOutPage, box: Box, top: number): number {
  page.text('Qty', box.x + QTY_WIDTH - QTY_INSET, top + 9, {
    font: 'Helvetica-Bold',
    size: 9,
    color: INK_MUTED,
    align: 'right'
  })
  page.text('Item', box.x + QTY_WIDTH, top + 9, {
    font: 'Helvetica-Bold',
    size: 9,
    color: INK_MUTED
  })
  page.line(box.x, top + HEAD_HEIGHT - 5, box.x + box.width, top + HEAD_HEIGHT - 5, {
    color: RULE,
    width: 0.75
  })
  return top + HEAD_HEIGHT
}

/** Draw one row with its top edge at `top`. */
function drawBomRow(
  page: LaidOutPage,
  box: Box,
  measured: MeasuredBomRow,
  top: number,
  shaded: boolean
): void {
  if (shaded) {
    page.rect({ x: box.x, y: top, width: box.width, height: measured.height }, { fill: PANEL })
  }
  const baseline = top + ROW_PAD + NAME_SIZE
  page.text(`${measured.row.quantity}×`, box.x + QTY_WIDTH - QTY_INSET, baseline, {
    font: 'Helvetica-Bold',
    size: NAME_SIZE,
    color: BRASS,
    align: 'right'
  })
  page.text(measured.row.name, box.x + QTY_WIDTH, baseline, {
    font: 'Helvetica-Bold',
    size: NAME_SIZE,
    color: INK
  })
  let detail = baseline + DETAIL_LEADING + 1
  for (const line of measured.lines) {
    if (line) page.text(line, box.x + QTY_WIDTH, detail, { size: DETAIL_SIZE, color: INK_MUTED })
    detail += DETAIL_LEADING
  }
}

/** How the table is set. */
export interface BomOptions {
  heading?: string
  /** The line of English above the table — see `sections/narrative.ts`. */
  intro?: string
}

/**
 * Draw the table across as many pages as it needs, returning them.
 *
 * No rows means NO pages: a project with no `robot.yml` has nothing to shop
 * for, and a heading with nothing under it is worse than no section (#1108).
 * A row is never split across pages — {@link packUnits} again — and the intro
 * only costs the FIRST page its room.
 */
export function drawBomPages(
  doc: PdfDocument,
  rows: readonly BomRow[],
  opts: BomOptions = {}
): LaidOutPage[] {
  if (!rows.length) return []
  // Plan against the geometry every page shares, BEFORE adding one (#1108).
  const box = doc.contentBox
  const measured = measureBomRows(rows, box.width)
  const capacity = box.height - SECTION_HEADING_HEIGHT - HEAD_HEIGHT
  const firstCapacity = capacity - introHeight(opts.intro, box.width)
  const paged = packUnits(
    measured.map((m) => ({ item: m, size: m.height })),
    capacity,
    firstCapacity
  )

  const heading = opts.heading ?? BOM_HEADING
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
      drawBomRow(page, box, row, y, n % 2 === 1)
      y += row.height
    })
  })
  return out
}
