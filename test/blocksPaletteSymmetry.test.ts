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
  controls_if: 'if going:\n    print(1)\n',
  controls_flow_statements: 'while True:\n    break\n',
  // --- values
  math_number: 'x = 1\n',
  math_arithmetic: 'x = a + b\n',
  math_modulo: 'x = a % b\n',
  text: "x = 'hi'\n",
  logic_boolean: 'x = True\n',
  logic_null: 'x = None\n',
  logic_compare: 'x = a == b\n',
  logic_operation: 'x = a and b\n',
  logic_negate: 'x = not a\n',
  snakie_is_none: 'x = reading is None\n',
  // --- lists: the two subscript forms the block can write back exactly
  snakie_list_get: 'x = readings[0]\n',
  snakie_list_set: 'readings[0] = 1\n',
  snakie_list_contains: 'found = name in names\n',
  // --- variables and functions
  variables_get: 'x = y\n',
  variables_set: 'x = 1\n',
  math_change: 'x += 1\n',
  procedures_defnoreturn: 'def go():\n    print(1)\n',
  procedures_defreturn: 'def double(n):\n    return n\n',
  procedures_callnoreturn: 'def go():\n    print(1)\n\ngo()\n',
  procedures_callreturn: 'def double(n):\n    return n\n\nx = double(2)\n',
  // --- the escape hatches (#1018), which W1 taught the reader to emit
  snakie_python_statement: 'assert ok\n',
  snakie_python_suite: 'class Thing:\n    def go(self):\n        print(1)\n',
  snakie_python_value: 'x = [v for v in things]\n',
  snakie_python_comment: '# a note\n',
  snakie_python_blank: 'x = 1\n\ny = 2\n',
  snakie_python_import: 'import time\n',
  snakie_python_import_as: 'import ujson as json\n',
  snakie_python_from_import: 'from machine import Pin\n',
  snakie_python_call: 'display.show()\n',
  snakie_python_call_value: 'x = sensor.read()\n',
  snakie_python_attr_get: 'x = self.angle\n',
  snakie_python_attr_set: 'self.angle = 0\n',
  // --- a declaration rather than a call (W10, #1097)
  snakie_name_pin: 'echo = Pin(0, Pin.IN)\n'
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
  snakie_map_range:
    'Writes arithmetic, not a call. The expression parser already reads that arithmetic back as ' +
    'the nest of math_arithmetic blocks it literally is.',
  text_join:
    'Writes a `+` chain of `str(...)` calls, which reads back as the arithmetic it is written as.',
  lists_create_with: 'A list display `[1, 2]` is a literal the expression parser does not read yet.',
  controls_for:
    "Blockly's count-with loop writes `range(a, b, c)`; the reader knows `range(n)` and " +
    '`for x in xs`. Widening it is W8 (#1095).',
  // --- a field the reader cannot place back
  snakie_turtle_pencolour: 'Carries a colour swatch field, not an argument the call text holds.',
  snakie_onboard_led: 'Writes a per-board pin token, which is board state rather than line text.',
  snakie_pin_pressed: 'Reads back as the pin block plus a comparison — two blocks for one line.',
  snakie_pwm_duty: 'Writes the percentage arithmetic inline, so the line is not a plain call.',
  snakie_adc_read: 'Writes the volts arithmetic inline, so the line is not a plain call.',
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
