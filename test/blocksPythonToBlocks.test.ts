import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { logicalLines, tokenize, isSuiteHeader } from '../src/renderer/src/lib/blocks/python-tokens'

/**
 * PYTHON → BLOCKS (#1019, epic #1007, phase 5).
 * =============================================================================
 *
 * The suite is built around ONE property, because it is the only one that makes
 * a decompiler safe to point at somebody's work:
 *
 *   **convert(code) → generate gives back `code`.**
 *
 * Not "produces nice blocks" — that is a quality question and it is allowed to
 * vary. This is the correctness question, and under it a conversion that
 * understood nothing and produced a stack of raw Python blocks still passes,
 * which is exactly the guarantee #1018's escape hatches were built to provide.
 *
 * So `roundTrips` below is the test that matters, and every other test here is
 * about how MUCH of a program became real blocks rather than raw ones.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** Convert, load, generate. The whole round trip, as one function. */
function regenerate(source: string): { code: string; report: ReturnType<typeof pythonToBlocks>['report'] } {
  const { workspace, report } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return { code: generateProgram(ws).code, report }
}

/** THE property: what comes out is what went in. */
function roundTrips(source: string): void {
  expect(regenerate(source).code).toBe(source)
}

/** The workspace's top-level blocks. `BlocksWorkspace` is deliberately untyped. */
function topLevel(workspace: Record<string, unknown>): Record<string, unknown>[] {
  const blocks = (workspace.blocks as { blocks?: Record<string, unknown>[] } | undefined)?.blocks
  return blocks ?? []
}

/** The block types the conversion produced, in document order. */
function types(source: string): string[] {
  const { workspace } = pythonToBlocks(source)
  const out: string[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block.type as string)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, { block?: never; shadow?: never }>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  for (const block of topLevel(workspace)) walk(block)
  return out
}

describe('the round trip — what comes out is what went in', () => {
  it('holds for a turtle square', () => {
    roundTrips(['import turtle', '', 'for _ in range(4):', '    turtle.forward(100)', '    turtle.right(90)', ''].join('\n'))
  })

  it('holds for a blink loop', () => {
    roundTrips(
      // The generator's own order: `time` is stdlib, `machine` is the hardware
      // group, and the sections are separated by a blank line.
      [
        'import time',
        '',
        'import machine',
        '',
        'while True:',
        '    machine.lightsleep(10)',
        '    time.sleep_ms(500)',
        ''
      ].join('\n')
    )
  })

  it('holds for arithmetic, comparisons and logic', () => {
    roundTrips(
      [
        'count = 0',
        'count += 1',
        "if count > 3 and count < 10:",
        "    print('yes')",
        'elif count == 0:',
        "    print('zero')",
        'else:',
        "    print('no')",
        ''
      ].join('\n')
    )
  })

  it('holds for a function with a return', () => {
    roundTrips(['def double(n):', '    return n * 2', '', 'print(double(4))', ''].join('\n'))
  })

  it('holds for a program made entirely of things it does not understand', () => {
    // The guarantee #1018 exists to provide: understanding NOTHING is still a
    // correct conversion, because every line has a block that holds it.
    roundTrips(
      [
        'from secret_driver import Thing',
        '',
        "thing = Thing(bus=2, mode='fast')",
        'thing.calibrate(*args, **kwargs)',
        'values = [x * 2 for x in thing.scan()]',
        "print(f'{values!r:>10}')",
        ''
      ].join('\n')
    )
  })

  it('holds for a line split across brackets', () => {
    // One logical line, however many physical ones — a call split over three
    // lines is one statement, and three blocks would each generate nonsense.
    const source = ['thing.configure(\n    1,\n    2,\n)', ''].join('\n')
    expect(regenerate(source).code).toBe('thing.configure( 1, 2, )\n')
  })

  it('keeps comments, as their own block', () => {
    roundTrips(['# set the speed first', 'motor.speed = 3', ''].join('\n'))
  })

  it('re-groups imports that were not in the generator′s own order', () => {
    // The ONE way the round trip is not byte-for-byte: imports go back through
    // the import manager, which sorts and groups them. Stated as a test rather
    // than left to be discovered, because it is the difference between "your
    // file, converted" and "your file, tidied" — and the second needs saying.
    const out = regenerate('import time\nimport machine\n\ngo()\n').code
    expect(out).toBe(['import time', '', 'import machine', '', 'go()', ''].join('\n'))
  })

  it('is idempotent — converting the output changes nothing', () => {
    const source = ['import turtle', '', 'for _ in range(4):', '    turtle.forward(100)', ''].join('\n')
    const once = regenerate(source).code
    expect(regenerate(once).code).toBe(once)
  })
})

describe('what it recognises', () => {
  it('reads the turtle palette back, from the palette′s own declarations', () => {
    expect(types('import turtle\n\nturtle.forward(100)\nturtle.penup()\n')).toEqual([
      'snakie_python_import',
      'snakie_turtle_forward',
      'math_number',
      'snakie_turtle_penup'
    ])
  })

  it('reads the three import forms', () => {
    expect(types('import machine\nimport instruments as inst\nfrom machine import Pin\n')).toEqual([
      'snakie_python_import',
      'snakie_python_import_as',
      'snakie_python_from_import'
    ])
  })

  it('splits a multi-name from-import into one block each', () => {
    // The block holds one name; the generator merges them back into one line.
    expect(types('from machine import I2C, Pin\n')).toEqual([
      'snakie_python_from_import',
      'snakie_python_from_import'
    ])
    expect(regenerate('from machine import I2C, Pin\n').code).toBe('from machine import I2C, Pin\n')
  })

  it('reads `while True:` as the forever block', () => {
    expect(types('while True:\n    pass\n')).toEqual(['snakie_forever'])
  })

  it('reads `for _ in range(n):` as repeat, and a named for as for-each', () => {
    expect(types('for _ in range(4):\n    pass\n')).toContain('controls_repeat_ext')
    expect(types('for item in things:\n    pass\n')).toContain('controls_forEach')
  })

  it('reads `while not x:` as the until loop', () => {
    const { workspace } = pythonToBlocks('while not ready:\n    pass\n')
    const first = topLevel(workspace)[0] as unknown as { type: string; fields: { MODE: string } }
    expect(first.type).toBe('controls_whileUntil')
    expect(first.fields.MODE).toBe('UNTIL')
  })

  it('reads literals, names and operators', () => {
    expect(types("x = 1 + 2 * 3\n")).toEqual([
      'variables_set',
      'math_arithmetic',
      'math_number',
      'math_arithmetic',
      'math_number',
      'math_number'
    ])
    expect(types("name = 'bob'\n")).toEqual(['variables_set', 'text'])
    expect(types('ready = True\n')).toEqual(['variables_set', 'logic_boolean'])
    expect(types('thing = None\n')).toEqual(['variables_set', 'logic_null'])
    expect(types('a = b\n')).toEqual(['variables_set', 'variables_get'])
  })

  it('reads a negative number as a number, not a subtraction', () => {
    expect(types('x = -5\n')).toEqual(['variables_set', 'math_number'])
    roundTrips('x = -5\n')
  })

  it('reads `+=` as the change block', () => {
    expect(types('count += 1\n')).toEqual(['math_change', 'math_number'])
  })

  it('reads break and continue', () => {
    expect(types('while True:\n    break\n')).toEqual([
      'snakie_forever',
      'controls_flow_statements'
    ])
  })

  it('drops a `pass` that was only holding an empty suite open', () => {
    // Carrying it over would add a block meaning "nothing" that then generates
    // `pass` a second time.
    expect(types('while True:\n    pass\n')).toEqual(['snakie_forever'])
  })

  it('does not mistake a comparison for an assignment', () => {
    expect(types('if a == b:\n    pass\n')).toContain('logic_compare')
  })
})

describe('what it keeps as raw Python, and says so', () => {
  it('reports the lines it could not read', () => {
    const { report } = regenerate(
      ['import turtle', '', 'turtle.forward(100)', 'thing.calibrate(*args)', ''].join('\n')
    )
    expect(report.raw).toBe(1)
    expect(report.rawLines).toEqual([4])
    expect(report.recognised).toBe(2)
    expect(report.total).toBe(3)
  })

  it('keeps a whole expression raw rather than half of it', () => {
    // Half an expression is worse than none: the learner would see blocks that
    // do not add up to the line they wrote.
    expect(types('x = [v for v in things]\n')).toEqual(['variables_set', 'snakie_python_value'])
  })

  it('keeps a string with an escape in it raw', () => {
    // A `text` block holds plain text and the generator quotes it again, so a
    // literal meaning something other than its characters must not become one.
    roundTrips("print('she said \\'hi\\'')\n")
  })

  it('keeps an f-string raw', () => {
    roundTrips("print(f'{x}')\n")
  })

  it('keeps a call with keyword arguments raw', () => {
    roundTrips('robot.drive(left=1, right=2)\n')
  })

  it('counts a fully unreadable program honestly', () => {
    const { report } = regenerate('a[0] = 1\nb.c.d()\n')
    expect(report.recognised).toBe(0)
    expect(report.raw).toBe(2)
  })
})

describe('the lexer', () => {
  it('joins a line split inside brackets', () => {
    expect(logicalLines('f(\n  1,\n  2\n)\n').map((l) => l.text)).toEqual(['f( 1, 2 )'])
  })

  it('joins a line continued with a backslash', () => {
    expect(logicalLines('x = 1 + \\\n    2\n').map((l) => l.text)).toEqual(['x = 1 + 2'])
  })

  it('records the indent and the starting line number', () => {
    const lines = logicalLines('while True:\n    go()\n')
    expect(lines.map((l) => [l.indent, l.line])).toEqual([
      [0, 1],
      [4, 2]
    ])
  })

  it('drops blank lines without treating them as dedents', () => {
    expect(logicalLines('a()\n\n\nb()\n').map((l) => l.text)).toEqual(['a()', 'b()'])
  })

  it('keeps a comment line', () => {
    expect(logicalLines('# hello\ngo()\n').map((l) => l.text)).toEqual(['# hello', 'go()'])
  })

  it('does not see a colon inside a string or a slice as a suite header', () => {
    expect(isSuiteHeader('while True:')).toBe(true)
    expect(isSuiteHeader("print('a: b')")).toBe(false)
    expect(isSuiteHeader('x = d[1:4]')).toBe(false)
    expect(isSuiteHeader("d = {'a': 1}")).toBe(false)
  })

  it('refuses an unterminated string rather than guessing', () => {
    expect(tokenize("print('hello)")).toBeNull()
  })

  it('lexes numbers, names, keywords and operators', () => {
    expect(tokenize('x <= 0x1F')?.map((t) => [t.kind, t.text])).toEqual([
      ['name', 'x'],
      ['op', '<='],
      ['number', '0x1F']
    ])
    expect(tokenize('not ready')?.map((t) => t.kind)).toEqual(['keyword', 'name'])
  })

  it('drops a trailing comment from a line′s tokens', () => {
    expect(tokenize('go()  # later')?.map((t) => t.text)).toEqual(['go', '(', ')'])
  })
})
