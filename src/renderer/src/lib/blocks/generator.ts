import type { Dialect } from '../../../../shared/dialect'
import * as Blockly from 'blockly/core'
import { ensureBlocklyLocale } from './locale'
import { ImportManager, type PyImport } from './imports'
import { sanitise, toPythonIdentifier } from './names'
import { blockDefinition, registeredBlocks } from './registry'
import { pinAliasesIn, pwmAliasesIn } from './board-pins'

/**
 * THE MICROPYTHON GENERATOR (#1010, epic #1007).
 * =============================================================================
 *
 * Blocks in, honest Snakie MicroPython out — the code a person would have
 * written, not a transcription of a block tree.
 *
 * WHY OUR OWN. Blockly ships a Python generator, and it targets CPython: it
 * knows nothing about `machine`, `snakie` or `instruments`, and it emits
 * helper-function scaffolding that would be the first thing a learner had to
 * un-learn on the way to text. Generated code a child has to grow out of defeats
 * the entire point of the epic, so the generator is ours.
 *
 * WHAT COMES OUT — always these three sections, in this order:
 *
 *     from snakie import Led          <- imports, grouped and deduplicated
 *     import time                        (`imports.ts` owns the ordering)
 *
 *     led = Led(15)                   <- setup: every object, constructed once,
 *     button = Button(14)                hoisted OUT of whatever loop uses it
 *
 *     while True:                     <- the program the blocks describe
 *         led.toggle()
 *         time.sleep(0.5)
 *
 * The hoisting is not tidiness. A construction left inside a loop re-creates the
 * object every pass, which on real hardware means re-configuring a pin thousands
 * of times a second — so the block that says "turn the LED on" asks for the
 * object it needs by KEY, gets the same one every time, and the constructor
 * lands in setup exactly once.
 *
 * THE SOURCE MAP ships from here rather than being reconstructed later, because
 * later it cannot be: once the code is a string, which block wrote line 7 is
 * gone. #1015 turns it into a traceback that highlights the failing block and
 * #1016 into hover-linked highlighting; both are cheap consequences of a map
 * that costs almost nothing to produce while the tree is still in hand.
 *
 * STABILITY is a requirement, not a nicety: the mirror regenerates on every
 * workspace change, so anything that depended on iteration order — a name, an
 * import's position, a hoisted line — would make unrelated parts of the file
 * jump while a learner is reading them, and would churn the source map under
 * #1016's highlighting. Imports sort, setup keeps first-request order (which
 * follows the blocks down the canvas), names count up deterministically.
 */

/** Operator precedence, Python's own. Mirrors Blockly's `Order` convention. */
export const Order = {
  ATOMIC: 0,
  COLLECTION: 1,
  STRING_CONVERSION: 1,
  MEMBER: 2.1,
  FUNCTION_CALL: 2.2,
  EXPONENTIATION: 3,
  UNARY_SIGN: 4,
  MULTIPLICATIVE: 5,
  ADDITIVE: 6,
  BITWISE_SHIFT: 7,
  BITWISE_AND: 8,
  BITWISE_XOR: 9,
  BITWISE_OR: 10,
  RELATIONAL: 11,
  LOGICAL_NOT: 12,
  LOGICAL_AND: 13,
  LOGICAL_OR: 14,
  CONDITIONAL: 15,
  LAMBDA: 16,
  NONE: 99
} as const

/**
 * The invisible marker a statement block's first line carries while the code is
 * being assembled, so the assembler can record which block wrote it.
 *
 * NUL is the one byte that cannot appear in generated Python — not in a string
 * literal we would emit, not in an identifier, not in a comment — so a marker
 * can never be mistaken for the program, and a stray one would be a bug loud
 * enough to see rather than a subtly wrong line number.
 */
const MARK = String.fromCharCode(0)

/** Matches a marked line: indentation, the id between markers, then the code. */
const MARKED_LINE = new RegExp(`^([ \\t]*)${MARK}([^${MARK}]*)${MARK}(.*)$`)

/** A program, and everything downstream needs to know about where it came from. */
export interface GeneratedProgram {
  /** The MicroPython. `ruff`-shaped: 4-space indent, no trailing whitespace. */
  code: string
  /**
   * 1-based line -> the id of the block responsible for it.
   *
   * EVERY code line has an entry, not just the ones a block's first line landed
   * on: a `for` block owns its `for ...:` and the body lines it wraps, and a
   * traceback pointing at line 7 needs an answer whatever is on line 7. Import
   * lines have no entry — no block owns them.
   */
  sourceMap: Map<number, string>
  /** The reverse: block id -> the lines it owns, ascending. #1016 highlights these. */
  blockLines: Map<string, number[]>
  /**
   * Block types in the workspace that no registered definition covers.
   *
   * Non-empty means `code` is INCOMPLETE — whatever those blocks would have
   * contributed is missing from it. A caller must not write such a program back
   * to the file: that would replace the learner's program with a version of it
   * that quietly lost a step. #1009's pre-injection check normally stops such a
   * workspace ever reaching the canvas; this is the same refusal, one layer
   * down, for the paths that don't go through it.
   */
  missing: string[]
  /**
   * The ids of the `def` blocks the generator HOISTED, in the order it emitted
   * them (#1112).
   *
   * Exposed so that anything else presenting the program — the PDF export's
   * blocks pages — can order functions before the main program from the SAME
   * notion the code is built from, rather than inventing a second answer to
   * "is this a function" that could drift from this one.
   */
  functions: string[]
  /**
   * The ids of top-level blocks whose stack threw while generating (#1068).
   *
   * The same warning as {@link missing} and a different cause: there the type
   * has no emitter, here the emitter ran and failed. Either way `code` is short
   * of everything that stack would have contributed — including the blocks above
   * the one that threw, since Blockly unwinds the whole chain — so a caller must
   * treat a non-empty `failed` exactly as it treats a non-empty `missing`.
   *
   * Ids rather than types, so the canvas can point at them.
   */
  failed: string[]
}

/** A hoisted object: `led = Led(15)` in the setup section, requested by key. */
interface SetupBinding {
  name: string
  expr: string
  /** The block that first asked — so a traceback in setup lands somewhere real. */
  blockId: string | null
  /**
   * Lines emitted straight after the assignment, with `{NAME}` filled in.
   *
   * CircuitPython needs this and MicroPython does not, which is most of what
   * makes the two APIs different shapes (#1040): `machine.Pin(15, Pin.OUT)`
   * says everything in the constructor, while `digitalio` builds the object
   * first and sets its `direction` afterwards. A hoisted object is still ONE
   * object with one key — it just takes two lines to make.
   */
  after: readonly string[]
}

export class MicroPythonGenerator extends Blockly.CodeGenerator {
  /**
   * Which Python this pass is writing (#1040).
   *
   * MicroPython unless told otherwise, which is both the default this app was
   * built for and the safe answer: `unknown` — no board, or a board that would
   * not say — generates MicroPython, because a program has to be written in
   * SOMETHING and that is what every Snakie lesson teaches.
   */
  dialect: Dialect = 'micropython'
  /** Imports declared during this pass. */
  imports = new ImportManager()
  /** Hoisted constructions, keyed so the second asker gets the first's object. */
  private setupBindings = new Map<string, SetupBinding>()
  /** Every name spoken for: modules, hoisted objects, user variables. */
  private taken = new Set<string>()
  /** The pin names this workspace declares — see {@link boundName}. */
  private pinNames: ReadonlySet<string> | null = null
  /**
   * The module names this pass was told about BEFORE it started (#1068's two
   * passes), as distinct from everything it has handed out since.
   *
   * {@link boundName} needs the difference: a declared pin outranks another
   * variable and never outranks a module, and by the time a `name pin` block
   * emits, the import that binds `time` may not have been requested yet — which
   * is the whole reason `generateProgram` runs twice.
   */
  private reservedModules = new Set<string>()
  /** Blockly variable id -> the Python identifier it settled on this pass. */
  private variableNames = new Map<string, string>()
  /** `def` blocks, in first-defined order: block id -> the whole definition. */
  private functions = new Map<string, string>()
  /** Blockly procedure name -> the Python identifier it settled on this pass. */
  private functionNames = new Map<string, string>()
  private workspaceRef: Blockly.Workspace | null = null
  /** The program section, filled in by the pass that walked the workspace. */
  body = ''

  constructor() {
    super('MicroPython')
    // 4 spaces. `black` and `ruff` both insist, and more to the point it is what
    // every Python tutorial the learner will meet next uses.
    this.INDENT = '    '
    // THE BRACKETS THAT PYTHON DOES NOT NEED (#1088, epic #1086).
    //
    // `valueToCode` adds brackets whenever the inner expression binds at least
    // as tightly as the socket it is going into, which is the safe default and
    // is wrong for the pairs below — `a.b` inside another `.` or a call is
    // exactly what a dotted chain IS. Without this, W1's reading of
    // `self.forward.freq(1000)` regenerated as `(self.forward).freq(1000)`:
    // valid Python, a different line, and one the round-trip gate rightly
    // refuses to commit.
    //
    // The same list Blockly's own Python generator carries, for the same
    // reasons. `and`/`or` are associative, so a nest of them is one chain.
    this.ORDER_OVERRIDES = [
      [Order.FUNCTION_CALL, Order.MEMBER],
      [Order.FUNCTION_CALL, Order.FUNCTION_CALL],
      [Order.MEMBER, Order.MEMBER],
      [Order.MEMBER, Order.FUNCTION_CALL],
      [Order.LOGICAL_NOT, Order.LOGICAL_NOT],
      [Order.LOGICAL_AND, Order.LOGICAL_AND],
      [Order.LOGICAL_OR, Order.LOGICAL_OR]
    ]
  }

  /**
   * Declare an import this block needs.
   *
   * `block` is optional: pass it only when the import IS the block's visible
   * effect (#1018's import blocks), so the source map can point at the line it
   * caused. See `ImportManager.need`.
   */
  need(imp: PyImport, block?: Blockly.Block): void {
    this.imports.need(imp, block?.id)
  }

  /**
   * Ensure a constructed object exists in the setup section, and give back the
   * name to call it by.
   *
   * `key` is the identity of the THING, not of the block: two separate "LED on
   * pin 15" blocks pass the same key and share one `led = Led(15)`. Get the key
   * wrong and you get two objects fighting over one pin; make it too coarse and
   * two different LEDs collapse into one.
   */
  setup(
    key: string,
    suggestedName: string,
    expr: string,
    block?: Blockly.Block,
    after: readonly string[] = []
  ): string {
    const existing = this.setupBindings.get(key)
    if (existing) {
      // AN UNCLAIMED LINE CAN STILL BE CLAIMED. A setup line is normally a
      // consequence of the block that wanted the object, so the first asker owns
      // it and later ones share. A named pin (`motor_left_speed = 15`) is the
      // exception: whichever block first USES the name registers the line
      // anonymously, but the line belongs to the `name pin` block — that line is
      // its whole visible effect, exactly as an import line is the import
      // block's. So an owner may still step forward; a second one may not.
      if (!existing.blockId && block) existing.blockId = block.id
      return existing.name
    }
    const name = this.boundName(suggestedName)
    this.taken.add(name)
    this.setupBindings.set(key, { name, expr, blockId: block?.id ?? null, after: [...after] })
    return name
  }

  /**
   * A NAME THE PROGRAM ITSELF DECLARED IS ONE BINDING, NOT TWO (#1097).
   *
   * `toPythonIdentifier` dodges a collision by counting up — `led` becomes
   * `led_` when `led` is already spoken for — which is exactly right for two
   * different things a learner happened to give the same name, and exactly
   * wrong for two halves of ONE thing.
   *
   * A `name pin` block is the second kind. It writes `led = Pin(25, Pin.OUT)`
   * into the setup section, and every other block that mentions that pin has to
   * say `led` too: the generic call block reading back `led.on()` holds a
   * VARIABLE called `led`, and letting that become `led_` produced
   * `led_.on()` — a program that names a pin it never made. It is also what
   * made the reader give up on the whole declaration and fall back to
   * *set led to (Pin(25, Pin.OUT))*, which is the bug as a learner meets it.
   *
   * So a name this workspace declares as a pin is authoritative: both halves
   * take it verbatim, and neither dodges the other.
   */
  private boundName(suggested: string): string {
    const clean = sanitise(suggested)
    // IT STILL LOSES TO A MODULE, and only to a module. A pin somebody called
    // `time` must not take the name out from under `import time` — the module
    // quietly stops being reachable and every `time.sleep()` in the program
    // breaks. So the authority is over the names this pass HANDS OUT, not over
    // the ones the imports bind, which is the same precedence `names.ts` has
    // always given the module namespace.
    const modules = this.imports.boundNames()
    for (const name of this.reservedModules) modules.add(name)
    if (this.declaredPins().has(clean) && !modules.has(clean)) return clean
    return toPythonIdentifier(clean, this.reservedNames())
  }

  /**
   * The names this workspace declares for a piece of hardware, off its `name
   * pin` and `name PWM` blocks.
   *
   * BOTH, because the collision is the same one either way: the naming block
   * writes `motor_a = PWM(Pin(15))` into the setup section, and a workspace
   * variable called `motor_a` that got renamed `motor_a_` would leave the two
   * halves pointing at different objects — the declaration on one name and every
   * block that uses it on another.
   */
  private declaredPins(): ReadonlySet<string> {
    if (this.pinNames) return this.pinNames
    const workspace = this.workspaceRef
    this.pinNames = new Set(
      workspace
        ? [
            ...pinAliasesIn(workspace).map((alias) => sanitise(alias.name)),
            ...pwmAliasesIn(workspace).map(sanitise)
          ]
        : []
    )
    return this.pinNames
  }

  /**
   * The Python identifier for a Blockly variable, stable for this pass.
   *
   * Keyed on the variable's ID rather than its name, so two variables a learner
   * has named the same thing stay two variables, and renaming one in the blocks
   * renames it everywhere in the code at once.
   */
  variableName(id: string, fallbackName?: string): string {
    const known = this.variableNames.get(id)
    if (known) return known
    const model = this.workspaceRef?.getVariableMap().getVariableById(id) ?? null
    const raw = model?.getName?.() ?? fallbackName ?? id
    // A variable named after a pin this program declares IS that pin — see
    // {@link boundName}.
    const name = this.boundName(raw)
    this.taken.add(name)
    this.variableNames.set(id, name)
    return name
  }

  /**
   * Names a new identifier must avoid: the module namespace the imports bind,
   * plus everything already handed out this pass.
   *
   * Recomputed rather than accumulated because imports keep arriving while
   * blocks emit — a variable named after a module imported later still has to
   * lose, or the module quietly stops being reachable.
   */
  private reservedNames(): Set<string> {
    const names = this.imports.boundNames()
    for (const n of this.taken) names.add(n)
    return names
  }

  /**
   * The Python identifier for a procedure, stable for this pass.
   *
   * Keyed on the name Blockly holds, because that IS a procedure's identity here
   * — Blockly enforces uniqueness on it and renames every caller when it
   * changes, so two `def`s can never collide except through sanitising, which
   * {@link toPythonIdentifier} resolves by counting up.
   */
  functionName(raw: string): string {
    const known = this.functionNames.get(raw)
    if (known) return known
    const name = toPythonIdentifier(raw, this.reservedNames())
    this.taken.add(name)
    this.functionNames.set(raw, name)
    return name
  }

  /**
   * Record a `def`, to be emitted in its own section above the program.
   *
   * A definition block sits on the canvas wherever the learner dropped it —
   * often below the code that calls it, because that is where there was room.
   * Emitted in place, the call would run before the `def` and die with a
   * `NameError` that has nothing to do with anything they did wrong. So
   * definitions are collected and hoisted, which is also where a Python
   * programmer would have put them.
   */
  defineFunction(blockId: string, code: string): void {
    this.functions.set(blockId, code)
  }

  /** The collected `def`s, in first-defined order. @internal */
  functionCode(): readonly string[] {
    return [...this.functions.values()]
  }

  /** The ids of the blocks those `def`s came from, same order. @internal */
  functionBlockIds(): readonly string[] {
    return [...this.functions.keys()]
  }

  /**
   * Spoken for before this pass starts — the names the imports are going to
   * bind (#1068). See the two passes in {@link generateProgram}.
   */
  reserve(names: Iterable<string>): void {
    for (const name of names) {
      this.taken.add(name)
      this.reservedModules.add(name)
    }
  }

  /** Reset for a fresh pass. Called by {@link generateProgram}. */
  override init(workspace: Blockly.Workspace): void {
    this.imports = new ImportManager()
    this.setupBindings = new Map()
    this.variableNames = new Map()
    this.pinNames = null
    this.reservedModules = new Set()
    this.functions = new Map()
    this.functionNames = new Map()
    this.taken = new Set()
    this.workspaceRef = workspace
  }

  /**
   * Blockly's per-block hook: chain to the next statement, and tag the block's
   * own first line for the source map.
   *
   * A VALUE block is left exactly alone. Its code is an expression that will be
   * substituted into the middle of a line, so a marker there would end up inside
   * the program — and a value block has no line of its own to own anyway.
   */
  override scrub_(block: Blockly.Block, code: string, thisOnly?: boolean): string {
    if (block.outputConnection) return code
    // A BLOCK THAT GENERATED NOTHING GETS NO MARKER (#1016).
    //
    // `def` is the one emitter that correctly returns the empty string — its
    // body is hoisted into the functions section, so it contributes nothing
    // where it stands. A marker on an empty string is a marker with no line of
    // its own, and it FUSES with whatever comes next: the def's marker and the
    // next block's marker end up on one line, of which the assembler strips the
    // first and leaves the second sitting in the code. That put a NUL byte in
    // the generated Python, saved it to the file and sent it to the board — in
    // any program with a function and anything after it, which is most programs
    // that have a function at all.
    const noted = withTrailingComment(block, code)
    const marked = noted === '' ? '' : `${MARK}${block.id}${MARK}${noted}`
    if (thisOnly) return marked
    const next = block.nextConnection?.targetBlock() ?? null
    return marked + (next ? (this.blockToCode(next) as string) : '')
  }

  /** The hoisted setup lines, in first-request order. @internal */
  setupLines(): readonly SetupBinding[] {
    return [...this.setupBindings.values()]
  }
}

/**
 * Generate a whole program from a workspace.
 *
 * Deliberately NOT `workspaceToCode`: that returns a bare string, and the source
 * map is the half of this issue that cannot be rebuilt afterwards. Assembling
 * the three sections here is also what decides the line numbering the map is
 * expressed in, so the two can't disagree.
 */
export function generateProgram(
  workspace: Blockly.Workspace,
  dialect: Dialect = 'micropython'
): GeneratedProgram {
  ensureBlocklyLocale()
  // TWO PASSES, BECAUSE A NAME CANNOT BE TAKEN BACK (#1068).
  //
  // `ImportManager.boundNames()` is what stops a learner's variable called
  // `time` replacing the module — but it can only report the imports declared
  // SO FAR, and they keep arriving while blocks emit. A variable above the block
  // that needs `import time` was named before anything had asked for it:
  //
  //     time = 0           import time      <- hoisted to the top, as always
  //     time.sleep(1)  ->  time = 0         <- and now the module is an int
  //                        time.sleep(1)       AttributeError, nowhere near
  //                                            the block that caused it
  //
  // The first pass exists only to find out which names the imports will bind;
  // its output is thrown away. The second is the real one, with those names
  // already spoken for, so the variable comes out `time_` wherever it sits.
  const survey = runPass(workspace, dialect, null)
  const pass = runPass(workspace, dialect, survey.gen.imports.boundNames())
  return {
    ...assemble(sectionsOf(pass.gen)),
    functions: [...pass.gen.functionBlockIds()],
    missing: blocksWithoutEmitters(workspace),
    failed: pass.failed
  }
}

/** One generation pass over `workspace`, with `reserved` names already taken. */
function runPass(
  workspace: Blockly.Workspace,
  dialect: Dialect,
  reserved: ReadonlySet<string> | null
): { gen: MicroPythonGenerator; failed: string[] } {
  const gen = new MicroPythonGenerator()
  gen.dialect = dialect
  installEmitters(gen)
  gen.init(workspace)
  if (reserved) gen.reserve(reserved)

  const chunks: string[] = []
  const failed: string[] = []
  for (const block of workspace.getTopBlocks(true)) {
    if (block.outputConnection) continue // a naked value block generates nothing
    try {
      const out = gen.blockToCode(block)
      const text = Array.isArray(out) ? out[0] : out
      if (text) chunks.push(text)
    } catch {
      // Blockly THROWS on a block type with no emitter, and it throws from
      // wherever that block is — which takes the whole stack it sits in with it,
      // including everything above it that generated fine. Skipping the stack
      // keeps the rest of the program readable in the mirror.
      //
      // AND IT IS WRITTEN DOWN (#1068). This used to be swallowed in silence, on
      // the reasoning that `missing` was already the guard — and `missing` only
      // knows about types with no registered emitter. An emitter that THREW for
      // a type we do have left `missing` empty, so the guard did not fire and a
      // program short of an entire stack, sometimes the empty string, was
      // written over the learner's file. A stack that would not generate is a
      // stack that is not in the program, whatever the reason.
      failed.push(block.id)
    }
  }
  gen.body = chunks.join('')
  return { gen, failed }
}

/** The three marked sections, in the order they are written. */
function sectionsOf(gen: MicroPythonGenerator): string[] {
  // Setup is collected DURING the walk, so it can only be rendered now.
  const setup = gen
    .setupLines()
    .map((b) =>
      [
        `${MARK}${b.blockId ?? ''}${MARK}${b.name} = ${b.expr}\n`,
        // `{NAME}` rather than the name inline, because the generator picks the
        // name — a second `led_15` on another pin becomes `led_16`, and a
        // follow-up line written by hand would still say `led_15`.
        ...b.after.map((line) => `${MARK}${b.blockId ?? ''}${MARK}${line.replace(/\{NAME\}/g, b.name)}\n`)
      ].join('')
    )
    .join('')

  // Functions ABOVE setup and the program: a `def` has to exist before anything
  // runs it, and putting them first is also where a Python programmer looks.
  const functions = gen.functionCode().join('\n')

  return [
    gen.imports.empty
      ? ''
      : // An import line is marked only when a block claimed it (#1018) — an
        // unclaimed line carries an EMPTY block id, which the assembler already
        // knows means "this line belongs to nobody".
        `${gen.imports.render((line, blockId) => `${MARK}${blockId ?? ''}${MARK}${line}`)}\n`,
    functions,
    setup,
    gen.body
  ].filter((s) => s !== '')
}

/**
 * Turn the marked sections into final text plus the map.
 *
 * The blank line BETWEEN sections is inserted here rather than being carried in
 * the sections themselves, so an absent section (a program with no imports)
 * leaves no gap behind it — and so the line numbers the map is built from are
 * the line numbers of the text that actually ships.
 */
function assemble(
  sections: readonly string[]
): Omit<GeneratedProgram, 'functions' | 'missing' | 'failed'> {
  const raw = sections.join('\n')
  const sourceMap = new Map<number, string>()
  const blockLines = new Map<string, number[]>()
  const out: string[] = []

  // Lines with no marker belong to the last block that had one: the `else:` of
  // an if, a continuation line, the body of a loop between its own blocks. A
  // traceback landing on one of those should still highlight the block it is
  // part of.
  let current: string | null = null

  for (const line of raw.split('\n')) {
    const match = MARKED_LINE.exec(line)
    let text: string
    if (match) {
      current = match[2] === '' ? null : match[2]
      text = match[1] + match[3]
    } else {
      text = line
      // A blank line is a separator, not part of anything — it ends the run, so
      // a section boundary can't attribute the next section to the last block.
      if (line.trim() === '') current = null
    }
    // `ruff`-shaped: never trailing whitespace, even on a line we only indented.
    out.push(text.replace(/[ \t]+$/, ''))
    const lineNo = out.length
    if (current && text.trim() !== '') {
      sourceMap.set(lineNo, current)
      const lines = blockLines.get(current) ?? []
      lines.push(lineNo)
      blockLines.set(current, lines)
    }
  }

  // Exactly one trailing newline — the shape every formatter agrees on.
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  const code = out.length === 0 ? '' : `${out.join('\n')}\n`
  return { code, sourceMap, blockLines }
}

/**
 * The Python ONE block writes, with the source markers taken back out (#1245).
 *
 * `generateProgram` answers "what does this program say"; this answers "what
 * does this block say", which is the question the *What block is this?* panel
 * asks of a block a learner has never seen before. Deliberately `thisOnly`: the
 * stack under a `for` is a different block's answer, and pasting twenty lines
 * into a panel that was asked about one of them helps nobody.
 *
 * The markers `scrub_` wraps each line in are NUL bytes carrying a block id for
 * the source map. Nothing outside the assembler may see them — a NUL in a
 * string a panel renders is invisible, uncopyable and, if it ever reached a
 * file, corrupt Python — so they come off here.
 */
export function pythonForBlock(block: Blockly.Block, dialect: Dialect = 'micropython'): string {
  const workspace = block.workspace
  const gen = new MicroPythonGenerator()
  gen.dialect = dialect
  installEmitters(gen)
  gen.init(workspace)
  const out = gen.blockToCode(block, true)
  const text = Array.isArray(out) ? out[0] : out
  return String(text ?? '').replace(new RegExp(`${MARK}[^${MARK}]*${MARK}`, 'g'), '')
}

/**
 * Point the generator's emitter table at the registry.
 *
 * Done per generation rather than once at module load so a block registered
 * later — by a part, by a plugin (#1017) — is picked up without anything having
 * to remember to re-install anything.
 */
function installEmitters(gen: MicroPythonGenerator): void {
  const forBlock = gen.forBlock as Record<string, unknown>
  for (const def of registeredBlocks()) {
    // ONE BLOCK, TWO TEMPLATES (#1040). The alternative was two block sets, and
    // the argument against it is the argument for this whole file format: a
    // learner's program should be a program, not a program-for-a-Pico. One
    // block means a canvas saved in a classroom's MicroPython half opens and
    // runs in its CircuitPython half, and the mirror next door shows exactly
    // what it generated either way — so "you cannot predict the code" is
    // answered by looking at it.
    //
    // Absent means this block only knows MicroPython, which `scopedByEmitters`
    // turns into a scope so the toolbox never offers it to the wrong board.
    const emitter = gen.dialect === 'circuitpython' && def.circuitpython ? def.circuitpython : def
    forBlock[def.type] = (block: Blockly.Block) => {
      // Imports declared on the DEFINITION are needed whenever the block emits,
      // so they are collected here instead of in every emitter's first line.
      if (emitter.imports) gen.imports.needAll(emitter.imports)
      return emitter.code(block, gen)
    }
  }
}

/**
 * Block types in `workspace` that no registered definition covers.
 *
 * A block with no emitter generates NOTHING — a block a child placed, that does
 * nothing, with no error anywhere. Callers use this to say so out loud instead.
 */
export function blocksWithoutEmitters(workspace: Blockly.Workspace): string[] {
  const missing = new Set<string>()
  for (const block of workspace.getAllBlocks(false)) {
    if (!blockDefinition(block.type)) missing.add(block.type)
  }
  return [...missing]
}


/**
 * A BLOCK'S NOTE, ON THE END OF ITS FIRST LINE (W5, #1092, epic #1086).
 *
 * `x = 5  # how many times` is one of the commonest shapes in teaching code and
 * it was a grey raw block in 55 of 73 projects, for nothing but having a note on
 * the end. #1068 refused to recognise such a line at all, which was right while
 * no block could hold both halves.
 *
 * A block can. Blockly's comment bubble is a field every block already has —
 * `def` has carried a docstring in it since #1007 — and it serialises with the
 * block, so nothing about the file format changes. This is the other half: what
 * the bubble writes when the block emits.
 *
 * THE FIRST LINE, and only it. A C-block's code is its header plus everything in
 * its mouth, and a note about `while True:` belongs on `while True:`, not on the
 * last line of the body.
 *
 * ONE LINE ONLY. A multi-line bubble is a description — a paragraph somebody
 * wrote about a block — and folding it onto the end of a line of code would
 * change what they wrote. It stays a bubble and writes nothing.
 *
 * A `#` IS ADDED WHEN IT IS MISSING, because a bubble is free text and
 * `  fix this later` is not Python. The reader always stores the comment
 * verbatim, `#` and all, so a round trip never goes through that branch.
 *
 * A block that generated nothing where it stands — an import, a `def`, the
 * `name pin` block — gets nothing, because there is no line for the note to sit
 * on. The reader declines to put one there for the same reason.
 */
function withTrailingComment(block: Blockly.Block, code: string): string {
  if (code === '') return code
  const raw = (block.getCommentText?.() ?? '').trim()
  if (raw === '' || raw.includes('\n')) return code
  const note = raw.startsWith('#') ? raw : `# ${raw}`
  const at = code.indexOf('\n')
  const first = at === -1 ? code : code.slice(0, at)
  const rest = at === -1 ? '' : code.slice(at)
  // PEP 8's two spaces, which is also what `trailingCommentAt` will find there.
  return `${first}  ${note}${rest}`
}
