import { Order } from '../generator'
import type { BlockDefinition } from '../registry'
import { registerCallRules } from '../python-to-blocks'

/**
 * LISTS (#1011, epic #1007).
 * =============================================================================
 *
 * Make one, add to it, read and write a position, and how long it is. That is the whole of what a first robot program needs a
 * list for: a set of poses to play, a handful of readings to average, the pins a
 * row of LEDs is on.
 *
 * MEMBERSHIP MOVED OUT (#1128). `v in xs` used to live here with a `check: 'Array'`
 * haystack, which is the block refusing by its shape to answer `"c" in text` or
 * `key in config`. It is one general block in Logic now — see `logic.ts`.
 *
 * ONE-BASED ON THE BLOCK, ZERO-BASED IN THE CODE. Blockly's index blocks count
 * from 1, and Python counts from 0. This is a genuine fork in the road and the
 * choice here is to keep Blockly's wording and generate the `- 1`: a learner
 * meeting `items[n - 1]` in the mirror is meeting the off-by-one honestly, at
 * the moment they can see both sides of it. Silently renumbering the block face
 * would spare them today and ambush them the first time they write `items[1]`
 * in text and get the second thing.
 *
 * `append`, `get`, `set` AS OUR OWN BLOCKS. Blockly's `lists_getIndex` and
 * `lists_setIndex` carry dropdowns for FIRST/LAST/RANDOM/FROM-END and a
 * GET/GET-AND-REMOVE/REMOVE mode — nine combinations, most of which generate
 * Python a beginner has no use for. Three plain blocks say what they do.
 *
 * TRIMMED: sort, reverse, split, sublist, repeat and index-of are registered
 * nowhere, for the same reason as the text-processing blocks.
 */
export const LIST_BLOCKS: BlockDefinition[] = [
  {
    type: 'lists_create_with',
    category: 'lists',
    help: 'ref-types',
    code: (block, gen) => {
      const n = Number(block.getFieldValue('ITEMS') ?? 0) || countItems(block)
      const items: string[] = []
      for (let i = 0; i < n; i++)
        items.push(gen.valueToCode(block, `ADD${i}`, Order.NONE) || 'None')
      return [`[${items.join(', ')}]`, Order.ATOMIC]
    }
  },
  {
    type: 'lists_length',
    category: 'lists',
    help: 'ref-builtins',
    code: (block, gen) => [
      `len(${gen.valueToCode(block, 'VALUE', Order.NONE) || '[]'})`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_list_append',
    category: 'lists',
    help: 'ref-types',
    // A METHOD ON WHATEVER THE LEARNER CALLED THEIR LIST (#1089). Not a module
    // and not an object the generator hoisted, so the receiver is a socket —
    // see `CallRule.on`. 403 raw lines across 28 projects before this.
    read: {
      fn: 'append',
      on: 'LIST',
      args: ['ITEM'],
      shape: 'statement',
      checks: { LIST: 'Array' }
    },
    json: {
      message0: 'add %1 to %2',
      args0: [
        { type: 'input_value', name: 'ITEM' },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Put a value on the end of a list.'
    },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      const item = gen.valueToCode(block, 'ITEM', Order.NONE) || 'None'
      return `${list}.append(${item})\n`
    }
  },
  {
    type: 'snakie_list_get',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'item %1 of %2',
      args0: [
        { type: 'input_value', name: 'INDEX', check: 'Number' },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      output: null,
      tooltip: 'Read one value out of a list. The first item is number 1.'
    },
    toolbox: { inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      return [
        `${list}[${zeroBased(gen.valueToCode(block, 'INDEX', Order.ADDITIVE))}]`,
        Order.MEMBER
      ]
    }
  },
  {
    type: 'snakie_list_set',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'set item %1 of %2 to %3',
      args0: [
        { type: 'input_value', name: 'INDEX', check: 'Number' },
        { type: 'input_value', name: 'LIST', check: 'Array' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Replace one value in a list. The first item is number 1.'
    },
    toolbox: { inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      const index = zeroBased(gen.valueToCode(block, 'INDEX', Order.ADDITIVE))
      const value = gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'
      return `${list}[${index}] = ${value}\n`
    }
  }

]

/**
 * A 1-based index from a block as a 0-based one for Python.
 *
 * A literal is arithmetic'd down at generation time — `items[0]`, not
 * `items[1 - 1]`, because nobody writes the second one. Anything else keeps the
 * `- 1` visible, which is where a learner meets the off-by-one with the block
 * that caused it still on screen beside it.
 */
function zeroBased(index: string): string {
  const code = index || '1'
  if (/^-?\d+$/.test(code)) return String(Number(code) - 1)
  return `${code} - 1`
}

/** How many sockets the mutator has actually given this block. */
function countItems(block: { getInput(name: string): unknown }): number {
  let n = 0
  while (block.getInput(`ADD${n}`)) n++
  return n
}

/**
 * How these blocks read BACK out of Python (W2, #1089, epic #1086).
 *
 * `registerCallRules` has been the extension point since #1019 and only
 * `hardware.ts` and `turtle.ts` ever called it — so every block in this drawer
 * was one a child could drag out, save, reopen, and find grey. That asymmetry is
 * a bug in its own right, and closing it for the whole palette is the real
 * deliverable of W2.
 *
 * Derived from the block list rather than written out again, exactly as
 * `turtle.ts` does it: a block that changes the call it writes changes both
 * sides at once, or neither.
 *
 * THE THREE THAT ARE NOT CALLS are read by the expression parser instead, and
 * `test/blocksPaletteSymmetry.test.ts` holds them to it: `xs[i]` and
 * `xs[i] = v` are subscripts, and `v in xs` is an operator. `lists_length` has
 * no rule of its own on purpose — `len(xs)` is already read as `text_length`,
 * and one line of Python cannot be two blocks.
 */
registerCallRules(
  LIST_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : []))
)
