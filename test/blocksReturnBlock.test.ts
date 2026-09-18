import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * AN EARLY OR BARE `return` (W3, #1090, epic #1086).
 * =============================================================================
 *
 * **2,359 raw lines across 57 of 73 projects** — and grey on purpose, which is
 * the part worth remembering. A mid-function `return` used to become
 * `procedures_ifreturn`, whose generated code is `if <COND>: return <VALUE>`,
 * and with nothing in COND the generator wrote `if False:`. Every early return
 * in the program silently became dead code, so #1063 pulled the recognition back
 * to a raw block: honest, and a grey wall.
 *
 * This is not that block re-enabled. It is the block that was missing: no
 * condition, a value socket that may be empty, and a next connection, because a
 * guard clause has a whole function after it.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

function types(source: string): string[] {
  const { workspace } = pythonToBlocks(source)
  const out: string[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block.type as string)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const roots = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of roots ?? []) walk(block)
  return out
}

describe('a return that is not the last line', () => {
  it('reads a bare `return` as a block', () => {
    const src = ['def angle(degrees):', '    if degrees < 0:', '        return', '    print(degrees)', ''].join('\n')
    expect(types(src)).toContain('snakie_return')
    expect(types(src)).not.toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('reads `return <value>` as a block with the value in its socket', () => {
    const src = ['def clamp(v):', '    if v < 0:', '        return 0', '    print(v)', ''].join('\n')
    expect(types(src)).toContain('snakie_return')
    expect(types(src)).toContain('math_number')
    roundTrips(src)
  })

  it('never writes `if False:` — the bug that made this raw in the first place', () => {
    const src = ['def go(n):', '    if n < 0:', '        return', '    print(n)', ''].join('\n')
    expect(regenerate(src)).not.toContain('if False')
  })

  it('holds for a guard-clause-heavy function', () => {
    const src = [
      'def angle(degrees):',
      '    if degrees < 0:',
      '        return',
      '    if degrees > 180:',
      '        return',
      '    print(degrees)',
      ''
    ].join('\n')
    roundTrips(src)
  })

  it('carries the rest of the function after it', () => {
    // The reason it needs a NEXT connection. `controls_flow_statements` has
    // none, on the true reasoning that nothing runs after `break` — and #1068
    // is the record of how much that cost when it was not true.
    const src = ['def go(n):', '    return', '    print(n)', ''].join('\n')
    expect(types(src)).toContain('snakie_return')
    roundTrips(src)
  })

  it('reads one at the top level too', () => {
    // Not valid Python outside a function, and not this module's business: the
    // rule is that every line either becomes the block it obviously is or a
    // block holding that exact line.
    roundTrips('return\n')
  })
})

describe('what must not change', () => {
  it('a trailing `return <expr>` is still the def block’s RETURN socket', () => {
    const src = ['def double(n):', '    return n * 2', ''].join('\n')
    expect(types(src)).toContain('procedures_defreturn')
    expect(types(src)).not.toContain('snakie_return')
    roundTrips(src)
  })

  it('a trailing return with a comment is neither — it stays whole', () => {
    // `statement()` refuses a line carrying a trailing comment because no block
    // holds both halves, and the RETURN socket must agree or the comment is lost
    // (found by the ratchet in #1087).
    const src = ['def half(n):', '    return n / 2  # rounded down', ''].join('\n')
    roundTrips(src)
  })

  it('a def whose only statement is an early return still round-trips', () => {
    const src = ['def go(n):', '    if n:', '        return 1', '    return 2', ''].join('\n')
    roundTrips(src)
  })
})
