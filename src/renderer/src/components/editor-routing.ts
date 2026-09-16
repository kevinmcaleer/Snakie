import type { WorkspaceId } from '../store/layout'

/**
 * WHICH WORKSPACES SHOW THE BLOCK CANVAS (#1066).
 * =============================================================================
 *
 * Pure, because "does the block shelf appear here?" turned out to be a question
 * nobody could answer by reading `EditorArea`'s router — and the answer was
 * wrong in two of the four workspaces.
 */

/** Just enough of an open file to route it. */
export interface RoutedFile {
  name: string
  /** Does this `.py` carry a blocks footer (#1008)? */
  isBlocks?: boolean
}

/**
 * Show the blocks split for this file, in this workspace?
 *
 * TWO RULES, AND THEY ARE BOTH ABOUT THE FILE:
 *  - a file with a blocks footer is a blocks file (#1008); and
 *  - in the Blocks workspace, so is any `.py` at all (#1034) — the `.py` is the
 *    program and the blocks are a view of it, so pressing Blocks on a file
 *    Snakie did not write shows you blocks rather than appearing to ignore you.
 *
 * AND ONE ABOUT THE WORKSPACE, which is what #1066 was missing. Blocks and Code
 * are the two workspaces that are ABOUT the program. Electronics and Build are
 * not: both collapse the centre column to nothing so the Board View or the URDF
 * editor can have the screen — and a canvas mounted in a zero-width column does
 * not quietly disappear, because Blockly's toolbox takes no hint from a host
 * with no width. The block shelf painted itself straight over Build's robot
 * tree and its Export buttons.
 *
 * The file is not hidden by this. It opens as ordinary code in those two, which
 * is all a workspace that is not about the program can usefully show of it.
 */
export function showsBlocksCanvas(workspace: WorkspaceId, file: RoutedFile | null): boolean {
  if (workspace !== 'blocks' && workspace !== 'code') return false
  if (!file) return false
  return file.isBlocks === true || (workspace === 'blocks' && /\.py$/i.test(file.name))
}
