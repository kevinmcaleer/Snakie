import { beforeEach, describe, expect, it } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { orderStacks } from '../src/renderer/src/lib/pdf/sections/blocks'

/**
 * `GeneratedProgram.functions` — the ids of the `def` blocks the generator
 * HOISTED (#1112).
 *
 * The PDF's blocks pages order functions before the main program, and they do
 * it from this list rather than from a second idea of what a function is. These
 * tests are what stop the two drifting apart.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function load(python: string): Blockly.Workspace {
  const { workspace } = pythonToBlocks(python)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return ws
}

describe('the hoisted function ids', () => {
  it('is empty for a program with no functions', () => {
    expect(generateProgram(load('print("hi")\n')).functions).toEqual([])
  })

  it('names the def blocks, and only those', () => {
    const ws = load('def wiggle(a):\n    print(a)\n\nwiggle(1)\n')
    const { functions } = generateProgram(ws)
    expect(functions).toHaveLength(1)
    const block = ws.getBlockById(functions[0])
    expect(block?.type).toBe('procedures_defnoreturn')
    expect(block?.getFieldValue('NAME')).toBe('wiggle')
  })

  it('lists them in the order the code hoists them', () => {
    const ws = load('def one():\n    pass\n\ndef two():\n    pass\n\none()\ntwo()\n')
    const { code, functions } = generateProgram(ws)
    const names = functions.map((id) => ws.getBlockById(id)?.getFieldValue('NAME'))
    expect(names).toEqual(['one', 'two'])
    // The PDF's ordering and the generated .py agree, by construction.
    expect(code.indexOf('def one')).toBeLessThan(code.indexOf('def two'))
  })

  it('is the notion the blocks pages order from', () => {
    const ws = load('main_thing = 1\n\ndef helper():\n    pass\n\nhelper()\n')
    const { functions } = generateProgram(ws)
    const tops = ws.getTopBlocks(true).map((b) => ({ id: b.id }))
    const ordered = orderStacks(tops, functions)
    // Whatever order the learner dropped them in, the def comes out first.
    expect(ordered[0].id).toBe(functions[0])
    expect(ordered).toHaveLength(tops.length)
  })

  it('covers a returning def as well', () => {
    const ws = load('def answer():\n    return 42\n\nx = answer()\n')
    const { functions } = generateProgram(ws)
    expect(functions).toHaveLength(1)
    expect(ws.getBlockById(functions[0])?.type).toBe('procedures_defreturn')
  })
})
