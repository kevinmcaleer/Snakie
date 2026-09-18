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

  it('reads a call to the program\u2019s own function as a CALLER block', () => {
    // THE BUG THIS FIXES. The `def` became a proper function block and the call
    // under it came back as a raw Python block — so the Functions drawer gave a
    // learner a definition they could not call, in a program that plainly did.
    const src = 'def hello():\n    print(1)\n\nhello()\n'
    expect(types(src)).toContain('procedures_callnoreturn')
    expect(types(src)).not.toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('and carries the arguments across', () => {
    const src = 'def wiggle(a, b):\n    print(a)\n\nwiggle(1, max(2, 3))\n'
    expect(types(src)).toContain('procedures_callnoreturn')
    roundTrips(src)
  })

  it('a call that RETURNS is the value caller', () => {
    const src = 'def double(n):\n    return n * 2\n\nprint(double(3))\n'
    expect(types(src)).toContain('procedures_callreturn')
    roundTrips(src)
  })

  describe('and stays raw where no caller block would be right', () => {
    // Each of these would load with a socket empty or no matching definition
    // block at all, and regenerate as a program the learner did not write.
    const staysRaw = (src: string): void => {
      expect(types(src)).toContain('snakie_python_statement')
      roundTrips(src)
    }
    it('the wrong number of arguments', () =>
      staysRaw('def wiggle(a, b):\n    print(a)\n\nwiggle(1)\n'))
    it('a statement call to a function that returns', () =>
      staysRaw('def double(n):\n    return n * 2\n\ndouble(3)\n'))
    it('a name this program does not define', () => staysRaw('frobnicate()\n'))
    it('a def whose parameters Blockly cannot hold', () =>
      staysRaw('def load(path, flip=None):\n    print(path)\n\nload(1, 2)\n'))
  })

  it('reads a two-argument round back as a block, not raw Python', () => {
    // `round(x, 1)` is how every sensor reading is printed, and `math_round`
    // has one socket and a nearest/up/down dropdown — so it used to be the one
    // thing in an otherwise fully converted function that stayed grey.
    const src = 'def d():\n    return round(5 / 10, 1)\n'
    const { report } = pythonToBlocks(src)
    expect(report.raw).toBe(0)
    expect(types(src)).toContain('snakie_math_round_places')
    roundTrips(src)
  })

  it('and a one-argument round is still the nearest-whole block', () => {
    expect(types('print(round(1.23))\n')).toContain('math_round')
    roundTrips('print(round(1.23))\n')
  })

  it('holds for a measured pulse, ticks and all', () => {
    // `ticks_diff(end, start)` reads back with its sockets swapped, so the round
    // trip is the test that the swap happens in both directions and not one.
    const src = [
      'import time',
      '',
      'start = time.ticks_us()',
      'print(time.ticks_diff(time.ticks_us(), start))',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_ticks_diff')
    expect(types(src)).toContain('snakie_ticks_us')
    roundTrips(src)
  })

  it('holds for a microsecond wait, which reads back as its own block', () => {
    // `time.sleep_us(10)` is the HC-SR04 trigger pulse and a dozen other
    // datasheet waits. Without a rule for it, it came back as a raw Python
    // block: still correct, and not a block a learner could author another of.
    const src = ['import time', '', 'time.sleep_us(10)', ''].join('\n')
    expect(types(src)).toContain('snakie_wait_us')
    roundTrips(src)
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
    // `assert` is one of the constructs epic #1086 declines on purpose — 890
    // lines in the corpus and almost all of them pytest — so it is a line that
    // stays raw however far the reader comes.
    const { report } = regenerate(
      ['import turtle', '', 'turtle.forward(100)', 'assert thing.ready', ''].join('\n')
    )
    expect(report.raw).toBe(1)
    expect(report.rawLines).toEqual([4])
    expect(report.recognised).toBe(2)
    expect(report.total).toBe(3)
  })

  it('does not lose a line to one argument it cannot read (#1088)', () => {
    // §4.2 of the delivery plan, as a test: `rawValue()` does not increment
    // `report.raw`, so a real block with a grey value in one socket is a
    // RECOGNISED line. It is what makes W1 cheap — fix the statement and the
    // expression stops mattering — and it is why f-strings appear in 44 projects
    // and account for five raw lines between them.
    const { report } = regenerate('thing.calibrate(*args)\n')
    expect(report.raw).toBe(0)
    expect(report.recognised).toBe(1)
    expect(report.rawSockets).toBe(1)
    expect(types('thing.calibrate(*args)\n')).toContain('snakie_python_call')
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
    // Both deliberately out of scope for epic #1086 — see §3.5 — so this test is
    // about the counting rather than about these two constructs.
    const { report } = regenerate('assert ok\nassert speed < 100\n')
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

/**
 * WHAT A REAL MODULE DOES TO IT (#1062, #1063).
 * =============================================================================
 *
 * Every test above was written against a program the converter was designed
 * for. #1062 pointed it at a 114-line module off a robot — classes, `try`,
 * default arguments, early returns, a thirty-line comment header — and the
 * round trip came back as 36 lines. The property at the top of this file was
 * not merely failing; it was failing in the direction that costs somebody their
 * work, because #1034 reconverts on every typing pause.
 *
 * These are the cases that module is made of.
 */
describe('a suite we cannot read keeps its body (#1063)', () => {
  it('a class keeps its methods', () => {
    // THE BUG, at its smallest: this came back as `class Frame:` and nothing
    // else. Five lines out of eight, gone, and the report called it a success.
    roundTrips(
      [
        'class Frame:',
        '    def __init__(self, sprite):',
        '        self.sprite = sprite',
        // No blank line between the methods: `logicalLines` drops blank lines
        // for the whole converter, so they are not part of this property.
        '    def draw(self, matrix):',
        '        print(self.sprite)',
        ''
      ].join('\n')
    )
  })

  it('try/except keeps what it guards', () => {
    roundTrips(
      [
        'try:',
        '    risky()',
        'except OSError as e:',
        '    print(e)',
        ''
      ].join('\n')
    )
  })

  it('with keeps its block', () => {
    roundTrips(["with open(path, 'rb') as f:", '    blob = f.read()', ''].join('\n'))
  })

  it('nests them', () => {
    roundTrips(
      [
        'class Sprite:',
        '    def load(self, path):',
        "        with open(path, 'rb') as f:",
        '            self.blob = f.read()',
        ''
      ].join('\n')
    )
  })
})

describe('names survive the trip (#1063)', () => {
  it('a dunder is not renamed', () => {
    // `sanitise` strips leading and trailing underscores, which is right for a
    // label somebody typed and destructive for a name that was already Python:
    // `__init__` came back as `init`.
    const code = regenerate(['class A:', '    def __init__(self):', '        pass', ''].join('\n')).code
    expect(code).toContain('def __init__(self):')
    expect(code).not.toContain('def init(')
  })

  it('a private function keeps its underscore', () => {
    roundTrips(['def _pack_rows(rows):', '    return rows', ''].join('\n'))
  })

  it('a method stays inside its class rather than becoming a top-level def', () => {
    // Blockly models a `def` as a hat, and a hat cannot nest — so a nested one
    // was collected as a ROOT and generated un-indented, detached from the
    // object it belongs to. Twelve of them, on the module in #1062.
    const { workspace } = pythonToBlocks(
      ['class A:', '    def go(self):', '        pass', ''].join('\n')
    )
    expect(topLevel(workspace as never)).toHaveLength(1)
  })
})

describe('signatures are not rewritten (#1063)', () => {
  it('keeps default arguments', () => {
    // `procedures_def`'s parameters are bare names, so a default has nowhere to
    // live on the block — and they used to be FILTERED OUT, turning
    // `def load(path, flip_x=None)` into `def load(path)` while every call to
    // it still passed two arguments.
    roundTrips(['def load(path, flip_x=None, flip_y=None):', '    return path', ''].join('\n'))
  })

  it('keeps *args and **kwargs', () => {
    roundTrips(['def go(*args, **kwargs):', '    return args', ''].join('\n'))
  })

  it('still models a plain signature as a real function block', () => {
    // The escape hatch is for what we cannot hold, not a excuse to stop trying.
    expect(types(['def double(n):', '    return n * 2', ''].join('\n'))).toContain(
      'procedures_defreturn'
    )
  })
})

describe('an early return is not dead code (#1063)', () => {
  it('generates the return it was given', () => {
    // It became `procedures_ifreturn`, whose code is `if <COND>: return <VALUE>`
    // — and with nothing in COND the generator wrote `if False:`. Every early
    // return in the program became unreachable, silently.
    const code = regenerate(
      ['def f(x):', '    if x:', '        return 1', '    return 2', ''].join('\n')
    ).code
    expect(code).not.toContain('if False:')
    expect(code).toContain('return 1')
  })

  it('round-trips a guard clause', () => {
    roundTrips(['def f(x):', '    if x:', '        return 1', '    return 2', ''].join('\n'))
  })
})

describe('a run of comments is one block (#1062)', () => {
  it('folds consecutive comment lines together', () => {
    const src = ['# one', '# two', '# three', 'print(1)', ''].join('\n')
    // `types` walks the value children too, hence the number in the print.
    expect(types(src)).toEqual(['snakie_python_comment', 'text_print', 'math_number'])
    roundTrips(src)
  })

  it('keeps the exact spacing, because that is a comment’s content', () => {
    // The header in #1062 carries an ASCII table of a binary format. Strip the
    // `#` and a space for display and `#foo` comes back as `# foo`; keep the
    // line verbatim and the alignment survives.
    roundTrips(
      ['#     offset size  field', '#     0      4     magic', '#     4      1     version', ''].join('\n')
    )
  })

  it('does not join comments across the code between them', () => {
    expect(types(['# a', 'print(1)', '# b', ''].join('\n'))).toEqual([
      'snakie_python_comment',
      'text_print',
      'math_number',
      'snakie_python_comment'
    ])
  })

  it('a lone comment is still one comment block', () => {
    expect(types(['# just the one', ''].join('\n'))).toEqual(['snakie_python_comment'])
  })
})

describe('the roots do not overlap (#1062)', () => {
  /** Every root as `[top, bottom]`, using the converter's own estimate. */
  const spans = (source: string): [number, number][] => {
    const { workspace } = pythonToBlocks(source)
    const roots = topLevel(workspace as never) as unknown as { y: number }[]
    return roots.map((r, i) => [r.y, i + 1 < roots.length ? roots[i + 1].y : r.y] as [number, number])
  }

  it('puts a tall root clear of the next one', () => {
    // A fixed 240px gap was fine for a four-block program and wrong for a real
    // one: a class with eight methods is well over a thousand pixels tall, so
    // the next four roots were drawn on top of it.
    const tall = [
      'def big():',
      ...Array.from({ length: 30 }, (_, i) => `    print(${i})`),
      '',
      'def after():',
      '    print("me")',
      ''
    ].join('\n')
    const [first, second] = spans(tall)
    // The first root's own height must fit in the space before the second.
    expect(second[0] - first[0]).toBeGreaterThan(30 * 40)
  })

  it('stacks every root downwards, in order, never back up', () => {
    const src = [
      'def a():',
      '    print(1)',
      '',
      'def b():',
      '    print(2)',
      '',
      'def c():',
      '    print(3)',
      '',
      'print(4)',
      ''
    ].join('\n')
    const ys = spans(src).map(([top]) => top)
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1])
  })

  it('counts a folded comment block by its lines, not as one row', () => {
    // The case a per-block estimate gets worst: one block, thirty rows tall.
    const many = ['def f():', '    print(1)', '', ...Array.from({ length: 30 }, (_, i) => `# line ${i}`), ''].join('\n')
    const ys = spans(many).map(([top]) => top)
    expect(ys[1] - ys[0]).toBeGreaterThan(0)
  })
})

/**
 * A BLOCK WITH NO NEXT CONNECTION CANNOT HOLD A CHAIN (#1068).
 * ---------------------------------------------------------------------------
 *
 * `forever` and `break`/`continue` are defined with no next connection, on the
 * true reasoning that nothing runs after them. The converter used to chain onto
 * them anyway, and `Blockly.serialization.workspaces.load` THROWS on that — a
 * throw that reached the canvas, cleared the workspace and blocked writes, so a
 * `while True:` with a `break` and a line of cleanup under it opened as an empty
 * canvas beside a perfectly good program.
 *
 * `regenerate` below already loads into a real workspace, so every one of these
 * is a load test as much as a round-trip one.
 */
describe('a terminal block that is not last becomes a raw one (#1068)', () => {
  it('survives the loop every hardware program is: forever, break, cleanup', () => {
    roundTrips(
      [
        'import time',
        '',
        'while True:',
        '    if button.value():',
        '        break',
        '    time.sleep(0.1)',
        'led.off()',
        ''
      ].join('\n')
    )
  })

  it('keeps a line after a break inside the loop', () => {
    roundTrips(['while True:', '    break', '    print(1)', ''].join('\n'))
  })

  it('keeps a line after a continue', () => {
    roundTrips(['for x in items:', '    continue', '    print(1)', ''].join('\n'))
  })

  it('handles two forever loops in one file', () => {
    roundTrips(['while True:', '    print(1)', 'while True:', '    print(2)', ''].join('\n'))
  })

  it('still makes a real forever block when it IS last', () => {
    expect(types('while True:\n    print(1)\n')).toContain('snakie_forever')
    roundTrips('while True:\n    print(1)\n')
  })

  it('counts the demoted block as raw, not recognised', () => {
    const { report } = regenerate(['while True:', '    print(1)', 'led.off()', ''].join('\n'))
    // The demoted `while True:` on line 1, and only that: `led.off()` is a
    // method call on an object, which W1 (#1088) reads as a real call block.
    expect(report.raw).toBe(1)
    expect(report.rawLines).toEqual([1])
  })

  it('reports raw lines in ascending order', () => {
    const { report } = regenerate(
      ['robot.go()', 'while True:', '    print(1)', 'led.off()', ''].join('\n')
    )
    expect(report.rawLines).toEqual([...report.rawLines].sort((a, b) => a - b))
  })
})

/**
 * THE DRIFT GUARD for the set above. `python-to-blocks.ts` is Blockly-free by
 * design, so it carries its own list of which types are terminal — which is only
 * safe if a test checks the list against the real block definitions. Both
 * directions: a type wrongly IN the set loses a real block for nothing, and one
 * wrongly OUT of it is the crash this describe block exists for.
 */
describe('the terminal-type list matches the real blocks (#1068)', () => {
  /** Every type the converter can emit, including the palette-registered rules. */
  const EMITTED = [
    'controls_flow_statements',
    'controls_forEach',
    'controls_if',
    'controls_repeat_ext',
    'controls_whileUntil',
    'math_change',
    'snakie_forever',
    'snakie_python_comment',
    'snakie_python_from_import',
    'snakie_python_import',
    'snakie_python_import_as',
    'snakie_python_statement',
    'snakie_python_suite',
    'snakie_wait_ms',
    'snakie_wait_seconds',
    'snakie_wait_us',
    'text_print',
    'variables_set'
  ]

  it('is exactly the set of emitted statement types with no next connection', () => {
    const ws = new Blockly.Workspace()
    const terminal = EMITTED.filter((type) => !ws.newBlock(type).nextConnection)
    expect(terminal.sort()).toEqual(['controls_flow_statements', 'snakie_forever'])
  })
})

/**
 * HARDWARE COMES BACK (#1058).
 * =============================================================================
 *
 * Only `turtle.ts` declared `read`, so a hardware program converted
 * asymmetrically: blocks → Python perfect, Python → blocks dropping to the
 * #1018 escape hatch on exactly the lines that matter. `led_15.set(True)` was a
 * raw block, and the learner could read their program but not build it.
 *
 * A hardware block does not write one line. It writes a constructor hoisted
 * into the setup section AND a call on it, with the pin in the object's NAME —
 * so reading one back means reading both lines and then NOT emitting the
 * constructor a second time.
 */
describe('a call on a hoisted object (#1058)', () => {
  it('reads an LED back as an LED block', () => {
    const src = ['from machine import Pin', '', 'from snakie import Led', '', 'led_15 = Led(pin=Pin(15, Pin.OUT))', '', 'led_15.set(True)', ''].join('\n')
    expect(types(src)).toContain('snakie_led_set')
    roundTrips(src)
  })

  it('takes the pin out of the object name and the state out of the argument', () => {
    const { workspace } = pythonToBlocks(
      ['from snakie import Led, Pin', '', 'led_15 = Led(pin=Pin(15, Pin.OUT))', 'led_15.set(False)', ''].join('\n')
    )
    const json = JSON.stringify(topLevel(workspace as never))
    expect(json).toContain('"PIN":"15"')
    expect(json).toContain('"STATE":"OFF"')
  })

  it('swallows the constructor rather than generating it twice', () => {
    // The block carries the pin, so the generator writes the setup line back
    // out from the block. Keeping the original as well would double it.
    const src = ['from snakie import Led, Pin', '', 'led_15 = Led(pin=Pin(15, Pin.OUT))', '', 'led_15.set(True)', ''].join('\n')
    expect(regenerate(src).code.match(/Led\(/g)).toHaveLength(1)
    expect(types(src)).not.toContain('variables_set')
  })

  it('reads a pull resistor out of the CONSTRUCTOR, where it lives', () => {
    // `pin_14.value()` says nothing about the resistor; getting it wrong would
    // rewrite the learner's wiring.
    for (const pull of ['Pin(14, Pin.IN, Pin.PULL_UP)', 'Pin(14, Pin.IN, Pin.PULL_DOWN)', 'Pin(14, Pin.IN)']) {
      roundTrips(['from machine import Pin', '', `pin_14 = ${pull}`, '', 'print(pin_14.value())', ''].join('\n'))
    }
  })

  it('tells a pin WRITE from a pin READ, which are both `.value`', () => {
    // They share a receiver and a function name and differ only in shape, so
    // the rule table has to key on more than `module.fn`.
    const src = ['from machine import Pin', '', 'pin_15 = Pin(15, Pin.OUT)', '', 'pin_15.value(1)', 'pin_15.toggle()', ''].join('\n')
    expect(types(src)).toContain('snakie_pin_write')
    expect(types(src)).toContain('snakie_led_toggle')
    roundTrips(src)
  })

  it('lets one object back several blocks', () => {
    // `buzzer_16` is the receiver of both `tone` and `stop`.
    const src = [
      'from machine import PWM, Pin',
      '',
      'from snakie import Buzzer, Servo',
      '',
      'servo_0 = Servo(PWM(Pin(0)), pin=0)',
      'buzzer_16 = Buzzer(PWM(Pin(16)))',
      '',
      'servo_0.angle(90)',
      'buzzer_16.tone(440, 200)',
      'buzzer_16.stop()',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_buzzer_tone')
    expect(types(src)).toContain('snakie_buzzer_stop')
    expect(types(src)).toContain('snakie_servo_angle')
    roundTrips(src)
  })

  it('round-trips a blink loop, blocks and all', () => {
    roundTrips(
      [
        'from time import sleep',
        '',
        'from machine import Pin',
        '',
        'from snakie import Led',
        '',
        'led_15 = Led(pin=Pin(15, Pin.OUT))',
        '',
        'while True:',
        '    led_15.set(True)',
        '    sleep(1)',
        '    led_15.set(False)',
        '    sleep(1)',
        ''
      ].join('\n')
    )
  })
})

describe('a hoisted object is all-or-nothing (#1058)', () => {
  it('one unreadable use leaves the whole object alone', () => {
    // THE BUG THIS RULE EXISTS FOR: keeping the constructor because one call
    // was unreadable, while still turning the OTHERS into blocks, gives two
    // objects on one pin — the learner's `led_15` and the block's own hoisted
    // copy, renamed `led_15_` to dodge the collision. Two `Led`s driving one
    // pin is a real bug, not an untidiness.
    const src = [
      'from snakie import Led, Pin',
      '',
      'led_15 = Led(pin=Pin(15, Pin.OUT))',
      'led_15.set(True)',
      'led_15.frobnicate()',
      ''
    ].join('\n')
    expect(types(src)).not.toContain('snakie_led_set')
    expect(regenerate(src).code).not.toContain('led_15_')
    roundTrips(src)
  })

  it('a constructor that is not ours is not touched', () => {
    // `Led(pin=Pin(15))` is not what this block writes. Somebody wrote their
    // own, and reading it back as a block would rewrite their line.
    const src = ['from snakie import Led, Pin', '', 'led_15 = Led(pin=Pin(15))', 'led_15.set(True)', ''].join('\n')
    expect(types(src)).not.toContain('snakie_led_set')
    roundTrips(src)
  })

  it('a variable that merely looks like one is left alone', () => {
    roundTrips(['led_15 = 3', 'print(led_15)', ''].join('\n'))
  })
})

/**
 * AN ARM NOBODY CLAIMED IS STILL AN ARM (#1068).
 * ---------------------------------------------------------------------------
 *
 * `statements` used to skip any line starting with `elif`/`else` on the
 * reasoning that `ifChain` must already have consumed it. `ifChain` stops
 * scanning at the first sibling that is neither — which a comment at column zero
 * between the arms is, and which `while … else:` always is — so the arm was
 * skipped without ever being taken, and its whole body went with it. Silently,
 * and counted as a success, because the counting lives in `statement()` and
 * `statement()` was never reached.
 */
describe('an else nobody consumed is kept (#1068)', () => {
  it('keeps an else separated from its if by a comment', () => {
    roundTrips(
      ['x = 1', 'if x:', '    print(1)', '# otherwise', 'else:', '    print(2)', ''].join('\n')
    )
  })

  it('keeps an elif separated from its if by a comment', () => {
    roundTrips(['if x:', '    print(1)', '# hmm', 'elif y:', '    print(2)', ''].join('\n'))
  })

  it("keeps a while loop's else, which no if ever claims", () => {
    roundTrips(['while x:', '    print(1)', 'else:', '    print(2)', ''].join('\n'))
  })

  it("keeps a for loop's else", () => {
    roundTrips(['for i in items:', '    print(i)', 'else:', '    print(2)', ''].join('\n'))
  })

  it('counts the lines it kept instead of reporting a clean run', () => {
    const { report } = regenerate(
      ['if x:', '    print(1)', '# otherwise', 'else:', '    print(2)', ''].join('\n')
    )
    // Five lines in, five lines accounted for — the `else:` among them.
    expect(report.total).toBe(5)
  })

  it('still folds a plain if/elif/else into one block', () => {
    expect(types(['if x:', '    print(1)', 'elif y:', '    print(2)', 'else:', '    print(3)', ''].join('\n'))).toContain(
      'controls_if'
    )
  })
})

/**
 * A COMMENT IS PART OF THE LINE IT IS ON (#1068).
 *
 * `tokenize` stops at a trailing `#` and hands the code back alone, so every
 * recogniser matched the line and dropped the rest of it. No block holds a
 * statement and a comment about it, so a line carrying one stays raw.
 */
describe('a trailing comment survives (#1068)', () => {
  it('on an assignment', () => {
    roundTrips('x = 5  # how many times\n')
  })

  it('on a call that would otherwise be a block', () => {
    roundTrips(['import time', '', 'time.sleep(1)  # pause', ''].join('\n'))
  })

  it('on a print', () => {
    roundTrips("print('hi')  # say hello\n")
  })

  it('on a suite header, whose colon goes before the comment and not inside it', () => {
    roundTrips(['if x:  # check', '    print(1)', ''].join('\n'))
  })

  it('adds the colon before the comment when the header lacks one', () => {
    // The raw suite block supplies the colon a learner did not type; with a
    // comment on the line it has to go before it, or it does nothing at all.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'snakie_python_suite',
              fields: { CODE: 'if x  # check' },
              inputs: { DO: { block: { type: 'text_print', inputs: {} } } }
            }
          ]
        }
      } as never,
      ws
    )
    expect(generateProgram(ws).code.split('\n')[0]).toBe('if x:  # check')
  })

  it('does not mistake a hash inside a string for a comment', () => {
    roundTrips("print('# not a comment')\n")
    expect(types("print('# not a comment')\n")).toContain('text_print')
  })

  it('counts a commented line as raw, not recognised', () => {
    expect(regenerate('x = 5  # how many\n').report.raw).toBe(1)
  })
})

/**
 * TWO WAYS THE CONVERTER USED TO WRITE CODE THAT WOULD NOT COMPILE (#1068).
 */
describe('the converter never produces a syntax error (#1068)', () => {
  it('does not read == as an assignment', () => {
    // The guard sliced the text up to the first `=`, which stops BEFORE the
    // character it is looking for, so this came back as `x = = 5`.
    roundTrips('x == 5\n')
    expect(types('x == 5\n')).not.toContain('variables_set')
  })

  it('still reads a real assignment', () => {
    expect(types('x = 5\n')).toContain('variables_set')
  })

  it('leaves the other comparisons alone', () => {
    roundTrips('x != 5\n')
    roundTrips('x <= 5\n')
  })

  it('does not let a comment inside brackets swallow the rest of the call', () => {
    // The line break after the comment is folded into a space, so a comment left
    // in place took the `2)` into itself and left an unclosed bracket behind.
    const out = regenerate(['print(', '    1,  # first', '    2)', ''].join('\n')).code
    expect(out).toContain('2)')
    expect(out.trimEnd().endsWith(')')).toBe(false) // the comment rides at the end
    expect(out).toContain('# first')
  })
})

/**
 * A CHAINED COMPARISON IS NOT A TREE OF THEM (#1071, finding 1).
 * =============================================================================
 *
 * The one finding in #1071 that was a WRONG ANSWER rather than a refusal.
 * `0 <= n <= 59` means `0 <= n and n <= 59` in Python; folded left it became
 * `(0 <= n) <= 59`, which compares a bool against a number. `(0 <= 70) <= 59`
 * is `True <= 59` — `True` — so a guard meant to reject 70 accepted it, and the
 * conversion reported a clean run while doing it.
 *
 * The fix is a refusal, not a translation: the line stays raw and regenerates
 * verbatim. These tests pin both halves — that the chain is refused, and that
 * everything shaped LIKE a chain but isn't one still becomes real blocks.
 */
describe('a chained comparison is refused rather than flattened (#1071)', () => {
  it('keeps `0 <= n <= 59` as written', () => {
    roundTrips('if not 0 <= n <= 59:\n    print(1)\n')
  })

  it('builds no comparison block for it at all', () => {
    // The wrong answer was a `logic_compare` whose A was another one. Neither
    // may appear: one of them IS the bug.
    expect(types('x = 0 <= n <= 59\n')).not.toContain('logic_compare')
  })

  it('still builds a real block for a single comparison', () => {
    expect(types('if n < 59:\n    print(1)\n')).toContain('logic_compare')
    roundTrips('if n < 59:\n    print(1)\n')
  })

  it('leaves `and` of two comparisons alone — that is not a chain', () => {
    const t = types('if 0 <= n and n <= 59:\n    print(1)\n')
    expect(t).toContain('logic_operation')
    expect(t.filter((x) => x === 'logic_compare')).toHaveLength(2)
    roundTrips('if 0 <= n and n <= 59:\n    print(1)\n')
  })

  it('honours brackets, because then the nesting is what the source says', () => {
    // `(a < b) < c` really does compare a bool: only ONE operator is at this
    // level, so the nested compare is a faithful reading, not a flattened chain.
    const t = types('x = (a < b) < c\n')
    expect(t.filter((y) => y === 'logic_compare')).toHaveLength(2)
    roundTrips('x = (a < b) < c\n')
  })

  it('refuses a longer chain too', () => {
    roundTrips('if a < b < c < d:\n    print(1)\n')
    expect(types('x = a < b < c < d\n')).not.toContain('logic_compare')
  })
})

/**
 * A TYPED SOCKET IS NEVER FILLED WITH THE WRONG THING (#1071, findings 2–3).
 * =============================================================================
 *
 * Six of the `.py` files this repository ships used to come back **unloadable**.
 * Tracing them together — which is what #1071 asked for before a fourth
 * one-operator-at-a-time patch — showed one cause in four costumes: a block of
 * one type put into a socket that accepts another, which makes
 * `Blockly.serialization.workspaces.load` throw and abandon the WHOLE
 * workspace. One `+=` on a string cost the learner every block in the file.
 *
 * Each case below is taken from a real shipped file. The rule is the same in
 * all of them: if it cannot fit, the expression stays raw and regenerates
 * verbatim — an uglier block, and the program intact.
 */
describe('a block never lands in a socket that would reject it (#1071)', () => {
  /** Would Blockly accept the workspace this source converts to? */
  function loads(source: string): boolean {
    const { workspace } = pythonToBlocks(source)
    try {
      Blockly.serialization.workspaces.load(workspace as never, new Blockly.Workspace())
      return true
    } catch {
      return false
    }
  }

  it('`s += "x"` — text into math_change.DELTA (micropython/modules/buzzer.py)', () => {
    expect(loads('s = \'\'\ns += "x"\n')).toBe(true)
    // The `+=` line is raw, so its double quotes survive verbatim; the
    // assignment above it is a real block and renders in house style.
    roundTrips('s = \'\'\ns += "x"\n')
    expect(types('s += "x"\n')).not.toContain('math_change')
  })

  it('`x = a + "b"` — text into math_arithmetic.B (micropython/instruments.py)', () => {
    expect(loads('x = a + "b"\n')).toBe(true)
    roundTrips('x = a + "b"\n')
  })

  it('`"%.1f" % v` — text into math_modulo.DIVIDEND (grove_ultrasonic_demo.py)', () => {
    expect(loads('x = "%.1f" % v\n')).toBe(true)
    roundTrips('x = "%.1f" % v\n')
  })

  it('`a and "b"` — text into logic_operation.B (examples/ultrasonic_test.py)', () => {
    expect(loads('x = a and "b"\n')).toBe(true)
    roundTrips('x = a and "b"\n')
  })

  it('`abs(x) and y` — a Number into logic_operation.A (sg90/servo.py)', () => {
    expect(loads('x = abs(n) and y\n')).toBe(true)
    roundTrips('x = abs(n) and y\n')
  })

  it('`not "x"` — text into logic_negate.BOOL', () => {
    expect(loads('x = not "s"\n')).toBe(true)
    roundTrips('x = not "s"\n')
  })

  it('`2 ** "x"` — text into the power block', () => {
    expect(loads('x = 2 ** "s"\n')).toBe(true)
    roundTrips('x = 2 ** "s"\n')
  })

  it('still builds the real blocks when the operands do fit', () => {
    expect(types('n += 1\n')).toContain('math_change')
    expect(types('x = a + 1\n')).toContain('math_arithmetic')
    expect(types('x = a % 2\n')).toContain('math_modulo')
    expect(types('x = a and b\n')).toContain('logic_operation')
    expect(types('x = not a\n')).toContain('logic_negate')
  })

  it('lets an unknown operand through — a name could be anything at runtime', () => {
    // The table is deliberately silent about variables, calls and raw values,
    // because Blockly leaves their output unchecked for the same reason.
    expect(types('x = a + b\n')).toContain('math_arithmetic')
    expect(types('total += values[i]\n')).toContain('math_change')
  })
})

/**
 * NO BRACKETS ROUND A SUBSCRIPT (#1071, finding 4).
 *
 * `total += values[i]` came back `total += (values[i])`. Cosmetic, but it is
 * still somebody's source being rewritten, and a subscript of a name binds
 * exactly as tightly as the call that was already recognised beside it.
 */
describe('a subscript needs no brackets (#1071)', () => {
  it('leaves `values[i]` alone', () => {
    roundTrips('total = 0\ntotal += values[i]\n')
  })

  it('leaves a dotted and a doubled subscript alone', () => {
    roundTrips('x = self.data[i] + 1\n')
    roundTrips('x = grid[y][x] + 1\n')
  })

  it('still brackets anything it cannot read', () => {
    // A subscript whose own index is a call stays loose: the rule only widens
    // to the unambiguous case.
    roundTrips('x = (values[f(i)]) + 1\n')
  })
})

/**
 * AN IMPORT IS HOISTED, SO ONLY A MODULE-SCOPE ONE MAY BECOME A BLOCK (#1071).
 * =============================================================================
 *
 * The un-traced cause behind one of #1071's thirteen files, and the second
 * WRONG ANSWER in that list rather than a refusal.
 *
 * An import block is hoisted: the generator gathers every one into the import
 * section at the top. That is right for the `import time` a learner drags in,
 * and it destroys the one idiom every portable MicroPython driver opens with:
 *
 * ```python
 * try:
 *     import ustruct as struct     # the board's
 * except ImportError:
 *     import struct                # CPython's, so the file is import-safe
 * ```
 *
 * Both arms used to be hoisted to module scope and both arms replaced with
 * `pass` — so a file written *because* one of the two may be missing became a
 * file that raises `ImportError` on line 1 and never starts. The conversion
 * reported a clean run while doing it.
 *
 * `examples/parts/snakie-standard/icm20948/icm20948.py` is the shipped file
 * this was found in.
 */
describe('only a module-scope import becomes an import block (#1071)', () => {
  it('keeps a try/except import fallback exactly as written', () => {
    roundTrips(
      [
        'try:',
        '    import ustruct as struct',
        'except ImportError:',
        '    import struct',
        ''
      ].join('\n')
    )
  })

  it('builds no import block for either arm', () => {
    const t = types('try:\n    import ustruct as struct\nexcept ImportError:\n    import struct\n')
    expect(t).not.toContain('snakie_python_import')
    expect(t).not.toContain('snakie_python_import_as')
  })

  it('leaves a lazy import inside a function where it was written', () => {
    // Deliberately off the start-up path. Hoisting it is a quieter version of
    // the same mistake.
    roundTrips('def f():\n    import time\n    return time\n')
  })

  it('leaves a nested `from … import …` alone too', () => {
    roundTrips('if fast:\n    from machine import Pin\n')
  })

  it('still makes a real block for an import at module scope', () => {
    expect(types('import time\n')).toContain('snakie_python_import')
    expect(types('import ustruct as struct\n')).toContain('snakie_python_import_as')
    expect(types('from machine import Pin\n')).toContain('snakie_python_from_import')
  })
})
