import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * `try` / `except` / `finally`, `raise` AND `with` (W7, #1094, epic #1086).
 * =============================================================================
 *
 * 1,271 raw lines of `try` across 40 projects, 322 of `raise` across 26, 198 of
 * `with` across 27. All three are line-shaped headers, which is why none of them
 * is an argument for a parser.
 *
 * `try` IS AN ARM CHAIN, like `if`/`elif`/`else`, and it reuses that machinery
 * for the reason that machinery was written: an arm is a SIBLING line, not a
 * child, and the header that claims one must mark it consumed or it is converted
 * twice or not at all. The `else:` of a `try` is the same token as a loop's, and
 * #1068 is the record of what happens when nobody says who claimed it.
 *
 * AND THE IDIOM THAT MUST NOT BREAK. `try: import ujson as json / except
 * ImportError: import json` exists precisely because one of the two may be
 * missing, and the reader refuses to hoist a nested import for that reason
 * (#1071). Recognising `try` must not change it.
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

describe('try, with its arms', () => {
  it('reads one except arm', () => {
    const src = ['try:', '    print(1)', 'except OSError:', '    print(2)', ''].join('\n')
    expect(types(src)).toContain('snakie_try')
    expect(one(src, 'snakie_try')!.fields).toEqual({ EXCEPT0: 'OSError' })
    roundTrips(src)
  })

  it('keeps the `as` binding, which is 34 of 73 projects on its own', () => {
    const src = ['try:', '    print(1)', 'except OSError as e:', '    print(e)', ''].join('\n')
    expect(one(src, 'snakie_try')!.fields).toEqual({ EXCEPT0: 'OSError as e' })
    roundTrips(src)
  })

  it('keeps a bare `except:`', () => {
    const src = ['try:', '    print(1)', 'except:', '    print(2)', ''].join('\n')
    expect(one(src, 'snakie_try')!.fields).toEqual({ EXCEPT0: '' })
    expect(one(src, 'snakie_try')!.extraState).toMatchObject({ excepts: [''] })
    roundTrips(src)
  })

  it('keeps a tuple of exception types', () => {
    const src = ['try:', '    print(1)', 'except (ValueError, TypeError) as e:', '    print(e)', ''].join('\n')
    expect(one(src, 'snakie_try')!.fields).toEqual({ EXCEPT0: '(ValueError, TypeError) as e' })
    roundTrips(src)
  })

  it('reads several except arms, an else and a finally', () => {
    const src = [
      'try:',
      '    print(1)',
      'except OSError:',
      '    print(2)',
      'except ValueError:',
      '    print(3)',
      'else:',
      '    print(4)',
      'finally:',
      '    print(5)',
      ''
    ].join('\n')
    expect(one(src, 'snakie_try')!.extraState).toEqual({
      excepts: ['OSError', 'ValueError'],
      hasElse: true,
      hasFinally: true
    })
    roundTrips(src)
  })

  it('reads a try/finally with no except at all', () => {
    const src = ['try:', '    print(1)', 'finally:', '    print(2)', ''].join('\n')
    expect(one(src, 'snakie_try')!.extraState).toMatchObject({ excepts: [], hasFinally: true })
    roundTrips(src)
  })

  it('counts every arm line, so the report stays honest', () => {
    const src = [
      'try:',
      '    print(1)',
      'except OSError:',
      '    print(2)',
      'finally:',
      '    print(3)',
      ''
    ].join('\n')
    const { report } = pythonToBlocks(src)
    expect(report.total).toBe(6)
    expect(report.raw).toBe(0)
  })

  it('does not steal a loop’s `else`', () => {
    // The `else:` of a `while` is the same token, and whichever header claims it
    // must mark it consumed. The `try` here has already ended.
    const src = [
      'try:',
      '    print(1)',
      'except OSError:',
      '    print(2)',
      'while x:',
      '    print(3)',
      'else:',
      '    print(4)',
      ''
    ].join('\n')
    expect(one(src, 'snakie_try')!.extraState).toMatchObject({ hasElse: false })
    roundTrips(src)
  })
})

describe('the idiom that must not break', () => {
  it('keeps a nested import exactly where it was written', () => {
    // It exists BECAUSE one of the two may be missing, and hoisting both turns a
    // file that runs into one that raises on line 1 — while the arms it came
    // from become `pass` (#1071).
    const src = [
      'try:',
      '    import ujson as json',
      'except ImportError:',
      '    import json',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_try')
    expect(types(src)).not.toContain('snakie_python_import_as')
    roundTrips(src)
  })
})

describe('with', () => {
  it('reads one context manager and its binding', () => {
    const src = ['with open(path) as handle:', '    print(handle)', ''].join('\n')
    expect(one(src, 'snakie_with')!.fields).toEqual({ ITEMS: 'open(path) as handle' })
    roundTrips(src)
  })

  it('reads several on one line', () => {
    const src = ['with open(a) as f, open(b) as g:', '    print(f)', ''].join('\n')
    expect(one(src, 'snakie_with')!.fields).toEqual({ ITEMS: 'open(a) as f, open(b) as g' })
    roundTrips(src)
  })

  it('reads one with no binding at all', () => {
    const src = ['with lock:', '    print(1)', ''].join('\n')
    expect(one(src, 'snakie_with')!.fields).toEqual({ ITEMS: 'lock' })
    roundTrips(src)
  })

  it('nests inside a try, and holds real blocks', () => {
    const src = [
      'try:',
      '    with open(path) as handle:',
      '        print(handle)',
      'except OSError:',
      '    print(1)',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_with')
    expect(types(src)).toContain('text_print')
    roundTrips(src)
  })
})

describe('raise', () => {
  it('reads a bare re-raise', () => {
    const src = ['try:', '    print(1)', 'except OSError:', '    raise', ''].join('\n')
    expect(types(src)).toContain('snakie_raise')
    roundTrips(src)
  })

  it('reads one with an exception', () => {
    expect(types('raise RuntimeError("no wifi")\n')).toContain('snakie_raise')
    roundTrips('raise RuntimeError("no wifi")\n')
  })

  it('reads a bare exception class', () => {
    roundTrips('raise StopIteration\n')
  })

  it('keeps `raise X from Y` verbatim in its socket', () => {
    roundTrips('raise ValueError from err\n')
  })
})
