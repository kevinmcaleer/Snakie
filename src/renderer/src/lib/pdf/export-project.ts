/**
 * THE EXPORT ACTION (#1114) — from "the user pressed print" to a file on disk.
 *
 * Gathers what the document needs out of the live app, hands it to the
 * orchestrator (#1108), and saves the result on whichever host we are. Kept
 * apart from the toolbar button so the menu entry and the button run exactly
 * the same thing.
 */

import { generateProgram } from '../blocks/generator'
import { getBlocksWorkspace } from '../blocks/workspace-registry'
import { reportError } from '../report-error'
import { showStatus } from '../status-bar'
import { domProjectArt } from './project-art'
import { type OmittedSection, type ProgressUpdate, buildProjectPdf } from './project-pdf'
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
export async function exportProjectPdf(input: ExportProjectInput): Promise<ExportProjectResult> {
  const workspace = getBlocksWorkspace()
  // Generate once, here: the listing prints this text and the blocks pages
  // order themselves from the same pass's `functions` (#1112).
  const program = workspace ? generateProgram(workspace) : null
  const robot = await loadRobot(input.folder)

  const result = await buildProjectPdf(
    {
      robot,
      folder: input.folder,
      entryFile: input.entryFile,
      code: { generated: program?.code, stored: input.stored },
      date: new Date()
    },
    {
      art: domProjectArt({ functionIds: program?.functions }),
      onProgress: input.onProgress
    }
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
}
