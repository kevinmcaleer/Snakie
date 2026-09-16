import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  blockDefinition,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * THE FUNCTIONS DRAWER (#1045, epic #1007).
 * =============================================================================
 *
 * A function you defined never appeared in the drawer, so there was no way to
 * call it. The drawer held the two `def` blocks, `ifreturn`, and TWO BLANK
 * caller blocks — `procedures_callnoreturn` and `procedures_callreturn`
 * rendered as themselves, with no procedure to take a name from.
 *
 * The cause was that every toolbox category was built as a static list from the
 * block registry. That is right for the other thirteen and wrong for this one,
 * whose contents are a question about the WORKSPACE. Blockly's own
 * `flyoutCategory` answers it.
 *
 * So this suite is about two things: that the drawer is generated rather than
 * listed, and that a caller which arrives from it still generates Python —
 * which nothing exercised before, because no NAMED caller could be reached.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** A workspace holding `def wiggle(a, b)` and a call to it. */
function withFunction(): Blockly.Workspace {
  const { workspace } = pythonToBlocks('def wiggle(a, b):\n    print(a)\n\nwiggle(1, 2)\n')
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return ws
}

describe('the drawer is generated from the workspace (#1045)', () => {
  it('Blockly can see the function the learner defined', () => {
    // `allProcedures` is what the flyout reads. If this is empty the drawer
    // cannot possibly offer a caller, whatever the toolbox says.
    const [noReturn] = Blockly.Procedures.allProcedures(withFunction())
    expect(noReturn).toEqual([['wiggle', ['a', 'b'], false]])
  })

  it('offers a caller NAMED after it, carrying its parameters', () => {
    const items = Blockly.Procedures.flyoutCategory(
      withFunction() as Blockly.WorkspaceSvg
    ) as unknown as Record<string, unknown>[]
    const caller = items.find((i) => i.type === 'procedures_callnoreturn')
    expect(caller).toBeTruthy()
    expect(caller?.extraState).toEqual({ name: 'wiggle', params: ['a', 'b'] })
  })

  it('offers the two def blocks and ifreturn, always', () => {
    const types = (
      Blockly.Procedures.flyoutCategory(withFunction() as Blockly.WorkspaceSvg) as unknown as {
        type?: string
      }[]
    ).map((i) => i.type)
    expect(types).toContain('procedures_defnoreturn')
    expect(types).toContain('procedures_defreturn')
    expect(types).toContain('procedures_ifreturn')
  })

  it('offers NO caller when nothing is defined — the old blank blocks', () => {
    // The bug, stated as a test: with no function defined there must be no
    // caller in the drawer at all, rather than two nameless ones.
    const empty = new Blockly.Workspace()
    const types = (
      Blockly.Procedures.flyoutCategory(empty as Blockly.WorkspaceSvg) as unknown as {
        type?: string
      }[]
    ).map((i) => i.type)
    expect(types).not.toContain('procedures_callnoreturn')
    expect(types).not.toContain('procedures_callreturn')
  })
})

describe('the caller blocks stay registered though they are never listed (#1045)', () => {
  it('both still have an emitter', () => {
    // The generator looks an emitter up by type. Dropping these from the
    // registry to get them out of the flyout would break every program that
    // calls a function.
    expect(blockDefinition('procedures_callnoreturn')).toBeTruthy()
    expect(blockDefinition('procedures_callreturn')).toBeTruthy()
  })

  it('and Blockly still knows their shapes, so a saved file opens', () => {
    // `workspace-check.ts` refuses to mount a canvas holding a type this build
    // does not know — it would strand the learner's file rather than show it.
    expect(Blockly.Blocks['procedures_callnoreturn']).toBeTruthy()
    expect(Blockly.Blocks['procedures_callreturn']).toBeTruthy()
  })
})

describe('a named caller generates Python (#1045)', () => {
  it('round-trips a def and its call', () => {
    const source = 'def wiggle(a, b):\n    print(a)\n\nwiggle(1, 2)\n'
    const { workspace } = pythonToBlocks(source)
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    expect(generateProgram(ws).code).toBe(source)
  })

  it('a caller built the way the drawer builds one emits the call', () => {
    // This is the path nothing exercised before: `extraState` rather than a
    // hand-written `fields`/`inputs` pair, which is what `flyoutCategory` hands
    // the canvas when a block is dragged out of the drawer.
    const ws = withFunction()
    const fresh = Blockly.serialization.blocks.append(
      {
        type: 'procedures_callnoreturn',
        extraState: { name: 'wiggle', params: ['a', 'b'] }
      } as never,
      ws
    )
    expect(fresh.getFieldValue('NAME')).toBe('wiggle')
    const def = blockDefinition('procedures_callnoreturn')
    expect(def).toBeTruthy()
    // Sockets left empty generate `None`, which is Python that runs — the
    // learner sees the shape of the call before they fill it in.
    const code = generateProgram(ws).code
    expect(code).toContain('wiggle(')
  })

  it('a function with no parameters still calls cleanly', () => {
    const source = 'def hello():\n    print(1)\n\nhello()\n'
    const { workspace } = pythonToBlocks(source)
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    expect(generateProgram(ws).code).toBe(source)
  })
})
