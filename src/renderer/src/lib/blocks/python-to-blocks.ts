import type { BlocksWorkspace } from '../../../../shared/blocks-doc'
import type { ArgField, CallReceiver } from './registry'
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
type SocketType = 'String' | 'Number' | 'Boolean'

const OUTPUT_TYPE = new Map<string, SocketType>([
  ['text', 'String'],
  ['text_join', 'String'],
  ['math_number', 'Number'],
  ['math_arithmetic', 'Number'],
  ['math_modulo', 'Number'],
  ['math_round', 'Number'],
  ['snakie_math_abs', 'Number'],
  ['text_length', 'Number'],
  ['logic_boolean', 'Boolean'],
  ['logic_compare', 'Boolean'],
  ['logic_negate', 'Boolean'],
  ['logic_operation', 'Boolean']
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
  'snakie_python_from_import'
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
export type { CallReceiver, ArgField }

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
  { fn: 'print', type: 'text_print', args: ['TEXT'] },
  { fn: 'len', type: 'text_length', args: ['VALUE'], shape: 'value' },
  { fn: 'abs', type: 'snakie_math_abs', args: ['NUM'], shape: 'value' },
  { fn: 'round', type: 'math_round', args: ['NUM'], shape: 'value' }
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
  return `${rule.receiver?.name ?? rule.module ?? ''}.${rule.fn}/${rule.shape ?? 'statement'}`
}

/** Every rule, palette-registered ones first so a palette can override. */
function rules(): CallRule[] {
  return [...REGISTERED, ...BUILT_IN_RULES]
}

/** Forget the registered rules — for tests, which must not leak into each other. */
export function resetCallRules(): void {
  REGISTERED.length = 0
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

/** Turn Python into a blocks workspace. Never throws; never refuses. */
export function pythonToBlocks(source: string): Conversion {
  const lines = logicalLines(source)
  // Which hoisted objects this file even HAS (#1058) — the constructor lines
  // that match a receiver rule's template exactly.
  const hoisted = hoistedObjects(lines, rules())
  // THE FIRST PASS IS A QUESTION, NOT AN ANSWER. It asks which of those objects
  // actually became blocks, and which are still named by a raw block — because a
  // constructor may only be consumed when every use of its object was
  // understood. Guessing that from the text would be guessing; converting and
  // looking is not.
  const probe = convert(lines, hoisted, null)
  const consumable = new Set([...probe.claimed].filter((name) => !probe.rawNames.has(name)))
  // The probe read every hoisted call it could and swallowed no constructors —
  // it was only ever a question. So whenever it read ANY, the real pass has to
  // run: to swallow the constructors of the objects that came out fully
  // understood, and to leave the rest of the program exactly as it was.
  const state = probe.claimed.size > 0 ? convert(lines, hoisted, consumable) : probe
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
  return input === 'ELSE' || input === 'STACK' || /^DO\d*$/.test(input)
}

/**
 * A node standing for a RUN of consecutive comment lines (#1062), in place of
 * the several statement nodes they arrived as.
 */
interface CommentRun extends Stmt {
  comment: readonly LogicalLine[]
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
 * a comment inside a function never joins the one above the `def`. A blank line
 * does not break a run, because `logicalLines` has already dropped blank lines —
 * and a paragraph split by a blank line is still one paragraph.
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
      run.push(node.line)
      continue
    }
    flush()
    out.push(node)
  }
  flush()
  return out
}

/** A parameter list, split and trimmed. Empty for `()`. */
function splitParams(params: string): string[] {
  return params
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/**
 * Can Blockly's `procedures_def` hold this parameter list faithfully? (#1063)
 *
 * Its parameters are bare NAMES — they become workspace variables — so that is
 * all it can express. A default (`flip_x=None`), a type annotation, `*args` or
 * `**kwargs` has nowhere to live on the block.
 *
 * This used to be a `.filter()`, which meant the ones it could not hold were
 * simply dropped: `def load(path, flip_x=None, flip_y=None)` came back as
 * `def load(path)`. A signature is not decoration — every call to that function
 * still passed three arguments — so a `def` we cannot model faithfully stays a
 * raw suite with its header verbatim instead. Uglier, and correct.
 */
function modellableParams(params: string): boolean {
  return splitParams(params).every((p) => /^[A-Za-z_]\w*$/.test(p))
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

/** `led_15 = Led(...)` → `led_15`. Null for anything that is not an assignment. */
export function constructorName(text: string): string | null {
  return /^([A-Za-z_]\w*)\s*=\s*\S/.test(text) ? /^([A-Za-z_]\w*)/.exec(text)![1] : null
}

/** Does `text` use `name` as a whole word? */
function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(name)}([^A-Za-z0-9_]|$)`).test(text)
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
  rs: readonly CallRule[]
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
  consumable: ReadonlySet<string> | null
): Converter {
  const state = new Converter(hoisted, consumable)
  state.stack = state.statements(tree(lines))
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
  readonly report: ConversionReport = { recognised: 0, raw: 0, rawLines: [], total: 0 }
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

  constructor(
    hoisted: ReadonlyMap<string, Hoisted> = new Map(),
    consumable: ReadonlySet<string> | null = null
  ) {
    this.hoisted = hoisted
    this.consumable = consumable
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
      if (this.consumable?.has(constructorName(node.line.text) ?? '')) {
        this.report.total += 1
        this.report.recognised += 1
        continue
      }
      // `pass` exists only to fill an empty suite, and an empty suite in blocks
      // is an empty socket — so carrying it over would add a block that means
      // "nothing" and then generate `pass` a second time.
      //
      // ONLY WHEN IT IS THE WHOLE BODY, though (#1068). Dropping it wherever it
      // appeared lost a `pass` that was keeping company with real statements, or
      // standing at the top level where no socket will put it back —
      // `examples/hello_world.py` came back a line short. Every emitter writes
      // `pass` for an empty body, so the one case this is for is still covered.
      if (node.line.text === 'pass' && grouped.length === 1) {
        this.report.total += 1
        this.report.recognised += 1
        continue
      }
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
    if (block.type === 'snakie_forever') {
      return {
        type: 'snakie_python_suite',
        fields: { CODE: 'while True:' },
        ...(block.inputs ? { inputs: block.inputs } : {})
      }
    }
    // `break` / `continue`, whose whole content is the keyword itself.
    return {
      type: 'snakie_python_statement',
      fields: { CODE: String((block.fields as { FLOW?: string } | undefined)?.FLOW ?? '').toLowerCase() }
    }
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

  /** One statement → one or more blocks (a `from x import a, b` makes two). */
  private statement(node: Stmt, siblings: readonly Stmt[]): BlockJson[] {
    this.report.total += 1
    const text = node.line.text
    const recognised = (blocks: BlockJson[]): BlockJson[] => {
      this.report.recognised += 1
      return blocks
    }

    // --- a line that carries a comment is that whole line (#1068) ----------
    //
    // `tokenize` stops at a trailing `#` and hands back the code alone, so every
    // recogniser below used to match the line and drop the rest of it — `x = 5
    // # how many times` came back as `x = 5`, and the module header three files
    // over promises the exact opposite about comments.
    //
    // No block holds a statement AND a comment about it, so recognising one at
    // all would mean choosing which half to keep. Raw keeps both, verbatim,
    // which is what the escape hatches are for.
    if (trailingCommentAt(text) >= 0) {
      if (isSuiteHeader(text) && node.body.length > 0) return [this.rawSuite(node)]
      return [this.raw(node.line)]
    }

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
    const forEach = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(text)
    if (forEach) {
      return recognised([
        this.withBody(
          {
            type: 'controls_forEach',
            fields: { VAR: { id: this.variable(forEach[1]) } },
            inputs: { LIST: { block: this.expression(forEach[2]) } }
          },
          'DO',
          node
        )
      ])
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

    const def = /^def\s+([A-Za-z_]\w*)\(([^)]*)\):$/.exec(text)
    if (def && this.depth === 0 && modellableParams(def[2])) {
      this.definitions.push(this.definition(def[1], def[2], node))
      // And the generator will write it into a section of its own, with a blank
      // line after it — which is the gap the learner typed under the `def`. See
      // {@link spacers}; nothing else can see this, because the block does not
      // stay in the chain being built.
      this.hoistedAbove = true
      // No block in the chain: it is a root of its own, collected above.
      return recognised([])
    }

    // --- simple statements -----------------------------------------------
    if (text === 'break' || text === 'continue') {
      return recognised([
        { type: 'controls_flow_statements', fields: { FLOW: text.toUpperCase() } }
      ])
    }
    const ret = /^return\s+(.+)$/.exec(text)
    if (ret) {
      // A `return` THAT IS NOT THE LAST STATEMENT (#1063). `definition()` takes
      // a trailing one as the `def`'s RETURN socket, which is how Blockly models
      // a function's result; everything else lands here.
      //
      // It used to become `procedures_ifreturn`, whose code is
      // `if <COND>: return <VALUE>` — and with nothing in COND the generator
      // wrote `if False:`. Every early return in the program became dead code,
      // quietly, which is a worse outcome than any ugly block. A raw statement
      // says `return x` and means it.
      return [this.raw(node.line)]
    }
    const change = /^([A-Za-z_]\w*)\s*\+=\s*(.+)$/.exec(text)
    if (change) {
      // `+=` on a STRING is concatenation, and `math_change`'s DELTA takes a
      // Number (#1071). `s += "x"` used to build a `text` block into it, which
      // made the whole workspace unloadable — so a delta that cannot be a
      // number keeps the line raw, and it regenerates verbatim.
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
      return [this.raw(node.line)]
    }
    // `=(?!=)` IS THE WHOLE GUARD (#1068). This used to read the `=` and then
    // check `text.slice(0, text.indexOf('='))` for a comparison operator — a
    // slice that stops BEFORE the character it is looking for, so `x == 5` was
    // read as assigning `= 5` to `x` and regenerated as `x = = 5`, which is not
    // Python at all. `!=`, `<=` and `>=` never reached the guard: `\s*` cannot
    // eat the `!`, `<` or `>`, so the pattern had already failed on them.
    const assign = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(text)
    if (assign) {
      return recognised([
        {
          type: 'variables_set',
          fields: { VAR: { id: this.variable(assign[1]) } },
          inputs: { VALUE: { block: this.expression(assign[2]) } }
        }
      ])
    }

    // --- a recognised call, standing on its own ---------------------------
    const call = this.callStatement(text)
    if (call) return recognised([call])

    // --- anything else ----------------------------------------------------
    //
    // A SUITE WE CANNOT READ STILL HAS A BODY (#1063). This used to return the
    // header line as a raw statement and walk away from `node.body` — so a
    // `class` lost every method inside it, a `try` lost everything it guarded,
    // and the report counted that a success. The raw SUITE block keeps the
    // header verbatim and nests the body under it, which is the difference
    // between an uglier program and a shorter one.
    if (isSuiteHeader(text) && node.body.length > 0) return [this.rawSuite(node)]
    return [this.raw(node.line)]
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

  /** `def name(a, b):` → a procedure definition, with its body. */
  private definition(name: string, params: string, node: Stmt): BlockJson {
    // Every one of these is a bare name — `modellableParams` is what let us in.
    const args = splitParams(params)
    // A trailing `return` becomes the definition's RETURN socket, which is the
    // shape Blockly models a function's result with.
    const last = node.body[node.body.length - 1]
    const returns = last && /^return\s+(.+)$/.exec(last.line.text)
    const body = this.nested(returns ? node.body.slice(0, -1) : node.body)
    const block: BlockJson = {
      type: returns ? 'procedures_defreturn' : 'procedures_defnoreturn',
      fields: { NAME: name },
      extraState: { params: args.map((a) => ({ name: a, id: this.variable(a) })) },
      inputs: {}
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

  /** A whole line that is one recognised call, as a statement block. */
  private callStatement(text: string): BlockJson | null {
    const tokens = tokenize(text)
    if (!tokens) return null
    const call = readCall(tokens, text)
    if (!call || call.rest.length > 0) return null
    // A call on a hoisted object first (#1058) — `led_15.set(True)`. Its
    // "module" is an object this file declared, not a module at all.
    const onObject = this.receiverCall(call, 'statement')
    if (onObject) return onObject
    const rule = rules().find(
      (r) => r.fn === call.fn && (r.module ?? '') === (call.module ?? '') && (r.shape ?? 'statement') === 'statement'
    )
    if (!rule) return null
    return this.buildCall(rule, call.args)
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
  private buildCall(rule: CallRule, args: readonly string[]): BlockJson | null {
    const names = rule.args ?? []
    // A call with the wrong number of arguments is not this block, whatever it
    // looks like — better a raw block than one that silently drops an argument.
    if (args.length !== names.length) return null
    const block: BlockJson = { type: rule.type }
    if (names.length > 0) {
      block.inputs = {}
      names.forEach((name, i) => {
        block.inputs![name] = { block: this.expression(args[i]) }
      })
    }
    return block
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
    const trimmed = text.trim()
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

    const left = this.parseAdditive(tokens, at)
    if (!left) return null
    const op = tokens[left.next]
    if (!isCompare(op)) return left
    const right = this.parseAdditive(tokens, left.next + 1)
    if (!right) return null
    // The third operator at this level is what makes it a chain.
    if (isCompare(tokens[right.next])) return null
    return {
      block: {
        type: 'logic_compare',
        fields: { OP: COMPARE[op.text] },
        inputs: { A: { block: left.block }, B: { block: right.block } }
      },
      next: right.next
    }
  }

  private parseAdditive(
    tokens: readonly Token[],
    at: number
  ): { block: BlockJson; next: number } | null {
    return this.binary(
      tokens,
      at,
      ['+', '-'],
      (a, b, op) => ({
        type: 'math_arithmetic',
        fields: { OP: op === '+' ? 'ADD' : 'MINUS' },
        inputs: { A: { block: a }, B: { block: b } }
      }),
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
      ['*', '/', '%'],
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
              fields: { OP: op === '*' ? 'MULTIPLY' : 'DIVIDE' },
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

    if (tok.kind === 'open' && tok.text === '(') {
      const inner = this.parse(tokens, at + 1)
      if (!inner) return null
      const close = tokens[inner.next]
      if (!close || close.kind !== 'close' || close.text !== ')') return null
      return { block: inner.block, next: inner.next + 1 }
    }

    if (tok.kind === 'number') {
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

    if (tok.kind === 'string') {
      const text = readStringLiteral(tok.text)
      if (text === null) return null
      return { block: { type: 'text', fields: { TEXT: text } }, next: at + 1 }
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
      const call = readCall(tokens, this.source, at)
      if (call) {
        const onObject = this.receiverCall(call, 'value')
        if (onObject) return { block: onObject, next: call.next }
        const rule = rules().find(
          (r) =>
            r.fn === call.fn &&
            (r.module ?? '') === (call.module ?? '') &&
            (r.shape ?? 'statement') === 'value'
        )
        if (rule) {
          const block = this.buildCall(rule, call.args)
          if (block) return { block, next: call.next }
        }
        return null // a call we do not know: the whole expression goes raw
      }
      // A plain name, not followed by a dot or a bracket, is a variable.
      const after = tokens[at + 1]
      if (after && (after.text === '.' || after.text === '(' || after.text === '[')) return null
      return {
        block: { type: 'variables_get', fields: { VAR: { id: this.variable(tok.text) } } },
        next: at + 1
      }
    }

    return null
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
  if (tokens[i]?.kind !== 'open' || tokens[i].text !== '(') return null
  i += 1

  const args: string[] = []
  let depth = 0
  let from: number | null = null
  let to = 0
  const flush = (): void => {
    if (from !== null) args.push(source.slice(from, to).trim())
    from = null
  }
  while (i < tokens.length) {
    const tok = tokens[i]
    if (depth === 0 && tok.kind === 'close' && tok.text === ')') {
      flush()
      i += 1
      return { module, fn, args, next: i, rest: tokens.slice(i) }
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
  const m = /^(['"])(.*)\1$/s.exec(literal)
  if (!m) return null
  if (m[2].includes('\\')) return null
  return m[2]
}
