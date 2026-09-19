/**
 * Assemble the project document end to end (#1108) — the issue that makes the
 * epic true.
 *
 * The order is #1105's, with the bill of materials #1157 put where a reader
 * needs it: title page, what you will need, blocks (functions first), the
 * MicroPython listing, the wiring diagram, the connections table (#1170), and
 * the "Made with Snakie" closing page. Each section opens with a line of ordinary English saying what to do
 * with it (`sections/narrative.ts`).
 *
 * Three things live HERE rather than in the section modules:
 *
 *  - **Section skipping.** A project may have no blocks, or no wiring, or
 *    neither. The document stays coherent: correct page numbering, no blank
 *    pages, no heading with nothing under it.
 *  - **Failure of one section.** If the breadboard refuses to rasterise, the
 *    export still produces a document and SAYS what it left out, rather than
 *    throwing the whole job away.
 *  - **Determinism.** The art comes from an injected {@link ProjectArt}, and
 *    the date is a parameter, so an end-to-end test can assert a real byte
 *    stream rather than "it didn't throw".
 */

import type { RobotDefinition } from '../../../../shared/robot'
import { PdfDocument } from './layout'
import type { PdfImageData } from './writer'
import { drawClosingPage, drawTitlePage, resolveProjectName } from './sections/cover'
import { type DrawableStack, drawBlocksPages } from './sections/blocks'
import { type BomCatalog, buildBom, drawBomPages } from './sections/bom'
import { buildConnections, drawConnectionsPages } from './sections/connections'
import { codeForListing, drawListing } from './sections/listing'
import {
  BLOCKS_INTRO,
  BOM_INTRO,
  CODE_INTRO,
  CODE_INTRO_WITH_BLOCKS,
  CONNECTIONS_INTRO,
  WIRING_INTRO
} from './sections/narrative'
import { drawWiringPage, hasWiring, wiringSummary } from './sections/wiring'

/** A captured blocks stack, rasterised and measured in points. */
export interface StackArt {
  id: string
  label?: string
  /** The function's docstring, printed under its name (#1147). */
  description?: string
  /** Natural width in points. */
  width: number
  /** Natural height in points. */
  height: number
  jpeg: PdfImageData
}

/** A captured wiring diagram, rasterised and measured in points. */
export interface DiagramArt {
  width: number
  height: number
  jpeg: PdfImageData
}

/**
 * Everything the document needs that only a DOM can produce.
 *
 * Injected rather than imported so the orchestrator stays testable in node, and
 * so a section that cannot be captured is a value (`null`) or a rejected
 * promise rather than a crash halfway through the file.
 */
export interface ProjectArt {
  /** The learner's top-level stacks, ordered functions-first. */
  blockStacks(): Promise<readonly StackArt[]>
  /**
   * The breadboard on its own white print sheet, or null when there is none to
   * draw.
   *
   * ONE picture of the board (#1168). This used to be two — the drawing lifted
   * onto the page's parchment, and the workspace's own sheet behind it — which
   * on the page read as the same diagram printed twice.
   */
  wiring(): Promise<DiagramArt | null>
  /** The Snakie mark for the cover, or null to set the cover typographically. */
  logo(): Promise<PdfImageData | null>
}

/** An empty art source — the document is then title, listing and closing. */
export const NO_ART: ProjectArt = {
  blockStacks: async () => [],
  wiring: async () => null,
  logo: async () => null
}

/** What the export was asked to produce. */
export interface ProjectPdfInput {
  /** The project's `robot.yml`, for the name, the wiring and the shopping list. */
  robot?: RobotDefinition | null
  /**
   * The installed parts libraries and boards, for naming the bill of materials'
   * rows (#1157). Omit and the table falls back to the ids in `robot.yml` —
   * which is what a project whose libraries could not be read gets.
   */
  catalog?: BomCatalog
  /** The workspace's current folder, the second rung of the name chain. */
  folder?: string | null
  /** The file the project opens on, printed under the title. */
  entryFile?: string
  /** Where the listing's text comes from — see {@link codeForListing}. */
  code?: { draft?: string | null; generated?: string | null; stored?: string | null }
  /** Injected for reproducibility. Omit and the document carries no date. */
  date?: Date
}

/** A section the document could not include, and why. */
export interface OmittedSection {
  section: 'blocks' | 'code' | 'wiring'
  reason: string
}

export interface ProjectPdfResult {
  bytes: Uint8Array<ArrayBuffer>
  /** A safe default file name, `project-name.pdf`. */
  fileName: string
  projectName: string
  pageCount: number
  /** Sections left out — an empty list means the whole document came through. */
  omitted: OmittedSection[]
}

/** The phases an export moves through, for the toolbar's busy state. */
export type ExportPhase = 'blocks' | 'wiring' | 'laying out' | 'writing'

export interface ProgressUpdate {
  phase: ExportPhase
  /** 0–1, monotonic. */
  fraction: number
}

export interface BuildOptions {
  art?: ProjectArt
  onProgress?: (update: ProgressUpdate) => void
}

/** `Servo arm` → `servo-arm`, safe on every filesystem we target. */
export function fileStem(projectName: string): string {
  const stem = projectName
    .trim()
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return stem || 'project'
}

/** A PDF date string, `D:YYYYMMDDHHmmSS`, in local time with no offset. */
function pdfDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Build the whole document.
 *
 * Never throws for a section it could not draw: what came through is in the
 * bytes, and what did not is in {@link ProjectPdfResult.omitted}.
 */
export async function buildProjectPdf(
  input: ProjectPdfInput,
  opts: BuildOptions = {}
): Promise<ProjectPdfResult> {
  const art = opts.art ?? NO_ART
  const progress = (phase: ExportPhase, fraction: number): void =>
    opts.onProgress?.({ phase, fraction })

  const projectName = resolveProjectName({
    robotName: input.robot?.name,
    folder: input.folder
  })
  const omitted: OmittedSection[] = []

  progress('blocks', 0.05)
  let stacks: readonly StackArt[] = []
  try {
    stacks = await art.blockStacks()
  } catch (err) {
    omitted.push({ section: 'blocks', reason: messageOf(err) })
  }

  progress('wiring', 0.4)
  let diagram: DiagramArt | null = null
  if (hasWiring(input.robot)) {
    try {
      diagram = await art.wiring()
      if (!diagram) {
        omitted.push({ section: 'wiring', reason: 'the breadboard could not be captured' })
      }
    } catch (err) {
      omitted.push({ section: 'wiring', reason: messageOf(err) })
    }
  }

  let logo: PdfImageData | null = null
  try {
    logo = await art.logo()
  } catch {
    // The cover reads perfectly well without the mark; not worth reporting.
    logo = null
  }

  progress('laying out', 0.7)
  const doc = new PdfDocument({
    footerLabel: projectName,
    info: {
      title: projectName,
      subject: 'A Snakie project',
      creationDate: input.date ? pdfDate(input.date) : undefined
    }
  })

  drawTitlePage(doc, {
    projectName,
    entryFile: input.entryFile,
    date: input.date,
    logo: logo ? doc.addImage(logo) : undefined
  })

  // What to get hold of, before anything that assumes you already have it
  // (#1157). Derived from the model, so there is nothing here to fail.
  drawBomPages(doc, buildBom(input.robot, input.catalog), { intro: BOM_INTRO })

  const drawable: DrawableStack[] = stacks.map((stack) => ({
    id: stack.id,
    label: stack.label,
    description: stack.description,
    width: stack.width,
    height: stack.height,
    image: doc.addImage(stack.jpeg)
  }))
  drawBlocksPages(doc, drawable, { intro: BLOCKS_INTRO })

  const code = codeForListing(input.code ?? {})
  // "You can also type the code below INSTEAD of using the blocks" only reads
  // as an offer to a reader who was given blocks in the first place.
  drawListing(doc, { code, intro: drawable.length ? CODE_INTRO_WITH_BLOCKS : CODE_INTRO })

  if (diagram) {
    drawWiringPage(
      doc,
      {
        image: doc.addImage(diagram.jpeg),
        width: diagram.width,
        height: diagram.height
      },
      { intro: WIRING_INTRO, summary: input.robot ? wiringSummary(input.robot) : undefined }
    )
  }

  // The same wiring as a list to work down (#1170). It follows the picture
  // rather than replacing it: the diagram says where a part sits, the table
  // says which pin to count to — and it stands on its own for a project whose
  // board could not be captured, which is the one case where the reader would
  // otherwise have no wiring at all.
  drawConnectionsPages(doc, buildConnections(input.robot, input.catalog), {
    intro: CONNECTIONS_INTRO
  })

  drawClosingPage(doc)

  progress('writing', 0.9)
  const bytes = doc.build()
  progress('writing', 1)

  return {
    bytes,
    fileName: `${fileStem(projectName)}.pdf`,
    projectName,
    pageCount: doc.pageCount,
    omitted
  }
}
