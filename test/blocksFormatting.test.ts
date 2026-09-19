import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * FORMATTING AND PRINTING SEVERAL VALUES (#1125, epic #1119).
 * =============================================================================
 *
 * Two gaps that meet in the same line of a sensor program.
 *
 * **No format spec.** `join` generates an f-string — a good decision, and every
 * slot it made was a bare `{x}`. "Print the temperature to one decimal place"
 * is the commonest formatting job there is, and the nearest block,
 * `snakie_math_round_places`, changes the *number*: it gives `23.1` where the
 * display wanted `23.10`.
 *
 * **`print` took one socket.** `docs/blocks-coverage-epic.md` §10 lists
 * *"`print` with more than one argument"* among the fourteen lines still grey.
 *
 * THE MIGRATION IS THE RISK, and the last test here is the one that matters:
 * `text_print` is in every workspace anybody has saved, and its socket is
 * called `TEXT`. `Blockly.serialization` does not warn about an input it cannot
 * find — it throws, and the throw costs the learner every block in the file.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function generate(blocks: unknown[]): string {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
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

function rootOf(source: string): Record<string, unknown> {
  const { workspace } = pythonToBlocks(source)
  return (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
}

describe('a saved one-socket `print` still opens', () => {
  it('loads a workspace written before the block could grow', () => {
    // Exactly the serialisation an older Snakie wrote: a `TEXT` input and no
    // `extraState` at all.
    expect(
      generate([
        {
          type: 'text_print',
          id: 'p',
          inputs: { TEXT: { block: { type: 'text', id: 't', fields: { TEXT: 'hi' } } } }
        }
      ])
    ).toContain("print('hi')")
  })
})

describe('printing several things', () => {
  it('reads `print("x:", x)` back with two sockets', () => {
    const root = rootOf('print("x:", x)\n')
    expect(root.type).toBe('text_print')
    expect(root.extraState).toEqual({ items: 2 })
    expect(roundTrip('print("x:", x)\n')).toContain("print('x:', x)")
  })

  it('leaves the one-argument form exactly where it was', () => {
    const root = rootOf('print(value)\n')
    expect(root.type).toBe('text_print')
    expect(root.extraState).toBeUndefined()
  })

  it('carries four values round the trip', () => {
    expect(roundTrip('print(1, 2, 3, 4)\n')).toContain('print(1, 2, 3, 4)')
  })
})

describe('the format blocks', () => {
  it('reads each of the three back', () => {
    for (const [type, line] of [
      ['snakie_format_places', 'shown = f"{temp:.1f}"\n'],
      ['snakie_format_pad', 'shown = f"{reading:>5}"\n'],
      ['snakie_format_base', 'shown = f"{addr:#x}"\n']
    ] as const) {
      const value = (rootOf(line).inputs as Record<string, { block: Record<string, unknown> }>)
        .VALUE.block
      expect(value.type, line).toBe(type)
      expect(roundTrip(line), line).toContain(line.trim())
    }
  })

  it('leaves an f-string it does not recognise verbatim', () => {
    // Everything about the f-string grammar beyond the one shape these blocks
    // write stays raw. Coming back as an approximation would be a rewrite.
    expect(roundTrip('shown = f"temp: {t:.1f}"\n')).toContain('shown = f"temp: {t:.1f}"')
    expect(roundTrip('shown = f"{x!r}"\n')).toContain('shown = f"{x!r}"')
    expect(roundTrip('shown = f"{x:08.3f}"\n')).toContain('shown = f"{x:08.3f}"')
  })

  it('folds into `join` rather than nesting an f-string inside one', () => {
    // Left alone this would be `f"{f'{t:.1f}'}"` — legal, and a line nobody
    // would write.
    const code = generate([
      {
        type: 'text_print',
        id: 'p',
        inputs: {
          TEXT: {
            block: {
              type: 'text_join',
              id: 'j',
              extraState: { itemCount: 2 },
              inputs: {
                ADD0: { block: { type: 'text', id: 'a', fields: { TEXT: 'temp: ' } } },
                ADD1: {
                  block: {
                    type: 'snakie_format_places',
                    id: 'f',
                    fields: { PLACES: 1 },
                    inputs: {
                      VALUE: { block: { type: 'math_number', id: 'n', fields: { NUM: 23 } } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    ])
    expect(code).toContain('f"temp: {23:.1f}"')
    expect(code).not.toContain("f'")
  })
})

describe('a sensor program that says its reading', () => {
  it('goes through the round-trip gate', async () => {
    const source = [
      'temp = read()',
      'print("temp:", f"{temp:.1f}")',
      'print("addr:", f"{addr:#x}")',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
