import { describe, it, expect, beforeEach } from 'vitest'
import 'blockly/blocks'
import {
  installBlockDefinitions,
  registeredBlocks,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks, readableBlockTypes } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * PALETTE / READER SYMMETRY (W2, #1089, epic #1086).
 * =============================================================================
 *
 * **A block a learner can drag out of the toolbox should be a block that comes
 * back when they reopen their file.** That is the whole property, and it was
 * quietly false for four drawers: `registerCallRules` has been the extension
 * point since #1019 and only `hardware.ts` and `turtle.ts` ever called it, so a
 * child could drag `add … to list`, save, reopen, and find grey.
 *
 * So every block in the palette has to be in one of three places, and the third
 * one is the point of the test:
 *
 *  1. a **rule** produces it — `readableBlockTypes()`;
 *  2. the **reader itself** produces it from a sample program below, which is
 *     how every control-flow block, literal and escape hatch is read;
 *  3. an explicit, **argued exception**.
 *
 * A block in none of them fails this test. That is deliberately annoying: the
 * cost of adding a block to the palette should include saying how it reads back,
 * even when the answer is "it doesn't, and here is why".
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** The block types a conversion of `source` produces, anywhere in the tree. */
function typesIn(source: string): Set<string> {
  const { workspace } = pythonToBlocks(source)
  const out = new Set<string>()
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.add(block.type as string)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const blocks = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of blocks ?? []) walk(block)
  return out
}

/**
 * Blocks the READER produces directly rather than through a rule, each with the
 * Python that should produce it.
 *
 * Doubles as a readable inventory of what the reader understands, which is
 * otherwise spread over a thousand lines of recognisers.
 */
const READ_DIRECTLY: Record<string, string> = {
  // --- control flow
  snakie_forever: 'while True:\n    print(1)\n',
  controls_repeat_ext: 'for _ in range(4):\n    print(1)\n',
  controls_whileUntil: 'while going:\n    print(1)\n',
  controls_forEach: 'for item in items:\n    print(item)\n',
  // --- two names in the loop target (#1121)
  snakie_for_each_two: 'for name, value in rows:\n    print(name)\n',
  snakie_for_each_indexed: 'for i, item in enumerate(items):\n    print(i)\n',
  snakie_for_each_zip: 'for a, b in zip(xs, ys):\n    print(a)\n',
  controls_if: 'if going:\n    print(1)\n',
  controls_flow_statements: 'while True:\n    break\n',
  // The small statements (#1133). `assert` is deliberately NOT among them —
  // it stays with the escape hatch below, and the argument is in `#1133`'s
  // own entry there.
  snakie_pass: 'if ready:\n    pass\n',
  // --- values
  math_number: 'x = 1\n',
  math_arithmetic: 'x = a + b\n',
  math_modulo: 'x = a % b\n',
  // --- the bits (#1127)
  snakie_bitwise: 'x = status & mask\n',
  snakie_bitwise_not: 'x = ~mask\n',
  snakie_bit_shift: 'x = 1 << pin\n',
  snakie_hex_number: 'addr = 0x3C\n',
  snakie_binary_number: 'mask = 0b1010\n',
  text: "x = 'hi'\n",
  logic_boolean: 'x = True\n',
  logic_null: 'x = None\n',
  logic_compare: 'x = a == b\n',
  logic_operation: 'x = a and b\n',
  logic_negate: 'x = not a\n',
  snakie_is_none: 'x = reading is None\n',
  // `is` / `is not` on anything else (#1128). `is None` is claimed first, so
  // this sample deliberately is not about None.
  snakie_identity: 'same = handle is other\n',
  // --- lists: the two subscript forms the block can write back exactly
  snakie_list_get: 'x = readings[0]\n',
  snakie_list_set: 'readings[0] = 1\n',
  // Taking one out by position has no method — `del` is the line (#1122).
  snakie_list_remove_at: 'del readings[0]\n',
  // --- slicing (#1123). Every one is a subscript, so the reader claims them
  // directly rather than through a rule.
  snakie_slice_range: 'middle = readings[1:4]\n',
  snakie_slice_first: 'head = readings[:3]\n',
  snakie_slice_last: 'tail = readings[-3:]\n',
  snakie_last_item: 'newest = readings[-1]\n',
  snakie_slice_copy: 'spare = readings[:]\n',
  snakie_slice_reverse: 'backwards = readings[::-1]\n',
  snakie_list_contains: 'found = name in names\n',
  snakie_tuple: 'point = (x, y)\n',
  // `where … is in` on the 1-based setting writes `s.find(n) + 1`, which is
  // arithmetic round a call — the rule reads the 0-based form and the parser
  // folds the `+ 1` back (#1124).
  snakie_text_find: "at = line.find(',') + 1\n",
  // --- formatting (#1125). The reader claims exactly the f-strings these
  // blocks write, and no other: everything else about the f-string grammar
  // stays raw and regenerates verbatim.
  snakie_format_places: 'shown = f"{temp:.1f}"\n',
  snakie_format_pad: 'shown = f"{reading:>5}"\n',
  snakie_format_base: 'shown = f"{addr:#x}"\n',
  // A LIST DISPLAY IS READ NOW (#1135). It used to be listed below as an
  // argued exception; the buffer block takes its list in a socket, so it had
  // to become real — and `readings = [1, 2, 3]` stopping being grey is worth
  // more than the block it was added for.
  lists_create_with: 'readings = [1, 2, 3]\n',
  // --- dictionaries (#1120). The three that are not calls are a literal, a
  // subscript and a `del`, each claimed only where the key is a string.
  snakie_dict_create: "config = {'pin': 15}\n",
  snakie_dict_get: "pin = config['pin']\n",
  snakie_dict_set: "config['pin'] = 15\n",
  snakie_dict_remove: "del config['pin']\n",
  // --- variables and functions
  variables_get: 'x = y\n',
  variables_set: 'x = 1\n',
  math_change: 'x += 1\n',
  snakie_forget: 'del score\n',
  // Exactly two plain names is the friendly block (#1121); everything else the
  // left-hand side can be stays with the text-target one below.
  snakie_unpack: 'x, y = position()\n',
  procedures_defnoreturn: 'def go():\n    print(1)\n',
  procedures_defreturn: 'def double(n):\n    return n\n',
  procedures_callnoreturn: 'def go():\n    print(1)\n\ngo()\n',
  procedures_callreturn: 'def double(n):\n    return n\n\nx = double(2)\n',
  snakie_return: 'def go(n):\n    if n < 0:\n        return\n    print(n)\n',
  // --- the escape hatches (#1018), which W1 taught the reader to emit
  //
  // `assert` IS DELIBERATELY NOT A BLOCK (#1133, epic #1119). The evidence
  // `docs/blocks-coverage-epic.md` §3.5 declined it on for the READER is that
  // it is 890 lines across 8 projects, almost all `pytest` files — test code,
  // not device code. Authoring is a different question and the answer came out
  // the same: on a board an `assert` stops the program with a traceback nobody
  // is there to read, while "if … then report a problem" — two blocks the
  // palette already has, since #1131 — says the same thing and says WHY. It
  // stays with the escape hatch, which regenerates it exactly.
  snakie_python_statement: 'assert ok\n',
  // A suite nothing claims: `while … else:` is real Python, and the `else` arm
  // belongs to no recogniser, so it keeps its header and its body.
  snakie_python_suite: 'while x:\n    print(1)\nelse:\n    print(2)\n',
  // --- structure (W6, #1093)
  snakie_class: 'class Thing:\n    def go(self):\n        print(1)\n',
  snakie_method: 'class Thing:\n    def go(self):\n        print(1)\n',
  // The getter and the `@name.setter` under it, folded into one block (#1222).
  snakie_property:
    'class Thing:\n    @property\n    def speed(self):\n        return 1\n\n    @speed.setter\n    def speed(self, value):\n        pass\n',
  snakie_self: 'class Thing:\n    def go(self):\n        self.x = 1\n',
  // --- error handling and resources (W7, #1094)
  snakie_try: 'try:\n    print(1)\nexcept OSError as e:\n    print(e)\n',
  // `use … as` took the shape a learner meets (#1132); the text-field block
  // keeps what that one cannot hold — two context managers on one line,
  // `async with`, a name that is not a plain identifier.
  snakie_use: "with open('data.csv') as handle:\n    print(handle)\n",
  snakie_with: 'with a() as f, b() as g:\n    print(f)\n',
  // --- async (W9, #1096)
  snakie_await: 'async def go():\n    await sleeper()\n',
  snakie_await_value: 'async def go():\n    data = await sensor.read()\n',
  snakie_raise: 'raise RuntimeError("no wifi")\n',
  // --- assignment and scope (W8, #1095)
  //
  // SUPERSEDED FOR TWO PLAIN NAMES by `snakie_unpack` (#1121) and still the
  // block for everything else a target can be: three names or more, an
  // attribute target, a chain, a subscript the list block cannot count back.
  snakie_python_assign: 'self.x, self.y = 0, 0\n',
  snakie_python_augmented: 'total *= 2\n',
  // `global x` alone is the Variables drawer's own block (#1118); the escape
  // hatch keeps what its variable field cannot hold — `nonlocal`, and several
  // names at once.
  snakie_global: 'def go():\n    global total\n    total = 1\n',
  // STILL HIDDEN, AND NOW ON PURPOSE (#1133). #1118 gave `global` a block with
  // a variable field, which is a better answer than un-hiding this one would
  // have been. `nonlocal` is genuinely rare in device code — it needs a
  // function inside a function, which nothing in the curriculum reaches — and
  // "several names at once" is a line the escape hatch says exactly. The
  // decision is recorded rather than left as a leftover.
  snakie_python_scope: 'def go():\n    nonlocal low, high\n    low = 1\n',
  snakie_python_import_here: 'def go():\n    import ujson\n    print(ujson)\n',
  // Spreading (#1134): only meaningful in an argument socket, which is the
  // only place a term can start with a star.
  snakie_spread: 'thing.calibrate(*args)\n',
  snakie_spread_named: 'thing.calibrate(**settings)\n',
  // A comprehension is a real block since #1126, so the grey value block needs
  // a sample that is still nobody's: a conditional expression.
  snakie_python_value: 'x = a if ready else b\n',
  // --- comprehensions (#1126). The spike §4.1 asked for came back yes: the
  // reader splits at the top-level `for`, `in` and optional `if`, so these are
  // rules rather than the argued exception the issue expected.
  snakie_list_comprehension: 'squares = [n * n for n in numbers]\n',
  snakie_dict_comprehension: 'table = {name: 0 for name in names}\n',
  snakie_python_comment: '# a note\n',
  snakie_python_docstring: '"""What this program does."""\n',
  snakie_python_blank: 'x = 1\n\ny = 2\n',
  snakie_python_import: 'import time\n',
  snakie_python_import_as: 'import ujson as json\n',
  snakie_python_from_import: 'from machine import Pin\n',
  // --- an f-string as a template (the print that holds one, and the value)
  snakie_print_format: 'print(f"distance {d}")\n',
  snakie_fstring: 'x = f"distance {d}"\n',
  snakie_python_call: 'display.show()\n',
  snakie_python_call_value: 'x = sensor.read()\n',
  snakie_python_attr_get: 'x = self.angle\n',
  snakie_python_attr_set: 'self.angle = 0\n',
  // --- a declaration rather than a call (W10, #1097)
  snakie_name_pin: 'echo = Pin(0, Pin.IN)\n',
  // Named hardware that is not a pin: the same `AliasRule` machinery, one mode.
  snakie_name_pwm: 'motor_a = PWM(Pin(15))\n'
}

/**
 * Blocks with NO Python form the reader can claim, and why.
 *
 * Every line here is an argument, not a shrug. Four kinds of reason:
 *
 *  - **the block writes an expression, not a call** — claiming it would mean
 *    pattern-matching arithmetic, and being wrong about that rewrites somebody's
 *    formula;
 *  - **two blocks write the same line**, so one of them has to lose;
 *  - **the call carries a field the reader cannot place back** — a colour, a
 *    channel name, a learner's own keyword;
 *  - **it is somebody else's workstream**, named.
 */
const NO_READER: Record<string, string> = {
  // --- the same line as another block
  lists_length: '`len(xs)` is read as `text_length`, and one line cannot be two blocks.',
  procedures_ifreturn:
    'Deliberately unreadable since #1063: its code is `if <COND>: return <VALUE>`, and with ' +
    'nothing in COND the generator wrote `if False:`, so every early return became dead code. ' +
    'W3 (#1090) is the real return block.',
  // --- an expression, not a call
  snakie_file_lines:
    'Writes `for line in f:`, which `controls_forEach` writes too — and nothing ' +
    'in the text says which of the two a learner built it with. The ordinary loop ' +
    'block got there first and keeps the line; this one is for BUILDING one, ' +
    'where the Files drawer is what a learner is looking at (#1132).',
  snakie_map_range:
    'Writes arithmetic, not a call. The expression parser already reads that arithmetic back as ' +
    'the nest of math_arithmetic blocks it literally is.',
  snakie_bit_of:
    'Writes `(value >> (n - 1)) & 1` — three operators, not a call. The expression parser reads ' +
    'that back as the shift and the mask it literally is, which is two real blocks rather than ' +
    'one; claiming the shape here would mean pattern-matching arithmetic, and being wrong about ' +
    'that rewrites a formula somebody wrote (#1127).',
  text_join:
    'Writes a `+` chain of `str(...)` calls, which reads back as the arithmetic it is written as.',
  controls_for:
    "Blockly's count-with loop writes `range(a, b, c)`; the reader knows `range(n)` and " +
    '`for x in xs`. Widening it is W8 (#1095).',
  // --- a field the reader cannot place back
  snakie_turtle_pencolour: 'Carries a colour swatch field, not an argument the call text holds.',
  snakie_onboard_led: 'Writes a per-board pin token, which is board state rather than line text.',
  snakie_pin_pressed: 'Reads back as the pin block plus a comparison — two blocks for one line.',
  snakie_pwm_read:
    'Two blocks write `x.duty_u16()`, and its socket twin `snakie_pwm_read_named` is the one that ' +
    'wins. It has to be: `snakie_name_pwm` registers its names against the `pwm` receiver, so a ' +
    'receiver rule here would claim `motor_a.duty_u16()` too — and this block regenerates through ' +
    '`pwm()`, which would build `pwm_motor_a = PWM(motor_a)`. The statement blocks settle that ' +
    'race with `onNamedPin`, whose pass runs first; the value side has no such pass, so only one ' +
    'of the pair may claim the line.',
  snakie_i2c_scan: 'Takes a hoisted I²C bus built from two pin fields, not from the call text.',
  snakie_i2c_present: 'As `snakie_i2c_scan`, with an address comparison on top.',
  snakie_inst_scope: 'Its channel is a keyword argument only written when it differs from the default.',
  snakie_inst_meter: 'As `snakie_inst_scope`.',
  snakie_inst_plot: 'The learner names their own series, which becomes the Python keyword itself.',
  snakie_inst_distance: 'As `snakie_inst_scope`.',
  snakie_inst_button: 'As `snakie_inst_scope`.',
  snakie_inst_encoder: 'As `snakie_inst_scope`.',
  snakie_inst_screen: 'Wraps its socket in a one-element list, so block and text are not one-to-one.',
  snakie_inst_read_adc: 'Takes a hoisted `machine.ADC`, which is #1012 machinery rather than line text.',
  snakie_inst_read_pwm: 'Takes a hoisted `machine.PWM`, as `snakie_inst_read_adc`.',
  snakie_inst_i2c_scan: 'Takes a hoisted I²C bus, as `snakie_i2c_scan`.',
  snakie_inst_gamepad_axis: 'Writes `inst.teleop()[0].get("x", 0)` — an indexed call chain, not a call.'
}

describe('every palette block is accounted for', () => {
  it('is a rule, a sample, or an argued exception', () => {
    const readable = readableBlockTypes()
    const unaccounted = registeredBlocks()
      .map((b) => b.type)
      .filter((type) => !readable.has(type) && !(type in READ_DIRECTLY) && !(type in NO_READER))
    expect(unaccounted).toEqual([])
  })

  it('has no stale entries in either table', () => {
    const defined = new Set(registeredBlocks().map((b) => b.type))
    const listed = [...Object.keys(READ_DIRECTLY), ...Object.keys(NO_READER)]
    expect(listed.filter((type) => !defined.has(type))).toEqual([])
  })

  it('does not excuse a block a rule already reads', () => {
    // An entry in `NO_READER` for a block that IS readable is a stale argument,
    // and a stale argument is worse than none.
    const readable = readableBlockTypes()
    expect(Object.keys(NO_READER).filter((type) => readable.has(type))).toEqual([])
  })
})

describe('the reader really produces what the samples claim', () => {
  for (const [type, source] of Object.entries(READ_DIRECTLY)) {
    it(`reads ${type}`, () => {
      expect([...typesIn(source)]).toContain(type)
    })
  }
})

describe('the drawers that had no rules at all before W2', () => {
  it('reads `xs.append(v)` as the Lists block', () => {
    expect([...typesIn('readings.append(value)\n')]).toContain('snakie_list_append')
  })

  it('reads `random.randint(a, b)` as the Maths block', () => {
    const src = ['import random', '', 'x = random.randint(1, 6)', ''].join('\n')
    expect([...typesIn(src)]).toContain('math_random_int')
  })

  it('reads `min` and `max` as one block with two settings', () => {
    const { workspace } = pythonToBlocks('x = min(a, b)\n')
    const first = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
    const value = (first.inputs as Record<string, { block: Record<string, unknown> }>).VALUE.block
    expect(value.type).toBe('snakie_math_min_max')
    expect(value.fields).toEqual({ OP: 'MIN' })
    expect([...typesIn('x = max(a, b)\n')]).toContain('snakie_math_min_max')
  })

  it('reads an instrument call whose arguments are all plain sockets', () => {
    // `inst.imu(...)` and friends: every argument a socket, nothing to place back
    // by guesswork. The ones with keyword or field arguments are listed above.
    const readable = readableBlockTypes()
    const instrumentRules = [...readable].filter((type) => type.startsWith('snakie_inst_'))
    expect(instrumentRules.length).toBeGreaterThan(0)
  })
})
