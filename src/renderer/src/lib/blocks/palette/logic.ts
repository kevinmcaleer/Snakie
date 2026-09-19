import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * LOGIC (#1011, epic #1007; widened by #1128, epic #1119).
 * =============================================================================
 *
 * Comparison, `and`/`or`/`not`, `True`/`False`, `None`, and the three tests
 * Python has that Blockly does not: `is None`, `is` / `is not`, and `in`.
 *
 * MEMBERSHIP LIVES HERE NOW, not in Lists. `v in xs` was a Lists block with an
 * `Array`-checked haystack, which meant `"c" in text`, `key in config` and
 * `byte in buf` had no block at all — #1086 measured `in`/`not in` at 214 lines
 * across 31 of 73 projects, and almost none of it is a list. One block, no
 * check, in the drawer where every other Boolean test already is.
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
      message0: '%1 %2 nothing',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        {
          // `is not None` IS ITS OWN OPERATOR (#1128), for the reason the
          // membership block below gives: a `logic_negate` around this block
          // writes `not x is None`, which is the same test and a different
          // line. "Has this been set up yet?" is the commonest guard in a
          // program that builds an object lazily, and it had no block at all.
          //
          // A block saved before this field existed has no `MODE` and gets the
          // first option, which is what it always meant.
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['is', 'IS'],
            ['is not', 'IS_NOT']
          ]
        }
      ],
      inputsInline: true,
      output: 'Boolean',
      // "is nothing" rather than "is None" on the block face: the block says
      // what it MEANS and the generated line says `is None`, which is the
      // translation the mirror is there to make.
      tooltip:
        'True when the value is None — "nothing". Sensors return None when they have no reading yet; set "is not" to ask whether something has a value.'
    },
    code: (block, gen) => {
      const op = block.getFieldValue('MODE') === 'IS_NOT' ? 'is not' : 'is'
      const value = gen.valueToCode(block, 'VALUE', Order.RELATIONAL) || 'None'
      return [`${value} ${op} None`, Order.RELATIONAL]
    }
  },
  {
    // `is` IS NOT `==`, AND THAT IS THE LESSON (#1128). Half of this was
    // already covered — `snakie_is_none` handles the common case — and the
    // other half, "is this the same object as that one?", had nothing.
    //
    // It is kept as a separate block from `logic_compare` rather than a seventh
    // entry on its dropdown, because a learner who finds `is` sitting beside
    // `=` will reach for it on two numbers, be right by accident, and be wrong
    // later. A block of its own, with a tooltip that says what it asks, is the
    // honest shape.
    type: 'snakie_identity',
    category: 'logic',
    help: 'ref-types',
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A' },
        {
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['is the same thing as', 'IS'],
            ['is not the same thing as', 'IS_NOT']
          ]
        },
        { type: 'input_value', name: 'B' }
      ],
      inputsInline: true,
      output: 'Boolean',
      tooltip:
        'True when both sides are the SAME OBJECT — not merely equal. Two lists with the same things in them are equal and are not the same list. Python writes it `is`.'
    },
    code: (block, gen) => {
      const op = block.getFieldValue('MODE') === 'IS_NOT' ? 'is not' : 'is'
      const a = gen.valueToCode(block, 'A', Order.RELATIONAL) || 'None'
      const b = gen.valueToCode(block, 'B', Order.RELATIONAL) || 'None'
      return [`${a} ${op} ${b}`, Order.RELATIONAL]
    }
  },
  {
    // MEMBERSHIP IS NOT A LIST QUESTION (#1128, epic #1119), which is why this
    // one block now lives in Logic and its haystack checks nothing.
    //
    // It was `check: 'Array'`, and that check was the block REFUSING, by its
    // shape, to answer `"c" in text`, `key in config` or `byte in buf` — three
    // of the commonest guards in device code, each with no block at all as a
    // result. #1086 measured `in`/`not in` at 214 lines across 31 of 73
    // projects; almost none of that is a list.
    //
    // TWO BLOCKS WRITING `a in b` WAS THE OUTCOME TO AVOID, so there is still
    // exactly one, and it kept its TYPE — a workspace saved before this opens
    // unchanged. What moved is the drawer: Logic is where every other Boolean
    // test already lives, and it is equidistant from Lists, Text and
    // Dictionaries, which is the whole of what "general" means here. The
    // Dictionaries drawer (#1120) deliberately ships no `has key` of its own
    // for the same reason.
    type: 'snakie_list_contains',
    category: 'logic',
    help: 'ref-types',
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'ITEM' },
        {
          // `not in` IS ITS OWN OPERATOR, not a `not` around this block (W8,
          // #1095). Wrapping it in `logic_negate` writes `not x in xs`, which is
          // the same test and a different line — and rewriting somebody's line
          // is the one thing the reader does not do. A setting says it exactly.
          //
          // A block saved before this field existed has no `MODE` and gets the
          // first option, which is what it always meant.
          type: 'field_dropdown',
          name: 'MODE',
          options: [
            ['is in', 'IN'],
            ['is not in', 'NOT_IN']
          ]
        },
        // NO CHECK, deliberately — see the note above. #1087 found that an
        // over-tight `Array` check can refuse a whole workspace rather than one
        // socket, and a string, a dictionary and a buffer all answer `in`.
        { type: 'input_value', name: 'LIST' }
      ],
      inputsInline: true,
      output: 'Boolean',
      tooltip:
        'True when the value appears somewhere in a list, a piece of text, a dictionary or a buffer — or, the other way round, when it does not. For a dictionary it asks about the keys.'
    },
    code: (block, gen) => {
      const item = gen.valueToCode(block, 'ITEM', Order.RELATIONAL) || 'None'
      const list = gen.valueToCode(block, 'LIST', Order.RELATIONAL) || '[]'
      const op = block.getFieldValue('MODE') === 'NOT_IN' ? 'not in' : 'in'
      return [`${item} ${op} ${list}`, Order.RELATIONAL]
    }
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
