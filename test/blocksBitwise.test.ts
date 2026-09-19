import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * BITWISE MATHS, FLOOR DIVISION AND THE LITERALS (#1127, epic #1119).
 * =============================================================================
 *
 * Two properties, and the second is the one with teeth.
 *
 * **Precedence**, because Python's four bitwise levels sit between comparison
 * and addition and a reader that flattened them would read `x & 1 == 0` as the
 * other program — silently, about a line that is in every driver ever written.
 *
 * **Literals come back as themselves.** `0x3C` through `math_number` is `60`:
 * the same value, a different line, and the round-trip gate refuses the whole
 * file over it. That is why there are two literal blocks holding text rather
 * than one holding a number.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** The Python a converted program generates back. */
function roundTrip(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out.code
}

describe('the bitwise operators generate', () => {
  it('writes & | ^ with Python precedence and no invented brackets', () => {
    expect(roundTrip('x = a & b & c\n')).toContain('x = a & b & c')
    expect(roundTrip('x = a | b | c\n')).toContain('x = a | b | c')
    expect(roundTrip('x = a ^ b\n')).toContain('x = a ^ b')
  })

  it('keeps the brackets Python needs between the levels', () => {
    // `&` binds tighter than `|`, so the source's own brackets are load-bearing.
    expect(roundTrip('x = (a | b) & c\n')).toContain('x = (a | b) & c')
    // …and where they are not, they are not added back.
    expect(roundTrip('x = a | b & c\n')).toContain('x = a | b & c')
  })

  it('reads a comparison as looser than a mask, the way Python does', () => {
    // A MASK BINDS TIGHTER THAN `==` IN PYTHON — the opposite of C, and the
    // reason the four bitwise levels had to go BETWEEN comparison and addition
    // rather than anywhere convenient. `x & 1 == 0` is `(x & 1) == 0`, so the
    // comparison is the outer block and the mask is inside it.
    const { workspace } = pythonToBlocks('flag = x & 1 == 0\n')
    const root = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
    const value = (root.inputs as Record<string, { block: Record<string, unknown> }>).VALUE.block
    expect(value.type).toBe('logic_compare')
    const inner = (value.inputs as Record<string, { block: Record<string, unknown> }>).A.block
    expect(inner.type).toBe('snakie_bitwise')
    expect(roundTrip('flag = x & 1 == 0\n')).toContain('flag = x & 1 == 0')
  })

  it('shifts, and keeps the shift looser than the addition inside it', () => {
    expect(roundTrip('x = 1 << pin\n')).toContain('x = 1 << pin')
    expect(roundTrip('x = 1 << a + b\n')).toContain('x = 1 << a + b')
    expect(roundTrip('x = a >> 2 >> 1\n')).toContain('x = a >> 2 >> 1')
  })

  it('flips the bits, and declines the one shape it would get wrong', () => {
    expect(roundTrip('x = ~mask\n')).toContain('x = ~mask')
    // `~a ** 2` is `~(a ** 2)` in Python. Refused, so it stays verbatim.
    expect(roundTrip('x = ~a ** 2\n')).toContain('x = ~a ** 2')
  })
})

describe('floor division is division, on the arithmetic block', () => {
  it('reads and writes `//` through math_arithmetic', () => {
    const { workspace } = pythonToBlocks('rows = total // 8\n')
    const root = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
    const value = (root.inputs as Record<string, { block: Record<string, unknown> }>).VALUE.block
    expect(value.type).toBe('math_arithmetic')
    expect(value.fields).toEqual({ OP: 'FLOORDIVIDE' })
    expect(roundTrip('rows = total // 8\n')).toContain('rows = total // 8')
  })

  it('associates left with the rest of its level', () => {
    expect(roundTrip('x = 7 // 2 * 3\n')).toContain('x = 7 // 2 * 3')
  })
})

describe('hex and binary literals survive the trip as written', () => {
  it('keeps `0x3C` as `0x3C` rather than 60', () => {
    expect(roundTrip('addr = 0x3C\n')).toContain('addr = 0x3C')
    expect(roundTrip('addr = 0x76\n')).toContain('addr = 0x76')
    expect(roundTrip('mask = 0b1010\n')).toContain('mask = 0b1010')
  })

  it('keeps lower case and underscores exactly', () => {
    expect(roundTrip('x = 0xff\n')).toContain('x = 0xff')
    expect(roundTrip('x = 0xDE_AD\n')).toContain('x = 0xDE_AD')
  })

  it('carries a real masking line through the round-trip gate', async () => {
    const source = [
      'status = read()',
      'measuring = status & 0b00001000',
      'command = (1 << 7) | mode',
      'rows = total // 8',
      'addr = 0x3C',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
