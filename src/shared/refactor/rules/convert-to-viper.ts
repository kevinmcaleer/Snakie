/**
 * Rule 44 — **Convert this to `@micropython.viper`** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                          # after
 * def crc8(seed, byte):             @micropython.viper
 *     crc = seed ^ byte             def crc8(seed: int, byte: int) -> int:
 *     for _ in range(8):                crc = seed ^ byte
 *         crc = (crc << 1) & 0xFF       for _ in range(8):
 *     return crc                            crc = (crc << 1) & 0xFF
 *                                       return crc
 * ```
 *
 * Why it matters: `@micropython.native` (rule 43) compiles your function to
 * machine code but keeps every Python semantic, which is typically worth about
 * 2×. The **viper** emitter goes much further. Annotate a value `int` and it
 * stops being a Python object altogether: it lives in a CPU register as a raw
 * machine word, arithmetic on it is one instruction, and nothing is allocated
 * for it on the heap. On integer-heavy code — a CRC, a fixed-point filter, a
 * bit-banged protocol — that is commonly several times faster than bytecode, and
 * it is the fastest thing you can reach without writing assembly.
 *
 * The price is that the inside of the function is no longer really Python. The
 * `int` annotations are **not** type hints in the CPython sense; they change the
 * calling convention. `def crc8(seed: int)` converts whatever the caller passes
 * into a machine word, so handing it a bytearray is a `TypeError` at the call
 * site rather than a warning in your editor. Integers stop being arbitrary
 * precision and start wrapping silently at the machine word (rule 48). Floats,
 * strings, dictionaries and method calls either refuse to compile or fall back
 * to slow object code, which loses you the whole point of the exercise.
 *
 * So this rule is deliberately fussy about what it will offer on. It fires only
 * where it can see the function is integer work end to end: every parameter used
 * only in arithmetic, comparisons or `range()`, no attribute access, no method
 * calls, no strings, no floats, no globals, no `try`/`except`, and a `return`
 * with a value on the way out. Anything less and it says nothing, because a
 * decorator that will not compile — or worse, one that compiles and quietly
 * narrows what your callers are allowed to pass — is far more expensive than a
 * hint you never saw.
 *
 * Then measure. The **Benchmark on device** button beside the diff times the
 * function on the board that is plugged in, before and after, so you keep the
 * change when it is worth 5× and drop it when it is worth 5%.
 *
 * Gated on the firmware actually having the viper emitter compiled in — it is a
 * `SyntaxError` where it is missing — so Snakie asks the board rather than
 * guessing, and offers nothing at all when no board is connected.
 */
import type { AnyNode, Expr, FunctionDef, Stmt } from '../ast'
import { ancestors, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import { indentAt, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ViperMatch {
  fn: FunctionDef
}

/**
 * Decorators that already pick an emitter — never stack a second one. Shared
 * with rules 46, 47 and 48, which are the rest of the §3.7 emitter family.
 */
export const EMITTER_DECORATORS = new Set([
  'micropython.native',
  'micropython.viper',
  'micropython.asm_thumb',
  'micropython.asm_xtensa',
  'micropython.asm_rv32',
  'native',
  'viper'
])

/** The emitter decorator a function already carries, or null. */
export function emitterDecoratorOf(fn: FunctionDef): { node: Expr; name: string } | null {
  for (const d of fn.decorators) {
    const name = dottedName(d.type === 'Call' ? d.func : d)
    if (name != null && EMITTER_DECORATORS.has(name)) return { node: d, name }
  }
  return null
}

/** Does this function carry `@micropython.viper`, under either spelling? */
export function hasViperDecorator(fn: FunctionDef): boolean {
  const dec = emitterDecoratorOf(fn)
  return dec != null && (dec.name === 'micropython.viper' || dec.name === 'viper')
}

/**
 * A loop whose body does arithmetic — the shape any of the emitters can speed
 * up. Nested `def`s and lambdas are their own compilation, so they do not count
 * towards the enclosing function looking hot.
 */
export function hasArithmeticLoop(fn: FunctionDef): boolean {
  let found = false
  walk(fn as AnyNode, (node) => {
    if (node !== fn && (node.type === 'FunctionDef' || node.type === 'Lambda')) return false
    if (node.type !== 'For' && node.type !== 'While') return undefined
    let arithmetic = false
    for (const stmt of node.body as Stmt[]) {
      walk(stmt as AnyNode, (inner) => {
        if (inner.type === 'BinOp' || inner.type === 'AugAssign') arithmetic = true
      })
    }
    if (arithmetic) found = true
    return undefined
  })
  return found
}

/** Is this numeric literal an integer, rather than a float or a complex? */
export function isIntegerLiteral(raw: string): boolean {
  const text = raw.replace(/_/g, '')
  if (/^0[xXbBoO]/.test(text)) return true
  return /^[0-9]+$/.test(text)
}

/**
 * The only calls an all-integer body may make. `range()` drives the loop and
 * `int()` is viper's own conversion; anything else hands back a Python object,
 * which is exactly what viper cannot hold in an `int`.
 */
const INT_SAFE_CALLS = new Set(['range', 'int'])

/** Comparison operators that stay in integer land. */
const INT_SAFE_COMPARISONS = new Set(['==', '!=', '<', '>', '<=', '>='])

/**
 * Node types that put the function outside viper's integer world: a nested
 * scope that may capture anything, a Python object or container, or a statement
 * whose value cannot live in a register.
 */
const VIPER_HOSTILE = new Set([
  'FunctionDef',
  'Lambda',
  'ClassDef',
  'Attribute',
  'Subscript',
  'Slice',
  'Starred',
  'List',
  'Tuple',
  'Set',
  'Dict',
  'ListComp',
  'SetComp',
  'DictComp',
  'GeneratorExp',
  'Yield',
  'Await',
  'Try',
  'With',
  'Raise',
  'Assert',
  'Delete',
  'Global',
  'Nonlocal',
  'Import',
  'ImportFrom',
  'AnnAssign',
  'NamedExpr'
])

/** Is the first statement a plain docstring? MicroPython discards it at compile time. */
function isDocstring(stmt: Stmt): boolean {
  return (
    stmt.type === 'ExprStmt' &&
    stmt.value.type === 'Constant' &&
    stmt.value.kind === 'string' &&
    !(stmt.value.prefix ?? '').includes('f')
  )
}

/** The statements to analyse: the body, minus a leading docstring. */
function analysedBody(fn: FunctionDef): Stmt[] {
  const body = fn.body
  if (body.length > 1 && isDocstring(body[0])) return body.slice(1)
  return body
}

/**
 * Can we see that every value this body touches is an integer?
 *
 * Conservative by construction: the visitor lists what is *allowed* and refuses
 * everything else, so an unfamiliar shape declines instead of guessing. Names
 * must resolve to a parameter or a local, which is what rules out globals,
 * module constants and closures in one go.
 */
function isAllIntegerWork(fn: FunctionDef, params: Set<string>, locals: Set<string>): boolean {
  let ok = true

  const visitor = (node: AnyNode): void | false => {
    if (!ok) return false
    // Anything here means the function is not pure machine-word integer work,
    // so viper either will not compile it or will quietly stop helping:
    //  - a nested scope compiles on its own terms and may capture anything;
    //  - objects and containers are Python values, which viper does not hold;
    //  - the rest are statements viper cannot keep in a register.
    if (VIPER_HOSTILE.has(node.type)) {
      ok = false
      return false
    }

    switch (node.type) {
      case 'Constant':
        if (node.kind !== 'number' || !isIntegerLiteral(node.raw)) ok = false
        return undefined

      case 'Call': {
        const name = dottedName(node.func)
        if (name == null || !INT_SAFE_CALLS.has(name) || node.keywords.length > 0) {
          ok = false
          return false
        }
        return undefined
      }

      case 'BinOp':
        // `/` is true division: two integers in, a float out.
        if (node.op === '/' || node.op === '@') ok = false
        return undefined

      case 'AugAssign':
        if (node.op === '/' || node.op === '@') ok = false
        return undefined

      case 'UnaryOp':
        // `not x` yields a bool object, not a machine word.
        if (node.op === 'not') ok = false
        return undefined

      case 'Compare':
        // `in`, `is` and friends ask an object a question.
        if (node.ops.some((op) => !INT_SAFE_COMPARISONS.has(op))) ok = false
        return undefined

      case 'Name':
        if (!params.has(node.id) && !locals.has(node.id) && !INT_SAFE_CALLS.has(node.id)) ok = false
        return undefined

      default:
        return undefined
    }
  }

  for (const stmt of analysedBody(fn)) walk(stmt as AnyNode, visitor)
  return ok
}

/**
 * Does every path out of this function return a value?
 *
 * `-> int` is only honest when the function cannot fall off the end: a viper
 * function annotated `int` hands back a machine word, so a path that meant to
 * return `None` would silently become `0` to its callers.
 */
function alwaysReturnsAValue(fn: FunctionDef): boolean {
  let allValued = true
  for (const stmt of fn.body) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
        return false
      }
      if (node.type === 'Return' && !node.value) allValued = false
      return undefined
    })
  }
  const last = fn.body[fn.body.length - 1]
  return allValued && last != null && last.type === 'Return' && last.value != null
}

/** Is this annotation exactly `int`? */
function isIntAnnotation(ctx: RefactorContext, expr: Expr | undefined): boolean {
  return expr != null && expr.type === 'Name' && textOf(ctx, expr) === 'int'
}

/** Every name bound inside the body: assignments, `for` targets, walrus, … */
function localNames(fn: FunctionDef): Set<string> {
  const out = new Set<string>()
  const bind = (expr: Expr): void => {
    const e = expr.type === 'Group' ? expr.value : expr
    if (e.type === 'Name') out.add(e.id)
    else if (e.type === 'Tuple' || e.type === 'List') for (const el of e.elts) bind(el)
    else if (e.type === 'Starred') bind(e.value)
  }
  for (const stmt of fn.body) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'Assign') for (const t of node.targets) bind(t)
      if (node.type === 'AugAssign') bind(node.target)
      if (node.type === 'For') bind(node.target)
      return undefined
    })
  }
  return out
}

/**
 * Would converting this function be both possible and worth offering?
 *
 * Also used by `apply` to work out whether *this* match is the first one in the
 * file, so a batch over several hot functions adds `import micropython` once.
 */
function qualifies(ctx: RefactorContext, fn: FunctionDef): boolean {
  if (fn.isAsync) return false
  // An emitter is already chosen; rule 47 deals with a bad choice, not this one.
  if (emitterDecoratorOf(fn) != null) return false
  // Only module-level functions: a method's `self` is an object, and a nested
  // `def` may be sharing a cell with the function it lives in.
  if (ancestors(fn as AnyNode).some((a) => a.type !== 'Module')) return false

  for (const p of fn.params) {
    if (p.kind !== 'normal') return false
    // A default is evaluated as a Python object before viper ever sees it.
    if (p.default != null) return false
    if (p.annotation != null && !isIntAnnotation(ctx, p.annotation)) return false
  }
  if (fn.returns != null && !isIntAnnotation(ctx, fn.returns)) return false

  const params = new Set(fn.params.map((p) => p.name))
  const locals = localNames(fn)
  if (!isAllIntegerWork(fn, params, locals)) return false
  if (!alwaysReturnsAValue(fn)) return false
  if (!hasArithmeticLoop(fn)) return false

  // A parameter we never read is a parameter we cannot claim is an integer, and
  // annotating it would narrow the calling contract on a guess.
  const read = new Set<string>()
  for (const stmt of analysedBody(fn)) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'Name') read.add(node.id)
      return undefined
    })
  }
  return fn.params.every((p) => read.has(p.name))
}

/** Every function in the file this rule would convert, in source order. */
function qualifyingFunctions(ctx: RefactorContext): FunctionDef[] {
  const out: FunctionDef[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type === 'FunctionDef' && qualifies(ctx, node)) out.push(node)
    return undefined
  })
  return out
}

/**
 * Offset of the `)` that closes the parameter list, so `-> int` can be spliced
 * in front of the colon. Returns null if anything unexpected is in the way —
 * a comment inside the signature, an unbalanced bracket — rather than guessing
 * where the annotation belongs.
 */
function closingParen(ctx: RefactorContext, fn: FunctionDef): number | null {
  const limit = fn.body[0] != null ? fn.body[0].start : ctx.src.length
  let i = ctx.src.indexOf('(', fn.nameStart + fn.name.length)
  if (i < 0 || i >= limit) return null
  let depth = 0
  for (; i < limit; i++) {
    const c = ctx.src[i]
    if (c === '#' || c === '"' || c === "'") return null
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return null
}

export const convertToViperRule = defineRule<ViperMatch>({
  id: 'convert-to-viper',
  title: 'Convert this to @micropython.viper',
  message: 'This function is integer work end to end — viper can hold it all in registers',
  catalogue: 44,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-convert-to-viper',
  // Trades Python semantics — and the calling contract — for speed. Never batched.
  safe: false,
  requires: (caps) => caps.viper,

  detect(ctx: RefactorContext): RefactorMatch<ViperMatch>[] {
    const hedge = ctx.capabilities?.inferred === true
    return qualifyingFunctions(ctx).map((fn) => ({
      ruleId: 'convert-to-viper',
      start: fn.defStart,
      end: fn.nameStart + fn.name.length,
      message: hedge
        ? `\`${fn.name}()\` is all integer work — your firmware probably supports @micropython.viper, which would keep it in registers`
        : `\`${fn.name}()\` is all integer work — @micropython.viper would keep it in registers`,
      data: { fn }
    }))
  },

  apply(match: RefactorMatch<ViperMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { fn } = match.data
    const edits: TextEdit[] = []

    // The decorator needs `micropython` in scope. Only the first converted
    // function adds it, so batching several in one go cannot stack duplicate
    // import lines. It goes in front of the decorator edit deliberately: when
    // the `def` starts at offset 0 both edits share an offset, and this order is
    // what puts the import above the decorator rather than between it and its
    // function.
    if (!/^\s*(?:import micropython\b|from micropython import)/m.test(ctx.src)) {
      const isFirst = !qualifyingFunctions(ctx).some((other) => other.defStart < fn.defStart)
      if (isFirst) edits.push({ start: 0, end: 0, newText: `import micropython${ctx.eol}` })
    }

    // Above the `def` but below any decorators it already carries, so an
    // existing @staticmethod keeps its position.
    const anchor = lineStart(ctx.src, fn.defStart)
    const indent = indentAt(ctx.src, fn.defStart)
    edits.push({ start: anchor, end: anchor, newText: `${indent}@micropython.viper${ctx.eol}` })

    // Viper only holds a value in a register once it has been told the value is
    // an integer, so the annotations are the refactoring — the decorator alone
    // would leave every parameter a boxed object.
    for (const p of fn.params) {
      if (p.annotation != null) continue
      edits.push({ start: p.end, end: p.end, newText: ': int' })
    }
    if (fn.returns == null) {
      const close = closingParen(ctx, fn)
      if (close == null) return null
      edits.push({ start: close + 1, end: close + 1, newText: ' -> int' })
    }

    return edits
  }
})
