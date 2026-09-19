import { Order } from '../generator'
import { pyString } from '../py'
import { registerCallRules } from '../python-to-blocks'
import type { BlockDefinition } from '../registry'

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
 * TRIMMED: case conversion, substring, index-of, trim, replace, reverse and
 * `text_prompt` (which asks for input on a device with no keyboard) are
 * registered nowhere. They are a text-processing library, and this is a palette
 * for making a robot do something.
 */
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
    // LETTERS AND THEIR NUMBERS (#1130, epic #1119).
    //
    // `ord`/`chr` are here rather than in a Conversions drawer because this is
    // where a learner is standing when they need them: a byte off a UART, a key
    // from a keypad, a character out of a buffer. #1118's `snakie_cast` covers
    // the six types a beginner meets first and has nowhere to put these — they
    // are not a type change, they are the two halves of one lookup.
    type: 'snakie_text_ord',
    category: 'text',
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
registerCallRules(
  TEXT_BLOCKS.flatMap((block) => (block.read ? [{ ...block.read, type: block.type }] : []))
)

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
