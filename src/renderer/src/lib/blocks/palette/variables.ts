import { Order } from '../generator'
import type { BlockDefinition } from '../registry'

/**
 * VARIABLES (#1011, epic #1007).
 * =============================================================================
 *
 * Get, set, change by. Blockly's own blocks — the variable field carries the
 * dropdown, the rename and delete flow, and the bookkeeping that keeps every
 * block referring to a renamed variable up to date.
 *
 * THE RENAME PROMPT is the trap. Blockly's rename asks through
 * `Blockly.dialog.prompt`, whose default implementation is `window.prompt` —
 * which Electron's renderer does not implement, so it returns null and the
 * rename silently does nothing. The canvas routes that through the in-app
 * `usePrompt()` modal (#1009, `BlocksCanvas.tsx`), which is what makes these
 * blocks work at all here rather than only in a browser.
 *
 * NAMES are the generator's job: `my score` becomes `my_score`, `class` becomes
 * `class_`, and a variable named after an imported module loses to the module
 * (`names.ts`). A learner never sees an invalid identifier, and never sees the
 * `time` module vanish because they called something `time`.
 */
export const VARIABLE_BLOCKS: BlockDefinition[] = [
  {
    type: 'variables_get',
    category: 'variables',
    help: 'ref-types',
    code: (block, gen) => [gen.variableName(block.getFieldValue('VAR')), Order.ATOMIC]
  },
  {
    type: 'variables_set',
    category: 'variables',
    help: 'ref-types',
    toolbox: { inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } } },
    code: (block, gen) => {
      const name = gen.variableName(block.getFieldValue('VAR'))
      return `${name} = ${gen.valueToCode(block, 'VALUE', Order.NONE) || '0'}\n`
    }
  },
  {
    type: 'math_change',
    category: 'variables',
    help: 'ref-types',
    toolbox: { inputs: { DELTA: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
    code: (block, gen) => {
      const name = gen.variableName(block.getFieldValue('VAR'))
      // `+=` rather than `name = name + delta`: it is what a Python programmer
      // writes, it is shorter to read in the mirror, and it makes the "change
      // BY" on the block face and the code say the same thing.
      return `${name} += ${gen.valueToCode(block, 'DELTA', Order.ADDITIVE) || '0'}\n`
    }
  },
  // ------------------------------------------------- the assignment shapes
  //
  // EVERYTHING `variables_set` CANNOT SAY (W8, #1095, epic #1086). 833 raw lines
  // of tuple assignment across 36 projects, 390 of subscript assignment across
  // 27, and every chained `a = b = 0`. The three of them are one shape — a
  // TARGET that is not a plain name — so they are one block.
  //
  // THE TARGET IS TEXT, and that is the decision. A tuple target is several
  // names at once, a subscript target is an expression with an index in it, and
  // a chained assignment is two targets; modelling any one of them as sockets
  // would model the common case and lose the others. `variables_set` still takes
  // every line that IS a plain name, which is the great majority, so this block
  // is what a learner meets only when the line really is one of these.
  {
    type: 'snakie_python_assign',
    category: 'variables',
    help: 'blocks-python',
    hidden: true,
    json: {
      message0: 'set %1 to %2',
      args0: [
        { type: 'field_input', name: 'TARGET', text: 'a, b' },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Assign to something that is not a plain name — several names at once, a position in a list, or one value into two names.'
    },
    code: (block, gen) => {
      const target = String(block.getFieldValue('TARGET') ?? '').trim()
      if (target === '') return ''
      return `${target} = ${gen.valueToCode(block, 'VALUE', Order.NONE) || 'None'}\n`
    }
  },
  {
    // EVERY OTHER AUGMENTED ASSIGN. `math_change` above is `+=` on a plain name
    // with a NUMBER delta, and it is deliberately that narrow: its DELTA socket
    // checks Number, so `s += "x"` — ordinary string concatenation — built a
    // `text` block into it and made the whole workspace unloadable (#1071).
    //
    // SO THIS BLOCK'S SOCKET CHECKS NOTHING, which is the honest answer: `+=` on
    // a string, a list, a byte array and a number are all the same statement,
    // and a socket that claimed otherwise would be the same bug again.
    type: 'snakie_python_augmented',
    category: 'variables',
    help: 'blocks-python',
    hidden: true,
    json: {
      message0: 'change %1 %2 %3',
      args0: [
        { type: 'field_input', name: 'TARGET', text: 'total' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['by', '+='],
            ['down by', '-='],
            ['times', '*='],
            ['divided by', '/='],
            ['whole-divided by', '//='],
            ['remainder by', '%='],
            ['to the power', '**='],
            ['bitwise and', '&='],
            ['bitwise or', '|='],
            ['bitwise xor', '^='],
            ['shifted left', '<<='],
            ['shifted right', '>>=']
          ]
        },
        { type: 'input_value', name: 'VALUE' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip: 'Change something in place — add to it, multiply it, join onto the end of it.'
    },
    code: (block, gen) => {
      const target = String(block.getFieldValue('TARGET') ?? '').trim()
      const op = String(block.getFieldValue('OP') ?? '+=')
      if (target === '') return ''
      return `${target} ${op} ${gen.valueToCode(block, 'VALUE', Order.NONE) || '0'}\n`
    }
  },
  {
    // `global` / `nonlocal` — 106 raw lines across 23 projects. A declaration
    // rather than a statement: it says which scope a name belongs to, and there
    // is nothing to compute, so it is two fields and no sockets.
    type: 'snakie_python_scope',
    category: 'variables',
    help: 'blocks-python',
    hidden: true,
    json: {
      message0: '%1 %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'SCOPE',
          options: [
            ['the whole program’s', 'global'],
            ['the enclosing function’s', 'nonlocal']
          ]
        },
        { type: 'field_input', name: 'NAMES', text: 'count' }
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Say that a name in here means the one outside, so changing it changes that one rather than making a new one.'
    },
    code: (block) => {
      const names = String(block.getFieldValue('NAMES') ?? '').trim()
      if (names === '') return ''
      return `${String(block.getFieldValue('SCOPE') ?? 'global')} ${names}\n`
    }
  }
]
