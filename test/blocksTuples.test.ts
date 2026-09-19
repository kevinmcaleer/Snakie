import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * TUPLES, UNPACKING AND MULTI-VALUE LOOPS (#1121, epic #1119).
 * =============================================================================
 *
 * `docs/blocks-coverage-epic.md` §10 listed `for name, value in rows:` among
 * the fourteen lines still grey in the fixture corpus — *"a tuple loop target,
 * which `controls_forEach` cannot hold"*. It is a block now, and so are the two
 * shapes that are really the same loop with a call in the middle.
 *
 * THE RISK HERE IS THE ROUND TRIP, which is why `a, b = b, a` has a test of its
 * own: it is the one line where the target and the value are both tuples and
 * neither is bracketed.
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

describe('the tuple literal', () => {
  it('reads `(x, y)` as a tuple rather than as brackets', () => {
    const value = (rootOf('point = (x, y)\n').inputs as Record<string, { block: Record<string, unknown> }>)
      .VALUE.block
    expect(value.type).toBe('snakie_tuple')
    expect(value.extraState).toEqual({ items: 2 })
    expect(roundTrip('point = (x, y)\n')).toContain('point = (x, y)')
  })

  it('leaves a bracketed expression alone', () => {
    // `(a + b)` is one expression in brackets and is not a tuple. The comma at
    // the top level of the brackets is the whole difference.
    const value = (rootOf('total = (a + b) * 2\n').inputs as Record<
      string,
      { block: Record<string, unknown> }
    >).VALUE.block
    expect(value.type).toBe('math_arithmetic')
  })

  it('keeps the comma on a one-element tuple', () => {
    // `(x,)` is a one-element tuple; `(x)` is just `x`. A driver asking for a
    // one-byte buffer writes the first one.
    expect(roundTrip('buf = (value,)\n')).toContain('buf = (value,)')
  })
})

describe('unpacking', () => {
  it('reads two plain names as the friendly block', () => {
    const root = rootOf('x, y = position()\n')
    expect(root.type).toBe('snakie_unpack')
    expect(roundTrip('x, y = position()\n')).toContain('x, y = position()')
  })

  it('leaves everything else to the text-target block', () => {
    // Three names, and an attribute target: both keep `snakie_python_assign`,
    // which is superseded for the common shape and not for these.
    expect(rootOf('a, b, c = 1, 2, 3\n').type).toBe('snakie_python_assign')
    expect(rootOf('self.x, self.y = 0, 0\n').type).toBe('snakie_python_assign')
  })

  it('brings the swap back as itself', () => {
    expect(roundTrip('a, b = b, a\n')).toContain('a, b = b, a')
  })
})

describe('the multi-value loops', () => {
  it('reads a tuple loop target — the line §10 listed as still grey', () => {
    const root = rootOf('for name, value in rows:\n    print(name)\n')
    expect(root.type).toBe('snakie_for_each_two')
    expect(roundTrip('for name, value in rows:\n    print(name)\n')).toContain(
      'for name, value in rows:'
    )
  })

  it('tells `enumerate` from a plain two-name loop, and keeps its start', () => {
    const zero = rootOf('for i, item in enumerate(items):\n    print(i)\n')
    expect(zero.type).toBe('snakie_for_each_indexed')
    expect((zero.fields as Record<string, unknown>).START).toBe('ZERO')
    const one = rootOf('for i, item in enumerate(items, 1):\n    print(i)\n')
    expect((one.fields as Record<string, unknown>).START).toBe('ONE')
    expect(roundTrip('for i, item in enumerate(items):\n    print(i)\n')).toContain(
      'for i, item in enumerate(items):'
    )
    expect(roundTrip('for i, item in enumerate(items, 1):\n    print(i)\n')).toContain(
      'for i, item in enumerate(items, 1):'
    )
  })

  it('declines a start the dropdown cannot hold rather than losing it', () => {
    expect(rootOf('for i, item in enumerate(items, 5):\n    print(i)\n').type).not.toBe(
      'snakie_for_each_indexed'
    )
    expect(roundTrip('for i, item in enumerate(items, 5):\n    print(i)\n')).toContain(
      'for i, item in enumerate(items, 5):'
    )
  })

  it('reads `zip` as the side-by-side loop', () => {
    expect(rootOf('for a, b in zip(xs, ys):\n    print(a)\n').type).toBe('snakie_for_each_zip')
    expect(roundTrip('for a, b in zip(xs, ys):\n    print(a)\n')).toContain(
      'for a, b in zip(xs, ys):'
    )
  })
})

describe('a function giving back two things', () => {
  it('returns a tuple and unpacks it, through the round-trip gate', async () => {
    const source = [
      'def position():',
      '    return (1, 2)',
      '',
      'x, y = position()',
      'for i, item in enumerate(rows, 1):',
      '    print(i, item)',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
