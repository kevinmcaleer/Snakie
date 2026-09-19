import { Order } from '../generator'
import { registerCallRules } from '../python-to-blocks'
import type { BlockDefinition } from '../registry'

/**
 * MATHS (#1011, epic #1007).
 * =============================================================================
 *
 * Numbers, arithmetic, random, rounding, remainder — and two blocks Blockly does
 * not have that every hardware lesson needs.
 *
 * `min`/`max` OF TWO NUMBERS. Blockly's `math_on_list` does min/max over a list,
 * which is not the question a learner is asking when they want to stop a servo
 * going past 180.
 *
 * `map a number from one range to another` is THE block nobody ships and every
 * analogue lesson needs: a potentiometer reads 0–65535, a servo wants 0–180, a
 * motor wants -1.0–1.0. Without it the lesson is a line of arithmetic the
 * teacher types for them, which teaches nothing. With it, the generated line IS
 * that arithmetic, sitting in the mirror where they can read it.
 *
 * TRIMMED, ruthlessly: `math_trig`, `math_constant` (π, e, φ, ∞), `math_atan2`,
 * `math_number_property` (prime? divisible by?), `math_on_list`, `math_constrain`
 * and `math_single`'s seven functions are all registered nowhere. A ten-year-old
 * on day one does not need `atan2`, and a palette they have to scroll past it to
 * use is a palette that is harder to learn.
 */
export const MATHS_BLOCKS: BlockDefinition[] = [
  {
    type: 'math_number',
    category: 'math',
    help: 'ref-types',
    code: (block) => {
      const n = Number(block.getFieldValue('NUM'))
      // A negative literal binds looser than a function call, so it has to say
      // so or `-5 ** 2` comes out meaning the wrong thing.
      return [String(n), n < 0 ? Order.UNARY_SIGN : Order.ATOMIC]
    }
  },
  {
    type: 'math_arithmetic',
    category: 'math',
    help: 'ref-types',
    // BLOCKLY'S BLOCK, REDEFINED FOR ONE MORE OPTION (#1127). `//` is division
    // — the kind that throws the remainder away — and a learner looking for it
    // looks at the division block. A `snakie_floor_divide` beside `÷` would be
    // two blocks for one idea and would teach that Snakie has two kinds of
    // arithmetic block, which it does not.
    //
    // The five glyphs are Blockly's own (`MATH_ADDITION_SYMBOL` and friends), so
    // a workspace saved before this looks and generates exactly as it did; only
    // the sixth entry is new, and `//` is on the face because `//` is what lands
    // in the mirror.
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'Number' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['+', 'ADD'],
            ['-', 'MINUS'],
            ['\u00d7', 'MULTIPLY'],
            ['\u00f7', 'DIVIDE'],
            ['^', 'POWER'],
            ['//', 'FLOORDIVIDE']
          ]
        },
        { type: 'input_value', name: 'B', check: 'Number' }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Arithmetic on two numbers. `//` divides and throws the remainder away, so 7 // 2 is 3 — which is how you count whole things.'
    },
    toolbox: {
      inputs: {
        A: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        B: { shadow: { type: 'math_number', fields: { NUM: 1 } } }
      }
    },
    code: (block, gen) => {
      const [op, order] = ARITHMETIC[block.getFieldValue('OP')] ?? ['+', Order.ADDITIVE]
      // THE SIDE THAT ASSOCIATES NEEDS NO BRACKETS (#1087, epic #1086).
      //
      // Blockly parenthesises whenever the inner order is at least as tight as
      // the outer one, because `valueToCode` cannot see WHICH socket it is
      // filling — and `a - (b - c)` really is not `a - b - c`. Here we can see
      // it. `+ - * /` are left-associative, so the LEFT operand at the same
      // precedence is exactly what the source said and the brackets are noise;
      // `**` is right-associative, so it is the right operand instead.
      //
      // Asking for one step LOOSER on that side is what says so: an inner block
      // at the same precedence no longer trips `outer <= inner`, and anything
      // genuinely looser still does.
      //
      // Not cosmetic. `volts = raw * 3.3 / 65535` came back as
      // `(raw * 3.3) / 65535`, which the round-trip gate reads as a different
      // program — so the blocks were held back from a learner who wrote one of
      // the commonest lines in a sensor program, with nothing said.
      const loose = order + 1
      const rightAssociative = op === '**'
      const a = gen.valueToCode(block, 'A', rightAssociative ? order : loose) || '0'
      const b = gen.valueToCode(block, 'B', rightAssociative ? loose : order) || '0'
      return [`${a} ${op} ${b}`, order]
    }
  },
  {
    type: 'math_modulo',
    category: 'math',
    help: 'ref-types',
    toolbox: {
      inputs: {
        DIVIDEND: { shadow: { type: 'math_number', fields: { NUM: 64 } } },
        DIVISOR: { shadow: { type: 'math_number', fields: { NUM: 10 } } }
      }
    },
    code: (block, gen) => {
      // Left-associative, so the dividend needs no brackets at its own
      // precedence — see `math_arithmetic` above for why that is asked for by
      // requesting one step looser.
      const a = gen.valueToCode(block, 'DIVIDEND', Order.MULTIPLICATIVE + 1) || '0'
      const b = gen.valueToCode(block, 'DIVISOR', Order.MULTIPLICATIVE) || '1'
      return [`${a} % ${b}`, Order.MULTIPLICATIVE]
    }
  },
  {
    type: 'math_round',
    category: 'math',
    help: 'ref-builtins',
    toolbox: { inputs: { NUM: { shadow: { type: 'math_number', fields: { NUM: 3.1 } } } } },
    // NOT a definition-level import: `round` is a builtin and needs nothing,
    // while up/down need `math`. Declared on the DEFINITION it would be added
    // whenever this block emits, putting an unused `import math` at the top of
    // every program that rounds to the nearest — and an import a learner cannot
    // account for is exactly the noise the import manager exists to prevent.
    code: (block, gen) => {
      const n = gen.valueToCode(block, 'NUM', Order.NONE) || '0'
      const op = block.getFieldValue('OP')
      if (op === 'ROUNDUP' || op === 'ROUNDDOWN') {
        gen.need({ module: 'math' })
        return [`math.${op === 'ROUNDUP' ? 'ceil' : 'floor'}(${n})`, Order.FUNCTION_CALL]
      }
      return [`round(${n})`, Order.FUNCTION_CALL]
    }
  },
  {
    type: 'math_random_int',
    category: 'math',
    help: 'ref-builtins',
    read: {
      module: 'random',
      fn: 'randint',
      args: ['FROM', 'TO'],
      shape: 'value',
      checks: { FROM: 'Number', TO: 'Number' }
    },
    toolbox: {
      inputs: {
        FROM: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        TO: { shadow: { type: 'math_number', fields: { NUM: 100 } } }
      }
    },
    imports: [{ module: 'random' }],
    code: (block, gen) => {
      const from = gen.valueToCode(block, 'FROM', Order.NONE) || '0'
      const to = gen.valueToCode(block, 'TO', Order.NONE) || '0'
      // `randint` is inclusive at both ends, which is what the block says.
      return [`random.randint(${from}, ${to})`, Order.FUNCTION_CALL]
    }
  },
  {
    // TWO-ARGUMENT `round`, which `math_round` cannot hold: its dropdown picks
    // nearest/up/down and it has one socket, so `round(x, 1)` — the form every
    // sensor reading is printed with — came back as raw Python and could not be
    // built at all. Kept as its own block rather than a second socket on
    // `math_round`, whose up and down options go through `math.ceil`/`floor` and
    // have nowhere to put a number of places.
    type: 'snakie_math_round_places',
    category: 'math',
    help: 'ref-builtins',
    json: {
      message0: 'round %1 to %2 decimal places',
      args0: [
        { type: 'input_value', name: 'NUM', check: 'Number' },
        { type: 'input_value', name: 'PLACES', check: 'Number' }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Round a number to a number of decimal places. 1 place turns 12.345 into 12.3 — which is how a distance or a temperature is usually shown.'
    },
    toolbox: {
      inputs: {
        NUM: { shadow: { type: 'math_number', fields: { NUM: 12.345 } } },
        PLACES: { shadow: { type: 'math_number', fields: { NUM: 1 } } }
      }
    },
    code: (block, gen) => [
      `round(${gen.valueToCode(block, 'NUM', Order.NONE) || '0'}, ${
        gen.valueToCode(block, 'PLACES', Order.NONE) || '0'
      })`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_math_abs',
    category: 'math',
    help: 'ref-builtins',
    json: {
      message0: 'size of %1',
      args0: [{ type: 'input_value', name: 'NUM', check: 'Number' }],
      inputsInline: true,
      output: 'Number',
      tooltip: 'How big a number is, ignoring its sign. The size of -7 is 7.'
    },
    toolbox: { inputs: { NUM: { shadow: { type: 'math_number', fields: { NUM: -7 } } } } },
    code: (block, gen) => [
      `abs(${gen.valueToCode(block, 'NUM', Order.NONE) || '0'})`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_math_min_max',
    category: 'math',
    help: 'ref-builtins',
    json: {
      message0: '%1 of %2 and %3',
      args0: [
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['smallest', 'MIN'],
            ['largest', 'MAX']
          ]
        },
        { type: 'input_value', name: 'A', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip: 'The smaller or larger of two numbers — the usual way to stop a value going too far.'
    },
    toolbox: {
      inputs: {
        A: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
        B: { shadow: { type: 'math_number', fields: { NUM: 100 } } }
      }
    },
    code: (block, gen) => {
      const fn = block.getFieldValue('OP') === 'MAX' ? 'max' : 'min'
      const a = gen.valueToCode(block, 'A', Order.NONE) || '0'
      const b = gen.valueToCode(block, 'B', Order.NONE) || '0'
      return [`${fn}(${a}, ${b})`, Order.FUNCTION_CALL]
    }
  },
  {
    type: 'snakie_map_range',
    category: 'math',
    help: 'ref-types',
    json: {
      message0: 'map %1 from %2 – %3 to %4 – %5',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'input_value', name: 'IN_MIN', check: 'Number' },
        { type: 'input_value', name: 'IN_MAX', check: 'Number' },
        { type: 'input_value', name: 'OUT_MIN', check: 'Number' },
        { type: 'input_value', name: 'OUT_MAX', check: 'Number' }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Rescale a number from one range to another — a dial that reads 0 to 65535 into an angle of 0 to 180.'
    },
    toolbox: {
      inputs: {
        IN_MIN: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
        IN_MAX: { shadow: { type: 'math_number', fields: { NUM: 65535 } } },
        OUT_MIN: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
        OUT_MAX: { shadow: { type: 'math_number', fields: { NUM: 180 } } }
      }
    },
    code: (block, gen) => {
      const v = gen.valueToCode(block, 'VALUE', Order.NONE) || '0'
      const inMin = gen.valueToCode(block, 'IN_MIN', Order.NONE) || '0'
      const inMax = gen.valueToCode(block, 'IN_MAX', Order.NONE) || '1'
      const outMin = gen.valueToCode(block, 'OUT_MIN', Order.NONE) || '0'
      const outMax = gen.valueToCode(block, 'OUT_MAX', Order.NONE) || '1'
      // Written out rather than hidden in a helper function. It is one line of
      // arithmetic a learner can read, and reading it is the lesson — a
      // `_map_range()` in a setup section they never open would teach nothing.
      return [
        `(${v} - ${inMin}) * (${outMax} - ${outMin}) / (${inMax} - ${inMin}) + ${outMin}`,
        Order.ADDITIVE
      ]
    }
  },
  // -------------------------------------------------------------------------
  // THE BITS (#1127, epic #1119).
  //
  // The most MicroPython-shaped gap in the whole audit. Bitwise arithmetic is
  // not an advanced topic on a microcontroller, it is the vocabulary: masking a
  // status register, packing flags, building an I²C command byte, `value & 0xFF`,
  // `1 << pin`. Every one of those was `snakie_python_value` text.
  //
  // THEY SAY "bits", AND THAT IS THE WHOLE DESIGN. A learner who reaches for the
  // Logic drawer's `and` and gets `&` has been taught something false in a way
  // that will not show up until a number comes out wrong. So these live in
  // Maths, wear the word `bits`, and never read as the words Logic already owns.
  // -------------------------------------------------------------------------
  {
    type: 'snakie_bitwise',
    category: 'math',
    help: 'ref-bits',
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'Number' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['bits and', 'AND'],
            ['bits or', 'OR'],
            ['bits xor', 'XOR']
          ]
        },
        { type: 'input_value', name: 'B', check: 'Number' }
      ],
      inputsInline: true,
      // UNCHECKED OUTPUT, AND IT IS NOT A SHRUG (#1127). `if flags & 0x01:` is
      // how every driver asks whether a bit is set, and Python is perfectly
      // happy treating the number that comes back as a yes/no. Declaring this
      // `Number` makes Blockly refuse the `if` socket, which cost two of the
      // `.py` files this repository ships their whole canvas — the same failure
      // #1087 found behind an over-tight `Array` check. The operands are still
      // checked, which is where a wrong type actually does harm.
      output: null,
      tooltip:
        'Combine two numbers one bit at a time. "bits and" keeps only the bits both have — the usual way to read part of a byte, as in value bits and 0xFF.'
    },
    toolbox: {
      inputs: {
        A: { shadow: { type: 'math_number', fields: { NUM: 0 } } },
        B: { shadow: { type: 'snakie_hex_number', fields: { HEX: 'FF' } } }
      }
    },
    code: (block, gen) => {
      const [op, order] = BITWISE[block.getFieldValue('OP')] ?? ['&', Order.BITWISE_AND]
      // LEFT-ASSOCIATIVE, SO THE LEFT SIDE NEEDS NO BRACKETS — the identical
      // argument `math_arithmetic` makes above, and it has to be made again or
      // `a & b & c` regenerates as `(a & b) & c` and the round-trip gate, quite
      // rightly, refuses to commit the conversion.
      const a = gen.valueToCode(block, 'A', order + 1) || '0'
      const b = gen.valueToCode(block, 'B', order) || '0'
      return [`${a} ${op} ${b}`, order]
    }
  },
  {
    type: 'snakie_bitwise_not',
    category: 'math',
    help: 'ref-bits',
    json: {
      message0: 'not the bits of %1',
      args0: [{ type: 'input_value', name: 'VALUE', check: 'Number' }],
      inputsInline: true,
      // Unchecked, as `snakie_bitwise` — see the note there.
      output: null,
      tooltip:
        'Flip every bit of a number: every 1 becomes a 0 and every 0 a 1. Python writes it ~value.'
    },
    toolbox: { inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } },
    code: (block, gen) => [
      `~${gen.valueToCode(block, 'VALUE', Order.UNARY_SIGN) || '0'}`,
      Order.UNARY_SIGN
    ]
  },
  {
    type: 'snakie_bit_shift',
    category: 'math',
    help: 'ref-bits',
    json: {
      message0: '%1 shifted %2 by %3',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        {
          type: 'field_dropdown',
          name: 'DIR',
          options: [
            ['left', 'LEFT'],
            ['right', 'RIGHT']
          ]
        },
        { type: 'input_value', name: 'BY', check: 'Number' }
      ],
      inputsInline: true,
      // Unchecked, as `snakie_bitwise` — see the note there.
      output: null,
      tooltip:
        'Slide a number\u2019s bits along. 1 shifted left by 5 is the number with only bit 5 set — which is how a pin number becomes a mask.'
    },
    toolbox: {
      inputs: {
        VALUE: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        BY: { shadow: { type: 'math_number', fields: { NUM: 1 } } }
      }
    },
    code: (block, gen) => {
      const op = block.getFieldValue('DIR') === 'RIGHT' ? '>>' : '<<'
      const value = gen.valueToCode(block, 'VALUE', Order.BITWISE_SHIFT + 1) || '0'
      const by = gen.valueToCode(block, 'BY', Order.BITWISE_SHIFT) || '0'
      return [`${value} ${op} ${by}`, Order.BITWISE_SHIFT]
    }
  },
  {
    // A LITERAL THAT KEEPS ITS OWN WRITING (#1127). `math_number` holds a
    // NUMBER, so `0x3C` typed into it comes back `60` — the same value and not
    // the same line, and the round-trip gate refuses the whole file over it.
    // The field here holds the DIGITS AS TEXT, so what the learner copied out of
    // a datasheet is what ends up in the mirror.
    type: 'snakie_hex_number',
    category: 'math',
    help: 'ref-bits',
    json: {
      message0: 'hex 0x %1',
      args0: [{ type: 'field_input', name: 'HEX', text: '3C' }],
      output: 'Number',
      tooltip:
        'A number written in hex, the way datasheets write I\u00b2C addresses and register numbers. 0x3C is 60.'
    },
    code: (block) => [`0x${hexDigits(block.getFieldValue('HEX'))}`, Order.ATOMIC]
  },
  {
    type: 'snakie_binary_number',
    category: 'math',
    help: 'ref-bits',
    json: {
      message0: 'binary 0b %1',
      args0: [{ type: 'field_input', name: 'BITS', text: '1010' }],
      output: 'Number',
      tooltip: 'A number written out as its bits. 0b1010 is 10.'
    },
    code: (block) => [`0b${binaryDigits(block.getFieldValue('BITS'))}`, Order.ATOMIC]
  },
  {
    type: 'snakie_bit_of',
    category: 'math',
    help: 'ref-bits',
    json: {
      message0: 'bit %1 of %2',
      args0: [
        { type: 'input_value', name: 'N', check: 'Number' },
        { type: 'input_value', name: 'VALUE', check: 'Number' }
      ],
      inputsInline: true,
      // Unchecked, as `snakie_bitwise` — a bit IS the answer to "is it set?".
      output: null,
      tooltip:
        'One bit out of a number, as a 1 or a 0. Bit 1 is the rightmost — the same counting as the Lists drawer.'
    },
    toolbox: {
      inputs: {
        N: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } }
      }
    },
    code: (block, gen) => {
      const value = gen.valueToCode(block, 'VALUE', Order.BITWISE_SHIFT + 1) || '0'
      const n = gen.valueToCode(block, 'N', Order.ADDITIVE) || '1'
      // ONE-BASED ON THE BLOCK, as the Lists drawer already promises, so bit 1
      // is the one worth 1. The `- 1` is written out for the same reason
      // `lists.ts` writes its own out: the learner meets the off-by-one with the
      // block that caused it still on screen.
      const shift = /^-?\d+$/.test(n) ? String(Number(n) - 1) : `(${n} - 1)`
      return [`(${value} >> ${shift}) & 1`, Order.BITWISE_AND]
    }
  }
]

/** The bitwise operators, with the Python symbol and Python's own precedence. */
const BITWISE: Record<string, [string, number]> = {
  AND: ['&', Order.BITWISE_AND],
  OR: ['|', Order.BITWISE_OR],
  XOR: ['^', Order.BITWISE_XOR]
}

/**
 * The hex digits out of whatever is in the field.
 *
 * A text field takes anything a learner types, and `0x` followed by nothing —
 * or by `hello` — is a SyntaxError in the mirror rather than a block that looks
 * wrong. Underscores are kept, because Python allows them in a literal and
 * `0xDE_AD_BE_EF` is somebody's deliberate spacing.
 */
function hexDigits(text: string): string {
  const kept = (text ?? '').replace(/[^0-9a-fA-F_]/g, '').replace(/^_+/, '')
  return kept === '' || /^_*$/.test(kept) ? '0' : kept
}

/** As {@link hexDigits}, for `0b`. */
function binaryDigits(text: string): string {
  const kept = (text ?? '').replace(/[^01_]/g, '').replace(/^_+/, '')
  return kept === '' || /^_*$/.test(kept) ? '0' : kept
}

/** Blockly's arithmetic ops, with the Python operator and its precedence. */
const ARITHMETIC: Record<string, [string, number]> = {
  ADD: ['+', Order.ADDITIVE],
  MINUS: ['-', Order.ADDITIVE],
  MULTIPLY: ['*', Order.MULTIPLICATIVE],
  DIVIDE: ['/', Order.MULTIPLICATIVE],
  POWER: ['**', Order.EXPONENTIATION],
  // `//` binds exactly as `/` and `%` do, and associates left the same way, so
  // it needs nothing here beyond saying so (#1127).
  FLOORDIVIDE: ['//', Order.MULTIPLICATIVE]
}

/**
 * How these blocks read BACK out of Python (W2, #1089, epic #1086).
 *
 * `round`, `round(x, n)` and `abs` already had rules — they live in the reader's
 * own built-in table, which is where the `time.sleep` family and `print` are.
 * These are the ones that had none, so `random.randint(1, 6)` and `min(a, b)`
 * were blocks a child could drag out of this drawer and never get back.
 *
 * `snakie_math_min_max` IS ONE BLOCK WITH A DROPDOWN, so it is two rules with
 * the field fixed — which is the whole reason `CallRule.fields` exists. Without
 * it the reader could only ever have produced one of the two.
 *
 * `snakie_map_range` has no rule on purpose: it writes arithmetic, not a call,
 * and the expression parser already reads that arithmetic back as the nest of
 * `math_arithmetic` blocks it literally is. A rule would have to pattern-match a
 * five-socket expression to claim it, and being wrong about that would rewrite
 * somebody's formula.
 */
registerCallRules([
  ...MATHS_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : [])),
  {
    fn: 'min',
    type: 'snakie_math_min_max',
    args: ['A', 'B'],
    shape: 'value',
    fields: { OP: 'MIN' },
    checks: { A: 'Number', B: 'Number' }
  },
  {
    fn: 'max',
    type: 'snakie_math_min_max',
    args: ['A', 'B'],
    shape: 'value',
    fields: { OP: 'MAX' },
    checks: { A: 'Number', B: 'Number' }
  }
])
