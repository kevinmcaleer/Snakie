import * as Blockly from 'blockly/core'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import type { BlockDefinition } from '../registry'
import { growableMixin, itemCount } from './growable'

/**
 * TUPLES, UNPACKING AND MULTI-VALUE LOOPS (#1121, epic #1119).
 * =============================================================================
 *
 * Nothing in the palette made or took apart a tuple, and four separate things
 * were missing because of it:
 *
 *  - **no tuple literal.** `lists_create_with` writes `[…]`; there was no `(…)`,
 *    so a function that wants to hand back an `(x, y)` could not say so;
 *  - **unpacking was hidden.** `snakie_python_assign` reads `a, b = f()` and is
 *    registered `hidden: true` — the reader could produce it and a learner
 *    could not drag it;
 *  - **tuple loop targets did not exist.** `docs/blocks-coverage-epic.md` §10
 *    lists `for name, value in rows:` among the lines still grey: *"a tuple loop
 *    target, which `controls_forEach` cannot hold"*;
 *  - **no `enumerate`, no `zip`.** "Loop over the list and know which position
 *    I'm at" is a first-week question whose answer was a counter maintained by
 *    hand.
 *
 * TWO NAMES, NOT N. The loop blocks take exactly two targets, which covers
 * `.items()`, `enumerate` and `zip` — the whole of why they are being built. A
 * three-target loop is rare enough that the escape hatch is the right answer
 * until somebody asks.
 *
 * `snakie_python_assign` IS SUPERSEDED, NOT UN-HIDDEN. It stays registered and
 * stays hidden, and keeps everything `set … and … to` cannot hold: three names
 * or more, an attribute target (`self.x, self.y = 0, 0`), a chained assignment,
 * a starred target. A learner gets the friendly block; the reader keeps the
 * exact one. That is §4.5's "one field flips it" answered deliberately rather
 * than by default.
 *
 * NAMES ARE BLOCKLY VARIABLES, the way `controls_forEach`'s already is, so a
 * rename works everywhere it already works. (Contrast `self` in
 * `docs/blocks-coverage-epic.md` §4.3, which is emphatically not a variable.)
 */

/** The tuple literal's block type — its shape is built in code, so it is named. */
export const TUPLE_BLOCK = 'snakie_tuple'

/** A statement input's body, or `pass` — an empty loop is a syntax error. */
function body(block: Blockly.Block, name: string, gen: MicroPythonGenerator): string {
  return gen.statementToCode(block, name) || `${gen.INDENT}pass\n`
}

export const TUPLE_BLOCKS: BlockDefinition[] = [
  {
    // A TUPLE IS NOT A LIST WITH DIFFERENT BRACKETS, and the block says so in
    // the only way a block can: its own word. What a learner needs to know on
    // the day they meet one is that it is the shape a function hands back when
    // it has two answers — `(x, y)`, `(name, value)` — and that it does not
    // change afterwards.
    type: TUPLE_BLOCK,
    category: 'lists',
    help: 'ref-types',
    // TWO SOCKETS ON ARRIVAL, because a one-item tuple is a curiosity and a
    // zero-item one is almost never what somebody dragged this out for.
    toolbox: { extraState: { items: 2 } },
    code: (block, gen) => {
      const n = itemCount(block)
      const items: string[] = []
      for (let i = 0; i < n; i++) items.push(gen.valueToCode(block, `ADD${i}`, Order.NONE) || 'None')
      // A ONE-ITEM TUPLE NEEDS ITS COMMA. `(x)` is just `x` in brackets, and a
      // block that said "tuple" and generated a bare value would be lying about
      // what it made — which matters, because `(x,)` is exactly what a driver
      // that wants a one-element buffer is asking for.
      if (items.length === 1) return [`(${items[0]},)`, Order.ATOMIC]
      return [`(${items.join(', ')})`, Order.ATOMIC]
    }
  },
  {
    // UNPACKING, WITH THE NAMES AS VARIABLES (#1121). `snakie_python_assign`
    // holds its target as TEXT, which is right for the shapes it keeps and
    // wrong for the common one: a learner typing `x, y` into a text field can
    // write `x, y ` or `x,y` or `my x, y`, and none of those follows a rename.
    type: 'snakie_unpack',
    category: 'variables',
    help: 'ref-types',
    json: {
      message0: 'set %1 and %2 to %3',
      args0: [
        { type: 'field_variable', name: 'VAR_A', variable: 'x' },
        { type: 'field_variable', name: 'VAR_B', variable: 'y' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Take apart something with two things in it and put each into its own variable. A function that gives back an (x, y) is unpacked like this.'
    },
    code: (block, gen) => {
      const a = gen.variableName(block.getFieldValue('VAR_A'))
      const b = gen.variableName(block.getFieldValue('VAR_B'))
      return `${a}, ${b} = ${gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'}\n`
    }
  },
  {
    type: 'snakie_for_each_two',
    category: 'control',
    help: 'ref-flow',
    json: {
      message0: 'for each %1 and %2 in %3',
      args0: [
        { type: 'field_variable', name: 'VAR_A', variable: 'key' },
        { type: 'field_variable', name: 'VAR_B', variable: 'value' },
        { type: 'input_value', name: 'SEQ' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Go through something whose items each hold two things, and name both. This is how a dictionary’s items() is looped over.'
    },
    code: (block, gen) => {
      const a = gen.variableName(block.getFieldValue('VAR_A'))
      const b = gen.variableName(block.getFieldValue('VAR_B'))
      const seq = gen.valueToCode(block, 'SEQ', Order.NONE) || '[]'
      return `for ${a}, ${b} in ${seq}:\n${body(block, 'DO', gen)}`
    }
  },
  {
    // THE OFF-BY-ONE IS A SETTING, NOT A SECRET (#1121).
    //
    // `enumerate(xs)` counts from 0 and the Lists drawer counts from 1, and a
    // block that quietly picked one would trap the learner who used its number
    // in `item n of xs`. The dropdown puts both on the block, defaults to the
    // one this palette already promises, and generates the `, 1` that says so
    // — which is the same choice `lists.ts` made when it decided to write the
    // `- 1` out rather than renumber silently.
    type: 'snakie_for_each_indexed',
    category: 'control',
    help: 'ref-flow',
    json: {
      message0: 'for each %1 at position %2 %3 in %4',
      args0: [
        { type: 'field_variable', name: 'VAR_ITEM', variable: 'item' },
        { type: 'field_variable', name: 'VAR_INDEX', variable: 'position' },
        {
          type: 'field_dropdown',
          name: 'START',
          options: [
            ['(first is 1)', 'ONE'],
            ['(first is 0)', 'ZERO']
          ]
        },
        { type: 'input_value', name: 'LIST' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Go through a list and know where you are. Leave it on "first is 1" and the position matches the Lists drawer; Python is told so with enumerate(xs, 1).'
    },
    code: (block, gen) => {
      const item = gen.variableName(block.getFieldValue('VAR_ITEM'))
      const index = gen.variableName(block.getFieldValue('VAR_INDEX'))
      const list = gen.valueToCode(block, 'LIST', Order.NONE) || '[]'
      const from = block.getFieldValue('START') === 'ZERO' ? '' : ', 1'
      return `for ${index}, ${item} in enumerate(${list}${from}):\n${body(block, 'DO', gen)}`
    }
  },
  {
    type: 'snakie_for_each_zip',
    category: 'control',
    help: 'ref-flow',
    json: {
      message0: 'for each %1 and %2 in %3 and %4',
      args0: [
        { type: 'field_variable', name: 'VAR_A', variable: 'a' },
        { type: 'field_variable', name: 'VAR_B', variable: 'b' },
        { type: 'input_value', name: 'LIST_A' },
        { type: 'input_value', name: 'LIST_B' }
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Go through two lists side by side, taking one from each. Python writes it zip(a, b); it stops when the shorter one runs out.'
    },
    code: (block, gen) => {
      const a = gen.variableName(block.getFieldValue('VAR_A'))
      const b = gen.variableName(block.getFieldValue('VAR_B'))
      const first = gen.valueToCode(block, 'LIST_A', Order.NONE) || '[]'
      const second = gen.valueToCode(block, 'LIST_B', Order.NONE) || '[]'
      return `for ${a}, ${b} in zip(${first}, ${second}):\n${body(block, 'DO', gen)}`
    }
  }
]

/** Register the tuple literal, whose sockets come and go. */
export function installTupleBlocks(): void {
  Blockly.Blocks[TUPLE_BLOCK] = growableMixin({
    style: 'lists_blocks',
    head: 'tuple of',
    defaults: 2,
    first: '',
    separator: 'and',
    noun: 'thing',
    value: true,
    tooltip:
      'A handful of values kept together and not changed afterwards — the shape a function uses to give back two answers at once, like (x, y).'
  }) as never
}
