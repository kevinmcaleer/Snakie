import { Order } from '../generator'
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
    toolbox: {
      inputs: {
        A: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
        B: { shadow: { type: 'math_number', fields: { NUM: 1 } } }
      }
    },
    code: (block, gen) => {
      const [op, order] = ARITHMETIC[block.getFieldValue('OP')] ?? ['+', Order.ADDITIVE]
      const a = gen.valueToCode(block, 'A', order) || '0'
      const b = gen.valueToCode(block, 'B', order) || '0'
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
      const a = gen.valueToCode(block, 'DIVIDEND', Order.MULTIPLICATIVE) || '0'
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
  }
]

/** Blockly's arithmetic ops, with the Python operator and its precedence. */
const ARITHMETIC: Record<string, [string, number]> = {
  ADD: ['+', Order.ADDITIVE],
  MINUS: ['-', Order.ADDITIVE],
  MULTIPLY: ['*', Order.MULTIPLICATIVE],
  DIVIDE: ['/', Order.MULTIPLICATIVE],
  POWER: ['**', Order.EXPONENTIATION]
}
