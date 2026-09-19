import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * ASSIGNMENT AND SCOPE (W8, #1095, epic #1086).
 * =============================================================================
 *
 * The shapes the reader used to decline. Individually small, and **2,333 lines
 * across 36 projects** between them: tuple targets, chained assignment,
 * subscripts, every augmented operator but `+=`, `global`/`nonlocal`, `not in`,
 * and the imports that must not be hoisted.
 *
 * TWO RULES CARRY OVER FROM #1068 AND #1071 AND ARE ASSERTED HERE.
 *
 *  - `x == 5` must never be read as assigning `= 5` to `x`. The old recogniser
 *    was a regex with a `=(?!=)` guard, because an earlier one regenerated that
 *    line as `x = = 5`. The guard is gone and the lexer answers instead — `==`
 *    is one token — so the regression test matters more, not less.
 *  - `s += "x"` must not build a `text` block into `math_change`'s DELTA socket,
 *    which checks Number and made the whole workspace unloadable. It gets a
 *    block whose socket checks nothing, rather than staying grey.
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

function blocks(source: string): Record<string, unknown>[] {
  const { workspace } = pythonToBlocks(source)
  const out: Record<string, unknown>[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const roots = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of roots ?? []) walk(block)
  return out
}

const types = (source: string): string[] => blocks(source).map((b) => b.type as string)
const one = (source: string, type: string): Record<string, unknown> | undefined =>
  blocks(source).find((b) => b.type === type)

describe('targets that are not a plain name', () => {
  it('reads a tuple assignment', () => {
    expect(one('a, b = 1, 2\n', 'snakie_python_assign')!.fields).toEqual({ TARGET: 'a, b' })
    roundTrips('a, b = 1, 2\n')
  })

  it('reads a swap', () => {
    roundTrips('a, b = b, a\n')
  })

  it('reads a chained assignment — one value, two names', () => {
    // The LAST top-level `=` is the one that assigns.
    expect(one('x = y = 0\n', 'snakie_python_assign')!.fields).toEqual({ TARGET: 'x = y' })
    roundTrips('x = y = 0\n')
  })

  it('reads a subscript the Lists block cannot count back', () => {
    expect(types('readings[index] = 1\n')).toContain('snakie_python_assign')
    roundTrips('readings[index] = 1\n')
  })

  it('reads a nested subscript', () => {
    roundTrips('grid[y][x] = 1\n')
  })

  it('reads a dict entry whose value is an expression', () => {
    roundTrips('counts[name] = counts.get(name, 0) + 1\n')
  })

  it('still prefers the real blocks where they fit', () => {
    // A plain name is the Variables drawer's own block; an attribute is the
    // attribute-set block; `xs[0]` is the Lists block. The generic one is what
    // is left.
    expect(types('x = 1\n')).toContain('variables_set')
    expect(types('self.speed = 0\n')).toContain('snakie_python_attr_set')
    expect(types('readings[0] = 1\n')).toContain('snakie_list_set')
  })
})

describe('augmented assignment', () => {
  it('keeps `count += 1` as the change block', () => {
    expect(types('count += 1\n')).toContain('math_change')
    roundTrips('count += 1\n')
  })

  it('reads every other operator', () => {
    for (const op of ['-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=']) {
      const src = `total ${op} 2\n`
      expect(one(src, 'snakie_python_augmented')!.fields, op).toEqual({ TARGET: 'total', OP: op })
      roundTrips(src)
    }
  })

  it('reads `+=` on something that is not a number', () => {
    // #1071's line, from `micropython/modules/buzzer.py`. `math_change`'s DELTA
    // checks Number and a `text` in it is a workspace Blockly refuses to load,
    // which cost the learner every block in the file; this block's socket checks
    // nothing, which is honest about an operator that joins strings too.
    expect(types("s += 'x'\n")).toContain('snakie_python_augmented')
    expect(types("s += 'x'\n")).not.toContain('math_change')
    roundTrips("s += 'x'\n")
  })

  it('reads one on an attribute and on a subscript', () => {
    roundTrips('self.total += 1\n')
    roundTrips('grid[y] ^= 1\n')
  })

  it('never mistakes a comparison for one (#1068)', () => {
    // The `=(?!=)` guard is gone and the lexer answers instead, so this
    // regression test matters more rather than less.
    expect(types('if x == 5:\n    print(1)\n')).toContain('controls_if')
    roundTrips('if x == 5:\n    print(1)\n')
    roundTrips('ok = x != 5\n')
    roundTrips('ok = x <= 5\n')
  })
})

describe('scope', () => {
  it('reads `global` as the Variables drawer\u2019s own block (#1118)', () => {
    // A plain `global name` is a block with a VARIABLE FIELD, so the name
    // follows a rename the way every other mention of that variable does. The
    // escape hatch below keeps everything that shape cannot hold.
    const src = ['def go():', '    global total', '    total = 1', ''].join('\n')
    expect(one(src, 'snakie_global')).toBeTruthy()
    roundTrips(src)
  })

  it('leaves `global` alone when the name is one Python has taken', () => {
    // `global list` cannot become a variable field: the generator sanitises a
    // reserved name to `list_`, which would write a different program back.
    const src = ['def go():', '    global list', '    list = []', ''].join('\n')
    expect(one(src, 'snakie_python_scope')!.fields).toEqual({ SCOPE: 'global', NAMES: 'list' })
  })

  it('reads `nonlocal`, and several names at once', () => {
    const src = ['def go():', '    nonlocal low, high', '    low = 1', ''].join('\n')
    expect(one(src, 'snakie_python_scope')!.fields).toEqual({
      SCOPE: 'nonlocal',
      NAMES: 'low, high'
    })
    roundTrips(src)
  })
})

describe('`not in`', () => {
  it('is its own operator, not a `not` around `in`', () => {
    // `logic_negate` round an `in` block writes `not v in xs` — the same test and
    // a different line, and rewriting somebody's line is the one thing the
    // reader does not do.
    const src = ['if name not in names:', '    print(1)', ''].join('\n')
    expect(one(src, 'snakie_list_contains')!.fields).toEqual({ MODE: 'NOT_IN' })
    roundTrips(src)
  })

  it('still reads plain `in`', () => {
    const src = ['if name in names:', '    print(1)', ''].join('\n')
    expect(one(src, 'snakie_list_contains')!.fields).toEqual({ MODE: 'IN' })
    roundTrips(src)
  })
})

describe('imports that must not move', () => {
  it('reads a nested import as a block that stays put', () => {
    const src = ['def load():', '    import ujson', '    print(ujson)', ''].join('\n')
    expect(types(src)).toContain('snakie_python_import_here')
    expect(types(src)).not.toContain('snakie_python_import')
    roundTrips(src)
  })

  it('keeps the try/except ImportError idiom exactly where it was written', () => {
    const src = [
      'try:',
      '    import ujson as json',
      'except ImportError:',
      '    import json',
      ''
    ].join('\n')
    expect(regenerate(src).split('\n')[0]).toBe('try:')
    roundTrips(src)
  })

  it('reads a star import, and one with several modules', () => {
    roundTrips('from machine import *\n')
    roundTrips('import os, sys\n')
  })

  it('still hoists an ordinary module-scope import', () => {
    const src = ['import time', '', 'time.sleep(1)', ''].join('\n')
    expect(types(src)).toContain('snakie_python_import')
    roundTrips(src)
  })
})
