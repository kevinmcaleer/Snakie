import type { BlocksWorkspace } from '../../../../shared/blocks-doc'
import type { ArgField, CallReceiver, SocketType } from './registry'
import { docstringComment } from './docstring'
import { isReservedName, sanitise } from './names'
import {
  isSuiteHeader,
  logicalLines,
  tokenize,
  trailingCommentAt,
  type LogicalLine,
  type Token
} from './python-tokens'

/**
 * PYTHON → BLOCKS (#1019, epic #1007, phase 5).
 * =============================================================================
 *
 * Everything else in this epic is careful to claim only blocks → code, because
 * code → blocks is decompilation. This is the narrow case where decompilation is
 * tractable and worth having: a learner who graduated (#1016) and wants to go
 * back, a teacher with a `.py` from a lesson sheet, a blocks file whose Python
 * was hand-edited (#1008's conflict).
 *
 * THE DESIGN, IN ONE SENTENCE: recognise what we can, and turn everything else
 * into #1018's raw Python blocks — one per line — so the conversion can never
 * fail, only be uglier.
 *
 * That single rule is what makes the whole thing safe. A converter that refuses
 * is a converter nobody can rely on; a converter that guesses is one that
 * silently changes somebody's program. This one is neither: every line either
 * becomes the block it obviously is, or becomes a block holding that exact line.
 * The acceptance property follows for free and is the suite's centre of gravity:
 *
 *   **converting a program and generating it again gives back the same program.**
 *
 * WHY THERE IS NO AST. See `python-tokens.ts` — the spike's answer, checked
 * rather than assumed. Python is line-oriented, the subset is one we define, and
 * the per-line fallback is always correct, so a lexer and an indentation tree do
 * the job that a megabyte of parser would.
 *
 * PURE, AND BLOCKLY-FREE. It emits Blockly's serialisation as plain JSON, which
 * is all a workspace ever was, so the whole thing is unit-tested in node against
 * the real generator: convert, load, generate, compare.
 */

/** A block, in Blockly's own serialisation shape. */
export interface BlockJson {
  type: string
  id?: string
  fields?: Record<string, unknown>
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>
  extraState?: unknown
  /**
   * Blockly's own serialisation for a block's attachments — the comment bubble
   * is `icons.comment`, which is how a `def`'s docstring comes across as the
   * block's description (see `docstring.ts`).
   */
  icons?: Record<string, unknown>
  next?: { block: BlockJson }
  x?: number
  y?: number
}

/**
 * SOCKET TYPES, SO WE STOP BUILDING WORKSPACES BLOCKLY REFUSES TO LOAD (#1071).
 * =============================================================================
 *
 * Six of the `.py` files this repository ships used to come back **unloadable**,
 * and tracing them turned up one cause wearing four different hats:
 *
 * ```
 *   "%.1f" % value      text   → math_modulo.DIVIDEND   wants Number
 *   s += "x"            text   → math_change.DELTA      wants Number
 *   x = a + "b"         text   → math_arithmetic.B      wants Number
 *   x = a and "b"       text   → logic_operation.B      wants Boolean
 *   abs(x) and y        abs    → logic_operation.A      wants Boolean
 * ```
 *
 * Every one is the converter putting a block of one type into a socket that
 * accepts another. `Blockly.serialization.workspaces.load` throws on the first
 * of them and abandons the whole workspace, so a single `+=` on a string used
 * to cost the learner every block in the file.
 *
 * It had been fixed twice before, one operator at a time — `snakie_forever` in
 * #1069, `%` on a string in #1068 — and #1071 asked for the structural answer
 * before a fourth instance. This is it: the converter cannot ask Blockly about
 * socket types (it is deliberately Blockly-free so it can be unit tested in
 * node), but it does not need to. It KNOWS what it just built.
 *
 * So each typed socket is filled only by something that fits it, and a mismatch
 * refuses the whole expression — which sends the line to a raw Python block that
 * regenerates it verbatim. An uglier block, and the learner's program intact.
 *
 * Absent from the table means UNKNOWN, and unknown always fits: a variable, a
 * call, a raw value block could be anything at runtime, which is exactly why
 * Blockly leaves their output unchecked too.
 */
const OUTPUT_TYPE = new Map<string, SocketType>([
  ['text', 'String'],
  ['text_join', 'String'],
  ['math_number', 'Number'],
  ['math_arithmetic', 'Number'],
  ['math_modulo', 'Number'],
  ['math_round', 'Number'],
  ['snakie_math_abs', 'Number'],
  ['text_length', 'Number'],
  // The bits (#1127). THE LITERALS ARE NUMBERS AND THE OPERATORS ARE NOT, which
  // looks inconsistent and is not: `if flags & 0x01:` is how every driver asks
  // whether a bit is set, so the result of a mask has to fit a socket that
  // checks Boolean, and the blocks in `maths.ts` say so by leaving their output
  // unchecked. This table mirrors what those blocks DECLARE — a row here that
  // disagrees with the block is a workspace Blockly refuses to load, which is
  // the whole reason the table exists.
  ['snakie_hex_number', 'Number'],
  ['snakie_binary_number', 'Number'],
  ['logic_boolean', 'Boolean'],
  ['logic_compare', 'Boolean'],
  ['logic_negate', 'Boolean'],
  ['logic_operation', 'Boolean'],
  ['snakie_is_none', 'Boolean'],
  ['snakie_identity', 'Boolean'],
  ['snakie_isinstance', 'Boolean'],
  // `ord` and `chr` (#1130): one answers with a number, the other with text.
  ['snakie_text_ord', 'Number'],
  ['snakie_text_chr', 'String'],
  // Working with text (#1124). `split` is the one that hands back a LIST,
  // which is what lets it go straight into a `for each`.
  ['snakie_text_case', 'String'],
  ['snakie_text_strip', 'String'],
  ['snakie_text_replace', 'String'],
  ['snakie_text_join_with', 'String'],
  ['snakie_text_split', 'Array'],
  ['snakie_text_edge', 'Boolean'],
  ['snakie_text_find', 'Number'],
  // The format blocks (#1125) hand back TEXT, which is what lets one of them
  // go into `print`, into `join`, or onto a display — one block, every
  // destination.
  ['snakie_format_places', 'String'],
  ['snakie_format_pad', 'String'],
  ['snakie_format_base', 'String'],
  ['snakie_int_base', 'Number'],
  // The list verbs (#1122). `sorted(xs)` is the only one that hands back a
  // LIST, which is what lets it go straight into a `for each`.
  ['snakie_list_index', 'Number'],
  ['snakie_list_count', 'Number'],
  ['snakie_list_aggregate', 'Number'],
  ['snakie_list_sorted', 'Array'],
  ['snakie_list_contains', 'Boolean'],
  // `controls_forEach`'s LIST socket checks Array, and a `text` in it is the
  // same class of unloadable workspace the table above exists for (#1087):
  // `for name in "EDCDEEE":` is ordinary Python — iterating a string — and it
  // took the whole file's canvas down with it.
  ['lists_create_with', 'Array'],
  // A TUPLE IS NOT AN `Array` (#1121). `controls_forEach`'s LIST socket checks
  // Array and a tuple is perfectly iterable, but so is a string — the table
  // says what a block DECLARES, and `snakie_tuple` declares nothing, so it fits
  // everywhere the way a variable does.
  ['lists_repeat', 'Array'],
  ['lists_sort', 'Array'],
  ['lists_split', 'Array']
])

/** Can this block sit in a socket that accepts `want`? Unknown always can. */
function fitsSocket(block: BlockJson, want: SocketType): boolean {
  const got = OUTPUT_TYPE.get(block.type)
  return got === undefined || got === want
}

/** What the conversion did, for the report #1032 shows before committing to it. */
export interface ConversionReport {
  /** Lines that became a block of their own kind. */
  recognised: number
  /** Lines kept verbatim in a raw Python block. */
  raw: number
  /** Which source lines those were, 1-based, in order. */
  rawLines: number[]
  /** Total logical lines read. */
  total: number
  /**
   * VALUE SOCKETS, COUNTED SEPARATELY (W0, epic #1086).
   *
   * `rawValue()` never increments {@link raw} — only `raw()` does — so a
   * statement that becomes a real block with an unreadable EXPRESSION in one of
   * its sockets counts as recognised. That asymmetry is deliberate and is what
   * makes most of epic #1086 cheap (see `docs/blocks-coverage-epic.md` §4.2),
   * but it leaves `echo = Pin(0, Pin.IN)` reporting a clean line while it
   * renders as *set echo to (grey blob)*.
   *
   * So sockets get their own number. One per value socket the conversion
   * filled, and how many of those came back grey.
   */
  sockets: number
  /** Of those, the ones holding a grey Python value block. */
  rawSockets: number
}

export interface Conversion {
  workspace: BlocksWorkspace
  report: ConversionReport
}

/**
 * The block types this converter can emit that have NO next connection (#1068).
 *
 * Kept as data here rather than asked of Blockly, because this module is
 * deliberately Blockly-free — it emits plain JSON so the whole conversion can be
 * unit-tested in node. `blocksPythonToBlocks.test.ts` asserts this set against
 * the real block definitions in both directions, so a palette that gains or
 * loses a next connection fails a test rather than a learner's canvas.
 */
const TERMINAL_TYPES = new Set(['snakie_forever', 'controls_flow_statements'])

/**
 * The value blocks that are the FALLBACK rather than a reading (W0, epic #1086).
 *
 * A socket holding one of these regenerates its text verbatim and is correct —
 * that is the guarantee — but it is not a block the learner can take apart, so
 * it is what socket coverage counts against itself.
 */
const GREY_VALUE_TYPES = new Set(['snakie_python_value', 'snakie_python_call_value'])

/**
 * THE ESCAPE HATCHES THE READER CAN NOW EMIT (W1, #1088, epic #1086).
 * ---------------------------------------------------------------------------
 *
 * All four have shipped since #1018, sitting in the Python drawer for a human to
 * drag, and the reader has never produced one of them. That is the single
 * biggest gap in the corpus and it costs nothing to close: 7,662 raw lines
 * across 66 of 73 projects, with nothing added to the palette.
 *
 * The literals rather than an import, like the raw blocks above: the palette
 * imports this module, so this module must not import back.
 */
const PYTHON_CALL = 'snakie_python_call'
const PYTHON_CALL_VALUE = 'snakie_python_call_value'
const PYTHON_ATTR_GET = 'snakie_python_attr_get'
const PYTHON_ATTR_SET = 'snakie_python_attr_set'

/**
 * The most argument sockets a call block will grow to — `MAX_ARGS` in
 * `palette/python.ts`, restated here for the same reason as the types above.
 *
 * A call with more arguments than the block can hold is not that block, so it
 * stays raw and regenerates verbatim, which is the rule everywhere else here.
 */
const MAX_CALL_ARGS = 8

/**
 * Blocks the generator lifts OUT of the body into a section of its own.
 *
 * The import blocks: they sit in the chain like any statement, and the generator
 * lifts them out into a section of its own with a blank line after it. So the gap
 * under the last of them is a gap that is coming back whatever we do, and a
 * spacer for it would make two.
 *
 * A top-level `def` is hoisted the same way and is NOT here, because it does not
 * stay in the chain to be recognised — `statement` sets `hoistedAbove` directly
 * when it collects one.
 */
const HOISTED_TYPES = new Set([
  'snakie_python_import',
  'snakie_python_import_as',
  'snakie_python_from_import',
  // A `name pin` block is hoisted the same way (W10, #1097): it generates
  // nothing where it stands and its assignment goes into the setup section,
  // which the generator already puts a blank line after.
  'snakie_name_pin',
  // And `name PWM`, for the same reason and by the same route. Leaving it out
  // kept the learner's blank line AND the separator the generator writes, so a
  // named PWM gained an empty line every time the file was opened.
  'snakie_name_pwm'
])

/** A statement and the suite indented under it. */
interface Stmt {
  line: LogicalLine
  body: Stmt[]
  /** Set only on a folded run of comment lines (#1062). */
  comment?: readonly LogicalLine[]
}

// ---------------------------------------------------------------------------
// The call table
// ---------------------------------------------------------------------------

/** One recognised call: `time.sleep_ms(200)` → `snakie_wait_ms` with MS=200. */
export interface CallRule {
  /** The module it goes through, e.g. `time`. Absent ⇒ a bare call like `print`. */
  module?: string
  /** The function name. */
  fn: string
  /** The block type to build. */
  type: string
  /** Socket names for the positional arguments, in order. */
  args?: readonly string[]
  /** Statement blocks stack; value blocks plug in. */
  shape?: 'statement' | 'value'
  /** This call is made on a hoisted object rather than a module (#1058). */
  receiver?: CallReceiver
  /** Positional arguments that are fields rather than sockets, by index. */
  argFields?: Readonly<Record<number, ArgField>>
  /**
   * THE CALL IS A METHOD ON ANY OBJECT, and this is the socket it goes in (W2,
   * #1089).
   *
   * Neither of the two shapes above: `module` is a literal module name and
   * `receiver` is an object the generator itself hoisted, and `xs.append(v)` is
   * a method on whatever the learner happens to have called their list. So the
   * receiver becomes a SOCKET — `snakie_list_append`'s LIST — and the argument
   * list is what is left.
   */
  on?: string
  /**
   * This `on` rule claims a receiver the learner NAMED, and only that (#1097).
   *
   * `led.value(1)` and `pin_15.value(1)` are the same line twice over, and two
   * blocks write it: `snakie_pin_write_named`, which takes the pin in a socket,
   * and `snakie_pin_write`, whose pin is a dropdown and whose receiver is an
   * object the generator hoisted. The NAME decides which, because that is what
   * the learner wrote.
   *
   * A rule with this set is tried in a pass of its own, ahead of the hoisted
   * path, and only where the receiver is a bare name a `name pin` block gave
   * out. Every other `on` rule sits that pass out, so the two can never race.
   */
  onNamedPin?: boolean
  /**
   * Fields this rule fixes on the block it builds.
   *
   * `snakie_math_min_max` is one block with a `smallest`/`largest` dropdown, so
   * `min(a, b)` and `max(a, b)` are two rules producing the same block type with
   * different `OP`s. Without this the reader could only ever produce one of them.
   */
  fields?: Readonly<Record<string, string>>
  /**
   * Socket name → the type that socket CHECKS, for the sockets that check one.
   *
   * The #1071 rule, applied to palette-registered rules: a block built with a
   * `text` in a socket that wants Number is a workspace `Blockly.serialization`
   * throws on, and the throw costs the learner every block in the file rather
   * than the one line. A rule whose argument cannot fit declines, and the line
   * stays raw.
   */
  checks?: Readonly<Record<string, SocketType>>
  /**
   * Sockets that are ONE-BASED on the block and zero-based in the Python
   * (#1122, epic #1119).
   *
   * The Lists drawer counts from 1 and writes the `- 1` out visibly — see
   * `lists.ts` for why that was chosen over renumbering in silence. Reading one
   * back means undoing the same arithmetic, and only the two forms the
   * generator can write are undoable: a literal, counted back up, and the
   * `- 1` it wrote. `xs.pop(n)` is neither, so a rule naming a socket here
   * DECLINES that line rather than producing a block which would regenerate as
   * `xs.pop(n - 1)` — somebody's line, rewritten.
   */
  oneBased?: readonly string[]
}

/**
 * HARDWARE COMES BACK IN TWO LINES (#1058).
 * ---------------------------------------------------------------------------
 *
 * Everything above reads ONE line: `turtle.forward(100)` in, one block out. A
 * hardware block does not write one line. It writes a constructor hoisted into
 * the setup section and a call that uses it:
 *
 *     led_15 = Led(pin=Pin(15, Pin.OUT))     <- the setup
 *     led_15.set(True)                        <- the block's own line
 *
 * and the pin lives in the object's NAME rather than in either call. So reading
 * one block back means reading both lines, putting the pin in a field, and then
 * making sure the constructor does not also become a block of its own — which
 * would generate it twice.
 *
 * THE CONSTRUCTOR IS ONLY CONSUMED WHEN IT IS SAFE TO. Dropping a line is the
 * one thing this module must never do carelessly, so the decision is made from
 * the FINISHED conversion rather than guessed at: convert once, see which
 * hoisted names became real blocks and which are still mentioned by a raw block,
 * and only then convert again dropping the constructors that are fully
 * accounted for. Two passes over a lexer is cheap; a deleted line is not.
 */
export type { CallReceiver, ArgField, SocketType }

/**
 * The calls this recognises, beyond the ones the palettes register themselves.
 *
 * Deliberately a TABLE and not a pile of `if`s: adding a recognition is a data
 * change, which is the same promise #1017 makes about adding a block. The turtle
 * palette contributes its own eighteen through {@link registerCallRules}, so
 * this file does not restate knowledge that `palette/turtle.ts` already has.
 */
const BUILT_IN_RULES: CallRule[] = [
  { module: 'time', fn: 'sleep', type: 'snakie_wait_seconds', args: ['SECS'] },
  { module: 'time', fn: 'sleep_ms', type: 'snakie_wait_ms', args: ['MS'] },
  { module: 'time', fn: 'sleep_us', type: 'snakie_wait_us', args: ['US'] },
  { module: 'time', fn: 'ticks_ms', type: 'snakie_ticks_ms', shape: 'value' },
  { module: 'time', fn: 'ticks_us', type: 'snakie_ticks_us', shape: 'value' },
  // `ticks_diff(end, start)` — the LATER reading first, which is why the sockets
  // come back the other way round from the arguments.
  { module: 'time', fn: 'ticks_diff', type: 'snakie_ticks_diff', args: ['TO', 'FROM'], shape: 'value' },
  { fn: 'print', type: 'text_print', args: ['TEXT'] },
  { fn: 'len', type: 'text_length', args: ['VALUE'], shape: 'value' },
  { fn: 'abs', type: 'snakie_math_abs', args: ['NUM'], shape: 'value' },
  { fn: 'round', type: 'math_round', args: ['NUM'], shape: 'value' },
  // `round(x, 1)` — two arguments, so it cannot be `math_round` and needs the
  // block that has a socket for the places.
  { fn: 'round', type: 'snakie_math_round_places', args: ['NUM', 'PLACES'], shape: 'value' }
]

const REGISTERED: CallRule[] = []

/**
 * Let a palette declare how its own calls read back.
 *
 * Called at module load by the palettes that can say it cheaply, so the table
 * and the emitters cannot disagree about what `turtle.forward` looks like.
 */
export function registerCallRules(rules: readonly CallRule[]): void {
  for (const rule of rules) {
    const key = ruleKey(rule)
    const at = REGISTERED.findIndex((r) => ruleKey(r) === key)
    if (at === -1) REGISTERED.push(rule)
    else REGISTERED[at] = rule
  }
}

/**
 * What makes two rules the same rule, for replacement.
 *
 * NOT just module + function (#1058). A receiver rule has no module at all —
 * its call goes through an object this file declared — so every hardware rule
 * keyed as `.set`, `.value`, `.toggle`, and `snakie_pin_read`'s `value` quietly
 * REPLACED `snakie_pin_write`'s. `pin_15.value(1)` then had no rule to match and
 * fell back to a raw block, while `pin_15.toggle()` beside it read fine.
 *
 * The receiver's own name and the shape are part of the identity: `pin.value`
 * as a statement writes a pin, and `pin.value` as a value reads one. Two rules,
 * two blocks.
 */
function ruleKey(rule: CallRule): string {
  // A method-on-any-object rule (W2) shares nothing with a bare call of the same
  // name — `xs.append(v)` and a hypothetical `append(v)` are different lines —
  // so the receiver socket is part of the identity too.
  const receiver = rule.on ? `*${rule.on}` : (rule.receiver?.name ?? rule.module ?? '')
  const fields = rule.fields ? `:${Object.entries(rule.fields).sort().join(',')}` : ''
  return `${receiver}.${rule.fn}/${rule.shape ?? 'statement'}${fields}`
}

/** Every rule, palette-registered ones first so a palette can override. */
function rules(): CallRule[] {
  return [...REGISTERED, ...BUILT_IN_RULES]
}

/**
 * Every block type some rule can produce (W2, #1089).
 *
 * For `test/blocksPaletteSymmetry.test.ts`, which holds the palette and the
 * reader to being two halves of one thing: a block a learner can drag out of the
 * toolbox should be a block that comes back when they reopen their file, and any
 * exception to that should be a listed, argued one rather than an oversight.
 */
export function readableBlockTypes(): Set<string> {
  return new Set([...rules().map((rule) => rule.type), ...ALIASES.map((rule) => rule.type)])
}

/** Forget the registered rules — for tests, which must not leak into each other. */
export function resetCallRules(): void {
  REGISTERED.length = 0
  ALIASES.length = 0
}

// ---------------------------------------------------------------------------
// Declarations (W10, #1097)
// ---------------------------------------------------------------------------

/**
 * A BLOCK WHOSE WHOLE PYTHON OUTPUT IS AN ASSIGNMENT (W10, #1097, epic #1086).
 *
 * `CallRule` describes a CALL, and `snakie_name_pin` does not write one: it
 * writes `echo = Pin(0, Pin.IN)` and nothing else. So it is the one hardware
 * block that could never have a `read` rule, and a pin somebody named came back
 * as *set echo to (grey blob)* — a line the coverage ratchet counts as fully
 * recognised, which is exactly why W0 measures sockets separately.
 *
 * IT IS ALSO THE KEYSTONE FOR THE REST OF THE HARDWARE ROUND TRIP. #1058 reads
 * a hardware block back off its constructor, but only when the object's name is
 * one the GENERATOR wrote — `pin_15`, `led_15`, `servo_3` — because the pin has
 * to come out of the name. Relaxing that on its own is unsafe: with an arbitrary
 * name, a `snakie_pin_write` holding `PIN=15` regenerates as
 * `pin_15 = Pin(15, Pin.OUT)` and silently renames the learner's `led`.
 *
 * This block is what resolves it, because it is the block that HOLDS THE NAME —
 * and pin fields have always accepted a name as well as a number
 * (`isPinName`/`resolvePinGpio` in `board-pins.ts`). So a declaration read as
 * this block lets every call on that object be read as the hardware block it is,
 * with the learner's own name in the pin field, and regenerate unchanged.
 */
export interface AliasRule {
  /** The block type that declares the name. */
  type: string
  /** The field holding the learner's name. */
  nameField: string
  /** The field holding the pin — a number here, a name everywhere else. */
  pinField: string
  /**
   * The field holding the mode, or `''` for a block whose mode is not a choice.
   *
   * A pin is named `for output` or `for input`, which is four constructors and a
   * dropdown. A PWM is named one way, so there is no field — and an empty name
   * here is what says so, rather than a field called `''` on every block.
   */
  modeField: string
  /** Mode value → the exact expression the block writes, `{PIN}` for the number. */
  modes: Readonly<Record<string, string>>
  /**
   * The {@link CallReceiver} name whose calls a name declared this way may serve.
   *
   * `echo = Pin(0, Pin.IN)` is the same object `pin_0 = Pin(0, Pin.IN)` would
   * have been, so every `pin` rule applies to it — with the NAME in the pin
   * field instead of the number.
   */
  receiver: string
}

const ALIASES: AliasRule[] = []

/** Let a palette declare how its naming block reads back. */
export function registerAliasRules(rules: readonly AliasRule[]): void {
  for (const rule of rules) {
    const at = ALIASES.findIndex((r) => r.type === rule.type)
    if (at === -1) ALIASES.push(rule)
    else ALIASES[at] = rule
  }
}

/** One name a program declares for a pin, as read off its declaration line. */
interface Alias {
  rule: AliasRule
  /** The pin number the constructor names. */
  pin: string
  /** Which of the rule's modes the constructor is. */
  mode: string
}

/**
 * Every name this file declares for a pin, by name.
 *
 * MATCHED CHARACTER FOR CHARACTER against what the block writes, exactly as
 * {@link hoistedObjects} is: a constructor somebody wrote their own way is not
 * this block's, and reading it back as one would rewrite their line.
 */
function declaredAliases(lines: readonly LogicalLine[]): Map<string, Alias> {
  const out = new Map<string, Alias>()
  if (ALIASES.length === 0) return out
  for (const line of lines) {
    const m = /^([A-Za-z_]\w*)\s*=\s*(\S.*)$/.exec(line.text)
    if (!m) continue
    // THE NAMES ALREADY DECLARED ARE PART OF THE QUESTION: `motor_a =
    // PWM(motor_left)` is the PWM naming block written on a pin this file has
    // already named, and only a scan that remembers `motor_left` can see it.
    // In order, because a declaration can only be built on one above it.
    const found = matchAlias(m[2].trim(), out)
    if (found) out.set(m[1], found)
  }
  return out
}

/**
 * Which naming block, if any, writes exactly `expr`?
 *
 * `declared` is what this file has named so far, so `{PIN}` can be a NAME as
 * well as a number: the `name PWM` block builds on the pin object when the pin
 * has one (`PWM(motor_left)`, not a second `Pin(15)` on the same hole), and the
 * block that holds the name is a block whose pin field holds a name too.
 */
function matchAlias(expr: string, declared?: ReadonlyMap<string, Alias>): Alias | null {
  for (const rule of ALIASES) {
    for (const [mode, template] of Object.entries(rule.modes)) {
      const pattern = new RegExp(`^${escapeRe(template).replace('\\{PIN\\}', '(\\d+)')}$`)
      const found = pattern.exec(expr)
      if (found) return { rule, pin: found[1], mode }
      const byName = namedPinTemplate(template).exec(expr)
      // A RULE THAT DECLARES A PIN CANNOT BE BUILT ON ONE. `Pin(motor_left,
      // Pin.OUT)` is not a second name for a pin — `Pin` takes a number — so
      // only the rules that build something ON a pin (the PWM) take a name
      // here, and `Pin(x, Pin.OUT)` with a variable in it stays the raw line it
      // has always been.
      if (byName && rule.receiver !== 'pin' && declared?.get(byName[1])?.rule.receiver === 'pin') {
        return { rule, pin: byName[1], mode }
      }
    }
  }
  return null
}

/** The same template with a NAME where the pin number goes. */
function namedPinTemplate(template: string): RegExp {
  // `escapeRe` has already escaped the braces and the brackets, so the needle
  // is the escaped spelling of `Pin({PIN})` — the whole constructor, because a
  // name stands for the pin OBJECT and not for the number inside it.
  return new RegExp(`^${escapeRe(template).replace('Pin\\(\\{PIN\\}\\)', '([A-Za-z_]\\w*)')}$`)
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

/** Turn Python into a blocks workspace. Never throws; never refuses. */
export function pythonToBlocks(source: string): Conversion {
  const lines = logicalLines(source)
  // Every name this file gives a pin (W10, #1097) — read before anything else,
  // because it is what lets a hoisted object have a name the learner chose.
  const aliases = declaredAliases(lines)
  // Which hoisted objects this file even HAS (#1058) — the constructor lines
  // that match a receiver rule's template exactly.
  //
  // ASKED TWICE, and the first answer is what stops W10 undoing #1058. A name
  // the GENERATOR wrote — `pin_15` — is already a hoisted object whose
  // constructor is consumed and whose pin comes out of its name, and it also
  // happens to be a line a `name pin` block would write. Reading it as BOTH gave
  // the file two objects on one pin: the learner's `pin_15` and the blocks' own
  // hoisted copy, renamed `pin_15_` to dodge the collision. So the generator's
  // own names are taken off the alias list before anything else looks at it.
  for (const name of hoistedObjects(lines, rules()).keys()) aliases.delete(name)
  const hoisted = hoistedObjects(lines, rules(), aliases)
  // THE FIRST PASS IS A QUESTION, NOT AN ANSWER. It asks which of those objects
  // actually became blocks, and which are still named by a raw block — because a
  // constructor may only be consumed when every use of its object was
  // understood. Guessing that from the text would be guessing; converting and
  // looking is not.
  const probe = convert(lines, hoisted, null, aliases)
  const consumable = new Set([...probe.claimed].filter((name) => !probe.rawNames.has(name)))
  // A NAME IS NOT ALL-OR-NOTHING — not any more, and the reason is worth keeping.
  //
  // It used to be. Reading `led = Pin(25, Pin.OUT)` as the `name pin` block puts
  // `led` in the SETUP section, and the generator's collision rule then minted
  // `led_` for a VARIABLE of the same name — so `led.on()` beside it, ordinary
  // MicroPython with no block of its own, came back `led_.on()`. The reader
  // defended against that by dropping the name entirely whenever any use of it
  // was unreadable, which meant the single commonest program there is —
  // `led = Pin(25, Pin.OUT)` then `led.on()` / `led.off()` — never got the
  // block, and came back as *set led to (grey blob)*.
  //
  // The generator now treats a declared pin and a variable of that name as ONE
  // binding (`boundName`), because that is what they are, so there is nothing
  // left to defend against: the declaration is always the `name pin` block, and
  // every other mention — a hardware block, a generic call, a raw line — says
  // `led` and means it.
  const named = aliases
  // The probe read every hoisted call it could and swallowed no constructors —
  // it was only ever a question. So whenever it read ANY, the real pass has to
  // run: to swallow the constructors of the objects that came out fully
  // understood, and to leave the rest of the program exactly as it was. A file
  // with names in it has to run again for the same reason.
  const again = probe.claimed.size > 0 || aliases.size > 0
  const state = again ? convert(lines, hoisted, consumable, named) : probe
  const stack = state.stack
  // Definitions are TOP-LEVEL blocks, not links in the chain: Blockly models a
  // `def` as a hat with no previous or next connection, which is also the truth
  // about Python — a function is not a step in the program, it is a thing the
  // program can do. The generator hoists their code above the body either way.
  const roots = [...state.definitions, ...(stack ? [stack] : [])]
  const positioned = stackRoots(roots)
  identify(positioned)
  // Ascending, as the field promises: a block demoted to a raw one because it
  // turned out not to be last in its chain (#1068) reports its line after the
  // walk that found it, not during.
  state.report.rawLines.sort((a, b) => a - b)
  const workspace: BlocksWorkspace = {
    blocks: { languageVersion: 0, blocks: positioned }
  }
  if (state.variables.size > 0) {
    ;(workspace as Record<string, unknown>).variables = [...state.variables].map(([name, id]) => ({
      name,
      id
    }))
  }
  return { workspace, report: state.report }
}

/**
 * WHERE THE ROOTS GO (#1062).
 * ---------------------------------------------------------------------------
 *
 * They used to be a fixed 240px apart, which is fine for the programs this was
 * written against and wrong for a real module. A class with eight methods is
 * well over a thousand pixels tall, so the next four `def`s were drawn ON TOP
 * of it — and blocks overlapping blocks is the one thing a block canvas must
 * never do, because the whole premise is that what you see is the structure.
 *
 * So each root is placed under the measured bottom of the one before it. The
 * measurement is an ESTIMATE, because this module is pure — it emits Blockly's
 * serialisation as plain JSON and has never loaded Blockly, which is what lets
 * the whole converter be unit-tested in node. It counts rows instead, which it
 * can do exactly, and multiplies by the row height the Soft Shell renderer
 * actually uses.
 *
 * THE CONSTANTS ARE MEASURED, not guessed. Rendering the turtle starter — one
 * `repeat` holding two statements — in the real canvas gives a root exactly
 * 176px tall, which is 48 + 2x48 + 32: one row for the header, one per block in
 * the mouth, and the arm underneath. That is what `ROW_HEIGHT` and
 * `MOUTH_BOTTOM` below are.
 *
 * Where it is still an estimate, it errs UPWARDS, and the gutter is wide. Being
 * a little too far apart costs a scroll; being too close costs the overlap this
 * exists to remove, and only one of those is a bug.
 */

/** Where the first root goes, and the left margin for all of them. */
const ROOT_ORIGIN = 40

/** Clear space between one root's bottom and the next root's top. */
const ROOT_GUTTER = 48

/**
 * One statement row, in px — `MIN_BLOCK_HEIGHT` plus the top and bottom strips
 * from `lib/blocks/renderer.ts`, rounded up.
 */
const ROW_HEIGHT = 48

/** The arm under a C-block's mouth. Measured: see above. */
const MOUTH_BOTTOM = 32

/** The hat a `def` wears — real height above its first row, and only it has one. */
const HAT_HEIGHT = 32

/** Lay the roots out in one column, each clear of the one above it. */
function stackRoots(roots: readonly BlockJson[]): BlockJson[] {
  let y = ROOT_ORIGIN
  return roots.map((block) => {
    const placed = { ...block, x: ROOT_ORIGIN, y }
    y += rootHeight(block) + ROOT_GUTTER
    return placed
  })
}

/** How tall a root renders, including everything chained below it. */
function rootHeight(block: BlockJson): number {
  const hat = block.type.startsWith('procedures_def') ? HAT_HEIGHT : 0
  return hat + chainHeight(block)
}

/** A block and its `next` chain. */
function chainHeight(block: BlockJson | undefined): number {
  let total = 0
  for (let b: BlockJson | undefined = block; b; b = b.next?.block) total += blockHeight(b)
  return total
}

/** One block: its own row(s), plus any statement bodies it holds open. */
function blockHeight(block: BlockJson): number {
  // A comment block is one row PER LINE — which is the whole point of #1062's
  // folding, and the case that would break a per-block estimate worst.
  const lines = (block.extraState as { lines?: unknown[] } | undefined)?.lines
  let total = Array.isArray(lines) && lines.length > 0 ? lines.length * ROW_HEIGHT : ROW_HEIGHT
  for (const [name, input] of Object.entries(block.inputs ?? {})) {
    // A VALUE socket sits on the row that is already counted; only a STATEMENT
    // body adds height, and it brings the arm under the mouth with it.
    if (input.block && isStatementBody(name)) total += chainHeight(input.block) + MOUTH_BOTTOM
  }
  return total
}

/**
 * Is this input a statement BODY — something that adds height — rather than a
 * value socket, which sits on a row already counted?
 *
 * Read off the INPUT NAME, and these are all of them: the converter writes
 * exactly `DO`, `DO0…DOn`, `ELSE` and `STACK`, and nothing else opens a mouth.
 *
 * Sniffing the block instead, which is what this did first, counted every value
 * socket's contents as vertical height — a comparison inside an `if` added
 * three rows that are not there. On the module in #1062 that reserved 1312px
 * for a root which renders 559, so the roots were laid out correct but a screen
 * apart. Measured against the real canvas; see the comment above.
 */
function isStatementBody(input: string): boolean {
  // `BODY` is the class and method blocks (W6), `TRY` and `FINALLY` the `try`
  // block (W7). A body the estimator cannot see is a root measured short, and a
  // root measured short is one the next root is drawn on top of.
  return (
    input === 'ELSE' ||
    input === 'STACK' ||
    input === 'BODY' ||
    input === 'TRY' ||
    input === 'FINALLY' ||
    /^DO\d*$/.test(input)
  )
}

/**
 * A node standing for a RUN of consecutive comment lines (#1062), in place of
 * the several statement nodes they arrived as.
 */
interface CommentRun extends Stmt {
  comment: readonly LogicalLine[]
}

/**
 * Is the line above this one a DECORATOR? (W6, #1093)
 *
 * A decorated `def` must not be hoisted into the functions section, because the
 * decorator stays where it is and the two would be separated: `@app.route("/")`
 * came back with its `def` lifted above it, so the decorator decorated whatever
 * happened to follow and the route was gone. And the round-trip gate cannot see
 * it — the gate compares a BAG of line signatures, deliberately, so that the
 * generator's hoisting is not mistaken for a rewrite, and a line that moved
 * without changing is exactly what it forgives.
 *
 * So a decorated `def` reads as the stackable method block instead, which stays
 * in the chain immediately under the decorator, whether the decorator itself was
 * one we understood or a raw line.
 */
function decoratedAbove(node: Stmt, siblings: readonly Stmt[]): boolean {
  const before = siblings[siblings.indexOf(node) - 1]
  return Boolean(before && before.line.text.startsWith('@') && before.body.length === 0)
}

/** Is this line nothing but a comment? */
function isCommentLine(line: LogicalLine): boolean {
  return line.text.startsWith('#')
}

/**
 * Fold each run of consecutive comment siblings into one node (#1062).
 *
 * WHY THIS IS WORTH DOING AT ALL. A real module's header is prose — the file in
 * #1062 opens with thirty lines of rationale and an ASCII table — and one grey
 * block per line made the canvas taller than the class being described, with
 * thirty indistinguishable shapes at the top of it. A comment is not a step in
 * the program, and a paragraph is not thirty steps.
 *
 * CONSECUTIVE, and siblings only: a node's body is already one indent level, so
 * a comment inside a function never joins the one above the `def`.
 *
 * A BLANK LINE BREAKS THE RUN. It did not use to, on the reasoning that
 * `logicalLines` dropped blank lines anyway and a paragraph split by one is
 * still a paragraph. Blank lines are carried now, and a run folded across one
 * has nowhere to put it: two comment paragraphs came back as one block and the
 * gap between them was gone the next time the program was regenerated. Two
 * paragraphs are two runs, with the learner's blank line still between them.
 */
function groupComments(nodes: readonly Stmt[]): Stmt[] {
  const out: Stmt[] = []
  let run: LogicalLine[] = []
  const flush = (): void => {
    if (run.length === 0) return
    // ONE of them is not a run. A lone comment stays a comment block all the
    // same — one shape for one idea, whether it is one line or thirty.
    out.push({ line: run[0], body: [], comment: run } as CommentRun)
    run = []
  }
  for (const node of nodes) {
    if (isCommentLine(node.line) && node.body.length === 0) {
      if ((node.line.blankBefore ?? 0) > 0) flush()
      run.push(node.line)
      continue
    }
    flush()
    out.push(node)
  }
  flush()
  return out
}

/**
 * A call's ARGUMENTS, split on the commas that are actually separators.
 *
 * A plain `split(',')` is right for a parameter list of bare names — which is
 * what {@link splitSignature} does — and wrong for `wiggle(f(1, 2), 3)`.
 * Returns null when the brackets or quotes do not balance, which is the
 * caller's signal to leave the line raw rather than guess at it.
 */
function splitArgs(args: string): string[] | null {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let buffer = ''
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]
    if (quote) {
      if (ch === '\\') {
        buffer += ch + (args[i + 1] ?? '')
        i += 1
        continue
      }
      if (ch === quote) quote = null
      buffer += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buffer += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1
    if (ch === ')' || ch === ']' || ch === '}') depth -= 1
    if (depth < 0) return null
    if (ch === ',' && depth === 0) {
      out.push(buffer.trim())
      buffer = ''
      continue
    }
    buffer += ch
  }
  if (depth !== 0 || quote) return null
  const last = buffer.trim()
  if (last !== '') out.push(last)
  // A trailing comma leaves an empty slot, which is not an argument.
  return out.every((a) => a !== '') ? out : null
}

/**
 * `f"{value:.2f}"` → which format block wrote it, and with what (#1125).
 *
 * Null for every other f-string, including one with any literal text in it.
 * The three specs here are the three the blocks emit and nothing more: a spec
 * this does not recognise belongs to a line somebody wrote by hand, and coming
 * back as an approximation of it would be a rewrite.
 */
function readFormatString(
  literal: string
): { type: string; fields: Record<string, string>; expr: string } | null {
  // DOUBLE QUOTES ONLY, which is what the blocks emit. `f'{t:.1f}'` is the same
  // string and a different line, and a block has nowhere to record which quote
  // the learner used — the same reason `0x3C` needed a field that holds text
  // rather than a number (#1127).
  if (!literal.startsWith('"')) return null
  const body = readStringLiteral(literal)
  if (body === null) return null
  const slot = /^\{(.+):([^{}]+)\}$/.exec(body)
  if (!slot) return null
  const [, expr, spec] = slot
  // An expression with a brace in it is a nested f-string or a dict display,
  // neither of which these blocks can hold.
  if (/[{}]/.test(expr) || expr.trim() === '') return null
  const places = /^\.(\d+)f$/.exec(spec)
  if (places) return { type: 'snakie_format_places', fields: { PLACES: places[1] }, expr }
  const width = /^>(\d+)$/.exec(spec)
  if (width) return { type: 'snakie_format_pad', fields: { WIDTH: width[1] }, expr }
  const base = /^#([xb])$/.exec(spec)
  if (base) return { type: 'snakie_format_base', fields: { BASE: base[1] }, expr }
  return null
}

/**
 * Does `text` carry a `for` at the top level of its brackets?
 *
 * Which is to say: is it a COMPREHENSION rather than a display (#1126)? The
 * literal readers use it to decline, because a comprehension has no top-level
 * commas and would otherwise split into a single "item" holding the whole of
 * it — half an expression, and worse than none.
 */
function hasLoopKeyword(text: string): boolean {
  const tokens = tokenize(text)
  if (!tokens) return false
  let depth = 0
  for (const tok of tokens) {
    if (tok.kind === 'open') depth += 1
    else if (tok.kind === 'close') depth -= 1
    else if (depth === 0 && tok.kind === 'keyword' && tok.text === 'for') return true
  }
  return false
}

/**
 * `'name': value` → the two halves, or null (#1120).
 *
 * The FIRST top-level colon, so `{'a': d['b']}` splits where it should and a
 * colon inside a nested slice or dict does not fool it. Null for a piece with
 * no colon at all, which is how `{1, 2}` — a set, which this palette has no
 * blocks for — declines to be read as a dictionary.
 */
function splitPair(text: string): [string, string] | null {
  const tokens = tokenize(text)
  if (!tokens) return null
  let depth = 0
  for (const tok of tokens) {
    if (tok.kind === 'open') depth += 1
    else if (tok.kind === 'close') depth -= 1
    else if (depth === 0 && tok.kind === 'op' && tok.text === ':') {
      const key = text.slice(0, tok.start).trim()
      const value = text.slice(tok.end).trim()
      return key === '' || value === '' ? null : [key, value]
    }
  }
  return null
}

/**
 * A parameter list, split into the part Blockly's mutator can hold and the rest
 * (#1063, widened by #1134).
 *
 * Blockly's parameters are bare NAMES — they become workspace variables — so a
 * default (`flip_x=None`), a type annotation, `*args` or `**kwargs` has nowhere
 * to live in the mutator. This used to be a boolean, and a `def` carrying any
 * of them went to a raw suite whole: correct, and it meant
 * `def blink(times=3):` — a beginner-friendly helper, and nearly every driver's
 * `__init__` — came back as a grey wall.
 *
 * #1134 gave the block a FIELD for the rest, appended after the declared ones,
 * so the split is what this returns. Everything from the first parameter
 * Blockly cannot hold onwards goes into the field VERBATIM, which keeps
 * keyword-only parameters after a `*args` in the order Python needs and never
 * reorders anybody's signature.
 *
 * Null for a list that cannot be split at all — an empty piece, which means a
 * trailing comma the block has nowhere to record.
 */
function splitSignature(params: string): { declared: string[]; extra: string } | null {
  const pieces = params.split(',').map((p) => p.trim())
  if (pieces.length === 1 && pieces[0] === '') return { declared: [], extra: '' }
  if (pieces.some((p) => p === '')) return null
  const plain = (p: string): boolean => /^[A-Za-z_]\w*$/.test(p)
  let at = 0
  while (at < pieces.length && plain(pieces[at])) at += 1
  return { declared: pieces.slice(0, at), extra: pieces.slice(at).join(', ') }
}

// ---------------------------------------------------------------------------
// Hoisted objects (#1058)
// ---------------------------------------------------------------------------

/** One hoisted object, as read back off its constructor line. */
export interface Hoisted {
  /** The pin out of the object's NAME: `15` from `led_15`. */
  pin: string
  /**
   * EVERY rule this constructor could serve, not just the first.
   *
   * One object backs several blocks — `buzzer_16` is the receiver of both
   * `tone` and `stop`, and `pin_15` of both `value` and `toggle`. Keeping only
   * the first match made the second call unreadable, which then kept the
   * constructor alive as a raw block AND let the blocks hoist a second copy of
   * it under a collision-avoiding name. The call's own function name picks.
   */
  matches: readonly { rule: CallRule; fields: Readonly<Record<string, string>> }[]
}

/**
 * Every name the import lines in this file BIND (W1, #1088).
 *
 * `import machine` binds `machine`; `import ujson as json` binds `json`;
 * `from machine import Pin, PWM` binds both. The generator's import manager owns
 * those names — they are in its `taken` set before a single variable is minted —
 * so a `variables_get` for one of them comes back RENAMED:
 * `machine.lightsleep(10)` read as a generic call regenerated as
 * `machine_.lightsleep(10)`, a program that no longer runs.
 *
 * And the round-trip gate cannot see it. Names are placeholders in a line
 * signature, deliberately, so that `id` → `id_` does not hold the blocks back —
 * which means a renamed module reads as the same program. The guard has to be
 * here, before the block is built.
 *
 * So a module is not an object, and a call into one is either a rule the reader
 * knows or a raw line. That is exactly what it was before W1; nothing regresses.
 */
function importedNames(lines: readonly LogicalLine[]): Set<string> {
  const out = new Set<string>()
  for (const line of lines) {
    const as = /^import\s+([A-Za-z_][\w.]*)\s+as\s+([A-Za-z_]\w*)$/.exec(line.text)
    if (as) {
      out.add(as[2])
      continue
    }
    const plain = /^import\s+([A-Za-z_][\w.]*)(\s*,\s*[A-Za-z_][\w.]*)*$/.exec(line.text)
    if (plain) {
      for (const name of line.text.slice('import'.length).split(',')) {
        // `import os.path` binds `os`, which is the name that would collide.
        out.add(name.trim().split('.')[0])
      }
      continue
    }
    const from = /^from\s+[A-Za-z_][\w.]*\s+import\s+(.+)$/.exec(line.text)
    if (!from) continue
    for (const part of from[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)
      const bound = (name[1] ?? name[0]).trim()
      if (/^[A-Za-z_]\w*$/.test(bound)) out.add(bound)
    }
  }
  return out
}

/** `led_15 = Led(...)` → `led_15`. Null for anything that is not an assignment. */
export function constructorName(text: string): string | null {
  return /^([A-Za-z_]\w*)\s*=\s*\S/.test(text) ? /^([A-Za-z_]\w*)/.exec(text)![1] : null
}

/** Does `text` use `name` as a whole word? */
function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(name)}([^A-Za-z0-9_]|$)`).test(text)
}

/**
 * A `def` header, with the `async` W9 (#1096) made a setting rather than a shape.
 *
 * Groups: the `async` keyword or undefined, the name, the parameter list.
 */
const DEF_HEADER = /^(async\s+)?def\s+([A-Za-z_]\w*)\((.*)\)\s*:$/

/**
 * Blocks whose 1-based setting writes `<call> + 1` (#1122, #1124).
 *
 * `xs.index(v)` and `s.find(n)` both answer 0-based, and both drawers count
 * from 1 — so the friendly face has to write the `+ 1`, which is arithmetic
 * around a call that no plain rule can read. The reader folds exactly that
 * shape back into the block's own setting; `xs.index(v) + 2` is arithmetic
 * somebody wrote and stays it.
 */
const ONE_BASED_PLUS_ONE = new Set(['snakie_list_index', 'snakie_text_find'])

/** The multiplicative operators, as `math_arithmetic`'s dropdown spells them. */
const MULTIPLICATIVE_OP: Record<string, string> = {
  '*': 'MULTIPLY',
  '/': 'DIVIDE',
  '//': 'FLOORDIVIDE'
}

/** Every augmented-assign operator the block has a setting for (W8, #1095). */
const AUGMENTED = new Set([
  '+=',
  '-=',
  '*=',
  '/=',
  '//=',
  '%=',
  '**=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>='
])

/**
 * Where the `=` that ASSIGNS is, or -1 (W8, #1095).
 *
 * The LAST one at bracket depth zero: `a = b = 0` is one value going into two
 * names, so everything before the last `=` is the target.
 *
 * Asked of the lexer, which is what makes the old `=(?!=)` guard unnecessary
 * rather than merely preserved. `==`, `!=`, `<=`, `>=` and every augmented
 * assign lex as operators of their own and simply are not this token — where the
 * regex it replaces once read `x == 5` as assigning `= 5` to `x` and regenerated
 * it as `x = = 5`, which is not Python at all (#1068).
 */
function topLevelAssign(tokens: readonly Token[]): number {
  let depth = 0
  let at = -1
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.kind === 'open') depth += 1
    else if (tok.kind === 'close') depth -= 1
    else if (depth === 0 && tok.kind === 'op' && tok.text === '=') at = i
  }
  return at
}

/** Drop up to `width` leading spaces — the body indent, and never more. */
function dedent(text: string, width: number): string {
  let i = 0
  while (i < width && (text[i] === ' ' || text[i] === '\t')) i += 1
  return text.slice(i)
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Every hoisted object this file declares, by name.
 *
 * MATCHED AGAINST THE TEMPLATE, CHARACTER FOR CHARACTER. A constructor that is
 * not exactly what the block would have written is not that block's — somebody
 * wrote their own `Led(...)` differently, and reading it back as a block would
 * rewrite their line. So the name has to fit `<prefix>_<pin>` AND the expression
 * has to match `receiver.ctor` with `{PIN}` filled in and each `{FIELD}` one of
 * its listed options.
 */
export function hoistedObjects(
  lines: readonly LogicalLine[],
  rs: readonly CallRule[],
  aliases: ReadonlyMap<string, Alias> = new Map()
): Map<string, Hoisted> {
  const receivers = rs.filter((r) => r.receiver)
  const out = new Map<string, Hoisted>()
  if (receivers.length === 0) return out
  for (const line of lines) {
    const m = /^([A-Za-z_]\w*)\s*=\s*(\S.*)$/.exec(line.text)
    if (!m) continue
    const [, name, expr] = m
    const matches: { rule: CallRule; fields: Record<string, string> }[] = []
    let pin = ''
    for (const rule of receivers) {
      const rec = rule.receiver!
      const pinMatch = new RegExp(`^${escapeRe(rec.name)}_(\\w+)$`).exec(name)
      if (!pinMatch) continue
      const fields = matchCtor(rec, pinMatch[1], expr.trim())
      if (!fields) continue
      pin = pinMatch[1]
      matches.push({ rule, fields })
    }
    // A NAME THE LEARNER CHOSE (W10, #1097). The generator's own `pin_15` wins,
    // above, because its constructor is consumed and its pin comes out of its
    // name; anything else can still be a hoisted object if a `name pin` block
    // would have written exactly that line — and then the PIN FIELD HOLDS THE
    // NAME, which is what stops regeneration renaming somebody's `echo` to
    // `pin_0`.
    const alias = matches.length === 0 ? aliases.get(name) : undefined
    if (alias) {
      for (const rule of receivers) {
        const rec = rule.receiver!
        if (rec.name !== alias.rule.receiver) continue
        const fields = matchCtor(rec, alias.pin, expr.trim())
        if (!fields) continue
        pin = name
        matches.push({ rule, fields })
      }
    }
    if (matches.length > 0) out.set(name, { pin, matches })
  }
  return out
}

/**
 * Does `expr` match this receiver's constructor for `pin`? If so, with which
 * field values?
 *
 * The template is turned into a regex rather than the expression into a parse
 * tree, because the template is OURS: the generator wrote it, so an exact match
 * is both achievable and the only safe test.
 */
function matchCtor(
  rec: CallReceiver,
  pin: string,
  expr: string
): Record<string, string> | null {
  const names: string[] = []
  let pattern = ''
  let rest = rec.ctor
  for (;;) {
    const at = rest.search(/\{[A-Z_]+\}/)
    if (at === -1) {
      pattern += escapeRe(rest)
      break
    }
    pattern += escapeRe(rest.slice(0, at))
    const token = /^\{([A-Z_]+)\}/.exec(rest.slice(at))![1]
    rest = rest.slice(at + token.length + 2)
    if (token === 'PIN') {
      pattern += escapeRe(pin)
      continue
    }
    const options = rec.options?.[token]
    if (!options) return null
    names.push(token)
    pattern += `(${Object.values(options).map(escapeRe).join('|')})`
  }
  const found = new RegExp(`^${pattern}$`).exec(expr)
  if (!found) return null
  const fields: Record<string, string> = {}
  names.forEach((token, i) => {
    const options = rec.options![token]
    const text = found[i + 1]
    const value = Object.keys(options).find((k) => options[k] === text)
    if (value !== undefined) fields[token] = value
  })
  return fields
}

/** One conversion pass over an already-lexed file. */
function convert(
  lines: readonly LogicalLine[],
  hoisted: ReadonlyMap<string, Hoisted>,
  consumable: ReadonlySet<string> | null,
  aliases: ReadonlyMap<string, Alias> = new Map()
): Converter {
  const state = new Converter(hoisted, consumable, importedNames(lines), aliases)
  const nodes = tree(lines)
  state.indexDefinitions(nodes)
  state.stack = state.statements(nodes)
  return state
}

/** Build the indentation tree. A header owns every line indented past it. */
function tree(lines: readonly LogicalLine[]): Stmt[] {
  const out: Stmt[] = []
  let i = 0
  const read = (indent: number): Stmt[] => {
    const nodes: Stmt[] = []
    while (i < lines.length && lines[i].indent >= indent) {
      // A line indented FURTHER than its siblings with no header above it is
      // malformed Python; take it as a sibling rather than losing it.
      const line = lines[i]
      i += 1
      const node: Stmt = { line, body: [] }
      if (isSuiteHeader(line.text) && i < lines.length && lines[i].indent > line.indent) {
        node.body = read(lines[i].indent)
      }
      nodes.push(node)
    }
    return nodes
  }
  out.push(...read(lines.length > 0 ? lines[0].indent : 0))
  return out
}

/**
 * IDENTITY, FROM POSITION (#1036, epic #1007).
 * ---------------------------------------------------------------------------
 *
 * The conversion used to emit blocks with no `id`, so Blockly minted a fresh
 * random one for every block on every load. Under #1034 that load happens each
 * time the learner pauses typing in the code pane — and a program whose blocks
 * are all new blocks every 450ms is a program with no identity at all:
 *
 *  - #1016's link drops the block you were hovering, because the id it was
 *    holding no longer exists.
 *  - #1015's tracebacks point at a block that was deleted a keystroke ago.
 *  - Any block the learner dragged somewhere goes back to the layout grid.
 *
 * So give a block an id that says WHERE IT IS: root index, then the chain
 * position at each level, then the input name on the way down. Converting the
 * same program twice produces the same ids, and converting an edited program
 * produces the same ids for everything that did not move — which is the whole
 * of what "identity-stable" needs to mean here, with no diff to compute.
 *
 * THE TYPE IS DELIBERATELY NOT IN THE KEY. A learner who replaces
 * `time.sleep(1)` with `print("hi")` has changed what the third statement IS,
 * not which statement it is, and the block at that position is still the block
 * at that position — the hover and the traceback should follow it there. Adding
 * the type would churn an id on every retype and buy nothing.
 *
 * Readable rather than hashed, matching the variable ids a few lines below:
 * `r0.2:DO.1` is a thing you can find on a canvas, and an opaque digest is not.
 * Blockly treats ids as opaque strings, and these cannot collide with its own
 * random 20-character ones.
 */
function identify(roots: readonly BlockJson[]): void {
  roots.forEach((root, i) => identifyChain(root, `r${i}`))
}

/** Walk a statement chain, numbering as it goes. Iterative, so a fifty-line
 *  program's last block gets `r0.49` rather than fifty nested segments. */
function identifyChain(first: BlockJson, path: string): void {
  let block: BlockJson | undefined = first
  let i = 0
  while (block) {
    identifyBlock(block, `${path}.${i}`)
    block = block.next?.block
    i += 1
  }
}

function identifyBlock(block: BlockJson, path: string): void {
  block.id = path
  for (const [name, input] of Object.entries(block.inputs ?? {})) {
    // A value input holds one block, but a statement input (`DO`) holds a
    // chain — so both go through `identifyChain`, which handles one block as
    // the one-element case.
    if (input.block) identifyChain(input.block, `${path}:${name}`)
    // Shadows are the greyed defaults in an empty socket. They get ids too, or
    // Blockly mints random ones and the workspace stops re-serialising
    // identically — which is what `lastLoadedRef` in the canvas compares.
    if (input.shadow) identifyBlock(input.shadow, `${path}:${name}^`)
  }
}

class Converter {
  readonly report: ConversionReport = {
    recognised: 0,
    raw: 0,
    rawLines: [],
    total: 0,
    sockets: 0,
    rawSockets: 0
  }
  /** The module-level chain, filled in by {@link convert}. */
  stack: BlockJson | null = null
  /** Hoisted objects this file declares, by name (#1058). */
  private readonly hoisted: ReadonlyMap<string, Hoisted>
  /**
   * Hoisted names this pass may READ — and therefore whose constructor it
   * swallows. `null` is the probe pass: read everything, swallow nothing.
   *
   * ALL OR NOTHING PER OBJECT, which is the rule the first attempt got wrong.
   * Keeping a constructor because one of its calls was unreadable, while still
   * turning the OTHER calls into blocks, gives you two objects on one pin: the
   * learner's `led_15` and the block's own hoisted copy, renamed `led_15_` to
   * avoid the collision. Two `Led`s driving one pin is a real bug, not an
   * untidiness. So a name is either fully understood — every use a block, the
   * constructor gone — or left alone entirely.
   */
  private readonly consumable: ReadonlySet<string> | null
  /** Hoisted names that became a real block. */
  readonly claimed = new Set<string>()
  /** Hoisted names still mentioned by a RAW block — their constructor must stay. */
  readonly rawNames = new Set<string>()

  /** Names an import line in this file binds — see {@link importedNames}. */
  private readonly imported: ReadonlySet<string>
  /** Names this file gives a pin (W10, #1097), by name. */
  private readonly aliases: ReadonlyMap<string, Alias>

  constructor(
    hoisted: ReadonlyMap<string, Hoisted> = new Map(),
    consumable: ReadonlySet<string> | null = null,
    imported: ReadonlySet<string> = new Set(),
    aliases: ReadonlyMap<string, Alias> = new Map()
  ) {
    this.hoisted = hoisted
    this.consumable = consumable
    this.imported = imported
    this.aliases = aliases
  }
  /** Variable name → the id the workspace declares it under. */
  readonly variables = new Map<string, string>()
  /** `def` blocks, which are top-level hats rather than links in a chain. */
  readonly definitions: BlockJson[] = []
  /**
   * How deep inside a suite we are (#1063). 0 is the module's own top level.
   *
   * A `def` at the top level is a DEFINITION — Blockly models it as a hat with
   * no connections, collected into {@link definitions} and laid out as a root
   * of its own, which is also the truth about Python.
   *
   * A `def` INSIDE something is a method, and hoisting it out of its `class`
   * was the second half of #1063's data loss: the class kept its header and its
   * methods walked off to become twelve top-level functions, each generated
   * un-indented and none of them attached to the object they belong to. A hat
   * cannot nest, so a nested `def` stays where it is as a raw suite instead.
   */
  private depth = 0
  /**
   * A block the generator will hoist has already been converted at top level.
   *
   * Tracked rather than read off the chain being built, because a top-level
   * `def` does not stay in that chain — it becomes a root block of its own, so
   * by the time the line under it is converted there is nothing left in `built`
   * to recognise it by. See {@link spacers}.
   */
  private hoistedAbove = false
  /**
   * The functions this program defines AS BLOCKS, by name.
   *
   * A call to one of them is `procedures_callnoreturn`, the block Blockly builds
   * per definition — which is the whole point of the Functions drawer. Without
   * this, `forwards()` under a perfectly good `def forwards():` came back as a
   * raw Python block: correct, and not a block a learner could author another of.
   *
   * COLLECTED UP FRONT, from the tree, rather than as the defs are converted: a
   * function may be called from inside another function defined above it, which
   * is ordinary Python and would otherwise depend on which one was walked first.
   *
   * Only the ones that really become procedure blocks are in here. A `def` whose
   * parameters Blockly cannot hold stays a raw suite, and a call to it has to
   * stay raw too — a caller block for a definition block that does not exist is
   * a workspace Blockly refuses to load.
   */
  private readonly definedHere = new Map<string, { params: string[]; returns: boolean }>()
  /**
   * The text the expression parser is currently reading, so an argument can be
   * sliced out of it verbatim. Saved and restored around every nested parse,
   * because reading a call's arguments starts a parse inside a parse.
   */
  private source = ''
  /**
   * The `elif`/`else` nodes an `if` above them has already taken (#1068).
   *
   * Identity, not a text test: only the chain that consumed an arm knows it did,
   * and guessing from the text is what lost an `else` whose `if` had a comment
   * between them. Nodes are unique objects, so one set serves the whole tree.
   */
  private readonly consumed = new Set<Stmt>()

  /**
   * Record every top-level `def` this program will model as a procedure block.
   *
   * The same two tests `statement` applies when it converts one, asked here so
   * a call can be recognised before its definition has been walked. Anything
   * that will stay a raw suite is deliberately left out — see `definedHere`.
   */
  indexDefinitions(nodes: readonly Stmt[]): void {
    for (const node of nodes) {
      const def = /^def\s+([A-Za-z_]\w*)\(([^)]*)\):$/.exec(node.line.text)
      // THE SAME TEST `recognise` APPLIES, decorator and all. A `def` under a
      // decorator does not become a procedure block, and registering it here
      // anyway would build a CALLER block for a definition that does not exist —
      // a workspace Blockly refuses to load, which costs the learner every block
      // in the file.
      if (!def || !splitSignature(def[2]) || decoratedAbove(node, nodes)) continue
      const last = node.body[node.body.length - 1]
      this.definedHere.set(def[1], {
        // ONLY THE DECLARED ONES ARE CALLER SOCKETS (#1134). A parameter with a
        // default is optional at the call site, which is the whole reason it
        // has one, so a caller block with a socket for it would be wrong — and
        // the arity check below is what keeps `blink()` and `blink(2)` from
        // both trying to become the same block.
        params: splitSignature(def[2])!.declared,
        // The same rule `definition` uses, down to the comment: a TRAILING
        // `return <expr>` becomes the block's RETURN socket, and that is what
        // makes it a `defreturn`. One carrying a trailing comment does not
        // (#1087), and the two must agree or a caller block is built for a
        // definition of the other shape.
        returns: Boolean(
          last && trailingCommentAt(last.line.text) < 0 && /^return\s+(.+)$/.test(last.line.text)
        )
      })
    }
  }

  /**
   * `wiggle(1, 2)` → the caller block for a function this program defines.
   *
   * `shape` is where the call stands: a statement on its own line, or a value
   * inside something else. They are different blocks — `procedures_callreturn`
   * has an output and cannot sit in a statement chain — and the definition
   * decides which one exists, so a mismatch has no block at all and stays raw:
   *
   *   - a statement call to a function that RETURNS (`double(3)` with the answer
   *     thrown away) — legal Python, and `procedures_callnoreturn` is not the
   *     block for it;
   *   - a value call to one that does not.
   *
   * ARITY IS CHECKED, because the caller's sockets come from the definition: a
   * call with the wrong number of arguments would load with sockets left empty
   * and regenerate as a call with arguments missing, which is the learner's
   * program silently changed. Raw keeps it exactly as written.
   */
  private procedureCall(text: string, shape: 'statement' | 'value'): BlockJson | null {
    const call = /^([A-Za-z_]\w*)\s*\((.*)\)$/.exec(text.trim())
    if (!call) return null
    const defined = this.definedHere.get(call[1])
    if (!defined) return null
    if (defined.returns !== (shape === 'value')) return null
    const args = splitArgs(call[2])
    if (!args || args.length !== defined.params.length) return null
    const block: BlockJson = {
      type: defined.returns ? 'procedures_callreturn' : 'procedures_callnoreturn',
      extraState: { name: call[1], ...(defined.params.length > 0 ? { params: defined.params } : {}) }
    }
    if (args.length > 0) {
      block.inputs = Object.fromEntries(
        args.map((arg, i) => [`ARG${i}`, { block: this.expression(arg) }])
      )
    }
    return block
  }

  /**
   * Push one spacer block per blank line standing above `line`.
   *
   * EXCEPT THE GAP UNDER THE IMPORTS, and that exception is the whole subtlety.
   * Import blocks generate nothing where they stand — the generator hoists every
   * one of them into a section of its own and writes a blank line after it. So
   * the gap a learner typed under their imports is a gap the generator is going
   * to write anyway, and a spacer for it would come back as two.
   *
   * The test is "is the body still empty" — nothing converted at top level so
   * far is anything but hoisted — rather than "is this the first line", because a
   * program may open with several imports and a `def` or two, and it is the gap
   * under the LAST of them that the separator stands for. A program with nothing
   * hoisted above its first line has no section above it, so its leading blank is
   * the learner's and is kept. Inside a suite there are no sections at all, so
   * every blank counts.
   */
  private spacers(line: LogicalLine, built: { block: BlockJson; line: LogicalLine }[]): void {
    const blanks = line.blankBefore ?? 0
    if (blanks === 0) return
    const separator =
      this.depth === 0 &&
      this.hoistedAbove &&
      built.every((b) => HOISTED_TYPES.has(b.block.type))
    for (let i = separator ? 1 : 0; i < blanks; i++) {
      // The literal, like the raw blocks: this module is imported by the palette
      // and must not import back.
      built.push({ block: { type: 'snakie_python_blank' }, line })
    }
  }

  /** A chain of statement blocks, or null for an empty suite. */
  statements(nodes: readonly Stmt[]): BlockJson | null {
    // The line each block came from, carried alongside it: a block that turns
    // out not to be last in its chain has to be re-made as a raw one, and the
    // report needs to know which source line that was.
    const built: { block: BlockJson; line: LogicalLine }[] = []
    // A RUN OF COMMENTS IS ONE BLOCK (#1062). Grouped before anything else
    // looks at them, because the grouping is about consecutive SIBLINGS and
    // this is the only place that sees a whole body at once.
    const grouped = groupComments(nodes)
    for (const node of grouped) {
      if (node.comment) {
        this.report.total += node.comment.length
        this.report.recognised += node.comment.length
        this.spacers(node.line, built)
        built.push({
          block: {
            // The literal, like the raw blocks above: this module is imported by the
            // palette, so it must not import back.
            type: 'snakie_python_comment',
            extraState: { lines: node.comment.map((l) => l.text) }
          },
          line: node.line
        })
        continue
      }
      // A CONSTRUCTOR THE BLOCKS ALREADY CARRY (#1058). `led_15 = Led(...)` is
      // the setup line of a block that also holds the pin, and the generator
      // writes it back out from that block — so keeping it here would generate
      // it twice. Only ever a name the pass before this one proved is fully
      // accounted for.
      //
      // UNLESS THE LINE IS A NAME (W10, #1097). `echo = Pin(0, Pin.IN)` is both
      // a hoisted object's constructor AND the `name pin` block itself, and the
      // block is what carries the learner's name forward — swallow it and
      // regeneration writes `pin_0 = Pin(0, Pin.IN)` instead, quietly renaming
      // their pin. The generator's own `pin_15` has no name to lose, so it is
      // still consumed.
      const declared = constructorName(node.line.text)
      if (declared && this.consumable?.has(declared) && !this.aliases.has(declared)) {
        this.report.total += 1
        this.report.recognised += 1
        continue
      }
      // `pass` USED TO BE DROPPED HERE when it was the whole body of a suite:
      // an empty suite in blocks is an empty socket, and every emitter writes
      // its own `pass` for one, so carrying it over would have added a block
      // meaning "nothing" and then written `pass` twice. (#1068 narrowed an
      // earlier version that dropped it everywhere and lost lines with it.)
      //
      // #1133 GAVE `pass` A BLOCK, and that changes the arithmetic: a body
      // holding one is not empty, so the emitter writes the learner's `pass`
      // rather than its own — one either way. Dropping it now would mean a
      // learner could drag `do nothing` into an empty `if`, save, reopen, and
      // find the block gone, which is the asymmetry the palette/reader test
      // exists to catch. So it is read like anything else, in `recognise`.
      // `elif`/`else` are not statements: they belong to the `if` above them.
      //
      // ASKED, NOT ASSUMED (#1068). This used to skip any line STARTING with
      // `elif` or `else` on the reasoning that `ifChain` must already have taken
      // it — and `ifChain` stops scanning at the first sibling that is neither,
      // which a comment at column zero between the arms is:
      //
      //     if x:          the `else:` was never consumed, was skipped anyway,
      //         a()        and its whole body went with it — silently, and
      //     # otherwise    counted as a success, because `statement()` (which
      //     else:          does the counting) was never reached.
      //         b()
      //
      // `while … else:` and `for … else:` are real Python and were losing their
      // else the same way. An arm nobody claimed now falls through to the raw
      // suite below and keeps its header and its body verbatim.
      if (this.consumed.has(node)) continue
      // The blank lines above it, if any — and only now that we know the line
      // itself survives. A blank kept in front of a statement that was consumed
      // (a constructor the blocks carry, a `pass` filling an empty suite) would
      // be a gap in front of nothing.
      this.spacers(node.line, built)
      for (const block of this.statement(node, nodes)) {
        built.push({ block, line: node.line })
        if (this.depth === 0 && HOISTED_TYPES.has(block.type)) this.hoistedAbove = true
      }
    }
    if (built.length === 0) return null
    // A TERMINAL BLOCK CANNOT HOLD A CHAIN (#1068), and Blockly does not forgive
    // being asked to. `forever` and `break`/`continue` are defined with no next
    // connection, on the true reasoning that nothing runs after `while True:` or
    // after a `break` — but `while True:` with a `break` in it and cleanup below
    // is the commonest hardware loop there is, and `Blockly.serialization` THROWS
    // on a `next` that the block has nowhere to put. That throw reached the
    // canvas's load, which cleared the workspace and blocked writes: an empty
    // canvas beside a perfectly good program, with nothing said.
    //
    // So a terminal block that is not last becomes the raw block it would have
    // been if we had not recognised it. Uglier, and correct — the same answer
    // `modellableParams` and the mid-function `return` already give.
    for (let i = 0; i < built.length - 1; i++) {
      built[i].block = this.demoteTerminal(built[i].block, built[i].line)
    }
    const blocks = built.map((b) => b.block)
    for (let i = blocks.length - 1; i > 0; i--) blocks[i - 1].next = { block: blocks[i] }
    return blocks[0]
  }

  /**
   * The raw equivalent of a block that has no next connection — see the call
   * site above. Anything else is returned untouched.
   *
   * The BODY is carried across rather than re-converted: it is already the right
   * blocks, and `snakie_python_suite` holds a statement input under the same name.
   */
  private demoteTerminal(block: BlockJson, line: LogicalLine): BlockJson {
    if (!TERMINAL_TYPES.has(block.type)) return block
    this.report.recognised -= 1
    this.report.raw += 1
    this.report.rawLines.push(line.line)
    // A NOTE ON THE BLOCK COMES WITH IT (W5, #1092). The raw blocks hold their
    // whole line as text, bubble and all, and the suite emitter already knows to
    // put its colon BEFORE a trailing comment rather than inside one (#1068).
    // Leaving it behind would drop a comment the learner wrote, which the
    // round-trip gate would refuse to commit — costing the file its conversion
    // rather than this line.
    const note = commentOn(block)
    if (block.type === 'snakie_forever') {
      return {
        type: 'snakie_python_suite',
        fields: { CODE: `while True:${note}` },
        ...(block.inputs ? { inputs: block.inputs } : {})
      }
    }
    // `break` / `continue`, whose whole content is the keyword itself.
    const flow = String((block.fields as { FLOW?: string } | undefined)?.FLOW ?? '').toLowerCase()
    return { type: 'snakie_python_statement', fields: { CODE: `${flow}${note}` } }
  }

  /**
   * Convert a nested BODY, one level deeper (#1063).
   *
   * Everything that opens a suite goes through here rather than calling
   * `statements` directly, so `depth` cannot get out of step with the tree.
   */
  private nested(nodes: readonly Stmt[]): BlockJson | null {
    this.depth += 1
    try {
      return this.statements(nodes)
    } finally {
      this.depth -= 1
    }
  }

  /**
   * One statement → one or more blocks (a `from x import a, b` makes two).
   *
   * The COUNTING half. {@link recognise} below is the recognising half, and the
   * split is what lets W5 (#1092) read a line, fail, and fall back to raw
   * without the report counting the attempt twice.
   */
  private statement(node: Stmt, siblings: readonly Stmt[]): BlockJson[] {
    this.report.total += 1
    const text = node.line.text
    // --- A LINE THAT CARRIES A COMMENT (#1068, then W5 of #1086) -----------
    //
    // `tokenize` stops at a trailing `#` and hands back the code alone, so every
    // recogniser used to match the line and silently drop the rest of it —
    // `x = 5  # how many times` came back as `x = 5`. #1068 answered that by
    // refusing the line outright, which was right when no block could hold both
    // halves: **1,532 raw lines across 55 of 73 projects**, for nothing but
    // having a note on the end.
    //
    // A block CAN hold both now. Blockly's own comment bubble is a field every
    // block has, the `def` block has used it for docstrings since #1007, and the
    // generator writes it back onto the end of the block's first line.
    const at = trailingCommentAt(text)
    if (at >= 0) {
      const commented = this.commented(node, siblings, at)
      if (commented) {
        this.report.recognised += 1
        return commented
      }
      return this.unrecognised(node)
    }
    const blocks = this.recognise(node, siblings)
    if (blocks) {
      this.report.recognised += 1
      return blocks
    }
    return this.unrecognised(node)
  }

  /**
   * The fallback that never fails: the line verbatim, with its body under it if
   * it opens one.
   *
   * A SUITE WE CANNOT READ STILL HAS A BODY (#1063). This used to return the
   * header line as a raw statement and walk away from `node.body` — so a `class`
   * lost every method inside it, a `try` lost everything it guarded, and the
   * report counted that a success. The raw SUITE block keeps the header verbatim
   * and nests the body under it, which is the difference between an uglier
   * program and a shorter one.
   */
  private unrecognised(node: Stmt): BlockJson[] {
    if (isSuiteHeader(node.line.text) && node.body.length > 0) return [this.rawSuite(node)]
    return [this.raw(node.line)]
  }

  /**
   * A STATEMENT WITH A NOTE ON THE END OF IT (W5, #1092, epic #1086).
   *
   * The cheapest line in the epic and one of the widest: `x = 5  # how many
   * times` is one of the commonest shapes in teaching code, and it was grey in
   * 55 of 73 projects for no reason but the comment.
   *
   * Read the code alone, then hang the comment on the block Blockly's own way —
   * the comment bubble, which every block has and which `def` has carried a
   * docstring in since #1007. The generator puts it back on the end of the
   * block's first line.
   *
   * THE NODE IS EDITED AND PUT BACK rather than copied, because `ifChain` finds
   * its `elif`/`else` arms by IDENTITY among the siblings: a copy has no place
   * in that list, and the arms it went looking for would be somebody else's.
   *
   * Null for anything that cannot carry it, and then the whole line stays raw
   * and regenerates with both halves — which is what #1068 did for every line.
   */
  private commented(node: Stmt, siblings: readonly Stmt[], at: number): BlockJson[] | null {
    const text = node.line.text
    const code = text.slice(0, at).trimEnd()
    // A line that is ONLY a comment is not this: `groupComments` has already
    // folded runs of those into one block of their own.
    if (code === '') return null
    const note = text.slice(at)
    const original = node.line
    const blocks = this.trial(() => {
      node.line = { ...original, text: code }
      try {
        const read = this.recognise(node, siblings)
        // ONE BLOCK, or there is no single place for the note to live: a
        // `from x import a, b` is two blocks and both of them are hoisted
        // anyway, and a `def` is NONE, because it becomes a root of its own.
        return read && read.length === 1 ? read : null
      } finally {
        node.line = original
      }
    })
    if (!blocks) return null
    const block = blocks[0]
    // A BLOCK THAT GENERATES NOTHING WHERE IT STANDS cannot carry it. The import
    // blocks and the `name pin` block are lifted into sections of their own, so
    // the note would travel with them — away from the line it is about — or be
    // dropped on the floor. Raw keeps it exactly where it was written.
    if (HOISTED_TYPES.has(block.type)) return null
    // And a block whose bubble is already spoken for: a `def`'s docstring is the
    // same field, and one of the two would have to lose.
    if (block.icons) return null
    return [{ ...block, icons: { comment: { text: note, pinned: false, height: 40, width: 220 } } }]
  }

  /**
   * Run a recogniser that MAY DECLINE, and leave nothing behind when it does.
   *
   * {@link recognise} is not a pure function and cannot be: it declares
   * variables, collects `def` blocks into a section of their own, marks the
   * `elif`/`else` arms an `if` has taken, and keeps the report honest about the
   * extra lines a multi-arm `if` costs. All of that is wanted when the answer is
   * yes.
   *
   * W5 (#1092) is the first caller that asks a question it is willing to have
   * answered no — "would this line be a block, if it did not have a comment on
   * the end?" — and a no that left those marks behind is worse than no answer at
   * all. `def go():  # the main loop` collected a definition block and then fell
   * back to raw, so the function came out TWICE: once as the raw suite holding
   * the line, and once as the hat the trial had already pushed.
   */
  private trial(run: () => BlockJson[] | null): BlockJson[] | null {
    const report = { ...this.report, rawLines: this.report.rawLines.length }
    const definitions = this.definitions.length
    const variables = [...this.variables]
    const claimed = [...this.claimed]
    const rawNames = [...this.rawNames]
    const consumed = [...this.consumed]
    const out = run()
    if (out !== null) return out
    this.report.total = report.total
    this.report.recognised = report.recognised
    this.report.raw = report.raw
    this.report.rawLines.length = report.rawLines
    this.report.sockets = report.sockets
    this.report.rawSockets = report.rawSockets
    this.definitions.length = definitions
    restore(this.variables, variables)
    restore(this.claimed, claimed)
    restore(this.rawNames, rawNames)
    restore(this.consumed, consumed)
    return null
  }

  /**
   * The recognising half: the blocks this line IS, or null when nothing here
   * knows it.
   *
   * Null rather than a raw block, so the caller owns both the counting and the
   * fallback — and so {@link commented} can ask the same question about a line
   * with its comment taken off and fall back cleanly when the answer is no.
   */
  private recognise(node: Stmt, siblings: readonly Stmt[]): BlockJson[] | null {
    const text = node.line.text
    const recognised = (blocks: BlockJson[]): BlockJson[] => blocks

    // --- imports ---------------------------------------------------------
    //
    // AT MODULE SCOPE ONLY (#1071). An import block is HOISTED — the generator
    // gathers every one of them into the import section at the top, which is
    // right for the `import time` a learner drags in and catastrophic for an
    // import that is nested on purpose:
    //
    //   try:                          import struct
    //       import ustruct as struct  import ustruct as struct
    //   except ImportError:      →
    //       import struct             try:
    //                                     pass
    //                                 except ImportError:
    //                                     pass
    //
    // That idiom exists precisely BECAUSE one of the two may not be there, and
    // hoisting both turns a file that runs into one that raises on line 1 —
    // while the arms it came from become `pass`. A lazy import inside a
    // function is the same mistake more quietly: it was written there to keep
    // it off the start-up path.
    //
    // `this.depth` is the same guard `def` already uses below, for the same
    // reason. Nested, the line stays raw and regenerates exactly where it was.
    const atModuleScope = this.depth === 0
    const importAs = /^import\s+([A-Za-z_][\w.]*)\s+as\s+([A-Za-z_]\w*)$/.exec(text)
    if (importAs && atModuleScope) {
      return recognised([
        { type: 'snakie_python_import_as', fields: { MODULE: importAs[1], ALIAS: importAs[2] } }
      ])
    }
    const plain = /^import\s+([A-Za-z_][\w.]*)$/.exec(text)
    if (plain && atModuleScope) {
      return recognised([{ type: 'snakie_python_import', fields: { MODULE: plain[1] } }])
    }
    const from = /^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/.exec(text)
    if (from && atModuleScope && !from[2].includes('*')) {
      const names = from[2].split(',').map((n) => n.trim())
      if (names.every((n) => /^[A-Za-z_]\w*$/.test(n))) {
        // One block per name: the block holds one, and two imports of one module
        // merge back into a single line in the generator anyway.
        return recognised(
          names.map((name) => ({
            type: 'snakie_python_from_import',
            fields: { MODULE: from[1], NAME: name }
          }))
        )
      }
    }
    // AN IMPORT NONE OF THOSE COULD TAKE (W8, #1095) — nested, starred, or
    // several modules on one line. It writes its line exactly where it stands,
    // which for the nested ones is the whole point: that idiom exists because
    // one of the two imports may be missing.
    if (/^(import|from)\s/.test(text)) {
      return recognised([{ type: 'snakie_python_import_here', fields: { CODE: text } }])
    }

    // --- suites ----------------------------------------------------------
    if (text === 'while True:') {
      return recognised([this.withBody({ type: 'snakie_forever' }, 'DO', node)])
    }
    const repeat = /^for\s+_\s+in\s+range\((.+)\):$/.exec(text)
    if (repeat) {
      const times = this.expression(repeat[1])
      return recognised([
        this.withBody(
          { type: 'controls_repeat_ext', inputs: { TIMES: { block: times } } },
          'DO',
          node
        )
      ])
    }
    // TWO NAMES IN THE LOOP TARGET (#1121, epic #1119), which `controls_forEach`
    // cannot hold — `docs/blocks-coverage-epic.md` §10 lists
    // `for name, value in rows:` among the lines still grey for exactly that
    // reason. `enumerate` and `zip` are tried first, because both are also a
    // two-name loop over "something" and the general block would claim them and
    // render the call as a grey socket.
    const forTwo = /^for\s+([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(text)
    if (forTwo) {
      const [, first, second, over] = forTwo
      const enumerated = /^enumerate\((.+)\)$/.exec(over)
      if (enumerated) {
        // `enumerate(xs)` counts from 0 and `enumerate(xs, 1)` from 1, which is
        // the block's own dropdown. Any other start — `enumerate(xs, 5)` — is
        // not this block, and a raw suite says so rather than losing the 5.
        const parts = splitArgs(enumerated[1])
        const start = parts?.length === 1 ? 'ZERO' : parts?.length === 2 && parts[1].trim() === '1' ? 'ONE' : null
        if (parts && start) {
          return recognised([
            this.withBody(
              {
                type: 'snakie_for_each_indexed',
                fields: {
                  START: start,
                  VAR_INDEX: { id: this.variable(first) },
                  VAR_ITEM: { id: this.variable(second) }
                },
                inputs: { LIST: { block: this.expression(parts[0]) } }
              },
              'DO',
              node
            )
          ])
        }
      }
      const zipped = /^zip\((.+)\)$/.exec(over)
      const zipArgs = zipped ? splitArgs(zipped[1]) : null
      if (zipArgs && zipArgs.length === 2) {
        return recognised([
          this.withBody(
            {
              type: 'snakie_for_each_zip',
              fields: { VAR_A: { id: this.variable(first) }, VAR_B: { id: this.variable(second) } },
              inputs: {
                LIST_A: { block: this.expression(zipArgs[0]) },
                LIST_B: { block: this.expression(zipArgs[1]) }
              }
            },
            'DO',
            node
          )
        ])
      }
      return recognised([
        this.withBody(
          {
            type: 'snakie_for_each_two',
            fields: { VAR_A: { id: this.variable(first) }, VAR_B: { id: this.variable(second) } },
            inputs: { SEQ: { block: this.expression(over) } }
          },
          'DO',
          node
        )
      ])
    }
    const forEach = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(text)
    if (forEach) {
      // The thing being iterated has to FIT the LIST socket, which checks Array
      // (#1087). `for name in "EDCDEEE":` iterates a string — ordinary Python —
      // and a `text` block in there is a workspace Blockly refuses to load, so
      // it used to cost the learner every block in the file rather than one.
      const list = this.expression(forEach[2])
      if (fitsSocket(list, 'Array')) {
        return recognised([
          this.withBody(
            {
              type: 'controls_forEach',
              fields: { VAR: { id: this.variable(forEach[1]) } },
              inputs: { LIST: { block: list } }
            },
            'DO',
            node
          )
        ])
      }
      return null
    }
    const whileNot = /^while\s+not\s+(.+):$/.exec(text)
    if (whileNot) {
      return recognised([
        this.withBody(
          {
            type: 'controls_whileUntil',
            fields: { MODE: 'UNTIL' },
            inputs: { BOOL: { block: this.expression(whileNot[1]) } }
          },
          'DO',
          node
        )
      ])
    }
    const whileLoop = /^while\s+(.+):$/.exec(text)
    if (whileLoop) {
      return recognised([
        this.withBody(
          {
            type: 'controls_whileUntil',
            fields: { MODE: 'WHILE' },
            inputs: { BOOL: { block: this.expression(whileLoop[1]) } }
          },
          'DO',
          node
        )
      ])
    }
    if (/^if\s+.+:$/.test(text)) return recognised([this.ifChain(node, siblings)])

    // --- try / with / raise (W7, #1094) -----------------------------------
    if (text === 'try:') return recognised([this.tryChain(node, siblings)])
    const withHead = /^(async\s+)?with\s+(.+):$/.exec(text)
    if (withHead) {
      // ONE THING, BOUND TO ONE PLAIN NAME → the friendly block (#1132). That
      // is the shape a learner meets — `with open('data.csv', 'a') as f:` — and
      // it takes the thing in a SOCKET, so the `open file` block plugs into it.
      // Everything else keeps the text-field block: two context managers on one
      // line, `async with`, a name that is not a plain identifier. The same
      // split #1121 made between `set … and … to` and the exact assign block.
      const one = withHead[1] ? null : /^(.+?)\s+as\s+([A-Za-z_]\w*)$/.exec(withHead[2].trim())
      if (one && !isReservedName(one[2]) && splitArgs(one[1])?.length === 1) {
        const thing = this.expression(one[1])
        return recognised([
          this.withBody(
            {
              type: 'snakie_use',
              fields: { VAR: { id: this.variable(one[2]) } },
              inputs: { THING: { block: thing } }
            },
            'BODY',
            node
          )
        ])
      }
      return recognised([
        this.withBody(
          {
            type: 'snakie_with',
            fields: { ITEMS: withHead[2].trim(), KIND: withHead[1] ? 'ASYNC' : 'SYNC' }
          },
          'BODY',
          node
        )
      ])
    }
    // `for line in f:` where the body is a file's — read as the ordinary
    // `for each` below, which writes the identical line. The Files drawer's own
    // loop block is for BUILDING one; there is nothing in the text that says
    // which of the two wrote it, and `controls_forEach` got there first.
    // `await <expr>` ON A LINE OF ITS OWN (W9, #1096). The value form is in the
    // expression parser, where `data = await sensor.read()` needs it.
    const awaited = /^await\s+(.+)$/.exec(text)
    if (awaited) {
      return recognised([
        { type: 'snakie_await', inputs: { VALUE: { block: this.expression(awaited[1]) } } }
      ])
    }
    // `del config['pin']` → the Dictionaries drawer's remove block (#1120).
    // TAKING A KEY OUT HAS NO METHOD — `del` is the only way to do it — and the
    // same string-key rule decides it here as decides the read: nothing deletes
    // a list item by `'name'`. A `del` of anything else is #1133's block.
    const delKey = /^del\s+(.+)$/.exec(text)
    if (delKey) {
      const target = this.expression(delKey[1])
      if (target.type === 'snakie_dict_get') {
        return recognised([{ type: 'snakie_dict_remove', inputs: target.inputs }])
      }
      // `del xs[0]` → the Lists drawer's remove-by-position (#1122). Taking one
      // out by WHERE it is has no method — `pop` hands the value back, which is
      // a different block — so `del` is the only line it can be.
      if (target.type === 'snakie_list_get') {
        return recognised([{ type: 'snakie_list_remove_at', inputs: target.inputs }])
      }
      // `del name` → the Variables drawer's own block (#1133). Only a plain
      // name a variable FIELD can hold: `del a, b` and `del obj.attr` are real
      // lines with no block, and they keep the grey one that regenerates them
      // exactly.
      if (target.type === 'variables_get') {
        return recognised([{ type: 'snakie_forget', fields: target.fields }])
      }
    }
    // `pass`, said deliberately (#1133). The generator writes its own for an
    // empty body; this is the one a learner put there, and reading it back as
    // a real block is what stops it being the grey line in the middle of an
    // otherwise complete program.
    if (text === 'pass') return recognised([{ type: 'snakie_pass' }])
    const raise = /^raise(?:\s+(.+))?$/.exec(text)
    if (raise) {
      const block: BlockJson = { type: 'snakie_raise' }
      if (raise[1] !== undefined) block.inputs = { VALUE: { block: this.expression(raise[1]) } }
      return recognised([block])
    }

    // --- classes and methods (W6, #1093) ----------------------------------
    //
    // THE BIGGEST THEME IN THE CORPUS: 32.8% of all grey lines once W1's `self.`
    // assignments and calls are counted with it. Before this a `class` came back
    // as a raw suite with its whole body nested under a grey header — correct,
    // and a wall.
    const klass = /^class\s+([A-Za-z_]\w*)\s*(\(.*\))?\s*:$/.exec(text)
    if (klass) {
      return recognised([
        this.withBody(
          {
            type: 'snakie_class',
            fields: { NAME: klass[1], BASES: klass[2] ?? '' }
          },
          'BODY',
          node
        )
      ])
    }
    // A DECORATOR BELONGS TO THE `def` UNDER IT, so it is read with it rather
    // than as a block of its own — a decorator block could be dragged away from
    // the thing it decorates, and would mean nothing where it landed. Only the
    // three the method block has a setting for; anything else is somebody's own
    // decorator and stays raw, header and body together.
    const decorator = /^@(property|staticmethod|classmethod)$/.exec(text)
    if (decorator) {
      const decorated = this.decorated(node, siblings, decorator[1])
      if (decorated) return recognised(decorated)
    }
    const method = DEF_HEADER.exec(text)

    const def = /^def\s+([A-Za-z_]\w*)\(([^)]*)\):$/.exec(text)
    // An `async def` never takes this branch — the pattern has no `async` in it —
    // because `procedures_def` has nowhere to put the keyword (W9, #1096).
    const signature = def ? splitSignature(def[2]) : null
    if (def && signature && this.depth === 0 && !decoratedAbove(node, siblings)) {
      this.definitions.push(this.definition(def[1], def[2], node))
      // And the generator will write it into a section of its own, with a blank
      // line after it — which is the gap the learner typed under the `def`. See
      // {@link spacers}; nothing else can see this, because the block does not
      // stay in the chain being built.
      this.hoistedAbove = true
      // No block in the chain: it is a root of its own, collected above.
      return recognised([])
    }
    // A `def` THAT IS NOT A TOP-LEVEL PROCEDURE (W6, #1093). Two kinds land
    // here: a method inside a class, and a `def` whose signature cannot be
    // split at all — a trailing comma the block has nowhere to record. The
    // defaults and stars that used to land here are the procedure block's now
    // (#1134): they go in its extras field, and #1063's argument for never
    // DROPPING a parameter is answered by keeping it rather than by refusing
    // the whole `def`.
    //
    // Both become the same stackable block, which is the shape a hat cannot be:
    // `procedures_defnoreturn` has no previous or next connection, so it can
    // never sit inside a class's body. Its parameter list is a FIELD, so any
    // signature comes back exactly as written.
    if (method) return recognised([this.method(node, method, 'NONE')])

    // --- simple statements -----------------------------------------------
    if (text === 'break' || text === 'continue') {
      return recognised([
        { type: 'controls_flow_statements', fields: { FLOW: text.toUpperCase() } }
      ])
    }
    const ret = /^return(?:\s+(.+))?$/.exec(text)
    if (ret) {
      // A `return` THAT IS NOT THE LAST STATEMENT (#1063, then W3 of #1086).
      // `definition()` takes a trailing one as the `def`'s RETURN socket, which
      // is how Blockly models a function's result; everything else lands here.
      //
      // It used to become `procedures_ifreturn`, whose code is
      // `if <COND>: return <VALUE>` — and with nothing in COND the generator
      // wrote `if False:`. Every early return in the program became dead code,
      // quietly, so #1063 pulled it back to a raw block. #1090 is the block that
      // was actually missing: no condition, an optional value, and a next
      // connection, because a guard clause has a whole function after it.
      const block: BlockJson = { type: 'snakie_return' }
      if (ret[1] !== undefined) block.inputs = { VALUE: { block: this.expression(ret[1]) } }
      return recognised([block])
    }
    // --- `global` / `nonlocal` (W8, #1095) --------------------------------
    const scope = /^(global|nonlocal)\s+(.+)$/.exec(text)
    if (scope && /^[A-Za-z_]\w*(\s*,\s*[A-Za-z_]\w*)*$/.test(scope[2].trim())) {
      const names = scope[2].trim()
      // ONE NAME, AND `global`, IS THE NATIVE BLOCK (#1118). The Variables
      // drawer has a `global` block whose name is a VARIABLE FIELD, so it
      // renames with everything else that mentions that variable — and a
      // learner who opens their program should get that block rather than the
      // escape hatch whose name is text they can mistype.
      //
      // The escape hatch keeps the rest, which is exactly what it is for:
      // `nonlocal`, and `global low, high`.
      if (scope[1] === 'global' && /^[A-Za-z_]\w*$/.test(names) && !isReservedName(names)) {
        return recognised([{ type: 'snakie_global', fields: { VAR: { id: this.variable(names) } } }])
      }
      return recognised([
        {
          type: 'snakie_python_scope',
          fields: { SCOPE: scope[1], NAMES: names }
        }
      ])
    }

    const change = /^([A-Za-z_]\w*)\s*\+=\s*(.+)$/.exec(text)
    if (change && !isReservedName(change[1])) {
      // `+=` on a STRING is concatenation, and `math_change`'s DELTA takes a
      // Number (#1071). `s += "x"` used to build a `text` block into it, which
      // made the whole workspace unloadable, so it kept the line raw.
      //
      // IT FALLS THROUGH NOW RATHER THAN DECLINING (W8, #1095). The
      // augmented-assign block a few lines below has a socket that checks
      // nothing, which is the honest shape for an operator that means four
      // different things depending on what is on either side of it — so a delta
      // that is not a number is still a block, just not this one.
      const delta = this.expression(change[2])
      if (fitsSocket(delta, 'Number')) {
        return recognised([
          {
            type: 'math_change',
            fields: { VAR: { id: this.variable(change[1]) } },
            inputs: { DELTA: { block: delta } }
          }
        ])
      }
    }
    // THE `x == 5` TRAP IS NOW THE LEXER'S PROBLEM (#1068, then W8 of #1086).
    // The recogniser used to be a regex with a `=(?!=)` guard, because an
    // earlier one read `x == 5` as assigning `= 5` to `x` and regenerated it as
    // `x = = 5`. `topLevelAssign` asks the tokenizer instead: `==` is one token
    // and is not the `=` that assigns, and neither is any augmented operator.
    // --- a name for a pin (W10, #1097) ------------------------------------
    //
    // BEFORE the plain assignment below, which would otherwise read
    // `echo = Pin(0, Pin.IN)` as *set echo to (grey blob)* — a line the coverage
    // number counts as fully recognised and a learner sees as a grey wall.
    const named = this.aliasDeclaration(text)
    if (named) return recognised([named])

    // --- every augmented assign but the one above (W8, #1095) -------------
    const augmented = this.augmentedAssign(text)
    if (augmented) return recognised([augmented])

    // --- assignment, in all the shapes it comes in ------------------------
    const assigned = this.assignment(text)
    if (assigned) return recognised([assigned])

    // --- a call to a function THIS program defines ------------------------
    //
    // Before the rule table below, which is about calls into `time`, `machine`
    // and the instrument libraries. A name the learner defined wins over a name
    // a module happens to share.
    const defined = this.procedureCall(text, 'statement')
    if (defined) return recognised([defined])

    // --- a recognised call, standing on its own ---------------------------
    const call = this.callStatement(text)
    if (call) return recognised([call])

    // --- a description standing on its own (W4, #1091) --------------------
    const described = this.docstring(node.line)
    if (described) return recognised([described])

    // --- anything else ----------------------------------------------------
    //
    // Null, and the caller turns it into the raw block or the raw SUITE that
    // keeps the body — see {@link unrecognised}.
    return null
  }

  /**
   * `@property` + the `def` under it → one method block (W6, #1093).
   *
   * The decorator line and the `def` line are two logical lines and one idea, so
   * the second is CONSUMED — by identity, the way `ifChain` takes its `elif` and
   * `else` arms, because guessing from the text is what lost an `else` in #1068.
   * Its line still has to be counted by hand: `statements()` skips a consumed
   * node without counting it, on the reasoning that whoever consumed it did.
   *
   * Null when the next sibling is not a `def` we can hold, which leaves the
   * decorator as an ordinary raw line with the `def` under it — exactly what
   * both were before.
   */
  private decorated(
    node: Stmt,
    siblings: readonly Stmt[],
    decorator: string
  ): BlockJson[] | null {
    const next = siblings[siblings.indexOf(node) + 1]
    if (!next || this.consumed.has(next)) return null
    const def = DEF_HEADER.exec(next.line.text)
    if (!def) return null
    this.consumed.add(next)
    this.report.total += 1
    this.report.recognised += 1
    return [this.method(next, def, decorator)]
  }

  /** `def name(params):` as a STACKABLE block, with its body under it. */
  private method(node: Stmt, header: RegExpExecArray, decorator: string): BlockJson {
    return this.withBody(
      {
        type: 'snakie_method',
        fields: {
          NAME: header[2],
          PARAMS: header[3].trim(),
          DECORATOR: decorator,
          KIND: header[1] ? 'ASYNC' : 'SYNC'
        }
      },
      'BODY',
      node
    )
  }

  /** `if` / `elif` / `else`, gathered from the siblings that follow. */
  private ifChain(node: Stmt, siblings: readonly Stmt[]): BlockJson {
    const arms: Stmt[] = [node]
    let elseArm: Stmt | null = null
    let i = siblings.indexOf(node) + 1
    while (i < siblings.length) {
      const next = siblings[i]
      if (/^elif\s+.+:$/.test(next.line.text)) {
        arms.push(next)
        this.consumed.add(next)
        i += 1
        continue
      }
      if (next.line.text === 'else:') {
        elseArm = next
        this.consumed.add(next)
        i += 1
      }
      break
    }

    const block: BlockJson = { type: 'controls_if', inputs: {} }
    arms.forEach((arm, n) => {
      const cond = /^(?:if|elif)\s+(.+):$/.exec(arm.line.text)![1]
      block.inputs![`IF${n}`] = { block: this.expression(cond) }
      const body = this.nested(arm.body)
      if (body) block.inputs![`DO${n}`] = { block: body }
      // Each extra arm is a line of its own in the source, and the `if` block
      // is one block — so the count has to be kept honest by hand.
      if (n > 0) this.report.total += 1, this.report.recognised += 1
    })
    if (elseArm) {
      const body = this.nested(elseArm.body)
      if (body) block.inputs!.ELSE = { block: body }
      this.report.total += 1
      this.report.recognised += 1
    }
    const elseIfCount = arms.length - 1
    if (elseIfCount > 0 || elseArm) {
      block.extraState = {
        ...(elseIfCount > 0 ? { elseIfCount } : {}),
        ...(elseArm ? { hasElse: true } : {})
      }
    }
    return block
  }

  /**
   * `try` / `except` / `else` / `finally`, gathered from the siblings (W7, #1094).
   *
   * THE SAME MACHINERY AS `ifChain`, and for the same reason it was written that
   * way: an arm is a SIBLING LINE, not a child, and the header that claims one
   * has to mark it consumed or it is converted twice or not at all. That is the
   * #1068 failure mode exactly, and the `else:` of a `try` is the same token as
   * a loop's — whichever header claims it must say so.
   *
   * THE ARMS ARE ASKED FOR IN ORDER and the scan stops at the first sibling that
   * is not one, so a comment at column zero between two arms ends the chain
   * rather than being skipped past — which is the bug #1068 records.
   */
  private tryChain(node: Stmt, siblings: readonly Stmt[]): BlockJson {
    const block: BlockJson = { type: 'snakie_try', fields: {}, inputs: {} }
    const attach = (input: string, arm: Stmt): void => {
      const body = this.nested(arm.body)
      if (body) block.inputs![input] = { block: body }
    }
    attach('TRY', node)
    const excepts: string[] = []
    let elseArm: Stmt | null = null
    let finallyArm: Stmt | null = null
    let i = siblings.indexOf(node) + 1
    while (i < siblings.length) {
      const next = siblings[i]
      const text = next.line.text
      const except = /^except\b\s*(.*?)\s*:$/.exec(text)
      if (except && elseArm === null && finallyArm === null) {
        this.claimArm(next)
        block.fields![`EXCEPT${excepts.length}`] = except[1]
        attach(`DO${excepts.length}`, next)
        excepts.push(except[1])
        i += 1
        continue
      }
      // `else` only after an `except`, which is what Python allows, and
      // `finally` last.
      if (text === 'else:' && excepts.length > 0 && elseArm === null && finallyArm === null) {
        elseArm = next
        this.claimArm(next)
        attach('ELSE', next)
        i += 1
        continue
      }
      if (text === 'finally:' && finallyArm === null) {
        finallyArm = next
        this.claimArm(next)
        attach('FINALLY', next)
        i += 1
        continue
      }
      break
    }
    block.extraState = {
      excepts,
      hasElse: elseArm !== null,
      hasFinally: finallyArm !== null
    }
    if (Object.keys(block.fields!).length === 0) delete block.fields
    if (Object.keys(block.inputs!).length === 0) delete block.inputs
    return block
  }

  /** Take an arm: mark it consumed and count its line, as `ifChain` does. */
  private claimArm(arm: Stmt): void {
    this.consumed.add(arm)
    this.report.total += 1
    this.report.recognised += 1
  }

  /** `def name(a, b):` → a procedure definition, with its body. */
  private definition(name: string, params: string, node: Stmt): BlockJson {
    // The bare names go to Blockly's mutator; everything else to the field
    // #1134 added — see {@link splitSignature}.
    const { declared, extra } = splitSignature(params)!
    // A LEADING DOCSTRING IS THE BLOCK'S DESCRIPTION, not a statement in the
    // body — one idea in two notations, so it becomes the comment bubble rather
    // than a raw Python block sitting at the top of the function. Only when it
    // can be written back out exactly; see `docstring.ts`.
    const first = node.body[0]
    const described = first && first.body.length === 0 ? docstringComment(first.line.text) : null
    const statements = described === null ? node.body : node.body.slice(1)
    // A trailing `return` becomes the definition's RETURN socket, which is the
    // shape Blockly models a function's result with.
    const last = statements[statements.length - 1]
    // NOT ONE THAT CARRIES A COMMENT (#1087). `statement()` refuses a line with
    // a trailing comment because no block holds both halves — and this path
    // never asked, so `return width * 0.0343 / 2  # centimetres` put the
    // expression in the RETURN socket and dropped the comment on the floor.
    // Silently, and counted as a success.
    const trailing = last && trailingCommentAt(last.line.text) < 0 ? last : undefined
    const returns = trailing && /^return\s+(.+)$/.exec(trailing.line.text)
    const body = this.nested(returns ? statements.slice(0, -1) : statements)
    const block: BlockJson = {
      type: returns ? 'procedures_defreturn' : 'procedures_defnoreturn',
      fields: { NAME: name, ...(extra === '' ? {} : { EXTRAS: extra }) },
      extraState: { params: declared.map((a) => ({ name: a, id: this.variable(a) })) },
      inputs: {}
    }
    if (described !== null) {
      this.report.total += 1
      this.report.recognised += 1
      // Blockly's own serialisation for the bubble. `pinned: false` leaves it
      // closed, so a long description does not cover the canvas the moment a
      // file opens — the `?` on the block opens it.
      block.icons = { comment: { text: described, pinned: false, height: 80, width: 160 } }
    }
    if (body) block.inputs!.STACK = { block: body }
    if (returns) {
      this.report.total += 1
      this.report.recognised += 1
      block.inputs!.RETURN = { block: this.expression(returns[1]) }
    }
    if (Object.keys(block.inputs!).length === 0) delete block.inputs
    return block
  }

  /** Attach a suite to a block's statement input. */
  private withBody(block: BlockJson, input: string, node: Stmt): BlockJson {
    const body = this.nested(node.body)
    if (body) block.inputs = { ...(block.inputs ?? {}), [input]: { block: body } }
    return block
  }

  /** A raw Python block holding this line, verbatim. The fallback that never fails. */
  private raw(line: LogicalLine, shape: 'statement' | 'value' = 'statement'): BlockJson {
    this.report.raw += 1
    this.report.rawLines.push(line.line)
    // A hoisted object named by a line we could NOT read keeps its constructor
    // (#1058): dropping it would leave this raw block calling a name nothing
    // declares. Recorded rather than decided here, because the decision belongs
    // to the whole file and this is one line of it.
    for (const name of this.hoisted.keys()) {
      if (mentions(line.text, name)) this.rawNames.add(name)
    }
    return {
      type: shape === 'value' ? 'snakie_python_value' : 'snakie_python_statement',
      fields: { CODE: line.text }
    }
  }

  /**
   * A raw SUITE block: the header verbatim, its body converted underneath.
   *
   * The header keeps its trailing colon, unlike a one-line raw statement,
   * because it IS the colon that makes the lines below it a body — and the
   * generator re-indents them under it.
   */
  private rawSuite(node: Stmt): BlockJson {
    this.report.raw += 1
    this.report.rawLines.push(node.line.line)
    const block: BlockJson = {
      type: 'snakie_python_suite',
      fields: { CODE: node.line.text }
    }
    const body = this.nested(node.body)
    if (body) block.inputs = { DO: { block: body } }
    return block
  }

  /** A raw VALUE block for an expression we could not read. */
  private rawValue(text: string): BlockJson {
    return { type: 'snakie_python_value', fields: { CODE: text } }
  }

  /** The workspace id a variable name is declared under. */
  private variable(name: string): string {
    const known = this.variables.get(name)
    if (known) return known
    const id = `v_${this.variables.size}_${name.replace(/[^A-Za-z0-9_]/g, '')}`
    this.variables.set(name, id)
    return id
  }

  /**
   * A LONE STRING LITERAL STANDING AS A STATEMENT (W4, #1091, epic #1086).
   *
   * 2,174 raw lines across 48 of 73 projects: every docstring in a
   * well-documented program, which is most of why a class-heavy file opened as a
   * wall of grey.
   *
   * Cheaper than it looks, because the lexer already folds a triple-quoted
   * literal into ONE logical line and keeps the line count honest — so a
   * thirty-line module header arrives here as a single unrecognised statement
   * rather than thirty of them. What was missing is only this recogniser and a
   * block that renders several lines without collapsing them.
   *
   * ASKED OF THE TOKENIZER rather than of a regex: a literal followed by
   * anything else starts and ends with the right quotes and is not a docstring,
   * and one containing a `#` holds something a regex would take for a comment.
   * Exactly one string token on the line, and nothing else.
   *
   * A `def`'s LEADING docstring never reaches here — `definition()` has already
   * taken it as the block's comment bubble, because the bubble and the docstring
   * say the same thing about the same function (`docstring.ts`). This is for the
   * ones with no bubble to live in: a module's, a class's, and every shape
   * `docstring.ts` declines because it could not write it back exactly.
   *
   * THE CONTINUATION LINES GIVE BACK THE BODY INDENT. `logicalLines` strips the
   * indent from the FIRST physical line only; everything after it is the literal
   * verbatim. The generator re-indents whatever this block emits by the depth it
   * sits at, so handing the lines back as they were would indent them twice.
   */
  private docstring(line: LogicalLine): BlockJson | null {
    const tokens = tokenize(line.text)
    if (!tokens || tokens.length !== 1 || tokens[0].kind !== 'string') return null
    const physical = line.text.split('\n')
    const lines = [physical[0], ...physical.slice(1).map((l) => dedent(l, line.indent))]
    return { type: 'snakie_python_docstring', extraState: { lines } }
  }

  /**
   * `echo = Pin(0, Pin.IN)` → the block that names a pin (W10, #1097).
   *
   * Read off the pre-scan rather than matched again here, so the name this line
   * declares and the name a call on it is read against cannot disagree.
   */
  private aliasDeclaration(text: string): BlockJson | null {
    const m = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(text)
    if (!m) return null
    const alias = this.aliases.get(m[1])
    // The same line has to still BE the declaration: a name can be reassigned,
    // and only the line that matches the block's own constructor is this block.
    if (!alias || matchAlias(m[2].trim(), this.aliases)?.mode !== alias.mode) return null
    return {
      type: alias.rule.type,
      fields: {
        [alias.rule.pinField]: alias.pin,
        [alias.rule.nameField]: m[1],
        // A NAMING BLOCK WITH ONE MODE HAS NOWHERE TO PUT IT, and says so with
        // an empty `modeField`: a PWM has no direction to choose, where a pin
        // has four. Writing it anyway gave every such block a field called `""`
        // — junk in the saved workspace, and a field Blockly has no home for.
        ...(alias.rule.modeField ? { [alias.rule.modeField]: alias.mode } : {})
      }
    }
  }

  /**
   * `a.b = x` → the block that sets an attribute (W1, #1088), and `xs[i] = v` →
   * the block that sets a list item (W2, #1089).
   *
   * The TARGET is read with the same chain everything else uses, and has to come
   * back as an attribute read for this to be that block: `self.speed` is an
   * attribute, `self.legs[0]` is a subscript (W8's, #1095) and `speed` is a
   * plain variable, which the assignment above has already taken.
   *
   * The `=` is found through the lexer rather than with `indexOf`, so a `=`
   * inside a string or a keyword argument cannot be mistaken for the one that
   * assigns — and `==`, `!=`, `<=`, `>=` and every augmented assign lex as
   * operators of their own and simply are not this.
   *
   * AUGMENTED ASSIGNS ARE DELIBERATELY NOT HERE. `self.total += 1` has no block:
   * `math_change` needs a workspace VARIABLE, and writing it as
   * `self.total = self.total + 1` would be rewriting somebody's line. It stays
   * raw, where it regenerates exactly as written.
   */
  private assignment(text: string): BlockJson | null {
    const tokens = tokenize(text)
    if (!tokens) return null
    // THE LAST TOP-LEVEL `=` IS THE ONE THAT ASSIGNS. `a = b = 0` is one value
    // going into two names, so everything before the last `=` is the target.
    const at = topLevelAssign(tokens)
    if (at === -1) return null
    const target = text.slice(0, tokens[at].start).trim()
    const value = text.slice(tokens[at].end).trim()
    if (target === '' || value === '') return null

    // A PLAIN NAME, which is the great majority of lines and reads best as the
    // Variables drawer's own block. `self = …` is refused: it would declare
    // `self` as a workspace variable through the back door (see {@link name}).
    if (/^[A-Za-z_]\w*$/.test(target)) {
      if (target === 'self' || isReservedName(target)) return null
      return {
        type: 'variables_set',
        fields: { VAR: { id: this.variable(target) } },
        inputs: { VALUE: { block: this.expression(value) } }
      }
    }

    // SOMETHING ON AN OBJECT, or a position in a list — the two the palette has
    // real blocks for. `self.speed = speed` is 2,649 raw lines across 45
    // projects on its own (W1, #1088).
    const read = this.readChain(text, tokens.slice(0, at))
    if (read && read.next === at) {
      if (read.block.type === PYTHON_ATTR_GET) {
        return {
          type: PYTHON_ATTR_SET,
          fields: read.block.fields,
          inputs: { ...read.block.inputs, VALUE: { block: this.expression(value) } }
        }
      }
      if (read.block.type === 'snakie_list_get') {
        return {
          type: 'snakie_list_set',
          inputs: { ...read.block.inputs, VALUE: { block: this.expression(value) } }
        }
      }
      // `config['pin'] = 15` → the Dictionaries drawer's setter (#1120). The
      // read side has already decided this is a dictionary, on the one
      // unambiguous ground there is: a string key.
      if (read.block.type === 'snakie_dict_get') {
        return {
          type: 'snakie_dict_set',
          inputs: { ...read.block.inputs, VALUE: { block: this.expression(value) } }
        }
      }
    }

    // EXACTLY TWO PLAIN NAMES → the friendly unpacking block (#1121). The one
    // shape a learner meets — `x, y = position()`, `key, value = pair` — gets
    // variable fields, so it follows a rename and cannot be typed wrong. Three
    // names or more, an attribute target, a subscript or a starred one all fall
    // through to the text-target block below, which is what that block is for.
    const pair = /^([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)$/.exec(target)
    if (pair && !isReservedName(pair[1]) && !isReservedName(pair[2])) {
      return {
        type: 'snakie_unpack',
        fields: { VAR_A: { id: this.variable(pair[1]) }, VAR_B: { id: this.variable(pair[2]) } },
        inputs: { VALUE: { block: this.expression(value) } }
      }
    }

    // ANYTHING ELSE the left-hand side can legally be (W8, #1095): several names
    // at once, a chained assignment, a subscript the list block cannot count
    // back. The target goes in as TEXT, because a tuple target is several names,
    // a subscript is an expression with an index in it and a chain is two
    // targets — modelling any one of them as sockets would lose the others.
    return {
      type: 'snakie_python_assign',
      fields: { TARGET: target },
      inputs: { VALUE: { block: this.expression(value) } }
    }
  }

  /**
   * `total *= 2`, `s += "x"`, `flags |= BIT` → the augmented-assign block.
   *
   * AFTER `math_change`, which is `+=` on a plain name with a NUMBER delta and
   * is deliberately that narrow: its DELTA socket checks Number, so `s += "x"` —
   * ordinary string concatenation — used to build a `text` block into it and make
   * the whole workspace unloadable (#1071). This block's socket checks nothing,
   * which is the honest answer.
   */
  private augmentedAssign(text: string): BlockJson | null {
    const tokens = tokenize(text)
    if (!tokens) return null
    let depth = 0
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.kind === 'open') depth += 1
      else if (tok.kind === 'close') depth -= 1
      if (depth !== 0 || tok.kind !== 'op' || !AUGMENTED.has(tok.text)) continue
      const target = text.slice(0, tok.start).trim()
      const value = text.slice(tok.end).trim()
      // The target has to be something that can be assigned to, and the cheapest
      // honest test is that the reader can read it as a value: a name, an
      // attribute, a subscript. `a < b -= c` is not a line anybody wrote, and a
      // raw block says so.
      if (target === '' || value === '') return null
      const read = this.readChain(text, tokens.slice(0, i))
      if (!read || read.next !== i) return null
      return {
        type: 'snakie_python_augmented',
        fields: { TARGET: target, OP: tok.text },
        inputs: { VALUE: { block: this.expression(value) } }
      }
    }
    return null
  }

  /**
   * `print(a, b, c)` → the one block, with as many sockets as it needs (#1125).
   *
   * A `CallRule` names its sockets, so it cannot express "however many there
   * are" — and one of the fourteen lines `docs/blocks-coverage-epic.md` §10
   * lists as still grey is exactly this. The one-argument form stays with the
   * rule in `BUILT_IN_RULES`, which keeps every existing reading unchanged;
   * this claims the rest.
   *
   * THE FIRST SOCKET IS `TEXT`, matching the block — see `text.ts` for why that
   * name could not move.
   */
  private printCall(text: string): BlockJson | null {
    const tokens = tokenize(text)
    if (!tokens || tokens[0]?.kind !== 'name' || tokens[0].text !== 'print') return null
    if (tokens[1]?.text !== '(') return null
    const read = readArgs(tokens, text, 1)
    // A trailing comma is the learner's text, as it is on any other call, and
    // a call that does not end the line is not this statement.
    if (!read || read.trailingComma || read.next !== tokens.length) return null
    if (read.args.length < 2) return null
    const inputs: Record<string, { block: BlockJson }> = {}
    read.args.forEach((arg, i) => {
      inputs[i === 0 ? 'TEXT' : `ADD${i}`] = { block: this.expression(arg) }
    })
    return { type: 'text_print', extraState: { items: read.args.length }, inputs }
  }

  /** A whole line that is one recognised call, as a statement block. */
  private callStatement(text: string): BlockJson | null {
    const several = this.printCall(text)
    if (several) return several
    const tokens = tokenize(text)
    if (!tokens) return null
    // A PIN THE LEARNER NAMED GOES TO THE BLOCK THAT TAKES A NAME, ahead of the
    // hoisted-object path below — which would otherwise claim `led.value(1)`
    // for the block whose pin is a dropdown. `pin_15.value(1)` is not a named
    // pin (the generator's own hoisted objects are kept out of the alias map on
    // purpose) and still goes there, which is the boundary #1097 drew.
    const named = this.objectCallStatement(text, tokens, true)
    if (named) return named
    const call = readCall(tokens, text)
    if (call && call.rest.length === 0) {
      // A call on a hoisted object first (#1058) — `led_15.set(True)`. Its
      // "module" is an object this file declared, not a module at all.
      const onObject = this.receiverCall(call, 'statement')
      if (onObject) return onObject
      const known = this.matchCall(call, 'statement')
      if (known) return known
    }
    const onObject = this.objectCallStatement(text, tokens)
    if (onObject) return onObject
    return this.methodCall(text, tokens)
  }

  /**
   * A statement that is a palette block's method call on an object (W2, #1089).
   *
   * `xs.append(v)`: the chain up to the last dot is the receiver, and the call
   * on the end of it is the rule. Read by hand rather than through
   * {@link methodCall}, because the chain builds VALUE blocks and a rule of this
   * shape may only exist as a statement.
   */
  private objectCallStatement(
    text: string,
    tokens: readonly Token[],
    /** Only rules that claim a learner-named pin — see {@link callStatement}. */
    namedPinOnly = false
  ): BlockJson | null {
    for (let i = tokens.length - 1; i > 0; i--) {
      const tok = tokens[i]
      if (tok.kind !== 'op' || tok.text !== '.') continue
      const member = tokens[i + 1]
      if (!member || member.kind !== 'name') return null
      const read = readArgs(tokens, text, i + 2)
      if (!read || read.trailingComma || read.next !== tokens.length) return null
      // Asked of the TEXT rather than of the built block: a `variables_get`
      // carries its variable's id, and the name is what the alias map is keyed
      // by. A named pin is a bare name with a dot after it — `self.led.value()`
      // is an attribute of something, not a pin this file declared.
      if (namedPinOnly && !(i === 1 && tokens[0].kind === 'name' && this.aliases.has(tokens[0].text))) {
        return null
      }
      // THE NAME IS BUILT HERE RATHER THAN PARSED, and it has to be: a declared
      // pin is not readable as a plain variable — `name()` refuses it, because
      // a pin the blocks hoist must not also become a variable beside itself
      // (#1097). In THIS pass the name has already been checked against the
      // alias map, so the variable it stands for is exactly what belongs in the
      // socket, and `boundName` in the generator binds the two to one
      // identifier on the way back out.
      const object = namedPinOnly
        ? { block: this.pinVariable(tokens[0].text), next: i }
        : this.readChain(text, tokens.slice(0, i))
      if (!object || object.next !== i) return null
      return this.objectCall(object.block, member.text, read.args, 'statement', namedPinOnly)
    }
    return null
  }

  /**
   * A line that is nothing but a method call on an object (W1, #1088).
   *
   * **2,782 raw lines across 66 of 73 projects**, plus another 1,478 for the
   * `self.x.y()` form — the largest single gap in the corpus, and the block for
   * it has been in the Python drawer since #1018.
   *
   * Read as a VALUE and then re-shaped, because the chain that produces it is
   * the same chain an expression uses: `self.display.text(...)` is an attribute
   * read with a call on the end of it, whichever side of an `=` it is on. The
   * two call blocks differ only in whether they have an output or a pair of
   * statement connections, so the last link becomes the statement one and
   * everything nested under it is already right.
   *
   * Everything above has had its chance first — see `parseAtom`.
   */
  private methodCall(text: string, tokens: readonly Token[]): BlockJson | null {
    const read = this.readChain(text, tokens)
    if (!read || read.next !== tokens.length) return null
    if (read.block.type !== PYTHON_CALL_VALUE) return null
    return { ...read.block, type: PYTHON_CALL }
  }

  /**
   * Read a postfix chain out of a whole line, with `source` pointed at that line
   * so an argument can be sliced from it verbatim.
   *
   * Saved and restored, like {@link expression} does, because a line's own parse
   * may start a nested one for each of its arguments.
   */
  private readChain(
    text: string,
    tokens: readonly Token[]
  ): { block: BlockJson; next: number } | null {
    const outer = this.source
    this.source = text
    try {
      return this.parseAtom(tokens, 0)
    } finally {
      this.source = outer
    }
  }

  /**
   * A call on a HOISTED OBJECT → the block that wrote it (#1058).
   *
   * `led_15.set(True)`: the receiver names the object, the object's name holds
   * the pin, and its constructor — already matched in {@link hoistedObjects} —
   * holds anything else the block put there (a pull resistor, say). What is
   * left is the arguments, which are either sockets or fields.
   *
   * Null for anything that does not line up exactly, which puts the line back
   * on the raw path it was always on.
   */
  private receiverCall(
    call: { module?: string; fn: string; args: string[] },
    shape: 'statement' | 'value'
  ): BlockJson | null {
    if (!call.module) return null
    // On the real pass, only a name the probe proved is fully accounted for.
    if (this.consumable && !this.consumable.has(call.module)) return null
    const object = this.hoisted.get(call.module)
    if (!object) return null
    const match = object.matches.find(
      (m) => m.rule.fn === call.fn && (m.rule.shape ?? 'statement') === shape
    )
    if (!match) return null
    const rule = match.rule
    const rec = rule.receiver!
    const argFields = rule.argFields ?? {}
    const sockets = rule.args ?? []
    // Every argument is either a socket or a field, and there are exactly as
    // many as the block has. One too many is not this block.
    if (call.args.length !== sockets.length + Object.keys(argFields).length) return null

    const fields: Record<string, unknown> = { [rec.pinField]: object.pin, ...match.fields }
    const inputs: Record<string, { block: BlockJson }> = {}
    let socket = 0
    for (let i = 0; i < call.args.length; i++) {
      const asField = argFields[i]
      if (asField) {
        const value = asField.values[call.args[i].trim()]
        // A value the dropdown cannot hold — `led.set(x)` with a variable in it
        // — is not this block, and a raw line says so honestly.
        if (value === undefined) return null
        fields[asField.field] = value
        continue
      }
      inputs[sockets[socket++]] = { block: this.expression(call.args[i]) }
    }
    this.claimed.add(call.module)
    const block: BlockJson = { type: rule.type, fields }
    if (Object.keys(inputs).length > 0) block.inputs = inputs
    return block
  }

  /** Fill a rule's block from the argument texts. */
  /**
   * The block for a call, from the first rule that can actually hold it.
   *
   * EVERY MATCHING RULE IS TRIED, not just the first one found. One function can
   * be two blocks depending on how many arguments it is given — `round(x)` is
   * "round to the nearest whole number" and `round(x, 1)` is "round to 1 decimal
   * place", which `math_round` has nowhere to put. Stopping at the first rule
   * whose name matched meant the second block could never be reached, and the
   * two-argument form stayed raw Python inside an otherwise converted program.
   *
   * {@link buildCall} is what does the rejecting — a rule whose argument count
   * does not line up returns null rather than dropping an argument — so this
   * only has to keep asking.
   */
  private matchCall(
    call: { module?: string; fn: string; args: string[] },
    shape: 'statement' | 'value'
  ): BlockJson | null {
    for (const rule of rules()) {
      if (rule.fn !== call.fn) continue
      if ((rule.module ?? '') !== (call.module ?? '')) continue
      if ((rule.shape ?? 'statement') !== shape) continue
      const block = this.buildCall(rule, call.args)
      if (block) return block
    }
    return null
  }

  /**
   * One argument of a rule, as the block it goes into wants it (#1122).
   *
   * Ordinarily that is just the expression. A socket the rule lists in
   * {@link CallRule.oneBased} is counted back UP first, because the block face
   * counts from 1 and the Python counts from 0 — and null when that cannot be
   * undone exactly, which declines the whole rule.
   */
  private ruleArgument(rule: CallRule, name: string, text: string): BlockJson | null {
    if (rule.oneBased?.includes(name)) return this.oneBased(text.trim())
    return this.expression(text)
  }

  private buildCall(rule: CallRule, args: readonly string[]): BlockJson | null {
    const names = rule.args ?? []
    // AN ARGUMENT CAN BE A FIELD (#1130), as it long has been for a call on a
    // hoisted object: `isinstance(x, int)` is *x is a [whole number]*, and the
    // `int` is a dropdown rather than a socket — a socket there would mean a
    // learner had to find a block that says `int` the TYPE, which nothing in
    // the palette does. So the arity a rule expects is its sockets plus its
    // fields, exactly as `objectCall` already counts it.
    const argFields = rule.argFields ?? {}
    // A call with the wrong number of arguments is not this block, whatever it
    // looks like — better a raw block than one that silently drops an argument.
    if (args.length !== names.length + Object.keys(argFields).length) return null
    const block: BlockJson = { type: rule.type }
    const fields: Record<string, string> = { ...(rule.fields ?? {}) }
    const inputs: Record<string, { block: BlockJson }> = {}
    let socket = 0
    for (let i = 0; i < args.length; i++) {
      const asField = argFields[i]
      if (asField) {
        // A value the dropdown cannot hold — `isinstance(x, MyClass)` — is not
        // this block, and a raw line says so honestly.
        const value = asField.values[args[i].trim()]
        if (value === undefined) return null
        fields[asField.field] = value
        continue
      }
      const name = names[socket++]
      const filled = this.ruleArgument(rule, name, args[i])
      if (!filled) return null
      // A socket that CHECKS a type and an argument that cannot fit it is not
      // this block — see {@link CallRule.checks}.
      const want = rule.checks?.[name]
      if (want && !fitsSocket(filled, want)) return null
      inputs[name] = { block: filled }
    }
    if (Object.keys(fields).length > 0) block.fields = fields
    if (Object.keys(inputs).length > 0) block.inputs = inputs
    return block
  }

  /**
   * `xs.append(v)` → the block the Lists drawer has always had (W2, #1089).
   *
   * The receiver is not a module and not something the generator hoisted: it is
   * whatever the learner called their list, so it goes into a SOCKET. That is
   * the one shape `registerCallRules` could not express before, and it is why
   * `snakie_list_append` — 403 lines across 28 projects — was a block a child
   * could drag out and never get back.
   *
   * BEFORE the generic call block from W1, which would otherwise claim every one
   * of these and render `add v to xs` as `call append on xs with v`.
   */
  private objectCall(
    object: BlockJson,
    fn: string,
    args: readonly string[],
    shape: 'statement' | 'value',
    /** The named-pin pass, which is the ONLY way an `onNamedPin` rule matches. */
    namedPinOnly = false
  ): BlockJson | null {
    for (const rule of rules()) {
      if (!rule.on || rule.fn !== fn) continue
      // Exclusive both ways: a named-pin rule is unreachable outside its pass,
      // and an ordinary `on` rule never claims a line inside it.
      if (!!rule.onNamedPin !== namedPinOnly) continue
      if ((rule.shape ?? 'statement') !== shape) continue
      const names = rule.args ?? []
      const argFields = rule.argFields ?? {}
      // AN ARGUMENT CAN BE A FIELD HERE TOO, as it long has been for a call on a
      // module or on a hoisted object: `led.value(1)` is *set pin (led) to
      // [high]*, and the `1` is the dropdown rather than a socket. So the arity
      // this rule expects is its sockets PLUS its fields.
      const fieldCount = Object.keys(argFields).length
      if (args.length !== names.length + fieldCount) continue
      const want = rule.checks?.[rule.on]
      if (want && !fitsSocket(object, want)) continue
      const inputs: Record<string, { block: BlockJson }> = { [rule.on]: { block: object } }
      const fields: Record<string, string> = { ...(rule.fields ?? {}) }
      let fits = true
      let socket = 0
      for (let i = 0; i < args.length && fits; i++) {
        const asField = argFields[i]
        if (asField) {
          // A value the dropdown cannot hold — `led.value(brightness)` — is not
          // this block, and a raw line says so honestly.
          const value = asField.values[args[i].trim()]
          if (value === undefined) fits = false
          else fields[asField.field] = value
          continue
        }
        const name = names[socket++]
        const filled = this.ruleArgument(rule, name, args[i])
        const check = rule.checks?.[name]
        if (!filled || (check && !fitsSocket(filled, check))) fits = false
        else inputs[name] = { block: filled }
      }
      if (!fits) continue
      return {
        type: rule.type,
        ...(Object.keys(fields).length > 0 ? { fields } : {}),
        inputs
      }
    }
    return null
  }

  /**
   * An expression → a value block.
   *
   * Precedence climbing over the token list, lowest binding first, exactly
   * mirroring the `Order` table the generator emits with. Anything that does not
   * fit becomes a raw Python value block holding the original text, so the
   * expression is never lost and never rewritten.
   */
  expression(text: string): BlockJson {
    // ONE CALL, ONE SOCKET. This is the single door every value socket is
    // filled through, which is what makes the socket half of W0's ratchet a
    // count rather than a walk of the finished workspace — see
    // {@link ConversionReport.sockets}.
    this.report.sockets += 1
    const block = this.readExpression(text)
    if (GREY_VALUE_TYPES.has(block.type)) this.report.rawSockets += 1
    return block
  }

  private readExpression(text: string): BlockJson {
    const trimmed = text.trim()
    // A CALL TO ONE OF THIS PROGRAM'S OWN FUNCTIONS, before the parser, which
    // would otherwise read `double(3)` as a call it does not recognise and hand
    // back a raw value block. Only a `def` that RETURNS has a value caller, so
    // this declines everything else and the parser carries on as before.
    const defined = this.procedureCall(trimmed, 'value')
    if (defined) return defined
    const tokens = tokenize(trimmed)
    if (!tokens || tokens.length === 0) return this.rawValue(trimmed)
    const outer = this.source
    this.source = trimmed
    try {
      const parsed = this.parse(tokens, 0)
      // Anything left over means we stopped early — a slice, a comprehension, a
      // ternary. The whole expression goes in raw rather than half of it.
      if (!parsed || parsed.next !== tokens.length) return this.rawValue(trimmed)
      return parsed.block
    } finally {
      this.source = outer
    }
  }

  // --- precedence climbing -------------------------------------------------

  private parse(tokens: readonly Token[], at: number): { block: BlockJson; next: number } | null {
    return this.parseOr(tokens, at)
  }

  private parseOr(tokens: readonly Token[], at: number): { block: BlockJson; next: number } | null {
    return this.binary(tokens, at, ['or'], (a, b) => ({
      type: 'logic_operation',
      fields: { OP: 'OR' },
      inputs: { A: { block: a }, B: { block: b } }
    }), (t, i) => this.parseAnd(t, i), 'Boolean')
  }

  private parseAnd(tokens: readonly Token[], at: number): { block: BlockJson; next: number } | null {
    return this.binary(tokens, at, ['and'], (a, b) => ({
      type: 'logic_operation',
      fields: { OP: 'AND' },
      inputs: { A: { block: a }, B: { block: b } }
    }), (t, i) => this.parseNot(t, i), 'Boolean')
  }

  private parseNot(tokens: readonly Token[], at: number): { block: BlockJson; next: number } | null {
    // `await` BINDS TIGHTER THAN `not` AND LOOSER THAN A CALL (W9, #1096), which
    // is where Python puts it — with the unary operators. `await` lexes as a
    // NAME rather than a keyword, because the tokenizer's keyword list is the
    // one the recognisers branch on and nothing else needed it there.
    const tok = tokens[at]
    if (tok?.kind === 'name' && tok.text === 'await') {
      const inner = this.parseNot(tokens, at + 1)
      if (!inner) return null
      return {
        block: { type: 'snakie_await_value', inputs: { VALUE: { block: inner.block } } },
        next: inner.next
      }
    }
    if (tokens[at]?.kind === 'keyword' && tokens[at].text === 'not') {
      const inner = this.parseNot(tokens, at + 1)
      if (!inner) return null
      if (!fitsSocket(inner.block, 'Boolean')) return null
      return {
        block: { type: 'logic_negate', inputs: { BOOL: { block: inner.block } } },
        next: inner.next
      }
    }
    return this.parseComparison(tokens, at)
  }

  /**
   * A comparison — but never a CHAIN of them (#1071).
   *
   * `binary` is left-associative, which is right for `+` and wrong for this:
   * Python reads `0 <= n <= 59` as `0 <= n and n <= 59`, and folding it left
   * gives `(0 <= n) <= 59`, which compares a BOOL against 59. That is not a
   * blemish, it is a different program — `(0 <= 70) <= 59` is `True <= 59`,
   * which is `True`, so a guard that should have rejected 70 lets it through.
   *
   * So a chain is refused outright: `null` here sends the whole expression to a
   * raw value block, which regenerates the line verbatim and means exactly what
   * the learner wrote. Recognising chains properly — as the `and` of their
   * links — is worth doing one day; being wrong about them is not worth a day.
   *
   * `(a < b) < c` is untouched: the brackets are an atom, so only ONE operator
   * is at this level and the nested compare is what the source actually says.
   */
  private parseComparison(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    const COMPARE: Record<string, string> = {
      '==': 'EQ',
      '!=': 'NEQ',
      '<': 'LT',
      '<=': 'LTE',
      '>': 'GT',
      '>=': 'GTE'
    }
    const operators = Object.keys(COMPARE)
    const isCompare = (tok: Token | undefined): boolean =>
      Boolean(tok) && tok!.kind === 'op' && operators.includes(tok!.text)
    /**
     * Is another comparison waiting, making this a CHAIN?
     *
     * `<` and friends, and also `in` and `is` — Python puts all three at one
     * precedence level, so `a in b is c` is as much a chain as `0 <= n <= 59`
     * and folding it left is as wrong. Refusing sends the whole expression to a
     * raw value block, which regenerates it verbatim and means what was written.
     */
    const chained = (tok: Token | undefined): boolean =>
      isCompare(tok) || (tok?.kind === 'keyword' && (tok.text === 'in' || tok.text === 'is'))

    const left = this.parseBitOr(tokens, at)
    if (!left) return null

    // `x is None`, `x is not None`, and `a is b` → the Logic drawer's own two
    // blocks (W2 #1089; the other three forms, #1128).
    //
    // `is not` IS ITS OWN OPERATOR rather than a `not` around the block: a
    // `logic_negate` wrapper writes `not x is None`, which is the same test and
    // a different line, and rewriting somebody's line is the one thing this
    // module does not do. Both blocks carry a `MODE` setting that says it
    // exactly, which is what let `is not None` be read at all.
    //
    // `None` FIRST, then the general identity — otherwise `x is None` would
    // come back as the two-socket block with a `logic_null` in it, which is the
    // same line written by the wrong block.
    const is = tokens[left.next]
    if (is?.kind === 'keyword' && is.text === 'is') {
      const negated =
        tokens[left.next + 1]?.kind === 'keyword' && tokens[left.next + 1].text === 'not'
      const after = left.next + (negated ? 2 : 1)
      const mode = negated ? 'IS_NOT' : 'IS'
      if (tokens[after]?.text === 'None' && !isCompare(tokens[after + 1])) {
        return {
          block: {
            type: 'snakie_is_none',
            fields: { MODE: mode },
            inputs: { VALUE: { block: left.block } }
          },
          next: after + 1
        }
      }
      const right = this.parseBitOr(tokens, after)
      if (!right) return null
      // A CHAIN IS REFUSED, exactly as it is for `<` below: `a is b is c` folded
      // left compares a Bool against `c`, which is a different program.
      if (chained(tokens[right.next])) return null
      return {
        block: {
          type: 'snakie_identity',
          fields: { MODE: mode },
          inputs: { A: { block: left.block }, B: { block: right.block } }
        },
        next: right.next
      }
    }

    // `v in xs` and `v not in xs` → `snakie_list_contains` with its setting
    // (W2 #1089, then W8 #1095). `not in` is its OWN operator rather than a
    // `not` around this block: `logic_negate` would write `not v in xs`, which
    // is the same test and a different line.
    const notIn =
      is?.kind === 'keyword' &&
      is.text === 'not' &&
      tokens[left.next + 1]?.kind === 'keyword' &&
      tokens[left.next + 1].text === 'in'
    if ((is?.kind === 'keyword' && is.text === 'in') || notIn) {
      const right = this.parseBitOr(tokens, left.next + (notIn ? 2 : 1))
      if (!right) return null
      // NO `Array` REQUIREMENT ANY MORE (#1128). The block's haystack socket
      // stopped checking, because `"c" in text`, `key in config` and
      // `byte in buf` are all this same line and all had no block at all while
      // it did.
      if (chained(tokens[right.next])) return null
      return {
        block: {
          type: 'snakie_list_contains',
          fields: { MODE: notIn ? 'NOT_IN' : 'IN' },
          inputs: { ITEM: { block: left.block }, LIST: { block: right.block } }
        },
        next: right.next
      }
    }

    const op = tokens[left.next]
    if (!isCompare(op)) return left
    const right = this.parseBitOr(tokens, left.next + 1)
    if (!right) return null
    // The third operator at this level is what makes it a chain.
    if (chained(tokens[right.next])) return null
    return {
      block: {
        type: 'logic_compare',
        fields: { OP: COMPARE[op.text] },
        inputs: { A: { block: left.block }, B: { block: right.block } }
      },
      next: right.next
    }
  }

  /**
   * `|`, then `^`, then `&`, then `<<`/`>>` — Python's own four levels, in
   * Python's own order (#1127, epic #1119).
   *
   * THEY GO BETWEEN COMPARISON AND ADDITION, which is where Python puts them and
   * is the whole reason they are four functions rather than one: `x & 1 == 0`
   * means `x & (1 == 0)` in Python, and a reader that folded them into a single
   * precedence level would say the other thing — silently, and about a line that
   * is in every driver ever written. The levels cost four small functions and
   * buy exactness.
   *
   * Left-associative, like the arithmetic above, and the emitters in `maths.ts`
   * ask for one step looser on the left so `a & b & c` comes back as itself.
   */
  private parseBitOr(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    return this.bitwise(tokens, at, '|', 'OR', (t, i) => this.parseBitXor(t, i))
  }

  private parseBitXor(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    return this.bitwise(tokens, at, '^', 'XOR', (t, i) => this.parseBitAnd(t, i))
  }

  private parseBitAnd(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    return this.bitwise(tokens, at, '&', 'AND', (t, i) => this.parseShift(t, i))
  }

  /** One bitwise level: the operator, the dropdown value, and what is below it. */
  private bitwise(
    tokens: readonly Token[],
    at: number,
    op: string,
    field: string,
    next: (tokens: readonly Token[], at: number) => { block: BlockJson; next: number } | null
  ): { block: BlockJson; next: number } | null {
    return this.binary(
      tokens,
      at,
      [op],
      (a, b) => ({
        type: 'snakie_bitwise',
        fields: { OP: field },
        inputs: { A: { block: a }, B: { block: b } }
      }),
      next,
      'Number'
    )
  }

  private parseShift(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    return this.binary(
      tokens,
      at,
      ['<<', '>>'],
      (a, b, op) => ({
        type: 'snakie_bit_shift',
        fields: { DIR: op === '>>' ? 'RIGHT' : 'LEFT' },
        inputs: { VALUE: { block: a }, BY: { block: b } }
      }),
      (t, i) => this.parseAdditive(t, i),
      'Number'
    )
  }

  private parseAdditive(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    return this.binary(
      tokens,
      at,
      ['+', '-'],
      (a, b, op) => {
        // `xs.index(v) + 1` IS ONE BLOCK, not two (#1122). The Lists drawer
        // counts from 1, so its 1-based setting writes exactly this — and the
        // reader has to fold it back or a learner's own block comes back as an
        // addition wrapped round a call it cannot see inside.
        //
        // Only that exact shape: `+ 1`, literally, on a block the `index` rule
        // just produced. `xs.index(v) + n` is real arithmetic somebody wrote
        // and stays the addition it is.
        if (
          op === '+' &&
          ONE_BASED_PLUS_ONE.has(a.type) &&
          (a.fields as { START?: string } | undefined)?.START === 'ZERO' &&
          b.type === 'math_number' &&
          (b.fields as { NUM?: number } | undefined)?.NUM === 1
        ) {
          return { ...a, fields: { ...(a.fields as object), START: 'ONE' } }
        }
        return {
          type: 'math_arithmetic',
          fields: { OP: op === '+' ? 'ADD' : 'MINUS' },
          inputs: { A: { block: a }, B: { block: b } }
        }
      },
      (t, i) => this.parseMultiplicative(t, i),
      'Number'
    )
  }

  private parseMultiplicative(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    return this.binary(
      tokens,
      at,
      // `//` BINDS EXACTLY HERE (#1127) — same level as `*`, `/` and `%`, and
      // left-associative with them, which is what `7 // 2 * 3` depends on.
      ['*', '/', '%', '//'],
      (a, b, op): BlockJson | null =>
        op === '%'
          ? // `%` ON A STRING IS FORMATTING, NOT MODULO (#1068).
            //
            // `"%.1f" % value` is the oldest way to format a number in Python
            // and it is all over MicroPython examples — read as modulo it built
            // a `math_modulo` with a `text` block in a socket that checks for
            // Number, and `Blockly.serialization` THREW on the connection. The
            // canvas caught that, cleared itself and blocked writes: an empty
            // canvas beside a working program, which is exactly the failure the
            // terminal-block fix was about. Two of the `.py` files this repo
            // ships hit it.
            //
            // Declining takes the whole expression raw, where it regenerates
            // verbatim and formats exactly as it always did.
            isTextBlock(a) || isTextBlock(b)
            ? null
            : { type: 'math_modulo', inputs: { DIVIDEND: { block: a }, DIVISOR: { block: b } } }
          : {
              type: 'math_arithmetic',
              fields: { OP: MULTIPLICATIVE_OP[op] ?? 'MULTIPLY' },
              inputs: { A: { block: a }, B: { block: b } }
            },
      (t, i) => this.parsePower(t, i),
      'Number'
    )
  }

  private parsePower(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    const left = this.parseAtom(tokens, at)
    if (!left) return null
    if (tokens[left.next]?.kind === 'op' && tokens[left.next].text === '**') {
      // Right-associative, like Python's own.
      const right = this.parsePower(tokens, left.next + 1)
      if (!right) return null
      if (!fitsSocket(left.block, 'Number') || !fitsSocket(right.block, 'Number')) return null
      return {
        block: {
          type: 'math_arithmetic',
          fields: { OP: 'POWER' },
          inputs: { A: { block: left.block }, B: { block: right.block } }
        },
        next: right.next
      }
    }
    return left
  }

  /**
   * The shared left-associative loop every level above `power` is.
   *
   * TWO WAYS TO DECLINE, and they answer different questions.
   *
   * `build` may return NULL to decline the operator it was handed (#1068),
   * which takes the whole expression raw. `%` is why: beside a string it is
   * formatting, not modulo — see {@link parseMultiplicative}.
   *
   * `operand` is the type both sockets of the block being built accept
   * (#1071). A side that cannot fit refuses the whole expression rather than
   * building a workspace Blockly will not load — see {@link fitsSocket}.
   *
   * The first is about what the OPERATOR means; the second about what the
   * OPERANDS are. Either one declining keeps the line raw, which regenerates
   * it verbatim.
   */
  private binary(
    tokens: readonly Token[],
    at: number,
    operators: readonly string[],
    build: (a: BlockJson, b: BlockJson, op: string) => BlockJson | null,
    next: (tokens: readonly Token[], at: number) => { block: BlockJson; next: number } | null,
    operand?: SocketType
  ): { block: BlockJson; next: number } | null {
    let left = next(tokens, at)
    if (!left) return null
    for (;;) {
      const tok = tokens[left.next]
      if (!tok || !operators.includes(tok.text)) return left
      if (tok.kind !== 'op' && tok.kind !== 'keyword') return left
      const right = next(tokens, left.next + 1)
      if (!right) return null
      // The operands first: a side that cannot fit the socket is refused
      // whatever the operator turns out to mean.
      if (operand && (!fitsSocket(left.block, operand) || !fitsSocket(right.block, operand))) {
        return null
      }
      const built = build(left.block, right.block, tok.text)
      if (!built) return null
      left = { block: built, next: right.next }
    }
  }

  /** A literal, a name, a call, a bracketed expression, or a unary minus. */
  private parseAtom(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    const tok = tokens[at]
    if (!tok) return null

    // `*args` AND `**settings` (#1134, epic #1119).
    //
    // Only ever meaningful in an argument socket, which is the only place a
    // term can start with a star — `a * b` reaches this function with `b`, not
    // with `* b`. Reading them is what stops `super().__init__(*args,
    // **kwargs)` — the standard shape of a subclass's setup — coming back with
    // two grey sockets in it.
    if (tok.kind === 'op' && (tok.text === '*' || tok.text === '**')) {
      const inner = this.parseAtom(tokens, at + 1)
      if (!inner) return null
      return {
        block: {
          type: tok.text === '**' ? 'snakie_spread_named' : 'snakie_spread',
          inputs: { VALUE: { block: inner.block } }
        },
        next: inner.next
      }
    }

    // `~mask` (#1127). It binds where unary minus does — tighter than `*`,
    // looser than `**` — and the one place that matters is `~a ** 2`, which
    // Python reads as `~(a ** 2)`. Reading it here would give `(~a) ** 2`, a
    // different number, so that shape is declined and stays verbatim.
    if (tok.kind === 'op' && tok.text === '~') {
      const inner = this.parseAtom(tokens, at + 1)
      if (!inner) return null
      if (tokens[inner.next]?.kind === 'op' && tokens[inner.next].text === '**') return null
      if (!fitsSocket(inner.block, 'Number')) return null
      return {
        block: { type: 'snakie_bitwise_not', inputs: { VALUE: { block: inner.block } } },
        next: inner.next
      }
    }

    if (tok.kind === 'op' && tok.text === '-') {
      const inner = this.parseAtom(tokens, at + 1)
      if (!inner) return null
      // A negated NUMBER is just a smaller number, which reads far better on the
      // canvas than a subtraction from zero.
      if (inner.block.type === 'math_number') {
        return {
          block: {
            type: 'math_number',
            fields: { NUM: -Number((inner.block.fields as { NUM: number }).NUM) }
          },
          next: inner.next
        }
      }
      return null
    }

    // A LIST DISPLAY (#1135, epic #1119). `readings = [1, 2, 3]` used to go
    // grey — `lists_create_with` was listed in the symmetry test's exceptions
    // as *"a literal the expression parser does not read yet"* — which meant
    // the commonest first line of any program that keeps several readings could
    // be dragged out and never got back. It is also what `bytes([0xF4, 0x2E])`
    // needs, since the buffer block takes the list in a socket.
    if (tok.kind === 'open' && tok.text === '[') {
      return this.listDisplay(tokens, at)
    }

    // A DICTIONARY LITERAL (#1120). `{'a': 1}` used to take its whole line raw,
    // which is the escape hatch doing the drawer's job — the thing #1119 set
    // out to count.
    if (tok.kind === 'open' && tok.text === '{') {
      return this.dictLiteral(tokens, at)
    }

    if (tok.kind === 'open' && tok.text === '(') {
      // A COMMA MAKES IT A TUPLE, not a bracketed expression (#1121). Checked
      // before the parse, because `(x, y)` parses as `x` and then stops at the
      // comma — which used to take the whole line raw.
      const tuple = this.tupleLiteral(tokens, at)
      if (tuple) return tuple
      const inner = this.parse(tokens, at + 1)
      if (!inner) return null
      const close = tokens[inner.next]
      if (!close || close.kind !== 'close' || close.text !== ')') return null
      return { block: inner.block, next: inner.next + 1 }
    }

    if (tok.kind === 'number') {
      // A HEX OR BINARY LITERAL COMES BACK AS ITSELF (#1127). `math_number`
      // holds a number, so `0x3C` through it is `60` — the same value, a
      // different line, and a whole file's conversion refused by the round-trip
      // gate. These two blocks hold the DIGITS as text, so what the learner
      // copied out of a datasheet is what goes back into the mirror.
      //
      // A leading underscore is excluded rather than handled: `0x_FF` is legal
      // Python and the field would normalise it away, which is a rewrite.
      const hex = /^0x([0-9a-fA-F][0-9a-fA-F_]*)$/.exec(tok.text)
      if (hex) {
        return { block: { type: 'snakie_hex_number', fields: { HEX: hex[1] } }, next: at + 1 }
      }
      const binary = /^0b([01][01_]*)$/.exec(tok.text)
      if (binary) {
        return {
          block: { type: 'snakie_binary_number', fields: { BITS: binary[1] } },
          next: at + 1
        }
      }
      const written = tok.text.replace(/_/g, '')
      const n = Number(written)
      if (!Number.isFinite(n)) return null
      // ONLY IF THE BLOCK CAN SAY IT BACK (#1068). Blockly's number field holds a
      // number, not the text of one, so `0.0` came back `0` — an int where the
      // learner wrote a float — and `0x1F` came back `31`. Both are silent
      // rewrites of somebody's source. A literal whose written form does not
      // survive the trip stays a raw value block, which regenerates it exactly.
      if (String(n) !== written) return { block: this.rawValue(written), next: at + 1 }
      return { block: { type: 'math_number', fields: { NUM: n } }, next: at + 1 }
    }

    // AN f-STRING THAT IS NOTHING BUT ONE FORMATTED VALUE (#1125).
    //
    // `f"{t:.1f}"` is exactly what the format blocks write, and nothing else in
    // the reader claims an f-string — the lexer sees a NAME and a STRING, and
    // every other f-string stays raw and regenerates verbatim. Claiming the one
    // shape the blocks themselves emit is what keeps a learner's own block from
    // coming back grey; claiming more would mean parsing the f-string grammar,
    // which is not this issue.
    if (
      tok.kind === 'name' &&
      tok.text === 'f' &&
      tokens[at + 1]?.kind === 'string' &&
      tokens[at + 1].start === tok.end
    ) {
      const formatted = readFormatString(tokens[at + 1].text)
      if (!formatted) return null
      const value = this.readExpression(formatted.expr)
      // ONLY WHEN THE VALUE ITSELF IS READABLE. `f"{values!r:>10}"` has a
      // CONVERSION in it, and `values!r` is not an expression — reading the
      // spec and leaving the rest grey would produce a block that regenerates
      // a line the learner did not write. The whole f-string stays raw instead.
      if (GREY_VALUE_TYPES.has(value.type)) return null
      return {
        block: { type: formatted.type, fields: formatted.fields, inputs: { VALUE: { block: value } } },
        next: at + 2
      }
    }

    if (tok.kind === 'string') {
      const text = readStringLiteral(tok.text)
      if (text === null) return null
      // AND THEN WHATEVER IS DOTTED ONTO IT (#1135, and #1124 after it).
      // `'AT'.encode()` and `'hello'.upper()` are methods on a literal, and
      // without this the literal was read and the method was not — which took
      // the whole line raw. {@link chain} reads a slice off it too, which is
      // how `'EDCDEEE'[::-1]` comes back.
      return this.chain({ block: { type: 'text', fields: { TEXT: text } }, next: at + 1 }, tokens)
    }

    if (tok.kind === 'keyword' && (tok.text === 'True' || tok.text === 'False')) {
      return {
        block: { type: 'logic_boolean', fields: { BOOL: tok.text.toUpperCase() } },
        next: at + 1
      }
    }
    if (tok.kind === 'keyword' && tok.text === 'None') {
      return { block: { type: 'logic_null' }, next: at + 1 }
    }

    if (tok.kind === 'name') {
      // THE ORDER HERE IS THE WHOLE OF W1'S RISK (#1088). A rule, a hoisted
      // object, or a function this program defines must all still win over the
      // generic reading below — otherwise `led_15.set(True)` quietly regresses
      // from a real LED block to a grey call block, and NEITHER half of the
      // ratchet catches it: coverage is unchanged (both are recognised) and
      // round-trip is unchanged (both generate the same line). It has its own
      // test instead, in `blocksPythonObjects.test.ts`.
      const call = readCall(tokens, this.source, at)
      if (call) {
        const onObject = this.receiverCall(call, 'value')
        if (onObject) return this.chain({ block: onObject, next: call.next }, tokens)
        const known = this.matchCall(call, 'value')
        if (known) return this.chain({ block: known, next: call.next }, tokens)
        const own = this.procedureCall(this.callText(tokens, at, call.next), 'value')
        if (own) return this.chain({ block: own, next: call.next }, tokens)
      }
      // A NAME, AND THEN WHATEVER IS DOTTED ONTO IT. This is what used to bail:
      // `self.angle` in an expression took the entire enclosing statement to
      // grey, and `obj.read()` with it.
      const after = tokens[at + 1]
      // A call we could not place stays raw — a bare `foo(1)` has no object to
      // be a method OF, so there is no generic block for it. A `[` is not
      // refused here any more: {@link chain} reads a subscript, when the Lists
      // block can say it back exactly (W2, #1089).
      if (after && after.text === '(') return null
      const base = this.name(tok.text)
      if (!base) return null
      return this.chain({ block: base, next: at + 1 }, tokens)
    }

    return null
  }

  /**
   * `(a, b)` → the tuple block, when the brackets really hold a tuple (#1121).
   *
   * Null for `(a + b)`, which is one expression in brackets and is read as
   * itself — the comma at the TOP level of the brackets is the whole
   * difference, and a comma nested inside a call or a list is not one.
   *
   * `(x,)` — a one-element tuple, which is what a driver wanting a one-byte
   * buffer writes — is read too, and generates its comma back.
   */
  private tupleLiteral(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    let depth = 0
    const parts: string[] = []
    let from = tokens[at].end
    for (let i = at; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.kind === 'open') {
        depth += 1
        continue
      }
      if (tok.kind === 'close') {
        depth -= 1
        if (depth > 0) continue
        if (tok.text !== ')') return null
        const last = this.source.slice(from, tok.start).trim()
        // A TRAILING COMMA IS MEANINGFUL HERE and only here: `(x,)` is a
        // one-element tuple, while `(x, y,)` is the same pair with the
        // learner's spare comma, which the block has nowhere to record.
        if (last !== '') parts.push(last)
        else if (parts.length !== 1) return null
        if (parts.length === 0) return null
        if (parts.length === 1 && last !== '') return null
        return {
          block: {
            type: 'snakie_tuple',
            extraState: { items: parts.length },
            inputs: Object.fromEntries(
              parts.map((part, n) => [`ADD${n}`, { block: this.expression(part) }])
            )
          },
          next: i + 1
        }
      }
      if (depth === 1 && tok.kind === 'op' && tok.text === ',') {
        parts.push(this.source.slice(from, tok.start).trim())
        from = tok.end
      }
    }
    return null
  }

  /**
   * `[1, 2, 3]` → Blockly's own `lists_create_with` (#1135).
   *
   * The mutator's state is `{ itemCount: n }` and its sockets are `ADD0…ADDn`,
   * which is Blockly's shape rather than ours — the growable blocks this epic
   * added use `{ items: n }`, and the two must not be confused.
   *
   * A TRAILING COMMA IS THE LEARNER'S TEXT, as it is everywhere else here: the
   * block has one socket per item and nowhere to record that there was a comma
   * after the last of them, so `[1, 2,]` stays raw rather than coming back
   * silently reformatted.
   */
  private listDisplay(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    let depth = 0
    for (let i = at; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.kind === 'open') {
        depth += 1
        continue
      }
      if (tok.kind !== 'close') continue
      depth -= 1
      if (depth > 0) continue
      if (tok.text !== ']') return null
      const inside = this.source.slice(tokens[at].end, tok.start).trim()
      if (inside === '') {
        return {
          block: { type: 'lists_create_with', extraState: { itemCount: 0 } },
          next: i + 1
        }
      }
      // A TRAILING COMMA IS THE LEARNER'S TEXT, as it is on a call (see
      // {@link Converter.chain}): the block has one socket per item and
      // nowhere to record that there was a comma after the last of them.
      // `splitArgs` drops it silently, so the check has to be here — and the
      // multi-line `SEQUENCE = [...,]` in the fixture corpus is exactly the
      // line that catches it.
      if (inside.endsWith(',')) return null
      // A COMPREHENSION IS NOT A LIST DISPLAY (#1126). `[v for v in things]`
      // has no commas in it at all, so splitting would hand back one "item"
      // that is the whole comprehension — a list block with one grey socket
      // saying `v for v in things`, which is half an expression and worse than
      // none. It stays raw until the block that really says it exists.
      if (hasLoopKeyword(inside)) return null
      const parts = splitArgs(inside)
      if (!parts) return null
      return {
        block: {
          type: 'lists_create_with',
          extraState: { itemCount: parts.length },
          inputs: Object.fromEntries(
            parts.map((part, n) => [`ADD${n}`, { block: this.expression(part) }])
          )
        },
        next: i + 1
      }
    }
    return null
  }

  /**
   * `{'a': 1, 'b': 2}` → the Dictionaries drawer's literal (#1120).
   *
   * A SET IS NOT A DICTIONARY and shares the braces: `{1, 2, 3}` has no colons
   * in it, and the palette has no set blocks (#1119 argued them out), so a
   * brace group whose top level holds no `:` is declined and stays verbatim.
   * `{}` is the empty DICTIONARY, which is what Python means by it.
   *
   * A COMPREHENSION also wears braces — `{k: v for k in xs}` — and is declined
   * here by the same test that declines anything whose pieces do not split into
   * clean `key: value`: see #1126 for the block that does claim it.
   */
  private dictLiteral(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    let depth = 0
    for (let i = at; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.kind === 'open') {
        depth += 1
        continue
      }
      if (tok.kind !== 'close') continue
      depth -= 1
      if (depth > 0) continue
      if (tok.text !== '}') return null
      const inside = this.source.slice(tokens[at].end, tok.start).trim()
      if (inside === '') {
        return { block: { type: 'snakie_dict_create', extraState: { items: 0 } }, next: i + 1 }
      }
      // A trailing comma the block cannot record — as for a list display above.
      if (inside.endsWith(',') || hasLoopKeyword(inside)) return null
      const parts = splitArgs(inside)
      if (!parts) return null
      const inputs: Record<string, { block: BlockJson }> = {}
      for (let n = 0; n < parts.length; n++) {
        const split = splitPair(parts[n])
        if (!split) return null
        inputs[`KEY${n}`] = { block: this.expression(split[0]) }
        inputs[`VALUE${n}`] = { block: this.expression(split[1]) }
      }
      return {
        block: { type: 'snakie_dict_create', extraState: { items: parts.length }, inputs },
        next: i + 1
      }
    }
    return null
  }

  /**
   * A bare name as a value block, or null when reading it would rename it.
   *
   * `names.ts` deliberately renames a variable that would shadow something
   * load-bearing — `id` becomes `id_`, and PEP 8 agrees — which is the right
   * answer for a name a learner typed into a block and the WRONG one for a name
   * we are reading back out of their file. `bytes.decode(x)` read as blocks
   * would regenerate as `bytes_.decode(x)`: a program that no longer runs, and
   * one the round-trip gate forgives, because it compares token SHAPES and a
   * renamed name is the same shape.
   *
   * So a name that would not survive the trip is refused here, and the line it
   * is in stays raw and regenerates verbatim. The same answer a number whose
   * written form the block cannot hold already gets.
   */
  private name(text: string): BlockJson | null {
    // `self` IS NOT A VARIABLE (W6, #1093, and §4.3 of the delivery plan).
    // Blockly variables are global to the workspace and renameable from a
    // dropdown, so a learner renaming `self` in one method would rename it in
    // twelve and generate a class that no longer works. It gets a block of its
    // own, which is also how it reads best: *set (self) . speed to (speed)*.
    if (text === 'self') return { type: 'snakie_self' }
    if (isReservedName(text) || sanitise(text) !== text) return null
    // A MODULE IS NOT AN OBJECT — see {@link importedNames}.
    if (this.imported.has(text)) return null
    // A HOISTED OBJECT IS ALL OR NOTHING (#1058), and this is where W1 could
    // have broken that. `led_15.frobnicate()` read as a generic call block is a
    // use of `led_15` that no longer looks unreadable — so the constructor gets
    // swallowed, `led_15.set(True)` beside it hoists a SECOND `Led` on the same
    // pin under a collision-avoiding name, and two objects drive one pin.
    //
    // A use we cannot read as the block that wrote it keeps the object alive,
    // which is what it did before W1 and what the rule has always meant.
    //
    // WHILE IT IS STILL IN PLAY, which is the probe pass and, on the real pass,
    // the names that came out fully understood. A name the probe found an
    // unreadable use of is an ordinary variable again by the time the real pass
    // reaches it, and reading it as one is what keeps `led.on()` a block.
    if (this.hoisted.has(text) && (this.consumable === null || this.consumable.has(text))) {
      return null
    }
    // A name the `name pin` block declares is NOT refused here (#1097): the
    // generator binds a declared pin and a variable of that name to one
    // identifier, so `led.on()` reads as a call on `led` and writes `led.on()`.
    return { type: 'variables_get', fields: { VAR: { id: this.variable(text) } } }
  }

  /** A read of a pin this file NAMED, for the socket of an `onNamedPin` rule. */
  private pinVariable(name: string): BlockJson {
    return { type: 'variables_get', fields: { VAR: { id: this.variable(name) } } }
  }

  /** The source text of the call `readCall` just read, for `procedureCall`. */
  private callText(tokens: readonly Token[], at: number, next: number): string {
    return this.source.slice(tokens[at].start, tokens[next - 1].end)
  }

  /**
   * `.attr` and `.method(...)`, for as long as the tokens keep going (W1, #1088).
   *
   * The two blocks this builds — `snakie_python_attr_get` and
   * `snakie_python_call_value` — have shipped since #1018 and take an OBJECT
   * SOCKET, which is what makes a chain work at all: the reading of `self.x` is
   * the object that `.y()` is then called on, so `self.display.text(...)` is two
   * blocks nested rather than a shape nobody modelled.
   *
   * Null rather than a partial read, per the rule everywhere here: half a chain
   * would be half a line, and the whole line going raw regenerates it verbatim.
   */
  private chain(
    start: { block: BlockJson; next: number },
    tokens: readonly Token[]
  ): { block: BlockJson; next: number } | null {
    let cur = start
    for (;;) {
      const head = tokens[cur.next]
      if (head?.kind === 'open' && head.text === '[') {
        const item = this.subscript(tokens, cur)
        if (!item) return null
        cur = item
        continue
      }
      const dot = head
      if (!dot || dot.kind !== 'op' || dot.text !== '.') return cur
      const member = tokens[cur.next + 1]
      if (!member || member.kind !== 'name') return null
      const open = tokens[cur.next + 2]
      if (open?.kind === 'open' && open.text === '(') {
        const read = readArgs(tokens, this.source, cur.next + 2)
        // A TRAILING COMMA IS THE LEARNER'S TEXT. The block has one socket per
        // argument and nowhere to record that there was a comma after the last
        // of them, so `thing.configure(1, 2,)` would come back `(1, 2)` — a
        // silent rewrite, and one the round-trip gate refuses to commit, which
        // would cost the file its whole conversion rather than this line.
        if (!read || read.trailingComma) return null
        // A PALETTE'S OWN RULE FIRST (W2, #1089) — `xs.append(v)` is the Lists
        // drawer's block, not a generic call on an object.
        const known = this.objectCall(cur.block, member.text, read.args, 'value')
        if (known) {
          cur = { block: known, next: read.next }
          continue
        }
        const block = this.callBlock(PYTHON_CALL_VALUE, cur.block, member.text, read.args)
        if (!block) return null
        cur = { block, next: read.next }
        continue
      }
      cur = {
        block: {
          type: PYTHON_ATTR_GET,
          fields: { NAME: member.text },
          inputs: { OBJ: { block: cur.block } }
        },
        next: cur.next + 2
      }
    }
  }

  /**
   * `xs[i]` → the Lists drawer's `item n of xs`, when it can say it back (W2).
   *
   * ONE-BASED ON THE BLOCK, ZERO-BASED IN THE CODE — `lists.ts` chose that
   * deliberately, so that a learner meets the off-by-one honestly with both
   * sides on screen. Reading it back means undoing the same arithmetic, and only
   * the two forms the generator can write are undoable:
   *
   *     xs[0]      → item 1 of xs        (a literal, counted back up)
   *     xs[i - 1]  → item i of xs        (the `- 1` the generator wrote)
   *
   * `xs[i]` is NOT one of them: the block would have to hold `i + 1` and would
   * regenerate as `xs[i + 1 - 1]`, which is somebody's line rewritten. It stays
   * raw, and W8 (#1095) is where a general subscript block belongs.
   */
  private subscript(
    tokens: readonly Token[],
    cur: { block: BlockJson; next: number }
  ): { block: BlockJson; next: number } | null {
    let depth = 0
    for (let i = cur.next; i < tokens.length; i++) {
      const tok = tokens[i]
      if (tok.kind === 'open') depth += 1
      else if (tok.kind === 'close') {
        depth -= 1
        if (depth > 0) continue
        if (tok.text !== ']') return null
        const inside = this.source.slice(tokens[cur.next].end, tok.start).trim()
        // A COLON MAKES IT A SLICE (#1123), and a slice is a different set of
        // blocks. Checked first, because `[:2]` and `[1:4]` would otherwise
        // fall through to the index reader and take the whole line raw.
        const sliced = this.slice(inside, cur.block)
        if (sliced) return { block: sliced, next: i + 1 }
        // `seq[-1]` is "the last thing", which is its own block rather than a
        // negative index nobody has been taught to read.
        if (inside === '-1') {
          return {
            block: { type: 'snakie_last_item', inputs: { SEQ: { block: cur.block } } },
            next: i + 1
          }
        }
        // A STRING KEY IS A DICTIONARY, unambiguously (#1120). Nothing indexes
        // a list by `'name'`, so this one shape can be claimed for the
        // Dictionaries drawer with no guesswork at all — while `xs[i]`, where
        // the index is a variable, could be either and stays where #1089 put it.
        const key = readStringLiteral(inside)
        if (key !== null) {
          return {
            block: {
              type: 'snakie_dict_get',
              inputs: {
                DICT: { block: cur.block },
                KEY: { block: { type: 'text', fields: { TEXT: key } } }
              }
            },
            next: i + 1
          }
        }
        const index = this.oneBased(inside)
        // THE `Array` GUARD CAME OFF WITH THE SOCKET'S CHECK (#1124). `'abc'[0]`
        // is one letter out of a piece of text, which is the same line and the
        // same block — see the note on `snakie_list_get` in `lists.ts`. The
        // #1071 rule still holds: the reader refuses what the SOCKET refuses,
        // and this socket no longer refuses anything.
        if (!index) return null
        return {
          block: {
            type: 'snakie_list_get',
            inputs: { LIST: { block: cur.block }, INDEX: { block: index } }
          },
          next: i + 1
        }
      }
    }
    return null
  }

  /**
   * `seq[a:b]` and its four shorthands → the slice blocks (#1123).
   *
   * Null when `inside` is not a slice at all (no top-level colon), and null
   * again for the slices these blocks cannot say back — a step other than
   * `::-1`, a start the 1-based face cannot undo. Either way the line stays
   * raw and regenerates verbatim, which is the rule everywhere in this module.
   */
  private slice(inside: string, seq: BlockJson): BlockJson | null {
    const tokens = tokenize(inside)
    if (!tokens) return null
    const parts: string[] = []
    let depth = 0
    let from = 0
    for (const tok of tokens) {
      if (tok.kind === 'open') depth += 1
      else if (tok.kind === 'close') depth -= 1
      else if (depth === 0 && tok.kind === 'op' && tok.text === ':') {
        parts.push(inside.slice(from, tok.start).trim())
        from = tok.end
      }
    }
    if (parts.length === 0) return null
    parts.push(inside.slice(from).trim())
    const [start, stop, step] = [parts[0], parts[1], parts[2] ?? '']

    // `seq[::-1]` — backwards. The only step this palette has a block for; any
    // other one stays raw rather than coming back as a slice that drops it.
    if (parts.length === 3) {
      if (start !== '' || stop !== '' || step !== '-1') return null
      return { type: 'snakie_slice_reverse', inputs: { SEQ: { block: seq } } }
    }
    if (parts.length !== 2) return null
    if (start === '' && stop === '') {
      return { type: 'snakie_slice_copy', inputs: { SEQ: { block: seq } } }
    }
    if (start === '') {
      const n = this.expression(stop)
      if (!fitsSocket(n, 'Number')) return null
      return { type: 'snakie_slice_first', inputs: { SEQ: { block: seq }, N: { block: n } } }
    }
    if (stop === '') {
      // `seq[-3:]` — the last few. `seq[3:]` is "everything from the 4th on",
      // which is a real slice with no block, so it stays raw.
      const negative = /^-\s*(.+)$/.exec(start)
      if (!negative) return null
      const inner = negative[1].trim()
      // `-(a + b)` is how the block writes a compound count; either form reads.
      const bare = /^\((.*)\)$/.exec(inner)
      const n = this.expression(bare ? bare[1] : inner)
      if (!fitsSocket(n, 'Number')) return null
      return { type: 'snakie_slice_last', inputs: { SEQ: { block: seq }, N: { block: n } } }
    }
    // `seq[a - 1:b]` — the general one, 1-based on the block. Only the exact
    // arithmetic the block writes can be undone; see {@link oneBased}.
    const first = this.oneBased(start)
    if (!first) return null
    const last = this.expression(stop)
    if (!fitsSocket(last, 'Number')) return null
    return {
      type: 'snakie_slice_range',
      inputs: { SEQ: { block: seq }, FROM: { block: first }, TO: { block: last } }
    }
  }

  /** The INDEX socket for a zero-based Python subscript, or null — see above. */
  private oneBased(text: string): BlockJson | null {
    if (/^\d+$/.test(text)) return { type: 'math_number', fields: { NUM: Number(text) + 1 } }
    const minusOne = /^(.+?)\s*-\s*1$/.exec(text)
    if (!minusOne) return null
    const index = this.expression(minusOne[1])
    return fitsSocket(index, 'Number') ? index : null
  }

  /**
   * One of the two call blocks, filled in — the object in its socket, the method
   * in its field, the arguments in the sockets it grows for them.
   *
   * RECOGNISE THE STATEMENT, SOCKET THE REST (§4.2 of the delivery plan). An
   * argument we cannot read becomes a grey value block inside a real call block,
   * which is why `self.display.text(f"{temp:.1f}", 0, 0)` needs this and nothing
   * else — the f-string sits in a socket and regenerates verbatim.
   */
  private callBlock(
    type: string,
    object: BlockJson,
    method: string,
    args: readonly string[]
  ): BlockJson | null {
    if (args.length > MAX_CALL_ARGS) return null
    const inputs: Record<string, { block: BlockJson }> = { OBJ: { block: object } }
    args.forEach((arg, i) => {
      inputs[`ARG${i}`] = { block: this.expression(arg) }
    })
    return { type, fields: { METHOD: method }, extraState: { args: args.length }, inputs }
  }
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

/**
 * A call at `at`: `turtle.forward(100)` → module, fn, and the argument texts.
 *
 * The arguments come back as SLICES OF THE ORIGINAL LINE, not as re-joined
 * tokens. `f'{x}'` lexes as a name and a string, and no spacing rule puts those
 * back together the way they were typed — so the text that a raw block ends up
 * holding has to be the text the learner wrote, character for character.
 */
function readCall(
  tokens: readonly Token[],
  source: string,
  at = 0
): { module?: string; fn: string; args: string[]; next: number; rest: Token[] } | null {
  let i = at
  if (tokens[i]?.kind !== 'name') return null
  let module: string | undefined
  let fn = tokens[i].text
  i += 1
  if (tokens[i]?.text === '.' && tokens[i + 1]?.kind === 'name') {
    module = fn
    fn = tokens[i + 1].text
    i += 2
    // `a.b.c(...)` is a call on something we have no name for; leave it raw.
    if (tokens[i]?.text === '.') return null
  }
  const read = readArgs(tokens, source, i)
  if (!read) return null
  return { module, fn, args: read.args, next: read.next, rest: tokens.slice(read.next) }
}

/**
 * The argument list of a call whose `(` is at `at`: the texts, and where the
 * `)` left off.
 *
 * Split out of {@link readCall} for W1 (#1088), which reads a chain of calls —
 * `self.display.text(...)` — rather than the one-deep `module.fn(...)` that
 * function is shaped for.
 *
 * The arguments come back as SLICES OF THE ORIGINAL LINE, not as re-joined
 * tokens. `f'{x}'` lexes as a name and a string, and no spacing rule puts those
 * back together the way they were typed — so the text a raw block ends up
 * holding has to be the text the learner wrote, character for character.
 */
function readArgs(
  tokens: readonly Token[],
  source: string,
  at: number
): { args: string[]; next: number; trailingComma: boolean } | null {
  if (tokens[at]?.kind !== 'open' || tokens[at].text !== '(') return null
  let i = at + 1
  const args: string[] = []
  let depth = 0
  let from: number | null = null
  let to = 0
  /** A `,` with nothing after it — legal Python, and not an argument. */
  let trailingComma = false
  const flush = (): void => {
    if (from !== null) args.push(source.slice(from, to).trim())
    from = null
  }
  while (i < tokens.length) {
    const tok = tokens[i]
    if (depth === 0 && tok.kind === 'close' && tok.text === ')') {
      trailingComma = from === null && args.length > 0
      flush()
      return { args, next: i + 1, trailingComma }
    }
    if (depth === 0 && tok.kind === 'op' && tok.text === ',') {
      // A trailing comma before `)` is legal and contributes no argument.
      if (from !== null) flush()
      i += 1
      continue
    }
    if (tok.kind === 'open') depth += 1
    if (tok.kind === 'close') depth -= 1
    if (from === null) from = tok.start
    to = tok.end
    i += 1
  }
  return null
}

/** Put a set or a map back exactly as it was — see {@link Converter.trial}. */
function restore<T>(into: Set<T>, was: readonly T[]): void
function restore<K, V>(into: Map<K, V>, was: readonly [K, V][]): void
function restore(
  into: { clear(): void; add?: (v: unknown) => unknown; set?: (k: unknown, v: unknown) => unknown },
  was: readonly unknown[]
): void {
  into.clear()
  for (const entry of was) {
    if (into.add) into.add(entry)
    else into.set!((entry as unknown[])[0], (entry as unknown[])[1])
  }
}

/** A block's bubble as a trailing comment, with its two spaces, or ''. */
function commentOn(block: BlockJson): string {
  const text = (block.icons as { comment?: { text?: string } } | undefined)?.comment?.text
  return text ? `  ${text}` : ''
}

/** Is this block a text literal? `%` beside one is formatting, not modulo. */
function isTextBlock(block: BlockJson): boolean {
  return block.type === 'text'
}

/**
 * The text inside a simple string literal, or null when it is not one.
 *
 * Null for an f-string, a raw string or anything with an escape in it: a `text`
 * block holds plain text and the generator quotes it again on the way out, so a
 * literal that means something other than its characters must stay raw or it
 * would come back changed.
 */
function readStringLiteral(literal: string): string | null {
  // A TRIPLE-QUOTED LITERAL IS NOT A `text` BLOCK (#1091). The pattern below is
  // happy to read `"""hello"""` as the text `""hello""`, and the generator then
  // quotes that again: `banner = """hello"""` came back `banner = '""hello""'`.
  // A silent rewrite, and one the round-trip gate forgives, because a string is
  // a placeholder in a line signature. Raw regenerates it verbatim.
  if (/^("""|''')/.test(literal)) return null
  const m = /^(['"])(.*)\1$/s.exec(literal)
  if (!m) return null
  if (m[2].includes('\\')) return null
  return m[2]
}
