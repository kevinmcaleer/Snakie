import { Order } from '../generator'
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
  }
]

/**
 * A Python string literal for `value`, single-quoted like `ruff` prefers.
 *
 * Escapes the quote and the backslash, and nothing else: the field holds text a
 * child typed, so a newline in it is a newline they meant.
 */
function pyString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

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
