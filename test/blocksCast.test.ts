import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * CASTING, AND `global` (#1118).
 * =============================================================================
 *
 * Two lines a learner could write in blocks only by typing Python into a grey
 * block: turning a value into another type, and telling a function that a name
 * belongs to the whole program.
 *
 * WHAT THESE TESTS PIN, beyond "it generates the call":
 *
 *  - **an empty socket still runs.** `int()` is a TypeError in the mirror the
 *    learner is reading, so each type has an empty value of its own — and it is
 *    the empty value of the type going IN (`str('')`), not of the one coming
 *    out.
 *  - **`int('ff', 16)` is not this block.** The reader refuses a call whose
 *    argument count does not line up, so a base conversion stays raw rather
 *    than quietly losing its 16.
 *  - **`global` follows a rename.** Its name is a variable field, so `my score`
 *    reaches the code as `my_score` — the same sanitising every other mention
 *    of that variable gets — and `global list`, which sanitising would rename
 *    out from under the declaration, stays with the escape hatch instead.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** Build a workspace from serialised JSON and generate its program. */
function lines(blocks: unknown[], variables?: unknown[]): string[] {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(
    { blocks: { languageVersion: 0, blocks }, ...(variables ? { variables } : {}) },
    ws
  )
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out.code.split('\n')
}

/** `print( turn <value> into <type> )`, as one statement. */
function printCast(type: string, value?: Record<string, unknown>): unknown[] {
  return [
    {
      type: 'text_print',
      id: 'p',
      inputs: {
        TEXT: {
          block: {
            type: 'snakie_cast',
            id: 'c',
            fields: { TYPE: type },
            ...(value ? { inputs: { VALUE: { block: value } } } : {})
          }
        }
      }
    }
  ]
}

const text = (t: string): Record<string, unknown> => ({
  type: 'text',
  id: 't',
  fields: { TEXT: t }
})

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

function blocks(source: string): Record<string, unknown>[] {
  const { workspace } = pythonToBlocks(source)
  const out: Record<string, unknown>[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const roots = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of roots ?? []) walk(block)
  return out
}

describe('turning one type into another', () => {
  it('generates the call the dropdown names', () => {
    expect(lines(printCast('int', text('10')))[0]).toBe("print(int('10'))")
    expect(lines(printCast('float', text('1.5')))[0]).toBe("print(float('1.5'))")
    expect(lines(printCast('str', text('10')))[0]).toBe("print(str('10'))")
    expect(lines(printCast('bool', text('')))[0]).toBe("print(bool(''))")
    expect(lines(printCast('list', text('abc')))[0]).toBe("print(list('abc'))")
    expect(lines(printCast('tuple', text('abc')))[0]).toBe("print(tuple('abc'))")
  })

  it('writes something that RUNS when the socket is empty', () => {
    expect(lines(printCast('int'))[0]).toBe('print(int(0))')
    expect(lines(printCast('float'))[0]).toBe('print(float(0))')
    expect(lines(printCast('str'))[0]).toBe("print(str(''))")
    expect(lines(printCast('list'))[0]).toBe('print(list([]))')
  })

  it('reads every one of them back, and writes the same line again', () => {
    for (const type of ['int', 'float', 'str', 'bool', 'list', 'tuple']) {
      const src = `x = ${type}(reading)\n`
      const cast = blocks(src).find((b) => b.type === 'snakie_cast')
      expect(cast, src).toBeTruthy()
      expect(cast!.fields).toEqual({ TYPE: type })
      expect(regenerate(src)).toBe(src)
    }
  })

  it('reads a cast of an expression, brackets and all', () => {
    expect(regenerate('x = int(raw * 3.3 / 65535)\n')).toBe('x = int(raw * 3.3 / 65535)\n')
    expect(regenerate('speed = float(parts[1])\n')).toBe('speed = float(parts[1])\n')
  })

  it('leaves a call this block cannot hold alone', () => {
    // A base conversion has a second argument and no socket to put it in.
    expect(blocks("x = int('ff', 16)\n").map((b) => b.type)).not.toContain('snakie_cast')
    expect(regenerate("x = int('ff', 16)\n")).toBe("x = int('ff', 16)\n")
  })
})

describe('`global`', () => {
  it('declares the name, sanitised the same way every other mention is', () => {
    expect(
      lines(
        [
          {
            type: 'procedures_defnoreturn',
            id: 'd',
            fields: { NAME: 'go' },
            inputs: {
              STACK: {
                block: {
                  type: 'snakie_global',
                  id: 'g',
                  fields: { VAR: { id: 'v', name: 'my score' } },
                  next: {
                    block: {
                      type: 'variables_set',
                      id: 's',
                      fields: { VAR: { id: 'v', name: 'my score' } },
                      inputs: {
                        VALUE: { block: { type: 'math_number', id: 'n', fields: { NUM: 1 } } }
                      }
                    }
                  }
                }
              }
            }
          }
        ],
        [{ name: 'my score', id: 'v' }]
      )
    ).toEqual(['def go():', '    global my_score', '    my_score = 1', ''])
  })

  it('comes back as itself when the program is reopened', () => {
    const src = ['def go():', '    global total', '    total = 1', ''].join('\n')
    expect(blocks(src).map((b) => b.type)).toContain('snakie_global')
    expect(regenerate(src)).toBe(src)
  })
})
