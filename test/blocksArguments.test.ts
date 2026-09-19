import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * KEYWORD ARGUMENTS, DEFAULTS AND `*args` (#1134, epic #1119).
 * =============================================================================
 *
 * `palette/functions.ts` built a signature from Blockly's parameter list —
 * positional names, and nothing else — so `def blink(times=3):` could not be
 * built, `pixels.fill(colour=RED)` could not be written, and
 * `def __init__(self, *args, **kwargs)` had only the escape hatch.
 *
 * **THE MIGRATION IS THE COST OF THIS ISSUE**, and the last describe here is
 * about it. Blockly's procedure blocks carry a mutator that renames every
 * caller when a parameter is renamed; extending its serialisation is what would
 * have put every saved workspace at risk. A FIELD on the block is serialised by
 * name, a block saved before it existed simply has none, and Blockly's own
 * machinery is untouched.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function generate(blocks: unknown[], variables?: unknown[]): string {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(
    { blocks: { languageVersion: 0, blocks }, ...(variables ? { variables } : {}) },
    ws
  )
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out.code
}

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

describe('keyword arguments at a call site', () => {
  it('writes `name=value` when the socket is named, and nothing when it is not', () => {
    const call = (name: string): string =>
      generate([
        {
          type: 'snakie_python_call',
          id: 'c',
          extraState: { args: 1 },
          fields: { METHOD: 'fill', NAME0: name },
          inputs: {
            OBJ: { block: { type: 'snakie_python_value', id: 'o', fields: { CODE: 'pixels' } } },
            ARG0: { block: { type: 'math_number', id: 'n', fields: { NUM: 1 } } }
          }
        }
      ])
    expect(call('colour')).toContain('pixels.fill(colour=1)')
    expect(call('')).toContain('pixels.fill(1)')
  })

  it('never turns an unnamed argument into `value=` by accident', () => {
    // `sanitise` falls back to `value` for anything that cleans down to
    // nothing, which is right for a LABEL somebody typed and would have made
    // every positional argument in the palette a keyword one.
    expect(
      generate([
        {
          type: 'snakie_python_call',
          id: 'c',
          extraState: { args: 1 },
          fields: { METHOD: 'set_speed', NAME0: '   ' },
          inputs: {
            OBJ: { block: { type: 'snakie_python_value', id: 'o', fields: { CODE: 'motor' } } },
            ARG0: { block: { type: 'math_number', id: 'n', fields: { NUM: 120 } } }
          }
        }
      ])
    ).toContain('motor.set_speed(120)')
  })
})

describe('spreading', () => {
  it('reads and writes `*args` and `**settings`', () => {
    expect(roundTrip('thing.calibrate(*args)\n')).toContain('thing.calibrate(*args)')
    expect(roundTrip('thing.calibrate(*args, **settings)\n')).toContain(
      'thing.calibrate(*args, **settings)'
    )
  })
})

describe('`super()`', () => {
  it('reads back, and carries a subclass’s setup', () => {
    const src = [
      'class Rover(Wheels):',
      '    def __init__(self, *args, **kwargs):',
      '        super().__init__(*args, **kwargs)',
      ''
    ].join('\n')
    expect(roundTrip(src)).toBe(src)
  })
})

describe('parameters Blockly’s list cannot hold', () => {
  it('reads a default, keeping the plain names as real parameters', () => {
    const root = rootOf('def blink(pin, times=3):\n    print(pin)\n')
    expect(root.type).toBe('procedures_defnoreturn')
    expect(root.fields).toMatchObject({ NAME: 'blink', EXTRAS: 'times=3' })
    expect((root.extraState as { params: { name: string }[] }).params.map((p) => p.name)).toEqual([
      'pin'
    ])
    expect(roundTrip('def blink(pin, times=3):\n    print(pin)\n')).toContain(
      'def blink(pin, times=3):'
    )
  })

  it('reads `*args` / `**kwargs`, and everything after them, verbatim', () => {
    // Keyword-only parameters come AFTER a `*args`, so the split has to take
    // everything from the first unholdable one onwards rather than filtering —
    // otherwise a signature comes back reordered.
    expect(roundTrip('def go(a, *args, flag=True, **kwargs):\n    print(a)\n')).toContain(
      'def go(a, *args, flag=True, **kwargs):'
    )
  })

  it('gives a defaulted parameter no caller socket, which is correct', () => {
    // It is optional at the call site — that is the whole reason for a default.
    const src = 'def blink(pin, times=3):\n    print(pin)\n\nblink(15)\n'
    expect(roundTrip(src)).toBe(src)
  })

  it('still refuses a signature it cannot split', () => {
    // A trailing comma is the learner's text and no block records it.
    expect(rootOf('def load(path,):\n    print(path)\n').type).not.toBe(
      'procedures_defnoreturn'
    )
    expect(roundTrip('def load(path,):\n    print(path)\n')).toContain('def load(path,):')
  })
})

describe('every saved workspace still opens', () => {
  it('generates a `def` saved before the field existed', () => {
    // Exactly what an older Snakie wrote: Blockly's own `params` extraState, a
    // NAME field, and no EXTRAS at all.
    expect(
      generate(
        [
          {
            type: 'procedures_defnoreturn',
            id: 'd',
            fields: { NAME: 'go' },
            extraState: { params: [{ name: 'n', id: 'varn' }] },
            inputs: {
              STACK: {
                block: {
                  type: 'text_print',
                  id: 'p',
                  inputs: {
                    TEXT: { block: { type: 'variables_get', id: 'g', fields: { VAR: { id: 'varn' } } } }
                  }
                }
              }
            }
          }
        ],
        [{ name: 'n', id: 'varn' }]
      )
    ).toContain('def go(n):')
  })

  it('leaves Blockly’s caller bookkeeping alone', () => {
    // The whole reason for a field rather than an extended mutator: the caller
    // blocks, the rename flow and the parameter list are untouched.
    const src = 'def go(n):\n    print(n)\n\ngo(1)\n'
    expect(roundTrip(src)).toBe(src)
  })
})

describe('a driver-shaped program', () => {
  it('goes through the round-trip gate whole', async () => {
    const source = [
      'def blink(pin, times=3, delay=0.1):',
      '    print(pin)',
      '',
      'blink(15)',
      'pixels.fill(colour=RED)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
