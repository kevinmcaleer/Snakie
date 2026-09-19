import { Order } from '../generator'
import { pyString } from '../py'
import { registerCallRules } from '../python-to-blocks'
import type { BlockDefinition, BlockGroup } from '../registry'

/**
 * TEXT (#1011, epic #1007).
 * =============================================================================
 *
 * Literals, joining, length, and `print` — which on a board means "say something
 * in the console", and is how a learner sees anything at all before they have
 * wired up a screen.
 *
 * JOIN GENERATES AN F-STRING. This is the one place in the core palette where
 * the obvious implementation would have been actively harmful. Blockly's own
 * Python generator emits `str(a) + ' ' + str(b)`, which is correct, ugly, and —
 * worse — the exact pattern the app's own refactor hints tell people to stop
 * writing (`refactor-use-fstring`). A learner would graduate to text carrying a
 * habit Snakie would immediately advise them out of. So `join` emits
 * `f"{a}{b}"`, which is what a Python programmer writes today, and a literal
 * in a socket is inlined into the f-string rather than interpolated —
 * `f"score: {n}"`, not `f"{'score: '}{n}"`.
 *
 * THE TRIM WAS RE-OPENED (#1124, epic #1119). It used to read: *"case
 * conversion, substring, index-of, trim, replace, reverse and `text_prompt` are
 * registered nowhere. They are a text-processing library, and this is a palette
 * for making a robot do something."* That was right for #1007, and Snakie is
 * not only a robot palette now — a serial command parser, a sensor that answers
 * in CSV, a WiFi response, a menu on a display are all string work, and all of
 * it was `snakie_python_value` text.
 *
 * SO THE DRAWER KEEPS ITS FIRST FOUR AND GROWS A SECOND SHELF. Seven new blocks
 * loose in Text would double it and bury `print` half way down; they live in a
 * **Working with text** sub-drawer instead, which `categoryContents` has built
 * from `group` since #1017. A first-day learner opens Text and still sees four
 * blocks.
 *
 * `text_prompt` IS STILL NOT HERE, and for the same reason as before: there is
 * no keyboard on the board.
 *
 * TWO MORE THINGS THIS DRAWER DOES NOT HAVE. `%TEXT contains %NEEDLE` is
 * `n in s`, which #1128's general membership block writes — it stopped checking
 * `Array` for exactly this case. `letter %N of %TEXT` is `s[n - 1]`, which the
 * Lists drawer's **item `n` of** writes; its socket stopped checking `Array`
 * too, rather than growing a twin.
 */
/**
 * The second shelf of the Text drawer (#1124).
 *
 * A sub-category rather than seven more blocks loose in Text: the drawer is a
 * curriculum, and doubling it would bury `print` half way down a flyout a
 * first-day learner is meant to read at a glance.
 */
const TEXT_MORE: BlockGroup = { id: 'text-more', name: 'Working with text' }

export const TEXT_BLOCKS: BlockDefinition[] = [
  {
    type: 'text',
    category: 'text',
    help: 'ref-types',
    code: (block) => [pyString(block.getFieldValue('TEXT') ?? ''), Order.ATOMIC]
  },
  {
    type: 'text_join',
    category: 'text',
    help: 'ref-print',
    code: (block, gen) => {
      const n = Number(block.getFieldValue('ITEMS') ?? 0) || countItems(block)
      if (n === 0) return ["''", Order.ATOMIC]
      const parts: string[] = []
      for (let i = 0; i < n; i++) {
        const raw = gen.valueToCode(block, `ADD${i}`, Order.NONE)
        if (!raw) continue
        parts.push(asFStringPart(raw))
      }
      if (parts.length === 0) return ["''", Order.ATOMIC]
      return [`f"${parts.join('')}"`, Order.ATOMIC]
    }
  },
  {
    type: 'text_length',
    category: 'text',
    help: 'ref-builtins',
    toolbox: { inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } } },
    code: (block, gen) => [
      `len(${gen.valueToCode(block, 'VALUE', Order.NONE) || "''"})`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'text_print',
    category: 'text',
    help: 'ref-print',
    toolbox: { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } } },
    code: (block, gen) => `print(${gen.valueToCode(block, 'TEXT', Order.NONE) || "''"})\n`
  },
  {
    type: 'snakie_text_case',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-types',
    json: {
      message0: '%1 in %2 case',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['upper', 'upper'],
            ['lower', 'lower']
          ]
        }
      ],
      inputsInline: true,
      output: 'String',
      tooltip:
        'The same text in capitals or in small letters. Comparing both sides in lower case is how you accept a command however it was typed.'
    },
    toolbox: { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } } },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'TEXT', Order.MEMBER) || "''"}.${
        String(block.getFieldValue('OP') ?? 'upper')
      }()`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_text_strip',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-types',
    read: { fn: 'strip', on: 'TEXT', args: [], shape: 'value' },
    json: {
      message0: '%1 with spaces trimmed',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      inputsInline: true,
      output: 'String',
      tooltip:
        'The same text with any spaces and line endings taken off both ends. A line read off a serial port almost always needs this first.'
    },
    toolbox: { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: ' hello ' } } } } },
    code: (block, gen) => [
      `${gen.valueToCode(block, 'TEXT', Order.MEMBER) || "''"}.strip()`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_text_replace',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-types',
    read: { fn: 'replace', on: 'TEXT', args: ['FROM', 'TO'], shape: 'value' },
    json: {
      message0: '%1 with %2 replaced by %3',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        { type: 'input_value', name: 'FROM' },
        { type: 'input_value', name: 'TO' }
      ],
      inputsInline: true,
      output: 'String',
      tooltip: 'A copy of the text with every one of one thing swapped for another.'
    },
    toolbox: {
      inputs: {
        FROM: { shadow: { type: 'text', fields: { TEXT: ',' } } },
        TO: { shadow: { type: 'text', fields: { TEXT: ' ' } } }
      }
    },
    code: (block, gen) => {
      const text = gen.valueToCode(block, 'TEXT', Order.MEMBER) || "''"
      const from = gen.valueToCode(block, 'FROM', Order.NONE) || "''"
      const to = gen.valueToCode(block, 'TO', Order.NONE) || "''"
      return [`${text}.replace(${from}, ${to})`, Order.FUNCTION_CALL]
    }
  },
  {
    type: 'snakie_text_split',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-types',
    read: { fn: 'split', on: 'TEXT', args: ['SEP'], shape: 'value' },
    json: {
      message0: 'split %1 by %2',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        { type: 'input_value', name: 'SEP' }
      ],
      inputsInline: true,
      output: 'Array',
      tooltip:
        'Cut a piece of text into a list, wherever the separator appears. This is how a line of CSV becomes values you can use.'
    },
    toolbox: { inputs: { SEP: { shadow: { type: 'text', fields: { TEXT: ',' } } } } },
    code: (block, gen) => {
      const text = gen.valueToCode(block, 'TEXT', Order.MEMBER) || "''"
      return [
        `${text}.split(${gen.valueToCode(block, 'SEP', Order.NONE) || "''"})`,
        Order.FUNCTION_CALL
      ]
    }
  },
  {
    // THE RECEIVER IS THE SEPARATOR, which is the one block on this shelf whose
    // Python reads back-to-front from its face: `', '.join(xs)`. The block says
    // it the way a person would, and the mirror shows the translation — which
    // is the same job `is nothing` → `is None` does in Logic.
    type: 'snakie_text_join_with',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-types',
    read: { fn: 'join', on: 'SEP', args: ['LIST'], shape: 'value', checks: { LIST: 'Array' } },
    json: {
      message0: 'join %1 with %2',
      args0: [
        { type: 'input_value', name: 'LIST', check: 'Array' },
        { type: 'input_value', name: 'SEP' }
      ],
      inputsInline: true,
      output: 'String',
      tooltip:
        'Stick a list of pieces of text together into one, with the separator between them. The other half of "split".'
    },
    toolbox: { inputs: { SEP: { shadow: { type: 'text', fields: { TEXT: ', ' } } } } },
    code: (block, gen) => {
      const sep = gen.valueToCode(block, 'SEP', Order.MEMBER) || "''"
      return [
        `${sep}.join(${gen.valueToCode(block, 'LIST', Order.NONE) || '[]'})`,
        Order.FUNCTION_CALL
      ]
    }
  },
  {
    type: 'snakie_text_edge',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-types',
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'TEXT' },
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['starts with', 'startswith'],
            ['ends with', 'endswith']
          ]
        },
        { type: 'input_value', name: 'PART' }
      ],
      inputsInline: true,
      output: 'Boolean',
      tooltip:
        'True when the text begins or finishes with that piece. How a command parser tells one instruction from another.'
    },
    toolbox: { inputs: { PART: { shadow: { type: 'text', fields: { TEXT: 'GO' } } } } },
    code: (block, gen) => {
      const text = gen.valueToCode(block, 'TEXT', Order.MEMBER) || "''"
      const op = String(block.getFieldValue('OP') ?? 'startswith')
      return [
        `${text}.${op}(${gen.valueToCode(block, 'PART', Order.NONE) || "''"})`,
        Order.FUNCTION_CALL
      ]
    }
  },
  {
    // THE OFF-BY-ONE IS A SETTING, as it is on the Lists drawer's `where … is
    // in` (#1122) and #1121's position loop — and here it carries a second
    // surprise worth naming: Python's `find` answers `-1` for "not there", so
    // the 1-based face turns that into `0`, which is falsy and consistent with
    // the rest of this palette's counting. The tooltip says so.
    type: 'snakie_text_find',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-types',
    read: {
      fn: 'find',
      on: 'TEXT',
      args: ['NEEDLE'],
      shape: 'value',
      fields: { START: 'ZERO' }
    },
    json: {
      message0: 'where %1 is in %2 %3',
      args0: [
        { type: 'input_value', name: 'NEEDLE' },
        { type: 'input_value', name: 'TEXT' },
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
        'Where a piece of text appears inside another. On "first is 1" it answers 0 when it is not there at all — which counts as false, so you can test it directly.'
    },
    toolbox: { inputs: { NEEDLE: { shadow: { type: 'text', fields: { TEXT: ',' } } } } },
    code: (block, gen) => {
      const text = gen.valueToCode(block, 'TEXT', Order.MEMBER) || "''"
      const call = `${text}.find(${gen.valueToCode(block, 'NEEDLE', Order.NONE) || "''"})`
      if (block.getFieldValue('START') === 'ZERO') return [call, Order.FUNCTION_CALL]
      return [`${call} + 1`, Order.ADDITIVE]
    }
  },
  {
    // LETTERS AND THEIR NUMBERS (#1130, epic #1119).
    //
    // `ord`/`chr` are here rather than in a Conversions drawer because this is
    // where a learner is standing when they need them: a byte off a UART, a key
    // from a keypad, a character out of a buffer. #1118's `snakie_cast` covers
    // the six types a beginner meets first and has nowhere to put these — they
    // are not a type change, they are the two halves of one lookup.
    type: 'snakie_text_ord',
    category: 'text',
    // ON THE SECOND SHELF TOO (#1124). They arrived loose in #1130, a few days
    // before this drawer had a shelf to put them on; leaving them out front
    // would have made "letter code of" one of the five blocks a first-day
    // learner meets.
    group: TEXT_MORE,
    help: 'ref-builtins',
    read: { fn: 'ord', args: ['CHAR'], shape: 'value' },
    json: {
      message0: 'letter code of %1',
      args0: [{ type: 'input_value', name: 'CHAR' }],
      inputsInline: true,
      output: 'Number',
      tooltip:
        'The number a single letter is stored as. "A" is 65. This is what a byte from a UART or a keypad really is.'
    },
    toolbox: { inputs: { CHAR: { shadow: { type: 'text', fields: { TEXT: 'A' } } } } },
    code: (block, gen) => [
      `ord(${gen.valueToCode(block, 'CHAR', Order.NONE) || "''"})`,
      Order.FUNCTION_CALL
    ]
  },
  {
    type: 'snakie_text_chr',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-builtins',
    read: { fn: 'chr', args: ['CODE'], shape: 'value', checks: { CODE: 'Number' } },
    json: {
      message0: 'letter for code %1',
      args0: [{ type: 'input_value', name: 'CODE', check: 'Number' }],
      inputsInline: true,
      output: 'String',
      tooltip: 'The letter a number stands for. 65 is "A". The other half of "letter code of".'
    },
    toolbox: { inputs: { CODE: { shadow: { type: 'math_number', fields: { NUM: 65 } } } } },
    code: (block, gen) => [
      `chr(${gen.valueToCode(block, 'CODE', Order.NONE) || '0'})`,
      Order.FUNCTION_CALL
    ]
  }
]

/**
 * How the two letter-code blocks read BACK out of Python (#1130).
 *
 * Both are `registerCallRules` one-liners with `shape: 'value'`, the same shape
 * the reader's own `len`/`abs`/`round` entries already have — which is the
 * whole argument for filing them together rather than as their own workstream.
 */
registerCallRules([
  ...TEXT_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : [])),
  // The two dropdown blocks are two rules each, with the field fixed — the
  // shape `CallRule.fields` exists for, and the only way the reader can produce
  // both options of one block.
  ...(['upper', 'lower'] as const).map((op) => ({
    fn: op,
    type: 'snakie_text_case',
    on: 'TEXT',
    args: [] as const,
    shape: 'value' as const,
    fields: { OP: op }
  })),
  ...(['startswith', 'endswith'] as const).map((op) => ({
    fn: op,
    type: 'snakie_text_edge',
    on: 'TEXT',
    args: ['PART'],
    shape: 'value' as const,
    fields: { OP: op }
  }))
])

/**
 * A Python string literal for `value`, single-quoted like `ruff` prefers.
 *
 * Escapes the quote and the backslash, and nothing else: the field holds text a
 * child typed, so a newline in it is a newline they meant.
 */
/**
 * One piece of an f-string.
 *
 * A LITERAL is inlined — `f"score: {n}"` rather than `f"{'score: '}{n}"`, which
 * is the difference between a line a learner reads and a line they squint at.
 * Anything else becomes a `{…}` slot. Braces inside a literal are doubled,
 * because inside an f-string a `{` means something.
 */
function asFStringPart(code: string): string {
  const literal = /^'((?:[^'\\]|\\.)*)'$/.exec(code) ?? /^"((?:[^"\\]|\\.)*)"$/.exec(code)
  if (literal) return literal[1].replace(/([{}])/g, '$1$1').replace(/\\'/g, "'")
  return `{${code}}`
}

/** How many sockets the mutator has actually given this block. */
function countItems(block: { getInput(name: string): unknown }): number {
  let n = 0
  while (block.getInput(`ADD${n}`)) n++
  return n
}
