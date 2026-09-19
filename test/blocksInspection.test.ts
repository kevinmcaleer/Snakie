import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * INSPECTION AND THE REMAINING CONVERSIONS (#1130, epic #1119).
 * =============================================================================
 *
 * #1118 shipped `snakie_cast` while this was being audited, which covers the
 * six types a learner meets first. These four are what it does not do:
 * `ord`/`chr` (two halves of one lookup, not a type change), `int(s, base)`
 * (a second argument the cast block has nowhere to put) and `isinstance`
 * (inspection rather than conversion — nothing in the palette asked what a
 * value *is*).
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

function valueOf(source: string): Record<string, unknown> {
  const { workspace } = pythonToBlocks(source)
  const root = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
  return (root.inputs as Record<string, { block: Record<string, unknown> }>).VALUE.block
}

describe('letters and their numbers', () => {
  it('reads and writes ord and chr', () => {
    expect(valueOf("code = ord('A')\n").type).toBe('snakie_text_ord')
    expect(valueOf('letter = chr(65)\n').type).toBe('snakie_text_chr')
    expect(roundTrip("code = ord('A')\n")).toContain("code = ord('A')")
    expect(roundTrip('letter = chr(65)\n')).toContain('letter = chr(65)')
  })
})

describe('a number written in another base', () => {
  it('reads int(text, base) without losing the base', () => {
    const block = valueOf("n = int('3C', 16)\n")
    expect(block.type).toBe('snakie_int_base')
    expect(roundTrip("n = int('3C', 16)\n")).toContain("n = int('3C', 16)")
  })

  it('leaves the one-argument cast to the cast block', () => {
    // `int(x)` has been #1118's block since it landed, and arity is what keeps
    // the two rules from fighting over the same line.
    expect(valueOf("n = int('10')\n").type).toBe('snakie_cast')
  })
})

describe('asking what a value is', () => {
  it('reads isinstance with the type in its dropdown', () => {
    const block = valueOf('ok = isinstance(reading, int)\n')
    expect(block.type).toBe('snakie_isinstance')
    expect(block.fields).toEqual({ KIND: 'int' })
    expect(roundTrip('ok = isinstance(reading, int)\n')).toContain(
      'ok = isinstance(reading, int)'
    )
    expect(roundTrip('ok = isinstance(payload, dict)\n')).toContain(
      'ok = isinstance(payload, dict)'
    )
  })

  it('declines a type the dropdown cannot hold rather than saying something else', () => {
    // `isinstance(x, MyClass)` is a real line and not this block. It stays
    // verbatim in a grey value block rather than coming back as `int`.
    expect(valueOf('ok = isinstance(thing, MyClass)\n').type).not.toBe('snakie_isinstance')
    expect(roundTrip('ok = isinstance(thing, MyClass)\n')).toContain(
      'ok = isinstance(thing, MyClass)'
    )
  })
})

describe('the four together survive the round-trip gate', () => {
  it('carries a serial-parsing program', async () => {
    const source = [
      "line = '3C'",
      "value = int(line, 16)",
      "first = ord(line[0])",
      "back = chr(first)",
      'if isinstance(value, int):',
      '    print(back)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
