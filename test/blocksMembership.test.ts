import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blockDefinition,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * MEMBERSHIP AND IDENTITY (#1128, epic #1119).
 * =============================================================================
 *
 * `in` existed in the palette exactly once, and only for lists: the haystack
 * socket carried `check: 'Array'`, so `"c" in text`, `key in config` and
 * `byte in buf` were refused by the SHAPE of the block and had no block at all.
 * #1086 measured `in`/`not in` at 214 lines across 31 of 73 projects; almost
 * none of that is a list.
 *
 * ONE BLOCK, NOT TWO. Two blocks generating `a in b` was the outcome the issue
 * named as the one to avoid, so the existing block lost its check and moved
 * drawer rather than gaining a twin — and it kept its TYPE, so a workspace
 * saved before this opens unchanged.
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

/** The value block a one-line assignment put in its socket. */
function valueOf(source: string): Record<string, unknown> {
  const { workspace } = pythonToBlocks(source)
  const root = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
  return (root.inputs as Record<string, { block: Record<string, unknown> }>).VALUE.block
}

describe('the membership block is general now', () => {
  it('has no check on its haystack, and lives in Logic', () => {
    const def = blockDefinition('snakie_list_contains')!
    expect(def.category).toBe('logic')
    const args = (def.json as { args0: Record<string, unknown>[] }).args0
    expect(args.find((a) => a.name === 'LIST')).not.toHaveProperty('check')
  })

  it('reads a key in a dictionary, a letter in a string and a byte in a buffer', () => {
    for (const line of ['found = key in config\n', 'found = "c" in text\n', 'found = b in buf\n']) {
      expect(valueOf(line).type, line).toBe('snakie_list_contains')
    }
  })

  it('still reads a list, and still tells `in` from `not in`', () => {
    expect(valueOf('found = name in names\n').fields).toEqual({ MODE: 'IN' })
    expect(valueOf('missing = key not in seen\n').fields).toEqual({ MODE: 'NOT_IN' })
    expect(roundTrip('missing = key not in seen\n')).toContain('missing = key not in seen')
  })
})

describe('identity', () => {
  it('reads `is None` and `is not None` as the one block with a setting', () => {
    expect(valueOf('empty = reading is None\n').type).toBe('snakie_is_none')
    expect(valueOf('empty = reading is None\n').fields).toEqual({ MODE: 'IS' })
    expect(valueOf('ready = wifi is not None\n').type).toBe('snakie_is_none')
    expect(valueOf('ready = wifi is not None\n').fields).toEqual({ MODE: 'IS_NOT' })
    expect(roundTrip('ready = wifi is not None\n')).toContain('ready = wifi is not None')
  })

  it('reads `a is b` as the general block, with None still winning its own', () => {
    expect(valueOf('same = handle is other\n').type).toBe('snakie_identity')
    expect(roundTrip('same = handle is other\n')).toContain('same = handle is other')
    expect(roundTrip('different = handle is not other\n')).toContain(
      'different = handle is not other'
    )
  })

  it('refuses a chain rather than folding it left', () => {
    // `a is b is c` folded left compares a Bool against `c` — a different
    // program. It stays verbatim instead.
    expect(roundTrip('x = a is b is c\n')).toContain('x = a is b is c')
    expect(roundTrip('x = a in b in c\n')).toContain('x = a in b in c')
  })
})

describe('the whole thing survives the round-trip gate', () => {
  it('carries the guards a real program writes', async () => {
    const source = [
      'if key not in config:',
      '    print(1)',
      'if wifi is not None:',
      '    print(2)',
      'if "," in line:',
      '    print(3)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
