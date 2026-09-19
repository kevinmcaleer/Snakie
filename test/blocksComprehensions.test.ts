import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * COMPREHENSIONS (#1126, epic #1119).
 * =============================================================================
 *
 * `docs/blocks-coverage-epic.md` §3.5 declined them for the READER on good
 * evidence — 26 projects write them and they cost 3 raw lines, because they sit
 * inside a statement that is already a real block. That argument says nothing
 * about whether a learner should be able to BUILD one, which is the question
 * #1119 asks: 26 of 73 projects is how this editor's author writes, and a
 * learner graduating to text meets one immediately.
 *
 * THE SPIKE §4.1 ASKED FOR CAME BACK YES, which is why this ships with a reader
 * rather than the argued exception the issue expected. A comprehension is a
 * single logical line with two fixed keywords in it; splitting at the top-level
 * `for`, then the `in`, then an optional `if`, needs no parser. So the help
 * page does NOT have to warn that reopening turns the block grey — it does not.
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

const valueOf = (source: string): Record<string, unknown> => {
  const { workspace } = pythonToBlocks(source)
  const root = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
  return (root.inputs as Record<string, { block: Record<string, unknown> }>).VALUE.block
}

describe('the three forms the issue asks for', () => {
  it('reads and writes a plain list comprehension', () => {
    expect(valueOf('squares = [n * n for n in numbers]\n').type).toBe(
      'snakie_list_comprehension'
    )
    expect(roundTrip('squares = [n * n for n in numbers]\n')).toContain(
      'squares = [n * n for n in numbers]'
    )
  })

  it('reads and writes one with a filter', () => {
    const block = valueOf('hot = [t for t in readings if t > 30]\n')
    expect(block.type).toBe('snakie_list_comprehension')
    expect((block.inputs as Record<string, unknown>).COND).toBeTruthy()
    expect(roundTrip('hot = [t for t in readings if t > 30]\n')).toContain(
      'hot = [t for t in readings if t > 30]'
    )
  })

  it('reads and writes a dictionary comprehension', () => {
    expect(valueOf('table = {name: 0 for name in names}\n').type).toBe(
      'snakie_dict_comprehension'
    )
    expect(roundTrip('table = {name: 0 for name in names}\n')).toContain(
      'table = {name: 0 for name in names}'
    )
    expect(roundTrip('table = {n: n * n for n in numbers if n > 0}\n')).toContain(
      'table = {n: n * n for n in numbers if n > 0}'
    )
  })
})

describe('an empty filter socket means “all of them”', () => {
  it('writes no `if` at all', () => {
    // The optional socket IS the mutator arm the issue proposed, with nothing
    // to serialise and no second way to edit the block.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'text_print',
              id: 'p',
              inputs: {
                TEXT: {
                  block: {
                    type: 'snakie_list_comprehension',
                    id: 'c',
                    fields: { VAR: { id: 'v' } },
                    inputs: {
                      EXPR: { block: { type: 'variables_get', id: 'g', fields: { VAR: { id: 'v' } } } },
                      SEQ: { block: { type: 'variables_get', id: 'h', fields: { VAR: { id: 'xs' } } } }
                    }
                  }
                }
              }
            }
          ]
        },
        variables: [
          { name: 'item', id: 'v' },
          { name: 'things', id: 'xs' }
        ]
      },
      ws
    )
    expect(generateProgram(ws).code).toContain('print([item for item in things])')
  })
})

describe('what the reader declines, because the block cannot say it back', () => {
  const staysRaw = (source: string): void => {
    expect(valueOf(source).type, source).toBe('snakie_python_value')
    expect(roundTrip(source), source).toContain(source.split(' = ')[1].trim())
  }

  it('a nested comprehension — two `for`s', () => staysRaw('x = [y for row in grid for y in row]\n'))
  it('two filters', () => staysRaw('x = [v for v in xs if a if b]\n'))
  it('a tuple loop target', () => staysRaw('x = [k for k, v in pairs]\n'))
  it('a set comprehension — this palette has no set blocks', () =>
    staysRaw('x = {v for v in xs}\n'))
})

describe('a real program that writes one', () => {
  it('goes through the round-trip gate whole', async () => {
    const source = [
      'readings = [1, 2, 3]',
      'squares = [n * n for n in readings]',
      'hot = [t for t in readings if t > 2]',
      'table = {n: n * n for n in readings}',
      'print(squares, hot, table)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
