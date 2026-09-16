import type { BlocksWorkspace } from '../../../../shared/blocks-doc'
import { isSuiteHeader, logicalLines, tokenize, type LogicalLine, type Token } from './python-tokens'

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

/** A statement and the suite indented under it. */
interface Stmt {
  line: LogicalLine
  body: Stmt[]
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
}

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
    const key = `${rule.module ?? ''}.${rule.fn}`
    const at = REGISTERED.findIndex((r) => `${r.module ?? ''}.${r.fn}` === key)
    if (at === -1) REGISTERED.push(rule)
    else REGISTERED[at] = rule
  }
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
  const state = new Converter()
  const stack = state.statements(tree(logicalLines(source)))
  // Definitions are TOP-LEVEL blocks, not links in the chain: Blockly models a
  // `def` as a hat with no previous or next connection, which is also the truth
  // about Python — a function is not a step in the program, it is a thing the
  // program can do. The generator hoists their code above the body either way.
  const roots = [...state.definitions, ...(stack ? [stack] : [])]
  const positioned = roots.map((block, i) => ({ ...block, x: 40, y: 40 + i * 240 }))
  identify(positioned)
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
  /** Variable name → the id the workspace declares it under. */
  readonly variables = new Map<string, string>()
  /** `def` blocks, which are top-level hats rather than links in a chain. */
  readonly definitions: BlockJson[] = []
  /**
   * The text the expression parser is currently reading, so an argument can be
   * sliced out of it verbatim. Saved and restored around every nested parse,
   * because reading a call's arguments starts a parse inside a parse.
   */
  private source = ''

  /** A chain of statement blocks, or null for an empty suite. */
  statements(nodes: readonly Stmt[]): BlockJson | null {
    const blocks: BlockJson[] = []
    for (const node of nodes) {
      // `pass` exists only to fill an empty suite, and an empty suite in blocks
      // is an empty socket — so carrying it over would add a block that means
      // "nothing" and then generate `pass` a second time.
      if (node.line.text === 'pass') {
        this.report.total += 1
        this.report.recognised += 1
        continue
      }
      // `elif`/`else` are not statements: they belong to the `if` above them and
      // were consumed by it.
      if (/^(elif|else)\b/.test(node.line.text) && blocks.length > 0) continue
      blocks.push(...this.statement(node, nodes))
    }
    if (blocks.length === 0) return null
    for (let i = blocks.length - 1; i > 0; i--) blocks[i - 1].next = { block: blocks[i] }
    return blocks[0]
  }

  /** One statement → one or more blocks (a `from x import a, b` makes two). */
  private statement(node: Stmt, siblings: readonly Stmt[]): BlockJson[] {
    this.report.total += 1
    const text = node.line.text
    const recognised = (blocks: BlockJson[]): BlockJson[] => {
      this.report.recognised += 1
      return blocks
    }

    // --- imports ---------------------------------------------------------
    const importAs = /^import\s+([A-Za-z_][\w.]*)\s+as\s+([A-Za-z_]\w*)$/.exec(text)
    if (importAs) {
      return recognised([
        { type: 'snakie_python_import_as', fields: { MODULE: importAs[1], ALIAS: importAs[2] } }
      ])
    }
    const plain = /^import\s+([A-Za-z_][\w.]*)$/.exec(text)
    if (plain) return recognised([{ type: 'snakie_python_import', fields: { MODULE: plain[1] } }])
    const from = /^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/.exec(text)
    if (from && !from[2].includes('*')) {
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
    if (def) {
      this.definitions.push(this.definition(def[1], def[2], node))
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
      // Blockly models a function's return as the `def`'s own RETURN socket, so
      // a `return` in the middle of a body is the conditional-return block.
      return recognised([
        { type: 'procedures_ifreturn', inputs: { VALUE: { block: this.expression(ret[1]) } } }
      ])
    }
    const change = /^([A-Za-z_]\w*)\s*\+=\s*(.+)$/.exec(text)
    if (change) {
      return recognised([
        {
          type: 'math_change',
          fields: { VAR: { id: this.variable(change[1]) } },
          inputs: { DELTA: { block: this.expression(change[2]) } }
        }
      ])
    }
    const assign = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(text)
    if (assign && !/[=<>!]=/.test(text.slice(0, text.indexOf('=')))) {
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
        i += 1
        continue
      }
      if (next.line.text === 'else:') {
        elseArm = next
        i += 1
      }
      break
    }

    const block: BlockJson = { type: 'controls_if', inputs: {} }
    arms.forEach((arm, n) => {
      const cond = /^(?:if|elif)\s+(.+):$/.exec(arm.line.text)![1]
      block.inputs![`IF${n}`] = { block: this.expression(cond) }
      const body = this.statements(arm.body)
      if (body) block.inputs![`DO${n}`] = { block: body }
      // Each extra arm is a line of its own in the source, and the `if` block
      // is one block — so the count has to be kept honest by hand.
      if (n > 0) this.report.total += 1, this.report.recognised += 1
    })
    if (elseArm) {
      const body = this.statements(elseArm.body)
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
    const args = params
      .split(',')
      .map((p) => p.trim())
      .filter((p) => /^[A-Za-z_]\w*$/.test(p))
    // A trailing `return` becomes the definition's RETURN socket, which is the
    // shape Blockly models a function's result with.
    const last = node.body[node.body.length - 1]
    const returns = last && /^return\s+(.+)$/.exec(last.line.text)
    const body = this.statements(returns ? node.body.slice(0, -1) : node.body)
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
    const body = this.statements(node.body)
    if (body) block.inputs = { ...(block.inputs ?? {}), [input]: { block: body } }
    return block
  }

  /** A raw Python block holding this line, verbatim. The fallback that never fails. */
  private raw(line: LogicalLine, shape: 'statement' | 'value' = 'statement'): BlockJson {
    this.report.raw += 1
    this.report.rawLines.push(line.line)
    return {
      type: shape === 'value' ? 'snakie_python_value' : 'snakie_python_statement',
      fields: { CODE: line.text }
    }
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
    const rule = rules().find(
      (r) => r.fn === call.fn && (r.module ?? '') === (call.module ?? '') && (r.shape ?? 'statement') === 'statement'
    )
    if (!rule) return null
    return this.buildCall(rule, call.args)
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
    }), (t, i) => this.parseAnd(t, i))
  }

  private parseAnd(tokens: readonly Token[], at: number): { block: BlockJson; next: number } | null {
    return this.binary(tokens, at, ['and'], (a, b) => ({
      type: 'logic_operation',
      fields: { OP: 'AND' },
      inputs: { A: { block: a }, B: { block: b } }
    }), (t, i) => this.parseNot(t, i))
  }

  private parseNot(tokens: readonly Token[], at: number): { block: BlockJson; next: number } | null {
    if (tokens[at]?.kind === 'keyword' && tokens[at].text === 'not') {
      const inner = this.parseNot(tokens, at + 1)
      if (!inner) return null
      return {
        block: { type: 'logic_negate', inputs: { BOOL: { block: inner.block } } },
        next: inner.next
      }
    }
    return this.parseComparison(tokens, at)
  }

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
    return this.binary(
      tokens,
      at,
      Object.keys(COMPARE),
      (a, b, op) => ({
        type: 'logic_compare',
        fields: { OP: COMPARE[op] },
        inputs: { A: { block: a }, B: { block: b } }
      }),
      (t, i) => this.parseAdditive(t, i)
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
      (a, b, op) => ({
        type: 'math_arithmetic',
        fields: { OP: op === '+' ? 'ADD' : 'MINUS' },
        inputs: { A: { block: a }, B: { block: b } }
      }),
      (t, i) => this.parseMultiplicative(t, i)
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
      (a, b, op): BlockJson =>
        op === '%'
          ? { type: 'math_modulo', inputs: { DIVIDEND: { block: a }, DIVISOR: { block: b } } }
          : {
              type: 'math_arithmetic',
              fields: { OP: op === '*' ? 'MULTIPLY' : 'DIVIDE' },
              inputs: { A: { block: a }, B: { block: b } }
            },
      (t, i) => this.parsePower(t, i)
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

  /** The shared left-associative loop every level above `power` is. */
  private binary(
    tokens: readonly Token[],
    at: number,
    operators: readonly string[],
    build: (a: BlockJson, b: BlockJson, op: string) => BlockJson,
    next: (tokens: readonly Token[], at: number) => { block: BlockJson; next: number } | null
  ): { block: BlockJson; next: number } | null {
    let left = next(tokens, at)
    if (!left) return null
    for (;;) {
      const tok = tokens[left.next]
      if (!tok || !operators.includes(tok.text)) return left
      if (tok.kind !== 'op' && tok.kind !== 'keyword') return left
      const right = next(tokens, left.next + 1)
      if (!right) return null
      left = { block: build(left.block, right.block, tok.text), next: right.next }
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
      const n = Number(tok.text.replace(/_/g, ''))
      if (!Number.isFinite(n)) return null
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
