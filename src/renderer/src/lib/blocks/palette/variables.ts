import { Order } from '../generator'
import { registerCallRules } from '../python-to-blocks'
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
  // ------------------------------------------------- types, and the scope word
  {
    // TURNING ONE TYPE INTO ANOTHER (#1118).
    //
    // `int(reading)`, `str(count)`, `float(text)` — the three lines every
    // program that reads a sensor or shows a number on a screen contains, and
    // until now every one of them was a grey Python block. A learner could
    // write the value and could write the variable, and the one step between
    // them was the escape hatch.
    //
    // ONE BLOCK WITH A DROPDOWN, not six blocks. The six are the same sentence
    // with one word changed, and six near-identical shapes in a drawer is the
    // wall `snakie_math_min_max` avoids for the same reason.
    //
    // THE FACE NAMES THE PYTHON, which is not the house style and is right
    // here. *as a whole number* on its own reads like rounding, and `int(3.7)`
    // is 3 while `round(3.7)` is 4 — a block whose face implies the wrong one
    // of those teaches the trap rather than the tool. The gloss carries the
    // meaning and the `(int)` carries the promise.
    //
    // ITS OUTPUT IS UNCHECKED, deliberately. What this block produces depends
    // on the dropdown, and Blockly checks a socket against a type fixed when
    // the block is built — so a declared `Number` would be a lie in five cases
    // out of six. Unchecked is what the reader's own table already says about
    // anything it cannot type (see `OUTPUT_TYPE` in `python-to-blocks.ts`):
    // unknown fits everywhere, which is the honest answer here too.
    type: 'snakie_cast',
    category: 'variables',
    help: 'ref-types',
    json: {
      message0: 'turn %1 into %2',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        {
          type: 'field_dropdown',
          name: 'TYPE',
          options: [
            ['a whole number (int)', 'int'],
            ['a decimal number (float)', 'float'],
            ['text (str)', 'str'],
            ['true or false (bool)', 'bool'],
            ['a list', 'list'],
            ['a tuple', 'tuple']
          ]
        }
      ],
      inputsInline: true,
      output: null,
      tooltip:
        'Turn a value into another type — the text "10" into the number 10, or a reading into text ' +
        'so it can be joined onto a message. Turning a decimal into a whole number throws the rest ' +
        'away rather than rounding it.'
    },
    // `'10'` rather than a number: turning text into a number is the cast a
    // beginner meets first, and the shadow shows the block doing exactly that.
    toolbox: { inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: '10' } } } } },
    code: (block, gen) => {
      const type = String(block.getFieldValue('TYPE') ?? 'int')
      const empty = CAST_EMPTY[type] ?? '0'
      return [
        `${type}(${gen.valueToCode(block, 'VALUE', Order.NONE) || empty})`,
        Order.FUNCTION_CALL
      ]
    }
  },
  {
    // `global` AS A BLOCK OF ITS OWN (#1118).
    //
    // The commonest bug in a first program with functions in it: a function
    // assigns to `score`, the program outside never changes, and nothing says
    // why — Python made a new local name the moment the function wrote to it.
    // `global score` is the one line that fixes it, and it was reachable only
    // by typing Python into a grey block.
    //
    // THE NAME IS A VARIABLE FIELD, not text — which is the whole reason this
    // is a separate block from `snakie_python_scope` below rather than that one
    // unhidden. The dropdown offers the variables this program actually has, it
    // follows a rename the way every other block in this drawer does, and it
    // cannot say `global my score`. The escape hatch keeps everything this
    // shape cannot hold: `nonlocal`, and several names at once.
    type: 'snakie_global',
    category: 'variables',
    help: 'ref-types',
    json: {
      message0: 'use the whole program’s %1',
      args0: [{ type: 'field_variable', name: 'VAR', variable: 'score' }],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      tooltip:
        'Inside a function, say that this name means the one from the whole program — so changing ' +
        'it changes that one, rather than quietly making a new name that disappears when the ' +
        'function ends.'
    },
    code: (block, gen) => `global ${gen.variableName(block.getFieldValue('VAR'))}\n`
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

/**
 * What an EMPTY socket casts, per type.
 *
 * A cast with nothing in it still has to generate something that RUNS: `int()`
 * is a TypeError in the mirror the learner is reading, while `int(0)` is a zero.
 * Each one is the emptiest value of the type going in, not of the type coming
 * out — `str('')` rather than `str(0)` — so the line says what the block is for
 * even before it is filled.
 */
const CAST_EMPTY: Record<string, string> = {
  int: '0',
  float: '0',
  str: "''",
  bool: '0',
  list: '[]',
  tuple: '[]'
}

/**
 * How the casts read BACK out of Python (#1118).
 *
 * One rule per type, with the dropdown fixed — the same shape `min`/`max` uses,
 * and the reason `CallRule.fields` exists. Without them a child could drag
 * `turn (x) into a whole number` out of this drawer, save, reopen, and find the
 * grey block it was meant to replace.
 *
 * ARITY DOES THE REST. `buildCall` refuses a rule whose argument count does not
 * line up, so `int('ff', 16)` — a base conversion this block cannot hold — stays
 * raw rather than silently losing its 16.
 */
registerCallRules(
  Object.keys(CAST_EMPTY).map((type) => ({
    fn: type,
    type: 'snakie_cast',
    args: ['VALUE'],
    shape: 'value' as const,
    fields: { TYPE: type }
  }))
)
