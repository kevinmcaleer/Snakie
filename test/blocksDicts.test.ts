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
import { buildToolbox } from '../src/renderer/src/lib/blocks/toolbox'

/**
 * THE DICTIONARIES DRAWER (#1120, epic #1119).
 * =============================================================================
 *
 * The biggest hole the epic's audit found, and the only one that was a whole
 * missing CATEGORY: there were no dictionary blocks at all, so a config, a pin
 * map or a note table had to be typed into the escape hatch.
 *
 * THE INTERESTING TEST IS THE LAST ONE. `d['k']` and `xs[0]` are the same
 * shape, and the reader tells them apart on the one unambiguous ground there
 * is — a string key. `xs[i]` with a variable in it stays where #1089 put it,
 * because guessing would put somebody's line in the wrong drawer.
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

function rootOf(source: string): Record<string, unknown> {
  const { workspace } = pythonToBlocks(source)
  return (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
}

const valueOf = (source: string): Record<string, unknown> =>
  (rootOf(source).inputs as Record<string, { block: Record<string, unknown> }>).VALUE.block

describe('the drawer exists', () => {
  it('is a category of its own, in both toolboxes', () => {
    expect(blocksInCategory('dicts').length).toBeGreaterThan(0)
    for (const dialect of ['micropython', 'circuitpython'] as const) {
      const categories = (buildToolbox(dialect) as { contents: { name: string }[] }).contents
      expect(categories.map((c) => c.name)).toContain('Dictionaries')
    }
  })

  it('offers the safe get before the one that raises', () => {
    const types = blocksInCategory('dicts').map((b) => b.type)
    expect(types.indexOf('snakie_dict_get_default')).toBeLessThan(
      types.indexOf('snakie_dict_get')
    )
  })

  it('ships no second block for `in` or for `len` (#1128)', () => {
    // Two blocks generating one line is the outcome #1128 named as the one to
    // avoid — membership is the general Logic block, length is the Lists one.
    const types = blocksInCategory('dicts').map((b) => b.type)
    expect(types).not.toContain('snakie_dict_has')
    expect(types).not.toContain('snakie_dict_length')
  })
})

describe('the literal', () => {
  it('reads and writes a dictionary', () => {
    const value = valueOf("config = {'pin': 15, 'speed': 200}\n")
    expect(value.type).toBe('snakie_dict_create')
    expect(value.extraState).toEqual({ items: 2 })
    expect(roundTrip("config = {'pin': 15, 'speed': 200}\n")).toContain(
      "config = {'pin': 15, 'speed': 200}"
    )
  })

  it('reads the empty one', () => {
    expect(valueOf('seen = {}\n').type).toBe('snakie_dict_create')
    expect(roundTrip('seen = {}\n')).toContain('seen = {}')
  })

  it('leaves a set alone — this palette has no set blocks', () => {
    // `{1, 2, 3}` wears the same braces and has no colons in it. Declining it
    // keeps it verbatim rather than reading it as a dictionary it is not.
    expect(valueOf('seen = {1, 2, 3}\n').type).not.toBe('snakie_dict_create')
    expect(roundTrip('seen = {1, 2, 3}\n')).toContain('seen = {1, 2, 3}')
  })
})

describe('looking things up', () => {
  it('reads the three string-key shapes', () => {
    expect(valueOf("pin = config['pin']\n").type).toBe('snakie_dict_get')
    expect(rootOf("config['pin'] = 15\n").type).toBe('snakie_dict_set')
    expect(rootOf("del config['pin']\n").type).toBe('snakie_dict_remove')
    expect(roundTrip("pin = config['pin']\n")).toContain("pin = config['pin']")
    expect(roundTrip("config['pin'] = 15\n")).toContain("config['pin'] = 15")
    expect(roundTrip("del config['pin']\n")).toContain("del config['pin']")
  })

  it('does not steal a list subscript', () => {
    // `xs[0]` is the Lists block and `xs[i]` is neither. Only a string key is
    // unambiguous, so only a string key is claimed.
    expect(valueOf('first = readings[0]\n').type).toBe('snakie_list_get')
    expect(roundTrip('x = readings[index]\n')).toContain('x = readings[index]')
  })

  it('reads `.get` with its fallback, and the three views', () => {
    expect(valueOf("pin = config.get('pin', 0)\n").type).toBe('snakie_dict_get_default')
    for (const [what, line] of [
      ['keys', 'names = config.keys()\n'],
      ['values', 'names = config.values()\n'],
      ['items', 'names = config.items()\n']
    ] as const) {
      const value = valueOf(line)
      expect(value.type).toBe('snakie_dict_parts')
      expect(value.fields).toEqual({ WHAT: what })
    }
  })
})

describe('a real config program', () => {
  it('goes through the round-trip gate whole', async () => {
    const source = [
      "notes = {'C': 262, 'D': 294}",
      "notes['E'] = 330",
      "print(notes.get('F', 0))",
      'for name, frequency in notes.items():',
      '    print(name, frequency)',
      "del notes['C']",
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
