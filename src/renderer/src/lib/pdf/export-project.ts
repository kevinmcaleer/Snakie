/**
 * THE EXPORT ACTION (#1114) — from "the user pressed print" to a file on disk.
 *
 * Gathers what the document needs out of the live app, hands it to the
 * orchestrator (#1108), and saves the result on whichever host we are. Kept
 * apart from the toolbar button so the menu entry and the button run exactly
 * the same thing.
 */

import { generateProgram } from '../blocks/generator'
import type { BlocksSource } from './blocks-source'
import { reportError } from '../report-error'
import { showStatus } from '../status-bar'
import { resolveBoards } from '../../components/part-editor.util'
import { domProjectArt } from './project-art'
import {
  type OmittedSection,
  type ProgressUpdate,
  type ProjectArt,
  buildProjectPdf
} from './project-pdf'
import type { BomCatalog } from './sections/bom'
import { savePdf } from './save-pdf'
import type { RobotDefinition } from '../../../../shared/robot'

/** What the caller knows and this module cannot look up for itself. */
export interface ExportProjectInput {
  /** The workspace's current folder — where `robot.yml` lives. */
  folder: string | null
  /** The active file's name, printed under the title. */
  entryFile?: string
  /** The active file's stored content, the listing's last resort. */
  stored?: string | null
  onProgress?: (update: ProgressUpdate) => void
}

export interface ExportProjectResult {
  outcome: 'saved' | 'cancelled'
  fileName: string
  omitted: OmittedSection[]
}

/** The project's wiring, or null if there is none to read. */
async function loadRobot(folder: string | null): Promise<RobotDefinition | null> {
  try {
    return await window.api.robot.load(folder ?? undefined)
  } catch (err) {
    // A project with no robot.yml is the normal case, not a failure — but a
    // bridge that is not there at all is worth a line in the console.
    reportError('export pdf: robot.yml', err)
    return null
  }
}

/**
 * The catalogue the bill of materials names its rows from (#1157).
 *
 * Both halves are best-effort: a table of part IDS is a worse table than one of
 * names, but it is a far better document than one with no shopping list in it,
 * so nothing here can fail the export.
 */
async function loadCatalog(): Promise<BomCatalog> {
  try {
    const [libraries, userBoards] = await Promise.all([
      window.api.parts.listLibraries().catch(() => []),
      window.api.board.listUserBoards().catch(() => [])
    ])
    return { libraries, boards: resolveBoards(libraries, userBoards) }
  } catch (err) {
    reportError('export pdf: parts libraries', err)
    return {}
  }
}

/** A human summary of what did not make it into the document. */
export function omissionMessage(omitted: readonly OmittedSection[]): string {
  const names: Record<OmittedSection['section'], string> = {
    blocks: 'the blocks',
    code: 'the code listing',
    wiring: 'the wiring diagram'
  }
  const list = omitted.map((o) => names[o.section])
  const joined =
    list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0]
  return `PDF exported without ${joined}.`
}

/**
 * Build and save the project PDF.
 *
 * Throws only when the document itself could not be written or saved — a
 * section that could not be captured comes back in `omitted` and is reported to
 * the user, because a PDF missing its wiring page is far more useful than no
 * PDF at all.
 */
/**
 * The workspace to print, or the reason there is none (#1112).
 *
 * The canvas on screen when the Blocks view is open; the file's own blocks,
 * built off-screen, when it is not — printing from the Code workspace, from
 * Electronics, or with the split collapsed to its Python must still put the
 * blocks in the document. A source that cannot be built is an ERROR the blocks
 * pages report as an omission, never a silent drop.
 */
async function resolveSource(
  input: ExportProjectInput
): Promise<{ source: BlocksSource | null; error: unknown }> {
  try {
    // Lazily: the module carries Blockly and the whole palette with it.
    const { resolveBlocksSource } = await import('./blocks-source')
    return { source: resolveBlocksSource(input), error: null }
  } catch (err) {
    reportError('export pdf: blocks', err)
    return { source: null, error: err }
  }
}

export async function exportProjectPdf(input: ExportProjectInput): Promise<ExportProjectResult> {
  const { source, error } = await resolveSource(input)
  try {
    const workspace = source?.workspace ?? null
    // Generate once, here: the listing prints this text and the blocks pages
    // order themselves from the same pass's `functions` (#1112).
    const program = workspace ? generateProgram(workspace) : null
    const [robot, catalog] = await Promise.all([loadRobot(input.folder), loadCatalog()])

    const dom = domProjectArt({ workspace, functionIds: program?.functions })
    // Blocks that could not be built: say so in the document's omissions rather
    // than printing none and calling it complete.
    const art: ProjectArt =
      error === null
        ? dom
        : {
            ...dom,
            blockStacks: async () => {
              throw error
            }
          }

    const result = await buildProjectPdf(
      {
        robot,
        catalog,
        folder: input.folder,
        entryFile: input.entryFile,
        code: { generated: program?.code, stored: input.stored },
        date: new Date()
      },
      { art, onProgress: input.onProgress }
    )

    const saved = await savePdf(result.bytes, result.fileName)
    if (saved.outcome === 'saved') {
      showStatus(
        result.omitted.length
          ? omissionMessage(result.omitted)
          : `Exported ${result.fileName} — ${result.pageCount} pages.`,
        { clearAfterMs: 6000 }
      )
    }
    return { outcome: saved.outcome, fileName: result.fileName, omitted: result.omitted }
  } finally {
    // An off-screen workspace is ours to take down; the live one is not.
    source?.dispose()
  }
}
