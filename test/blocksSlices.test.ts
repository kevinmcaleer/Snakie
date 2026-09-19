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
 * SLICING (#1123, epic #1119).
 * =============================================================================
 *
 * A learner could read one thing out of a list and that was all. "The last
 * reading", "the first three", "everything after the header byte" and "the
 * string backwards" were all escape-hatch text — and on a microcontroller the
 * last of those matters most, because slicing is how a buffer is handled.
 *
 * THE `Array` CHECK IS THE REGRESSION TO WATCH. `"EDCDEEE"[::-1]` is a real
 * line in one of the music examples, and #1087 found that an over-tight check
 * does not refuse one socket — it refuses the whole workspace.
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

describe('no socket here checks Array', () => {
  it('is true of every slice block', () => {
    for (const type of [
      'snakie_slice_range',
      'snakie_slice_first',
      'snakie_slice_last',
      'snakie_last_item',
      'snakie_slice_copy',
      'snakie_slice_reverse'
    ]) {
      const args = (blockDefinition(type)!.json as { args0: Record<string, unknown>[] }).args0
      expect(args.find((a) => a.name === 'SEQ'), type).not.toHaveProperty('check')
    }
  })

  it('so a string in the socket does not take the canvas down', () => {
    // The #1087 failure, stated as a test: a `text` block in an Array-checked
    // socket is a workspace `Blockly.serialization` throws on, and the throw
    // costs the learner every block in the file.
    expect(roundTrip("tune = 'EDCDEEE'[::-1]\n")).toContain("tune = 'EDCDEEE'[::-1]")
  })
})

describe('the six shapes', () => {
  it('reads each one as its own block', () => {
    for (const [type, line] of [
      ['snakie_slice_range', 'middle = readings[1:4]\n'],
      ['snakie_slice_first', 'head = readings[:3]\n'],
      ['snakie_slice_last', 'tail = readings[-3:]\n'],
      ['snakie_last_item', 'newest = readings[-1]\n'],
      ['snakie_slice_copy', 'spare = readings[:]\n'],
      ['snakie_slice_reverse', 'back = readings[::-1]\n']
    ] as const) {
      expect(valueOf(line).type, line).toBe(type)
      expect(roundTrip(line), line).toContain(line.trim())
    }
  })

  it('keeps the 1-based start exact', () => {
    // `from 2 to 4` is `seq[1:4]`, and a variable start keeps its `- 1` where
    // the learner can see it — the drawer's promise since #1011.
    expect(roundTrip('middle = readings[1:4]\n')).toContain('middle = readings[1:4]')
    expect(roundTrip('middle = readings[n - 1:end]\n')).toContain(
      'middle = readings[n - 1:end]'
    )
  })

  it('handles the buffer slices a driver writes', () => {
    expect(roundTrip('rest = buf[1:]\n')).not.toBe('')
    expect(roundTrip('head = data[:2]\n')).toContain('head = data[:2]')
  })
})

describe('the slices these blocks cannot say back', () => {
  it('leaves a step it has no block for verbatim', () => {
    // `[::2]` is every other one, which this palette has no block for. Coming
    // back as a plain slice would silently drop the step.
    expect(roundTrip('every = readings[::2]\n')).toContain('every = readings[::2]')
  })

  it('leaves `seq[3:]` alone — "from the 4th on" is not "the last 3"', () => {
    expect(valueOf('rest = readings[3:]\n').type).not.toBe('snakie_slice_last')
    expect(roundTrip('rest = readings[3:]\n')).toContain('rest = readings[3:]')
  })
})

describe('a buffer-handling program', () => {
  it('goes through the round-trip gate', async () => {
    const source = [
      'data = read()',
      'header = data[:2]',
      'rest = data[1:]',
      'newest = data[-1]',
      "name = 'sensor'[::-1]",
      'print(header, rest, newest, name)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
