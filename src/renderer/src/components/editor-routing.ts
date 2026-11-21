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
 * In the Blocks workspace, any `.py` (#1034) — the `.py` is the program and the
 * blocks are a view of it. In Code, only when the switcher's dot is lit (the
 * split), and then for any `.py`; a blocks footer no longer changes which
 * editor Code uses.
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
export function showsBlocksCanvas(
  workspace: WorkspaceId,
  file: RoutedFile | null,
  both = false
): boolean {
  if (workspace !== 'blocks' && workspace !== 'code') return false
  if (!file) return false
  const program = file.isBlocks === true || /\.py$/i.test(file.name)
  if (!program) return false
  // EVERY FILE IS MICROPYTHON, AND CODE TREATS THEM ALL THE SAME (Kev, 2026-11-21).
  // A file saved from Blocks carries a comment footer recording where the blocks
  // sat; that is all that makes it different, and it used to send the file to the
  // blocks split's Python view in Code — another editor, another surface, no
  // chip. Now Code shows the canvas only when the switcher's dot asks for both
  // (and then for any `.py`), and otherwise opens every file in the code editor.
  if (workspace === 'code') return both
  return true
}
