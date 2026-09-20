import * as Blockly from 'blockly/core'
import { Order } from '../generator'
import type { MicroPythonGenerator } from '../generator'
import { pyString } from '../py'
import { growableMixin, itemCount } from './growable'
import { countHoles, renderFString } from '../fstring'
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
        // A FORMAT BLOCK IS FOLDED INTO THIS f-STRING RATHER THAN NESTED IN IT
        // (#1125). Left to itself, `to 1 decimal place` generates `f"{t:.1f}"`
        // and this would wrap it as `f"{f'{t:.1f}'}"` — legal, and a line
        // nobody would write. Asking the block for its PIECES instead gives
        // `f"temp: {t:.1f}"`, whole.
        const spec = formatOf(block.getInputTargetBlock(`ADD${i}`), gen)
        if (spec) {
          parts.push(`{${spec.expr}:${spec.spec}}`)
          continue
        }
        const raw = gen.valueToCode(block, `ADD${i}`, Order.NONE)
        if (!raw) continue
        // A template block in a socket is an f-string too; see `asHolePiece`.
        parts.push(asFStringPart(asHolePiece(raw)))
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
    // `print` GREW A SOCKET AT A TIME (#1125, epic #1119).
    // `docs/blocks-coverage-epic.md` §10 lists *"`print` with more than one
    // argument — `text_print` has one socket"* among the lines still grey, and
    // `print("x:", x, "y:", y)` is how everybody debugs: it could neither be
    // built nor read.
    //
    // ITS FIRST SOCKET IS STILL CALLED `TEXT`, which is the whole of the
    // migration story. Every saved workspace has a `text_print` with a `TEXT`
    // input in it, and `Blockly.serialization` does not warn about an input it
    // cannot find — it throws, and the throw costs the learner every block in
    // the file. The rows that grow are named beside it, and a block with no
    // saved count gets one row, which is what it always had.
    type: 'text_print',
    category: 'text',
    help: 'ref-print',
    toolbox: { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } } },
    code: (block, gen) => {
      const parts: string[] = []
      for (let i = 0; i < Math.max(1, itemCount(block)); i++) {
        // AN EMPTY SOCKET CONTRIBUTES NOTHING rather than `''`, the way the
        // call blocks treat one: a learner who pressed `+` once too often
        // should get their `print` back, not a stray empty string in the
        // console.
        const code = gen.valueToCode(block, i === 0 ? 'TEXT' : `ADD${i}`, Order.NONE)
        if (code) parts.push(code)
      }
      return `print(${parts.join(', ')})\n`
    }
  },
  {
    // `print` THAT UNDERSTANDS AN f-STRING.
    //
    // `print(f"ping.distance {ping.distance()}")` is how a sensor program says
    // what it read, and it had no block: `print` takes values, `join` builds the
    // f-string out of pieces, and neither looks like the line a learner is
    // copying out of a tutorial. This block holds the f-string as its TEMPLATE
    // — the text with a `{}` wherever a value goes — and grows one socket per
    // hole as they type. The mirror shows the f-string exactly as Python has it.
    //
    // A PRINT VARIANT, which the format blocks above argued against for
    // themselves — and the argument holds: they are about how ONE value looks,
    // and belong in any socket. This is about the whole line, `print(f"…")`,
    // which is the single commonest line in a hardware program's loop and
    // deserves to be one block. `snakie_fstring` below is the same template as
    // a value, for every other destination.
    type: 'snakie_print_format',
    category: 'text',
    help: 'ref-print',
    code: (block, gen) => `print(${fStringOf(block, gen)})\n`
  },
  {
    // ON THE SECOND SHELF: the print above is the block a first-day learner
    // reaches for, and this is the same template for every other destination —
    // a display, a `join`, a variable.
    type: 'snakie_fstring',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-print',
    code: (block, gen) => [fStringOf(block, gen), Order.ATOMIC]
  },
  {
    // FORMATTING IS ABOUT HOW A NUMBER LOOKS, not what it is (#1125).
    //
    // The nearest thing before this was `snakie_math_round_places`, which
    // changes the NUMBER: it gives `23.1` where a display wanted `23.10`, and
    // `23.0` where it wanted `23.00`. "Print the temperature to one decimal
    // place" is the single most common formatting job in a sensor program and
    // it had no block at all.
    //
    // A FORMAT BLOCK RETURNS TEXT, so it plugs into `join`, into `print`, into
    // a display block — one block, every destination. It is emphatically not a
    // `print` variant.
    type: 'snakie_format_places',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-print',
    json: {
      message0: '%1 to %2 decimal places',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        { type: 'field_number', name: 'PLACES', value: 1, min: 0, max: 10, precision: 1 }
      ],
      inputsInline: true,
      output: 'String',
      tooltip:
        'A number written out with exactly that many decimal places — 23.10 rather than 23.1. It changes how the number LOOKS, not what it is.'
    },
    code: (block, gen) => [fString(formatOf(block, gen)), Order.ATOMIC]
  },
  {
    type: 'snakie_format_pad',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-print',
    json: {
      message0: '%1 padded to %2',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        { type: 'field_number', name: 'WIDTH', value: 5, min: 1, max: 40, precision: 1 }
      ],
      inputsInline: true,
      output: 'String',
      tooltip:
        'A value written out at least that wide, with spaces in front of it. This is how a column of readings on a small screen stays lined up.'
    },
    code: (block, gen) => [fString(formatOf(block, gen)), Order.ATOMIC]
  },
  {
    type: 'snakie_format_base',
    category: 'text',
    group: TEXT_MORE,
    help: 'ref-bits',
    json: {
      message0: '%1 as %2',
      args0: [
        { type: 'input_value', name: 'VALUE' },
        {
          type: 'field_dropdown',
          name: 'BASE',
          options: [
            ['hex', 'x'],
            ['binary', 'b']
          ]
        }
      ],
      inputsInline: true,
      output: 'String',
      tooltip:
        'A number written out in hex or in binary, with its 0x or 0b in front. For showing a register or an address the way a datasheet does.'
    },
    code: (block, gen) => [fString(formatOf(block, gen)), Order.ATOMIC]
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

/** A value and the Python format spec that says how to write it out. */
export interface FormatSpec {
  expr: string
  spec: string
}

/**
 * The format spec one of the three format blocks asks for, or null (#1125).
 *
 * Exported as a FUNCTION OF THE BLOCK rather than baked into each emitter,
 * because `text_join` needs the pieces — see the fold there. A block whose
 * socket is empty still has a spec; an empty socket formats `0`, which is what
 * the block looks like it means.
 */
export function formatOf(
  block: Blockly.Block | null,
  gen: MicroPythonGenerator
): FormatSpec | null {
  if (!block) return null
  const value = (): string => gen.valueToCode(block, 'VALUE', Order.NONE) || '0'
  switch (block.type) {
    case 'snakie_format_places':
      return { expr: value(), spec: `.${Number(block.getFieldValue('PLACES') ?? 1)}f` }
    case 'snakie_format_pad':
      return { expr: value(), spec: `>${Number(block.getFieldValue('WIDTH') ?? 5)}` }
    case 'snakie_format_base':
      return { expr: value(), spec: `#${String(block.getFieldValue('BASE') ?? 'x')}` }
    default:
      return null
  }
}

/** One format spec as an f-string of its own, for a block standing alone. */
function fString(spec: FormatSpec | null): string {
  return spec ? `f"{${spec.expr}:${spec.spec}}"` : "''"
}

/**
 * The f-string a template block stands for: `f"ping.distance {ping.distance()}"`.
 *
 * One piece per hole, in order. A format block plugged into a hole is FOLDED
 * into it rather than nested — `{t:.1f}`, not `{f"{t:.1f}"}`, which is a nested
 * f-string reusing the outer quote and a syntax error before Python 3.12. Any
 * other double-quoted f-string in a hole (a `join`, another template) has its
 * quotes swapped for the same reason.
 */
function fStringOf(block: Blockly.Block, gen: MicroPythonGenerator): string {
  const template = String(block.getFieldValue(TEMPLATE_FIELD) ?? '')
  const pieces: string[] = []
  for (let i = 0; i < countHoles(template); i++) {
    const spec = formatOf(block.getInputTargetBlock(`ADD${i}`), gen)
    if (spec) {
      pieces.push(`${spec.expr}:${spec.spec}`)
      continue
    }
    pieces.push(asHolePiece(gen.valueToCode(block, `ADD${i}`, Order.NONE)))
  }
  return renderFString(template, pieces)
}

/** A generated expression as it can sit inside a `"…"` f-string's hole. */
function asHolePiece(code: string): string {
  if (/^f"[^'"]*"$/.test(code)) return `f'${code.slice(2, -1)}'`
  return code
}

/** The field a template block keeps its f-string text in. */
export const TEMPLATE_FIELD = 'TEMPLATE'

interface TemplateOptions {
  /** The words before the `f"`: `print`, or nothing for the value. */
  head: string
  /** A value block (an output) rather than a statement. */
  value?: boolean
  /** What a freshly dragged block's template says. */
  template: string
  tooltip: string
}

/**
 * The mixin for a block whose sockets FOLLOW ITS TEMPLATE.
 *
 * `growableMixin` grows on a `+` button; this grows on a `{`. Type `{}` into
 * the template and a socket appears for it; take it out and the socket goes —
 * but whatever was plugged in is UNPLUGGED rather than thrown away, because the
 * field re-validates on every keystroke and a learner deleting a `}` to retype
 * it must not lose the block they had built for that hole.
 *
 * The count is saved beside the template so a file reopens with its sockets
 * before the field is even set, which is the order Blockly loads them in.
 */
function templateMixin(options: TemplateOptions): Record<string, unknown> {
  return {
    itemCount_: 0,

    init(this: Blockly.Block): void {
      this.setStyle('text_blocks')
      const head = this.appendDummyInput('HEAD')
      if (options.head) head.appendField(options.head)
      const field = new Blockly.FieldTextInput(options.template, function (
        this: Blockly.Field,
        text: string
      ) {
        // `this` is the field: Blockly binds a validator so, and the constructor
        // validates the initial value before the `const` above is assigned.
        const block = this.getSourceBlock()
        if (block) sync(block, countHoles(text))
        return text
      })
      head.appendField('f"').appendField(field, TEMPLATE_FIELD).appendField('"')
      this.setInputsInline(true)
      if (options.value) this.setOutput(true, 'String')
      else {
        this.setPreviousStatement(true, null)
        this.setNextStatement(true, null)
      }
      this.setTooltip(options.tooltip)
      sync(this, countHoles(options.template))
    },

    saveExtraState(this: Blockly.Block): { items: number } {
      return { items: (this as unknown as { itemCount_: number }).itemCount_ }
    },

    loadExtraState(this: Blockly.Block, state: { items?: number }): void {
      sync(this, Math.max(0, Number(state?.items ?? 0)))
    }
  }

  /** Add or remove `ADDn` sockets so there are exactly `n`. */
  function sync(block: Blockly.Block, n: number): void {
    const self = block as unknown as { itemCount_: number }
    const have = self.itemCount_ ?? 0
    for (let i = have; i > n; i--) {
      const name = `ADD${i - 1}`
      const plugged = block.getInput(name)?.connection?.targetBlock()
      if (plugged && !plugged.isShadow()) plugged.unplug(true)
      block.removeInput(name, true)
    }
    for (let i = have; i < n; i++) {
      block
        .appendValueInput(`ADD${i}`)
        .setCheck(null)
        .appendField(i === 0 ? 'with' : 'and')
    }
    self.itemCount_ = n
  }
}

/**
 * `create text with` lays its sockets ACROSS, not down.
 *
 * Blockly's own `text_join` appends each socket as an external value input, so
 * a two-piece join — by far the common case — stands two rows tall for the sake
 * of two small sockets, and a flyout full of them scrolls for no reason. The
 * block says one thing ("join these"), so it reads as one line. Patched onto
 * Blockly's definition rather than replacing it, because the gear mutator, its
 * serialisation and its socket names are all worth keeping exactly as they are:
 * `inputsInline` survives `updateShape_` adding and removing rows, so setting
 * it once in `init` is the whole change.
 */
function installInlineJoin(): void {
  const def = Blockly.Blocks['text_join'] as unknown as {
    init: (this: Blockly.Block) => void
    snakieInline_?: boolean
  }
  // Installing the palette twice (every test does) must not wrap `init` twice.
  if (!def || def.snakieInline_) return
  const init = def.init
  def.init = function (this: Blockly.Block): void {
    init.call(this)
    this.setInputsInline(true)
  }
  def.snakieInline_ = true
}

/** Register the blocks whose sockets come and go. */
export function installTextBlocks(): void {
  installInlineJoin()
  Blockly.Blocks['text_print'] = growableMixin({
    style: 'text_blocks',
    head: 'print',
    defaults: 1,
    first: '',
    separator: 'and',
    noun: 'value',
    firstSocket: 'TEXT',
    tooltip:
      'Say something in the console. Press + to print several things at once — Python puts a space between them.'
  }) as never
  Blockly.Blocks['snakie_print_format'] = templateMixin({
    head: 'print',
    template: 'distance {}',
    tooltip:
      'Print text with values dropped into it. Type {} wherever a value goes and a socket appears for it — Python calls this an f-string.'
  }) as never
  Blockly.Blocks['snakie_fstring'] = templateMixin({
    head: '',
    value: true,
    template: 'distance {}',
    tooltip:
      'Text with values dropped into it — an f-string. Type {} wherever a value goes and a socket appears. Plug it into print, a display, or anywhere text goes.'
  }) as never
}

/** How many sockets the mutator has actually given this block. */
function countItems(block: { getInput(name: string): unknown }): number {
  let n = 0
  while (block.getInput(`ADD${n}`)) n++
  return n
}
