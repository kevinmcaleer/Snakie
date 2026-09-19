import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * THE LIST VERBS (#1122, epic #1119).
 * =============================================================================
 *
 * The drawer was six blocks and its own header recorded the trim: *"sort,
 * reverse, split, sublist, repeat and index-of are registered nowhere"*. That
 * was right for #1007's robot palette, and it left one thing that is not a
 * text-processing nicety: **you could not take something out of a list at all.**
 *
 * THE OFF-BY-ONE IS THE TEST. `insert`, `pop` and both removes write the `- 1`
 * out, the way `get`/`set` have since #1011, and the reader has to undo exactly
 * that arithmetic and nothing else — a line the generator could not have
 * written stays raw rather than coming back subtly renumbered.
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

describe('taking things out', () => {
  it('reads remove, remove-at and pop as three different blocks', () => {
    expect(rootOf('readings.remove(value)\n').type).toBe('snakie_list_remove')
    expect(rootOf('del readings[0]\n').type).toBe('snakie_list_remove_at')
    expect(valueOf('last = readings.pop(0)\n').type).toBe('snakie_list_pop')
  })

  it('keeps the 1-based ↔ 0-based conversion exact, both ways', () => {
    expect(roundTrip('readings.insert(0, value)\n')).toContain('readings.insert(0, value)')
    expect(roundTrip('readings.insert(n - 1, value)\n')).toContain(
      'readings.insert(n - 1, value)'
    )
    expect(roundTrip('last = readings.pop(2)\n')).toContain('last = readings.pop(2)')
    expect(roundTrip('del readings[0]\n')).toContain('del readings[0]')
  })

  it('declines an index it could not have written rather than renumbering it', () => {
    // `xs.pop(n)` is not a line this block writes — the block would hold `n`
    // and regenerate `xs.pop(n - 1)`, which is somebody's line rewritten.
    expect(valueOf('last = readings.pop(n)\n').type).not.toBe('snakie_list_pop')
    expect(roundTrip('last = readings.pop(n)\n')).toContain('last = readings.pop(n)')
  })
})

describe('where something is', () => {
  it('folds `xs.index(v) + 1` into the 1-based setting', () => {
    const one = valueOf('at = names.index(name) + 1\n')
    expect(one.type).toBe('snakie_list_index')
    expect(one.fields).toEqual({ START: 'ONE' })
    const zero = valueOf('at = names.index(name)\n')
    expect(zero.fields).toEqual({ START: 'ZERO' })
    expect(roundTrip('at = names.index(name) + 1\n')).toContain('at = names.index(name) + 1')
    expect(roundTrip('at = names.index(name)\n')).toContain('at = names.index(name)')
  })

  it('leaves real arithmetic around it alone', () => {
    // `+ 2` is not the block's own `+ 1`; it is an addition somebody wrote.
    expect(valueOf('at = names.index(name) + 2\n').type).toBe('math_arithmetic')
    expect(roundTrip('at = names.index(name) + 2\n')).toContain('at = names.index(name) + 2')
  })
})

describe('sorting, and the three that change a list in place', () => {
  it('tells a sort in place from a sorted copy', () => {
    const modify = rootOf('readings.sort()\n')
    expect(modify.type).toBe('snakie_list_modify')
    expect(modify.fields).toEqual({ OP: 'sort' })
    expect(valueOf('ordered = sorted(readings)\n').type).toBe('snakie_list_sorted')
  })

  it('reads reverse and clear through the same block', () => {
    expect((rootOf('readings.reverse()\n').fields as Record<string, unknown>).OP).toBe('reverse')
    expect((rootOf('readings.clear()\n').fields as Record<string, unknown>).OP).toBe('clear')
  })
})

describe('averaging five readings', () => {
  it('reads sum, min and max over a list', () => {
    for (const [op, line] of [
      ['sum', 'total = sum(readings)\n'],
      ['min', 'lowest = min(readings)\n'],
      ['max', 'highest = max(readings)\n']
    ] as const) {
      expect((valueOf(line).fields as Record<string, unknown>).OP, line).toBe(op)
    }
  })

  it('leaves the two-number min/max to the Maths drawer', () => {
    // Arity keeps them apart: one argument is a list, two are numbers.
    expect(valueOf('safe = min(angle, 180)\n').type).toBe('snakie_math_min_max')
  })

  it('carries the whole averaging idiom through the round-trip gate', async () => {
    const source = [
      'readings = []',
      'readings.append(value)',
      'readings.insert(0, value)',
      'readings.sort()',
      'average = sum(readings) / len(readings)',
      'oldest = readings.pop(1)',
      'print(average, oldest)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
