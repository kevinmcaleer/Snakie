import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blocksInCategory,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * `bytes` AND `bytearray` (#1135, epic #1119).
 * =============================================================================
 *
 * The one item in the audit that is a MicroPython gap rather than a Python one.
 * On a desktop you can go a long way without typing `bytearray`; on a board you
 * cannot talk to a device without it, and every one of those lines was
 * escape-hatch text — including inside the hardware lessons.
 *
 * THE LIST GOES IN A SOCKET, which is what made the reader learn list displays:
 * `bytes([0xF4, 0x2E])` cannot round-trip while the thing inside the brackets
 * is grey.
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

describe('where they live', () => {
  it('is a Buffers drawer inside Hardware, unscoped', () => {
    const buffers = blocksInCategory('hardware').filter((b) => b.group?.id === 'buffers')
    expect(buffers.length).toBe(4)
    // Plain Python, core in both runtimes: absent IS both, and a derived
    // `micropython` here would hide a working block from a board it works on.
    for (const block of buffers) expect([block.type, block.scope]).toEqual([block.type, undefined])
  })
})

describe('making a buffer', () => {
  it('reads `bytearray(2)` and `bytes([…])`', () => {
    expect(valueOf('buf = bytearray(2)\n').type).toBe('snakie_buffer_new')
    const command = valueOf('command = bytes([0xF4, 0x2E])\n')
    expect(command.type).toBe('snakie_bytes_of')
    const list = (command.inputs as Record<string, { block: Record<string, unknown> }>).LIST.block
    expect(list.type).toBe('lists_create_with')
  })

  it('keeps the hex in the list exactly as written', () => {
    // This is the pair #1127 and #1135 were sequenced together for: a command
    // byte comes out of a datasheet in hex and has to stay in hex.
    expect(roundTrip('command = bytes([0xF4, 0x2E])\n')).toContain(
      'command = bytes([0xF4, 0x2E])'
    )
    expect(roundTrip('buf = bytearray(2)\n')).toContain('buf = bytearray(2)')
  })
})

describe('text and bytes', () => {
  it('reads encode and decode', () => {
    expect(valueOf("out = 'AT'.encode()\n").type).toBe('snakie_bytes_encode')
    expect(valueOf('reply = buf.decode()\n').type).toBe('snakie_bytes_decode')
    expect(roundTrip("out = 'AT'.encode()\n")).toContain("out = 'AT'.encode()")
    expect(roundTrip('reply = buf.decode()\n')).toContain('reply = buf.decode()')
  })
})

describe('a list display is a real block now', () => {
  it('reads `[1, 2, 3]`, which used to go grey', () => {
    expect(valueOf('readings = [1, 2, 3]\n').type).toBe('lists_create_with')
    expect(roundTrip('readings = [1, 2, 3]\n')).toContain('readings = [1, 2, 3]')
    expect(roundTrip('readings = []\n')).toContain('readings = []')
  })

  it('leaves a comprehension and a trailing comma alone', () => {
    // A comprehension has no top-level commas, so splitting would hand back one
    // "item" holding the whole of it — half an expression, worse than none
    // (#1126 is the block that really says it). And a trailing comma is the
    // learner's text, which the block has nowhere to record.
    expect(valueOf('xs = [v for v in things]\n').type).toBe('snakie_python_value')
    expect(roundTrip('xs = [1, 2,]\n')).toContain('xs = [1, 2,]')
  })
})

describe('the I²C idiom', () => {
  it('goes through the round-trip gate whole', async () => {
    // The shape `docs/hardware-test-plan.md` would exercise on a real board.
    // NOT verified on hardware here — this asserts the blocks and the Python
    // agree, which is what a unit test can honestly claim.
    const source = [
      'buf = bytearray(2)',
      'i2c.readfrom_into(0x76, buf)',
      'i2c.writeto(0x76, bytes([0xF4, 0x2E]))',
      "uart.write('AT'.encode())",
      'print(buf.decode())',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
