import * as Blockly from 'blockly/core'
import { ensureBlocklyLocale } from './locale'
import { ImportManager, type PyImport } from './imports'
import { sanitise, toPythonIdentifier } from './names'
import { blockDefinition, registeredBlocks } from './registry'

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
}

/** A hoisted object: `led = Led(15)` in the setup section, requested by key. */
interface SetupBinding {
  name: string
  expr: string
  /** The block that first asked — so a traceback in setup lands somewhere real. */
  blockId: string | null
}

export class MicroPythonGenerator extends Blockly.CodeGenerator {
  /** Imports declared during this pass. */
  imports = new ImportManager()
  /** Hoisted constructions, keyed so the second asker gets the first's object. */
  private setupBindings = new Map<string, SetupBinding>()
  /** Every name spoken for: modules, hoisted objects, user variables. */
  private taken = new Set<string>()
  /** Blockly variable id -> the Python identifier it settled on this pass. */
  private variableNames = new Map<string, string>()
  private workspaceRef: Blockly.Workspace | null = null

  constructor() {
    super('MicroPython')
    // 4 spaces. `black` and `ruff` both insist, and more to the point it is what
    // every Python tutorial the learner will meet next uses.
    this.INDENT = '    '
  }

  /** Declare an import this block needs. */
  need(imp: PyImport): void {
    this.imports.need(imp)
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
  setup(key: string, suggestedName: string, expr: string, block?: Blockly.Block): string {
    const existing = this.setupBindings.get(key)
    if (existing) return existing.name
    const name = toPythonIdentifier(sanitise(suggestedName), this.reservedNames())
    this.taken.add(name)
    this.setupBindings.set(key, { name, expr, blockId: block?.id ?? null })
    return name
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
    const name = toPythonIdentifier(raw, this.reservedNames())
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

  /** Reset for a fresh pass. Called by {@link generateProgram}. */
  override init(workspace: Blockly.Workspace): void {
    this.imports = new ImportManager()
    this.setupBindings = new Map()
    this.variableNames = new Map()
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
    const marked = `${MARK}${block.id}${MARK}${code}`
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
export function generateProgram(workspace: Blockly.Workspace): GeneratedProgram {
  ensureBlocklyLocale()
  const gen = new MicroPythonGenerator()
  installEmitters(gen)
  gen.init(workspace)

  const missing = blocksWithoutEmitters(workspace)
  const chunks: string[] = []
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
      // keeps the rest of the program readable in the mirror; `missing` is what
      // stops anyone writing the result back to the file.
    }
  }
  const body = chunks.join('')

  // Setup is collected DURING the walk above, so it can only be rendered now.
  const setup = gen
    .setupLines()
    .map((b) => `${MARK}${b.blockId ?? ''}${MARK}${b.name} = ${b.expr}\n`)
    .join('')

  const sections = [gen.imports.empty ? '' : `${gen.imports.render()}\n`, setup, body].filter(
    (s) => s !== ''
  )
  return { ...assemble(sections), missing }
}

/**
 * Turn the marked sections into final text plus the map.
 *
 * The blank line BETWEEN sections is inserted here rather than being carried in
 * the sections themselves, so an absent section (a program with no imports)
 * leaves no gap behind it — and so the line numbers the map is built from are
 * the line numbers of the text that actually ships.
 */
function assemble(sections: readonly string[]): Omit<GeneratedProgram, 'missing'> {
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
 * Point the generator's emitter table at the registry.
 *
 * Done per generation rather than once at module load so a block registered
 * later — by a part, by a plugin (#1017) — is picked up without anything having
 * to remember to re-install anything.
 */
function installEmitters(gen: MicroPythonGenerator): void {
  const forBlock = gen.forBlock as Record<string, unknown>
  for (const def of registeredBlocks()) {
    forBlock[def.type] = (block: Blockly.Block) => {
      // Imports declared on the DEFINITION are needed whenever the block emits,
      // so they are collected here instead of in every emitter's first line.
      if (def.imports) gen.imports.needAll(def.imports)
      return def.code(block, gen)
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
