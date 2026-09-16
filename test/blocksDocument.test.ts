import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { blocksDocumentFor } from '../src/renderer/src/lib/blocks/document'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { writeBlocksFooter } from '../src/shared/blocks-doc'

/**
 * WHICH BLOCKS GO ON THE CANVAS (#1034, #1068).
 * =============================================================================
 *
 * The case that matters is the middle one: a `.py` hand-edited under a footer
 * that no longer matches it. `docs/blocks.md` says Snakie works the blocks out
 * from the code when that happens, and nothing did — the stale workspace went on
 * the canvas, the mirror showed its regeneration in place of the learner's own
 * edited Python, and the first block they touched wrote that over the file.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

const CODE = "print('one')\n"
/** A blocks file whose footer genuinely matches its code. */
const MATCHING = writeBlocksFooter(CODE, pythonToBlocks(CODE).workspace)

/** What the document's blocks actually generate. */
function regenerate(workspace: Record<string, unknown>): string {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

describe('blocksDocumentFor', () => {
  it('has nothing to say about a file with no text yet', () => {
    expect(blocksDocumentFor(undefined)).toBeNull()
  })

  it('keeps the stored workspace when the footer matches its code', () => {
    const doc = blocksDocumentFor(MATCHING)
    expect(doc?.derived).toBe(false)
    expect(doc?.code).toBe(CODE.trimEnd())
    // The learner's own arrangement, not our reading of it.
    expect(doc?.workspace).toEqual(pythonToBlocks(CODE).workspace)
  })

  it('converts an ordinary .py, and says the blocks are derived', () => {
    const doc = blocksDocumentFor("print('hello')\n")
    expect(doc?.derived).toBe(true)
    expect(doc?.code).toBe("print('hello')\n")
  })

  it('re-derives the blocks from the code when the footer has gone stale', () => {
    // Somebody edited the Python by hand; the footer still describes the old
    // program. The code is what they last wrote and what runs, so it wins.
    const edited = MATCHING.replace("print('one')", "print('two')")
    const doc = blocksDocumentFor(edited)
    expect(doc?.derived).toBe(true)
    expect(doc?.code).toBe("print('two')")
    expect(regenerate(doc!.workspace)).toBe("print('two')\n")
  })

  it('does not put the stale blocks on the canvas', () => {
    // The regression, stated as its own test: what used to happen is that the
    // OLD program came back, and the hand edit was gone from the screen.
    const edited = MATCHING.replace("print('one')", "print('two')")
    expect(regenerate(blocksDocumentFor(edited)!.workspace)).not.toContain("print('one')")
  })

  it('keeps the footer version it found, so a stale footer is not silently upgraded', () => {
    const edited = MATCHING.replace("print('one')", "print('two')")
    expect(blocksDocumentFor(edited)?.version).toBe(blocksDocumentFor(MATCHING)?.version)
  })
})
