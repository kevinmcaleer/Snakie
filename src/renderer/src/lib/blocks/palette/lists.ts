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
    // READING ONE THING OUT IS NOT A LIST QUESTION (widened by #1124, epic
    // #1119). The socket checked `Array`, so `'hello'[0]` — one letter out of a
    // piece of text, which is the same line — was refused by the shape of the
    // block, and a `letter %N of %TEXT` block beside it would have been two
    // blocks writing `s[n - 1]`. The check comes off instead, which is the
    // answer #1128 gave for `in` and #1123 gave for every slice socket.
    //
    // `set item` KEEPS ITS CHECK, and the asymmetry is the point: a string
    // cannot be written to. `s[0] = 'x'` is a TypeError, and a socket that
    // accepted it would be teaching one.
    type: 'snakie_list_get',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'item %1 of %2',
      args0: [
        { type: 'input_value', name: 'INDEX', check: 'Number' },
        { type: 'input_value', name: 'LIST' }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'Read one value out of a list, or one letter out of a piece of text. The first item is number 1.'
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
  },
  // -------------------------------------------------------------------------
  // THE VERBS (#1122, epic #1119).
  //
  // The drawer was six blocks, and its own header said why and what it cost:
  // *"TRIMMED: sort, reverse, split, sublist, repeat and index-of"*. That was
  // the right call for #1007's "make a robot do something" palette; #1119
  // re-opened it for the handful that are not a text-processing library but the
  // ordinary verbs of a list. **You could not take something OUT of a list in
  // blocks at all.**
  //
  // ONE-BASED ON THE BLOCK, ZERO-BASED IN THE CODE — the same promise the
  // drawer has made since #1011, kept by every one of these or the drawer would
  // contradict itself. `insert`, `pop` and the two removes all write the `- 1`
  // out, and the reader undoes exactly that (see `CallRule.oneBased`).
  //
  // `split` AND `join` ARE NOT HERE: they are text, and #1124's drawer has
  // them. Nor is `sublist`, which is #1123's slice.
  // -------------------------------------------------------------------------
  {
    type: 'snakie_list_insert',
    category: 'lists',
    help: 'ref-types',
    read: {
      fn: 'insert',
      on: 'LIST',
      args: ['INDEX', 'ITEM'],
      shape: 'statement',
      oneBased: ['INDEX'],
      checks: { LIST: 'Array' }
    },
    json: {
      message0: 'insert %1 at %2 in %3',
      args0: [
        { type: 'input_value', name: 'ITEM' },
        { type: 'input_value', name: 'INDEX', check: 'Number' },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Put a value into the middle of a list, pushing the rest along. Position 1 puts it at the front.'
    },
    toolbox: { inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      const index = zeroBased(gen.valueToCode(block, 'INDEX', Order.ADDITIVE))
      const item = gen.valueToCode(block, 'ITEM', Order.NONE) || 'None'
      return `${list}.insert(${index}, ${item})\n`
    }
  },
  {
    type: 'snakie_list_remove',
    category: 'lists',
    help: 'ref-types',
    read: {
      fn: 'remove',
      on: 'LIST',
      args: ['ITEM'],
      shape: 'statement',
      checks: { LIST: 'Array' }
    },
    json: {
      message0: 'remove %1 from %2',
      args0: [
        { type: 'input_value', name: 'ITEM' },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Take the FIRST matching value out of a list. If it is not in there the program stops, so check with "is in" first when you are not sure.'
    },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      return `${list}.remove(${gen.valueToCode(block, 'ITEM', Order.NONE) || 'None'})\n`
    }
  },
  {
    // TAKING ONE OUT BY POSITION HAS NO METHOD — `del` is the only way to do it
    // without also being handed the value back, which is what `pop` is for and
    // is a different block below.
    type: 'snakie_list_remove_at',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: 'remove thing %1 from %2',
      args0: [
        { type: 'input_value', name: 'INDEX', check: 'Number' },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Take one value out of a list by where it is. The first thing is number 1.'
    },
    toolbox: { inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      return `del ${list}[${zeroBased(gen.valueToCode(block, 'INDEX', Order.ADDITIVE))}]\n`
    }
  },
  {
    type: 'snakie_list_pop',
    category: 'lists',
    help: 'ref-types',
    read: {
      fn: 'pop',
      on: 'LIST',
      args: ['INDEX'],
      shape: 'value',
      oneBased: ['INDEX'],
      checks: { LIST: 'Array' }
    },
    json: {
      message0: 'take thing %1 out of %2',
      args0: [
        { type: 'input_value', name: 'INDEX', check: 'Number' },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'Take one value out of a list AND hand it back, so you can use it. The first thing is number 1.'
    },
    toolbox: { inputs: { INDEX: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      return [
        `${list}.pop(${zeroBased(gen.valueToCode(block, 'INDEX', Order.ADDITIVE))})`,
        Order.FUNCTION_CALL
      ]
    }
  },
  {
    // THE OFF-BY-ONE IS ON THE BLOCK, as it is on #1121's position loop. The
    // 1-based face has to write `xs.index(item) + 1`, which is arithmetic
    // around a call — so a plain rule cannot read it and a block with only one
    // answer could not round-trip the other. The setting gives both forms a
    // block and each regenerates as itself.
    type: 'snakie_list_index',
    category: 'lists',
    help: 'ref-types',
    read: {
      fn: 'index',
      on: 'LIST',
      args: ['ITEM'],
      shape: 'value',
      fields: { START: 'ZERO' },
      checks: { LIST: 'Array' }
    },
    json: {
      message0: 'where %1 is in %2 %3',
      args0: [
        { type: 'input_value', name: 'ITEM' },
        { type: 'input_value', name: 'LIST', check: 'Array' },
        {
          type: 'field_dropdown',
          name: 'START',
          options: [
            ['(first is 1)', 'ONE'],
            ['(first is 0)', 'ZERO']
          ]
        }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Where a value sits in a list. Leave it on "first is 1" and the number matches the rest of this drawer. If the value is not in the list at all the program stops.'
    },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      const item = gen.valueToCode(block, 'ITEM', Order.NONE) || 'None'
      const call = `${list}.index(${item})`
      if (block.getFieldValue('START') === 'ZERO') return [call, Order.FUNCTION_CALL]
      return [`${call} + 1`, Order.ADDITIVE]
    }
  },
  {
    type: 'snakie_list_count',
    category: 'lists',
    help: 'ref-types',
    read: {
      fn: 'count',
      on: 'LIST',
      args: ['ITEM'],
      shape: 'value',
      checks: { LIST: 'Array' }
    },
    json: {
      message0: 'how many %1 in %2',
      args0: [
        { type: 'input_value', name: 'ITEM' },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip: 'How many times a value appears in a list. Zero when it is not there at all.'
    },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      return [
        `${list}.count(${gen.valueToCode(block, 'ITEM', Order.NONE) || 'None'})`,
        Order.FUNCTION_CALL
      ]
    }
  },
  {
    // THREE THINGS DONE TO A LIST IN PLACE, one block. They are the same
    // sentence with one word changed — the argument `snakie_cast` makes — and
    // all three return `None`, which is why none of them may be a value block:
    // a learner who plugged `xs.sort()` into a socket would get nothing, with
    // no error to explain it.
    type: 'snakie_list_modify',
    category: 'lists',
    help: 'ref-types',
    json: {
      message0: '%1 %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['sort', 'sort'],
            ['reverse', 'reverse'],
            ['empty', 'clear']
          ]
        },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Change a list where it stands: put it in order, turn it round, or throw everything out of it. The list itself changes — nothing is handed back.'
    },
    code: (block, gen) => {
      const list = gen.valueToCode(block, 'LIST', Order.MEMBER) || '[]'
      return `${list}.${String(block.getFieldValue('OP') ?? 'sort')}()\n`
    }
  },
  {
    // A SORTED COPY IS A DIFFERENT STATEMENT from sorting in place, which is
    // why it is a different block: `xs.sort()` returns `None` and `sorted(xs)`
    // returns a new list. One is a statement and one is a value, and Blockly
    // blocks are one or the other.
    type: 'snakie_list_sorted',
    category: 'lists',
    help: 'ref-builtins',
    read: { fn: 'sorted', args: ['LIST'], shape: 'value', checks: { LIST: 'Array' } },
    json: {
      message0: 'sorted copy of %1',
      args0: [{ type: 'input_value', name: 'LIST', check: 'Array' }],
      inputsInline: true,
      output: 'Array',
      tooltip: 'A new list with the same things in order. The original is left alone.'
    },
    code: (block, gen) => [
      `sorted(${gen.valueToCode(block, 'LIST', Order.NONE) || '[]'})`,
      Order.FUNCTION_CALL
    ]
  },
  {
    // AVERAGE THESE FIVE READINGS is the single most common list job in a
    // sensor program, and none of its three pieces had a block:
    // `snakie_math_min_max` takes two NUMBERS, not a list.
    type: 'snakie_list_aggregate',
    category: 'lists',
    help: 'ref-builtins',
    json: {
      message0: '%1 of %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['total', 'sum'],
            ['smallest', 'min'],
            ['biggest', 'max']
          ]
        },
        { type: 'input_value', name: 'LIST', check: 'Array' }
      ],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'Add a list of numbers up, or find the smallest or biggest in it. Divide the total by the length to average some readings.'
    },
    code: (block, gen) => [
      `${String(block.getFieldValue('OP') ?? 'sum')}(${
        gen.valueToCode(block, 'LIST', Order.NONE) || '[]'
      })`,
      Order.FUNCTION_CALL
    ]
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
registerCallRules([
  ...LIST_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : [])),
  // ONE BLOCK WITH A DROPDOWN IS SEVERAL RULES (#1122), which is the whole
  // reason `CallRule.fields` exists — `snakie_math_min_max` has done it since
  // W2. Without them the reader could only ever have produced one option.
  ...(['sort', 'reverse', 'clear'] as const).map((op) => ({
    fn: op,
    type: 'snakie_list_modify',
    on: 'LIST',
    args: [] as const,
    shape: 'statement' as const,
    fields: { OP: op },
    checks: { LIST: 'Array' as const }
  })),
  // `min(xs)` AND `min(a, b)` ARE DIFFERENT BLOCKS, and arity is what keeps
  // them apart: `buildCall` refuses a rule whose argument count does not line
  // up, so the one-argument form lands here and the two-argument form stays
  // with the Maths drawer's block.
  ...(['sum', 'min', 'max'] as const).map((op) => ({
    fn: op,
    type: 'snakie_list_aggregate',
    args: ['LIST'],
    shape: 'value' as const,
    fields: { OP: op },
    checks: { LIST: 'Array' as const }
  }))
])
