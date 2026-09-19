import { beforeEach, describe, expect, it } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  EXTRAS_FIELD,
  extrasVisible,
  hasExtrasRow,
  setExtrasVisible
} from '../src/renderer/src/lib/blocks/palette/functions'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * THE EXTRA-PARAMETERS ROW IS ONLY THERE WHEN IT IS USED (#1134).
 * =============================================================================
 *
 * `def` blocks carry a text field for the parameters Blockly's mutator cannot
 * model — a default, a `*args`, a `**kwargs`. It shipped visible on every `def`
 * block, so the first function a learner ever drags out asked them to wonder
 * what an extra parameter is.
 *
 * The rule is: hidden while empty, shown the moment it holds something. These
 * tests hold BOTH halves of it — the row's state, and the fact that the row's
 * state never touches the Python, which is what makes hiding it safe.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** A workspace holding the blocks `python` reads back as. */
function load(python: string): Blockly.Workspace {
  const { workspace } = pythonToBlocks(python)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return ws
}

/** The one `def` block on a workspace. */
function def(ws: Blockly.Workspace): Blockly.Block {
  const block = ws
    .getTopBlocks(false)
    .find((b) => b.type.startsWith('procedures_def'))
  if (!block) throw new Error('no definition block')
  return block
}

describe('the extra-parameters row', () => {
  it('is installed on both definition blocks', () => {
    const ws = new Blockly.Workspace()
    for (const type of ['procedures_defnoreturn', 'procedures_defreturn']) {
      expect(hasExtrasRow(ws.newBlock(type))).toBe(true)
    }
  })

  it('starts hidden on a block dragged fresh out of the toolbox', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    expect(extrasVisible(block)).toBe(false)
    expect(block.getFieldValue(EXTRAS_FIELD)).toBe('')
  })

  it('stays hidden for a plain function read back from Python', () => {
    const ws = load('def blink(times):\n    print(times)\n')
    expect(extrasVisible(def(ws))).toBe(false)
  })

  it('shows itself for a function whose signature needs it', () => {
    // The field takes its value during deserialisation, and the row follows it.
    const ws = load('def load(path, flip_x=None):\n    print(path)\n')
    const block = def(ws)
    expect(block.getFieldValue(EXTRAS_FIELD)).toBe('flip_x=None')
    expect(extrasVisible(block)).toBe(true)
  })

  it('shows itself for `*args` / `**kwargs` too', () => {
    const ws = load('def wrap(*args, **kwargs):\n    print(args)\n')
    expect(extrasVisible(def(ws))).toBe(true)
  })

  it('appears when the block is asked for it, as the context menu does', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('procedures_defnoreturn')
    setExtrasVisible(block, true)
    expect(extrasVisible(block)).toBe(true)
    setExtrasVisible(block, false)
    expect(extrasVisible(block)).toBe(false)
  })
})

describe('what the row’s visibility does to the Python — nothing', () => {
  it('writes the same signature whether the empty row is shown or hidden', () => {
    const ws = load('def blink(times):\n    print(times)\n\nblink(1)\n')
    const before = generateProgram(ws).code
    setExtrasVisible(def(ws), true)
    expect(generateProgram(ws).code).toBe(before)
    expect(before).toContain('def blink(times):')
  })

  it('keeps generating the default when the row is hidden by hand', () => {
    const ws = load('def load(path, flip_x=None):\n    print(path)\n\nload("a")\n')
    setExtrasVisible(def(ws), false)
    expect(generateProgram(ws).code).toContain('def load(path, flip_x=None):')
  })

  it('saves a hidden row’s value, so a round trip through a file survives', () => {
    const ws = load('def load(path, flip_x=None):\n    print(path)\n')
    setExtrasVisible(def(ws), false)
    const saved = Blockly.serialization.workspaces.save(ws)
    const reopened = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(saved, reopened)
    const block = def(reopened)
    expect(block.getFieldValue(EXTRAS_FIELD)).toBe('flip_x=None')
    // And the row comes back with it: the value is what decides, not the state
    // the workspace happened to be saved in.
    expect(extrasVisible(block)).toBe(true)
  })
})
