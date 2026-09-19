import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * SLICING (#1123, epic #1119).
 * =============================================================================
 *
 * There was no slice block, for a list or for a string. A learner could read
 * ONE thing out of a list (`snakie_list_get`) and that was all — "the last
 * reading", "the first three", "everything after the header byte" and "the
 * string backwards" were `snakie_python_value` text.
 *
 * It matters more on a microcontroller than the block count suggests, because
 * slicing is how you handle a buffer: `buf[1:]`, `data[:2]`.
 *
 * NO `Array` CHECK ON ANY SOCKET HERE, and that is the load-bearing decision.
 * `"EDCDEEE"[::-1]` is a real thing one of the music examples does, and #1087
 * already found that an over-tight `Array` check does not refuse one socket —
 * it refuses the whole workspace, and the learner loses every block in the
 * file. One set of blocks for lists, strings and buffers alike.
 *
 * ONE SET, IN LISTS, rather than a worded copy in Text. Blockly allows a block
 * in one category only, so the choice was one block or two — and two would be
 * two blocks generating one line, which #1128 has just spent an issue
 * establishing as the outcome to avoid. The wording says "things" rather than
 * "items", so it reads for a string as well as for a list, and `ref-types`
 * carries the examples for both.
 *
 * ONE-BASED, AGAIN. `from 2 to 4` generates `seq[1:4]` — the drawer's existing
 * promise, and the off-by-one is written out in the tooltip the way `lists.ts`
 * writes out its own.
 *
 * `last %N` IS A SEPARATE BLOCK rather than a negative number in the general
 * one, so that nobody has to discover that `-1` means "from the end".
 */
export const SLICE_BLOCKS: BlockDefinition[] = [
  {
    type: 'snakie_slice_range',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: '%1 from %2 to %3',
      args0: [
        { type: 'input_value', name: 'SEQ' },
        { type: 'input_value', name: 'FROM', check: 'Number' },
        { type: 'input_value', name: 'TO', check: 'Number' }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'A piece out of the middle of a list, a piece of text or a buffer. "from 2 to 4" gives you the 2nd, 3rd and 4th things — both ends included.'
    },
    toolbox: {
      inputs: {
        FROM: { shadow: { type: 'math_number', fields: { NUM: 2 } } },
        TO: { shadow: { type: 'math_number', fields: { NUM: 4 } } }
      }
    },
    code: (block, gen) => {
      const seq = gen.valueToCode(block, 'SEQ', Order.MEMBER) || '[]'
      const from = zeroBased(gen.valueToCode(block, 'FROM', Order.ADDITIVE))
      const to = gen.valueToCode(block, 'TO', Order.ADDITIVE) || ''
      return [`${seq}[${from}:${to}]`, Order.MEMBER]
    }
  },
  {
    type: 'snakie_slice_first',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'first %1 of %2',
      args0: [
        { type: 'input_value', name: 'N', check: 'Number' },
        { type: 'input_value', name: 'SEQ' }
      ],
      inputsInline: true,
      output: null,
      tooltip: 'The first few things. Asking for more than there are gives you all of them.'
    },
    toolbox: { inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 3 } } } } },
    code: (block, gen) => {
      const seq = gen.valueToCode(block, 'SEQ', Order.MEMBER) || '[]'
      return [`${seq}[:${gen.valueToCode(block, 'N', Order.ADDITIVE) || '0'}]`, Order.MEMBER]
    }
  },
  {
    type: 'snakie_slice_last',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'last %1 of %2',
      args0: [
        { type: 'input_value', name: 'N', check: 'Number' },
        { type: 'input_value', name: 'SEQ' }
      ],
      inputsInline: true,
      output: null,
      tooltip: 'The last few things. Python writes it with a minus — seq[-3:].'
    },
    toolbox: { inputs: { N: { shadow: { type: 'math_number', fields: { NUM: 3 } } } } },
    code: (block, gen) => {
      const seq = gen.valueToCode(block, 'SEQ', Order.MEMBER) || '[]'
      return [`${seq}[-${negatable(gen.valueToCode(block, 'N', Order.UNARY_SIGN))}:]`, Order.MEMBER]
    }
  },
  {
    type: 'snakie_last_item',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'last thing in %1',
      args0: [{ type: 'input_value', name: 'SEQ' }],
      inputsInline: true,
      output: null,
      tooltip:
        'The one at the end — the newest reading, the final letter. Python writes it seq[-1], counting backwards from the end.'
    },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'SEQ', Order.MEMBER) || '[]'}[-1]`,
      Order.MEMBER
    ]
  },
  {
    // A COPY IS NOT THE SAME LIST, which is the lesson this block exists to
    // teach: two names for one list is the commonest surprise in a first
    // program that passes one to a function.
    type: 'snakie_slice_copy',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'copy of %1',
      args0: [{ type: 'input_value', name: 'SEQ' }],
      inputsInline: true,
      output: null,
      tooltip:
        'A new list with the same things in it. Changing the copy leaves the original alone — which just assigning it to another name does not.'
    },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'SEQ', Order.MEMBER) || '[]'}[:]`,
      Order.MEMBER
    ]
  },
  {
    type: 'snakie_slice_reverse',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: '%1 backwards',
      args0: [{ type: 'input_value', name: 'SEQ' }],
      inputsInline: true,
      output: null,
      tooltip:
        'A new list or piece of text with everything the other way round. The original is left alone — "reverse" in this drawer changes it in place instead.'
    },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'SEQ', Order.MEMBER) || '[]'}[::-1]`,
      Order.MEMBER
    ]
  }
]

/**
 * A 1-based start as a 0-based one. The same rule and the same reasoning as
 * `lists.ts`'s own — a literal is arithmetic'd down, anything else keeps the
 * `- 1` visible.
 */
function zeroBased(index: string): string {
  const code = index || '1'
  if (/^-?\d+$/.test(code)) return String(Number(code) - 1)
  return `${code} - 1`
}

/**
 * `n` as something a minus sign can go in front of.
 *
 * `seq[-n:]` is right for a number or a name and WRONG for `seq[-a + b:]`,
 * which Python reads as `(-a) + b`. Anything that is not one token gets
 * brackets, so the block means what it says whatever is plugged into it.
 */
function negatable(code: string): string {
  const n = code || '0'
  return /^[A-Za-z_]\w*$/.test(n) || /^\d+(\.\d+)?$/.test(n) ? n : `(${n})`
}
