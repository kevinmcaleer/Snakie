import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blockDefinition,
  installBlockDefinitions,
  registeredBlocks,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * THE SMALL STATEMENTS (#1133, epic #1119).
 * =============================================================================
 *
 * Three one-line statements, each too small for an issue of its own — and two
 * decisions that had to be taken out loud rather than left as leftovers.
 *
 * `del` is the one that mattered: `docs/blocks-coverage-epic.md` §10 lists it
 * among the still-grey lines as the statement *"no workstream claimed"*, and it
 * is the only way to take a key out of a dictionary.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function roundTrip(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out.code
}

const rootOf = (source: string): Record<string, unknown> => {
  const { workspace } = pythonToBlocks(source)
  return (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
}

describe('`forget` — the `del` no workstream claimed', () => {
  it('reads and writes `del name`', () => {
    expect(rootOf('del score\n').type).toBe('snakie_forget')
    expect(roundTrip('del score\n')).toContain('del score')
  })

  it('leaves the two `del`s that have drawers of their own to them', () => {
    // `del d['k']` and `del xs[0]` say what they MEAN in the Dictionaries and
    // Lists drawers, rather than being a statement about a name.
    expect(rootOf("del config['pin']\n").type).toBe('snakie_dict_remove')
    expect(rootOf('del readings[0]\n').type).toBe('snakie_list_remove_at')
  })

  it('leaves a `del` its variable field cannot hold verbatim', () => {
    // `del a, b` is two names and `del obj.attr` is not a name at all. Both
    // keep the grey block, which regenerates them exactly.
    expect(rootOf('del a, b\n').type).toBe('snakie_python_statement')
    expect(roundTrip('del a, b\n')).toContain('del a, b')
    expect(roundTrip('del self.buffer\n')).toContain('del self.buffer')
  })
})

describe('`do nothing`', () => {
  it('does not fight the generator’s own `pass`', () => {
    // A body holding the block is not empty, so the emitter writes the
    // learner's `pass` and not its own — one either way.
    expect(roundTrip('while True:\n    pass\n')).toBe('while True:\n    pass\n')
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      { blocks: { languageVersion: 0, blocks: [{ type: 'snakie_forever', id: 'f' }] } },
      ws
    )
    // …and an EMPTY body still gets the generator's, as it always did.
    expect(generateProgram(ws).code).toBe('while True:\n    pass\n')
  })

  it('survives being dragged into an empty suite, saved and reopened', () => {
    // The asymmetry the palette/reader test exists to catch: `pass` used to be
    // dropped when it was the whole body, which would have made this block
    // vanish on reopen.
    expect(rootOf('if ready:\n    pass\n').type).toBe('controls_if')
    const { workspace } = pythonToBlocks('if ready:\n    pass\n')
    const json = JSON.stringify(workspace)
    expect(json).toContain('snakie_pass')
  })
})

describe('the two decisions this issue asked to be taken out loud', () => {
  it('ships NO `assert` block, and says why', () => {
    // §3.5 declined it for the reader on evidence: 890 lines across 8 projects,
    // almost all `pytest` files — test code, not device code. Authoring came
    // out the same way. On a board an `assert` stops the program with a
    // traceback nobody is there to read, while `if … report a problem` — two
    // blocks the palette has had since #1131 — says the same thing and says
    // why. It stays with the escape hatch, which regenerates it exactly.
    expect(registeredBlocks().map((b) => b.type)).not.toContain('snakie_assert')
    expect(rootOf('assert ok\n').type).toBe('snakie_python_statement')
    expect(roundTrip('assert ok\n')).toContain('assert ok')
  })

  it('leaves `nonlocal` hidden, now that `global` has a block of its own', () => {
    // #1118 gave `global` a VARIABLE FIELD, which is a better answer than
    // un-hiding this would have been. `nonlocal` needs a function inside a
    // function, which nothing in the curriculum reaches, and "several names at
    // once" is a line the escape hatch says exactly.
    expect(blockDefinition('snakie_python_scope')!.hidden).toBe(true)
    expect(blockDefinition('snakie_global')!.hidden).toBeUndefined()
    const src = ['def go():', '    nonlocal low, high', '    low = 1', ''].join('\n')
    expect(roundTrip(src)).toBe(src)
  })
})
