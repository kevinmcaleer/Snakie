import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * LOGIC (#1011, epic #1007).
 * =============================================================================
 *
 * Comparison, `and`/`or`/`not`, `True`/`False`, `None`. All Blockly's own blocks
 * except the `is None` test, which Python has and Blockly doesn't.
 *
 * TRIMMED: `logic_ternary` (`if x then a else b` as a VALUE) is registered
 * nowhere. It generates a conditional expression, which is a fine thing to know
 * and a terrible thing to meet before you have met `if` — and a learner who
 * wants it can nest an `if` block, which is what they will do in text anyway.
 */
export const LOGIC_BLOCKS: BlockDefinition[] = [
  {
    type: 'logic_compare',
    category: 'logic',
    help: 'ref-types',
    code: (block, gen) => {
      const op = COMPARISONS[block.getFieldValue('OP')] ?? '=='
      const a = gen.valueToCode(block, 'A', Order.RELATIONAL) || '0'
      const b = gen.valueToCode(block, 'B', Order.RELATIONAL) || '0'
      return [`${a} ${op} ${b}`, Order.RELATIONAL]
    }
  },
  {
    type: 'logic_operation',
    category: 'logic',
    help: 'ref-types',
    code: (block, gen) => {
      const and = block.getFieldValue('OP') === 'AND'
      const order = and ? Order.LOGICAL_AND : Order.LOGICAL_OR
      // `True`/`False` as the neutral element, so an empty socket produces a
      // line that still means what the block looks like it means.
      const a = gen.valueToCode(block, 'A', order) || (and ? 'True' : 'False')
      const b = gen.valueToCode(block, 'B', order) || (and ? 'True' : 'False')
      return [`${a} ${and ? 'and' : 'or'} ${b}`, order]
    }
  },
  {
    type: 'logic_negate',
    category: 'logic',
    help: 'ref-types',
    code: (block, gen) => [
      `not ${gen.valueToCode(block, 'BOOL', Order.LOGICAL_NOT) || 'True'}`,
      Order.LOGICAL_NOT
    ]
  },
  {
    type: 'logic_boolean',
    category: 'logic',
    help: 'ref-types',
    code: (block) => [block.getFieldValue('BOOL') === 'TRUE' ? 'True' : 'False', Order.ATOMIC]
  },
  {
    type: 'logic_null',
    category: 'logic',
    help: 'ref-types',
    code: () => ['None', Order.ATOMIC]
  },
  {
    type: 'snakie_is_none',
    category: 'logic',
    help: 'ref-types',
    json: {
      message0: '%1 is nothing',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      inputsInline: true,
      output: 'Boolean',
      // "is nothing" rather than "is None" on the block face: the block says
      // what it MEANS and the generated line says `is None`, which is the
      // translation the mirror is there to make.
      tooltip:
        'True when the value is None — "nothing". Sensors return None when they have no reading yet.'
    },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'VALUE', Order.RELATIONAL) || 'None'} is None`,
      Order.RELATIONAL
    ]
  }
]

/** Blockly's operator field values, as Python writes them. */
const COMPARISONS: Record<string, string> = {
  EQ: '==',
  NEQ: '!=',
  LT: '<',
  LTE: '<=',
  GT: '>',
  GTE: '>='
}
