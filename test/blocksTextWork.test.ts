import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blockDefinition,
  blocksInCategory,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { categoryContents } from '../src/renderer/src/lib/blocks/toolbox'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * WORKING WITH TEXT (#1124, epic #1119).
 * =============================================================================
 *
 * The Text drawer was four blocks and its header recorded the trim: case,
 * substring, index-of, trim, replace, reverse and `text_prompt` registered
 * nowhere, because *"they are a text-processing library, and this is a palette
 * for making a robot do something."* #1119 re-opened that, on the grounds that
 * Snakie is not only a robot palette: a serial command parser, a CSV sensor, a
 * WiFi response and a menu on a display are all string work.
 *
 * THE DRAWER HAS TO STAY READABLE, which is what the first test is about. Seven
 * more blocks loose in Text would bury `print` half way down the flyout.
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

describe('the drawer is still four blocks at a glance', () => {
  it('puts the new ones on a shelf of their own', () => {
    const text = BLOCK_CATEGORIES.find((c) => c.id === 'text')!
    const contents = categoryContents(text, 'micropython')
    const loose = contents.filter((c) => c.kind === 'block')
    expect(loose.map((c) => c.type)).toEqual(['text', 'text_join', 'text_length', 'text_print'])
    const shelf = contents.find((c) => c.kind === 'category') as { name: string; contents: [] }
    expect(shelf.name).toBe('Working with text')
    expect(shelf.contents.length).toBe(9)
  })

  it('still has no `text_prompt` — there is no keyboard on the board', () => {
    expect(blocksInCategory('text').map((b) => b.type)).not.toContain('text_prompt')
  })
})

describe('what the drawer deliberately leaves to other blocks', () => {
  it('has no `contains` of its own — that is the Logic membership block', () => {
    expect(blocksInCategory('text').map((b) => b.type)).not.toContain('snakie_text_contains')
    expect(valueOf("found = ',' in line\n").type).toBe('snakie_list_contains')
  })

  it('has no `letter n of` — `item n of` stopped checking Array instead', () => {
    expect(blocksInCategory('text').map((b) => b.type)).not.toContain('snakie_text_letter')
    const args = (blockDefinition('snakie_list_get')!.json as { args0: Record<string, unknown>[] })
      .args0
    expect(args.find((a) => a.name === 'LIST')).not.toHaveProperty('check')
    expect(valueOf("first = 'hello'[0]\n").type).toBe('snakie_list_get')
    expect(roundTrip("first = 'hello'[0]\n")).toContain("first = 'hello'[0]")
  })

  it('keeps the Array check on `set item` — a string cannot be written to', () => {
    // The asymmetry is the point: `s[0] = 'x'` is a TypeError, and a socket
    // that accepted it would be teaching one.
    const args = (blockDefinition('snakie_list_set')!.json as { args0: Record<string, unknown>[] })
      .args0
    expect(args.find((a) => a.name === 'LIST')).toHaveProperty('check', 'Array')
  })
})

describe('the seven blocks', () => {
  it('reads each one back', () => {
    for (const [type, line] of [
      ['snakie_text_case', "shout = name.upper()\n"],
      ['snakie_text_strip', 'clean = line.strip()\n'],
      ['snakie_text_replace', "out = line.replace(',', ' ')\n"],
      ['snakie_text_split', "parts = line.split(',')\n"],
      ['snakie_text_join_with', "out = ', '.join(parts)\n"],
      ['snakie_text_edge', "go = command.startswith('GO')\n"],
      ['snakie_text_find', "at = line.find(',')\n"]
    ] as const) {
      expect(valueOf(line).type, line).toBe(type)
      expect(roundTrip(line), line).toContain(line.trim())
    }
  })

  it('tells the two options of each dropdown apart', () => {
    expect((valueOf('x = name.lower()\n').fields as Record<string, unknown>).OP).toBe('lower')
    expect(
      (valueOf("x = name.endswith('!')\n").fields as Record<string, unknown>).OP
    ).toBe('endswith')
  })

  it('folds `find(x) + 1` into the 1-based setting', () => {
    const one = valueOf("at = line.find(',') + 1\n")
    expect(one.type).toBe('snakie_text_find')
    expect((one.fields as Record<string, unknown>).START).toBe('ONE')
    expect(roundTrip("at = line.find(',') + 1\n")).toContain("at = line.find(',') + 1")
  })
})

describe('a serial command parser', () => {
  it('goes through the round-trip gate whole', async () => {
    const source = [
      'line = uart.readline()',
      'command = line.strip()',
      "if command.lower().startswith('go'):",
      "    parts = command.split(' ')",
      "    print(', '.join(parts))",
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
