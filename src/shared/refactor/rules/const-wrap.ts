/**
 * Rule 34 — **Wrap the constant in const()** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                        # after
 * LEFT_MOTOR_PIN = 16             from micropython import const
 * PWM_FREQ = 1000
 *                                 LEFT_MOTOR_PIN = const(16)
 *                                 PWM_FREQ = const(1000)
 * ```
 *
 * Why it matters, and why this rule exists nowhere else: on CPython a module
 * constant is just a global, and a linter has no reason to care. On MicroPython
 * `const()` is understood by the *compiler*. `NAME = const(16)` folds the value
 * into the bytecode at every use site, so the name lookup — a dictionary probe
 * in the module's globals, on every single loop iteration — disappears
 * completely. Name it `_LEADING_UNDERSCORE` and the global entry disappears from
 * RAM too. On a Pico with 264 KB, a control loop that reads eight pin numbers
 * per pass, that is real money in both time and space.
 *
 * The rewrite only fires on a module-level `NAME = <integer literal>` whose name
 * is never bound again anywhere in the file — because a `const` the code later
 * reassigns is the one way this optimisation bites: every *read* was already
 * folded to the old value at compile time, so the reassignment would silently do
 * nothing. Floats are excluded too: `const()` is an integer facility.
 */
import type { AnyNode, Assign, Expr, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { literalNumber, textOf } from '../expr'
import { lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ConstWrapMatch {
  stmt: Assign
  name: string
}

/** A screaming-snake-case name: the universal Python signal for "constant". */
const ALL_CAPS = /^_*[A-Z][A-Z0-9_]*$/

/** An integer literal exactly as MicroPython's compiler will accept it. */
const INT_LITERAL = /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|[0-9][0-9_]*)$/

/**
 * How this file can reach `const`, given the imports it already has.
 * `callee` is the text to call; `addImport` says the rewrite must add one.
 */
interface ConstAccess {
  callee: string
  addImport: boolean
}

/** True when the expression is an integer literal (optionally signed). */
function isIntegerLiteral(expr: Expr): boolean {
  let e = unwrap(expr)
  while (e.type === 'UnaryOp' && (e.op === '-' || e.op === '+')) e = unwrap(e.operand)
  if (e.type !== 'Constant' || e.kind !== 'number') return false
  if (!INT_LITERAL.test(e.raw)) return false
  const value = literalNumber(expr)
  return value != null && Number.isInteger(value)
}

/** Every name bound by a single node — assignment targets, params, imports, … */
function bindingNames(node: AnyNode): string[] {
  const targets = (expr: Expr | undefined): string[] => {
    if (!expr) return []
    const e = unwrap(expr)
    if (e.type === 'Name') return [e.id]
    if (e.type === 'Tuple' || e.type === 'List') return e.elts.flatMap(targets)
    if (e.type === 'Starred') return targets(e.value)
    return []
  }
  switch (node.type) {
    case 'Assign':
      return node.targets.flatMap(targets)
    case 'AugAssign':
    case 'AnnAssign':
      return targets(node.target)
    case 'For':
    case 'Comprehension':
      return targets(node.target)
    case 'WithItem':
      return targets(node.optionalVars)
    case 'Delete':
      return node.targets.flatMap(targets)
    case 'NamedExpr':
      return [node.target.id]
    case 'ExceptHandler':
      return node.name ? [node.name] : []
    case 'ImportAlias':
      return [node.asname ?? node.name.split('.')[0]]
    case 'FunctionDef':
    case 'ClassDef':
      return [node.name]
    case 'Param':
      return [node.name]
    case 'Global':
    case 'Nonlocal':
      // `global NAME` inside a function is a licence to rebind the module
      // global, so it counts as a binding for our purposes.
      return node.names
    default:
      return []
  }
}

/**
 * Is `name` bound anywhere in the tree, ignoring the nodes `skip` accepts?
 * Deliberately looks inside nested functions and classes: a `global NAME`
 * rebind is exactly the case that makes wrapping unsafe.
 */
function bindsAnywhere(root: AnyNode, name: string, skip: (n: AnyNode) => boolean): boolean {
  let found = false
  walk(root, (n) => {
    if (found) return false
    if (skip(n)) return false
    if (bindingNames(n).includes(name)) {
      found = true
      return false
    }
    return undefined
  })
  return found
}

/** Is this statement a module docstring (a bare string expression)? */
function isDocstring(stmt: Stmt): boolean {
  return stmt.type === 'ExprStmt' && stmt.value.type === 'Constant' && stmt.value.kind === 'string'
}

/**
 * Work out how to call `const` in this file — and decline (null) when the name
 * `const` is already bound to something of the file's own, where emitting a
 * bare `const(…)` would call the wrong thing.
 */
function constAccess(ctx: RefactorContext): ConstAccess | null {
  for (const stmt of ctx.module.body) {
    if (stmt.type !== 'ImportFrom' || stmt.module !== 'micropython' || stmt.level !== 0) continue
    // `from micropython import *` brings `const` in with everything else.
    if (stmt.isStar) return { callee: 'const', addImport: false }
    for (const alias of stmt.names) {
      if (alias.name === 'const') return { callee: alias.asname ?? 'const', addImport: false }
    }
  }
  for (const stmt of ctx.module.body) {
    if (stmt.type !== 'Import') continue
    for (const alias of stmt.names) {
      // `import micropython` — use the module attribute rather than adding an
      // import the file never asked for.
      if (alias.name === 'micropython') return { callee: `${alias.asname ?? 'micropython'}.const`, addImport: false }
    }
  }
  // Nothing imported yet, so we would introduce the name `const`. Refuse if the
  // file already means something else by it.
  if (bindsAnywhere(ctx.module as AnyNode, 'const', () => false)) return null
  return { callee: 'const', addImport: true }
}

/** Where a new import line goes, and whether it needs a blank line after it. */
function importAnchor(ctx: RefactorContext): { at: number; spaced: boolean } {
  // Only the import block at the *top* of the file is an anchor. An import
  // further down would put `const` out of reach of a constant defined above it,
  // and every match must agree on one anchor or a batch would add two imports.
  let lastImport = -1
  for (const stmt of ctx.module.body) {
    if (isDocstring(stmt)) continue
    if (stmt.type === 'Import' || stmt.type === 'ImportFrom') {
      lastImport = lineEnd(ctx.src, stmt.end)
      continue
    }
    break
  }
  // Join the existing import block: no blank line, it belongs with its peers.
  if (lastImport >= 0) return { at: lastImport, spaced: false }

  const body = ctx.module.body
  const first = body.length > 0 && isDocstring(body[0]) ? body[1] : body[0]
  if (!first) return { at: ctx.src.length, spaced: false }
  let at = lineStart(ctx.src, first.start)
  // A comment block sitting directly on top of that statement belongs to it, so
  // step over it rather than wedging the import between comment and code.
  while (at > 0) {
    const prev = lineStart(ctx.src, at - 1)
    if (!ctx.src.slice(prev, at).trim().startsWith('#')) break
    at = prev
  }
  return { at, spaced: true }
}

/**
 * An insertion anchored on one real character.
 *
 * A zero-width insert cannot overlap another zero-width insert at the same
 * offset, so a "Tidy this file" batch would happily add the import twice — once
 * per constant it wraps. Widening the edit by the neighbouring character (and
 * putting that character back) makes the engine see the clash, keep the first
 * and re-offer the rest on the next pass, by which time the import is there.
 */
function anchoredInsert(src: string, at: number, text: string): TextEdit {
  if (at > 0) return { start: at - 1, end: at, newText: src[at - 1] + text }
  return { start: 0, end: 1, newText: text + src[0] }
}

export const constWrapRule = defineRule<ConstWrapMatch>({
  id: 'const-wrap',
  title: 'Wrap the constant in const()',
  message: 'This value never changes — `const()` lets the compiler inline it',
  catalogue: 34,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-const-wrap',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ConstWrapMatch>[] {
    const out: RefactorMatch<ConstWrapMatch>[] = []
    // No usable `const`, no offer — we will not shadow whatever the file means
    // by that name.
    if (!constAccess(ctx)) return out

    for (const stmt of ctx.module.body) {
      if (stmt.type !== 'Assign') continue
      // `A = B = 16` and `A, B = 1, 2` bind more than one name; keep it simple.
      if (stmt.targets.length !== 1) continue
      const target = unwrap(stmt.targets[0])
      if (target.type !== 'Name') continue
      if (!ALL_CAPS.test(target.id)) continue
      // Already `const(…)`? That is a Call, not a literal — so this also keeps
      // the rule idempotent on its own output.
      if (!isIntegerLiteral(stmt.value)) continue
      // Bound anywhere else — including a `global NAME` rebind inside a
      // function — and folding the value at compile time would silently
      // ignore the later write.
      if (bindsAnywhere(ctx.module as AnyNode, target.id, (n) => n === (stmt as AnyNode))) continue

      out.push({
        ruleId: 'const-wrap',
        start: stmt.start,
        end: stmt.end,
        message: `\`${target.id}\` never changes — \`const()\` inlines it and saves the lookup`,
        data: { stmt, name: target.id }
      })
    }
    return out
  },

  apply(match: RefactorMatch<ConstWrapMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { stmt } = match.data
    const access = constAccess(ctx)
    if (!access) return null

    const edits: TextEdit[] = [
      {
        start: stmt.value.start,
        end: stmt.value.end,
        // Slice the literal as written, so `0x1F` stays `0x1F`.
        newText: `${access.callee}(${textOf(ctx, stmt.value)})`
      }
    ]

    if (access.addImport) {
      const { at, spaced } = importAnchor(ctx)
      if (at < 0 || at > ctx.src.length || ctx.src.length === 0) return null
      const line = `from micropython import const${ctx.eol}${spaced ? ctx.eol : ''}`
      const insert = anchoredInsert(ctx.src, at, line)
      // Never let the import edit collide with the value edit.
      if (insert.start < stmt.value.end && stmt.value.start < insert.end) return null
      edits.push(insert)
    }
    return edits
  }
})
