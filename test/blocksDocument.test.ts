import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { blocksDocumentFor, documentFromCode } from '../src/renderer/src/lib/blocks/document'
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


/**
 * FALLING BACK TO THE PYTHON (#1252).
 *
 * A footer can name a block type this build cannot build — a part or plugin
 * that isn't installed, or (the case this was reported for) a module whose
 * blocks #1048 registered from a `.py` that is not beside the file and a board
 * that is not plugged in. The canvas used to refuse to mount at all and say
 * "these blocks need a newer Snakie". It falls back to the code instead, which
 * always converts.
 */
describe('documentFromCode', () => {
  const MODULE_CODE = "ping = RangeFinder(echo_pin=0, trigger_pin=1)\nprint(ping.distance())\n"
  /** What a file saved with a module's blocks (#1048) looks like here. */
  const WITH_MODULE_BLOCKS = writeBlocksFooter(MODULE_CODE, {
    blocks: {
      blocks: [
        { type: 'snakie_module_range_finder_new_rangefinder', id: 'r0' },
        { type: 'snakie_module_range_finder_rangefinder_get', id: 'r1' }
      ]
    }
  } as never)

  it('the stored document still carries the types this build has never heard of', () => {
    const stored = blocksDocumentFor(WITH_MODULE_BLOCKS)
    expect(stored?.derived).toBe(false)
    expect(JSON.stringify(stored?.workspace)).toContain('snakie_module_range_finder_new_rangefinder')
  })

  it('re-reads the program from its Python, keeping the code byte-for-byte', () => {
    const stored = blocksDocumentFor(WITH_MODULE_BLOCKS)
    const fallback = documentFromCode(stored!)
    expect(fallback.code).toBe(stored!.code)
    // Our reading of their Python, so it goes behind the round-trip gate.
    expect(fallback.derived).toBe(true)
    // …and nothing in it needs a block this build hasn't got.
    expect(JSON.stringify(fallback.workspace)).not.toContain('snakie_module_')
  })

  it('the blocks it falls back to regenerate the same program', () => {
    const fallback = documentFromCode(blocksDocumentFor(WITH_MODULE_BLOCKS)!)
    expect(regenerate(fallback.workspace as Record<string, unknown>).trimEnd()).toBe(
      fallback.code.trimEnd()
    )
  })
})
