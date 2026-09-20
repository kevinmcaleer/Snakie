import {
  BLOCKS_SCHEMA_VERSION,
  parseBlocksFooter,
  type BlocksWorkspace
} from '../../../../shared/blocks-doc'
import { pythonToBlocks } from './python-to-blocks'

/**
 * WHICH BLOCKS GO ON THE CANVAS FOR THIS FILE (#1034, #1068).
 * =============================================================================
 *
 * Three cases, and the middle one is the bug this module exists to fix.
 *
 *  - **A footer that matches its code.** Those are the blocks the learner
 *    arranged, they generated exactly this Python when they were saved, and they
 *    go on the canvas as they are — including where each one was dragged to.
 *  - **A footer that does NOT match.** Somebody edited the `.py` by hand.
 *    `blocks-doc.ts` has detected this since #1008, when the answer was a modal
 *    asking which side won; #1034 settled it the other way and `docs/blocks.md`
 *    is the current word: *"if that comment goes stale, or is missing entirely,
 *    Snakie works the blocks out from the code"*.
 *
 *    Only nothing did. `parseBlocksFooter` hands back the workspace it stored,
 *    `codeMatches` was read by nobody, and the canvas loaded the stale blocks —
 *    so the mirror showed THEIR regeneration where the learner's own edited
 *    Python should have been, and the first block touched wrote it over the top.
 *    Their edits disappeared off the screen before they could read them.
 *  - **No footer at all.** An ordinary `.py`, converted, same as above.
 *
 * `derived` is the output that matters downstream: it says these blocks are our
 * reading of somebody's Python rather than an arrangement they made, which is
 * what tells `BlocksSplit` to put them through #1069's round-trip check before
 * letting them write anything back.
 *
 * Pure and React-free, so which-blocks-for-which-file is a unit test rather than
 * something you find out by hand-editing a file and watching what happens.
 */
export interface BlocksDocument {
  /** The Python: the file with any footer stripped. What runs on the board. */
  code: string
  /** The workspace to put on the canvas. */
  workspace: BlocksWorkspace
  /** The footer's schema version, or this build's when there was no footer. */
  version: number
  /**
   * True when the blocks were worked out from the code rather than read from a
   * footer that matched it — so nothing has ever checked that they say the same
   * thing, and #1069's check is what decides whether they may write.
   */
  derived: boolean
}

/** The document to show for a file's text, or null when there is no text yet. */
export function blocksDocumentFor(content: string | undefined): BlocksDocument | null {
  if (content === undefined) return null
  const stored = parseBlocksFooter(content)
  if (stored?.codeMatches) {
    return { code: stored.code, workspace: stored.workspace, version: stored.version, derived: false }
  }
  // The code is the thing they last wrote and the thing that runs, so it is the
  // thing the blocks are made to match — never the other way round.
  const code = stored ? stored.code : content
  return {
    code,
    workspace: pythonToBlocks(code).workspace,
    version: stored?.version ?? BLOCKS_SCHEMA_VERSION,
    derived: true
  }
}

/**
 * THE SAME PROGRAM, READ FROM ITS PYTHON INSTEAD (#1252).
 *
 * A stored footer can name block types this build cannot build: a part or
 * plugin that isn't installed (#1017), a module whose `.py` is not beside the
 * file and whose board is not plugged in (#1048 registers those blocks from the
 * module's own source, so they come and go with it), or a file from a newer
 * Snakie. Until now that was the end of the road — the canvas refused to mount
 * and said "these blocks need a newer Snakie".
 *
 * But nothing is actually lost in that case. The footer's OTHER half is the
 * Python those blocks generated, and `pythonToBlocks` cannot fail: a line it
 * has no native block for becomes a raw Python block holding that exact line
 * (#1019). So the honest answer is the one every other mismatch already gets —
 * the code is the program, the blocks are our reading of it, and `derived` says
 * so, which is what puts them behind #1069's round-trip gate before they may
 * write anything back.
 *
 * The stored workspace is dropped rather than repaired, and only in the document
 * we render: the FILE is untouched, so re-opening it with the missing part
 * installed brings the learner's own arrangement straight back.
 */
export function documentFromCode(doc: BlocksDocument): BlocksDocument {
  return {
    code: doc.code,
    workspace: pythonToBlocks(doc.code).workspace,
    version: doc.version,
    derived: true
  }
}
