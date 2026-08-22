/**
 * Rule 13 — **Replace the chain with a lookup table** (epic #634 §3.3).
 *
 * ```python
 * # before                          # after
 * def duty_for(mode):               _MODE_TABLE = {
 *     if mode == "crawl":               "crawl": 12000,
 *         return 12000                  "cruise": 32000,
 *     elif mode == "cruise":            "sprint": 58000,
 *         return 32000              }
 *     elif mode == "sprint":
 *         return 58000              def duty_for(mode):
 *     else:                             return _MODE_TABLE.get(mode, 0)
 *         return 0
 * ```
 *
 * Why it matters: a chain that compares *one* expression against a run of
 * literals is not really control flow at all — it is a table someone wrote out
 * as code. Reading it, you have to check every branch to be sure they all test
 * the same thing; adding a mode means adding two more lines in the middle of a
 * function; and on the way past, MicroPython evaluates the comparison once per
 * branch until one hits. A dict says the same thing as data: the mapping is
 * visible at a glance, a new entry is one line, and the lookup is a single hash
 * whatever the table's size.
 *
 * **This one is `safe: false`, and the reason is the whole rule.** A dict literal
 * evaluates *every* value the moment it is built; the chain evaluated exactly
 * one. Turn `elif mode == "sprint": return spin_up()` into a table and the motor
 * spins up at import time, for every mode. So each mapped value — and the
 * default — has to be provably pure before we will offer anything, and even then
 * a human should look at the cost of building the table once at import.
 *
 * The other things we decline rather than guess at:
 *
 * - **fewer than three branches** — two cases are an `if`/`else`, and a table
 *   costs more than it saves;
 * - **an assignment chain with no `else`** — the chain leaves the target at
 *   whatever it already held; `TABLE.get(key)` would overwrite it with `None`;
 * - **a `return` chain with no `else` that is not the last statement of its
 *   function** — falling off the end of the chain runs the code below it, where
 *   `return TABLE.get(key)` would skip it. When the chain *is* last, falling off
 *   the end returned `None` anyway, so the rewrite is exact — the message still
 *   says so out loud, because a missing key is now `None` rather than a
 *   fall-through, and that is worth seeing;
 * - **keys that are not distinct literals** — `1` and `1.0` are one dict key
 *   even though they are two different branches;
 * - **anything with a comment in it** — the chain's lines are replaced wholesale,
 *   and a rewrite must never eat someone's note.
 */
import type { AnyNode, Assign, Expr, FunctionDef, IfStmt, Module, Stmt } from '../ast'
import { enclosingFunction, unwrap, walk } from '../ast'
import { dottedName, isPureExpression, literalNumber, textOf } from '../expr'
import { freshName, localBindings, namesRead } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** One `key: value` row of the table we would build. */
interface Entry {
  keyText: string
  valueText: string
}

/** Everything `apply` needs, all of it derived from the original source text. */
interface Dispatch {
  /** `return` chains map to a returned value, `assign` chains to a target. */
  shape: 'return' | 'assign'
  /** The assignment target's source text; '' for a `return` chain. */
  targetText: string
  /** The expression every branch compares against, e.g. `mode`. */
  subjectText: string
  /** The identifier the table's name is derived from, e.g. `mode`. */
  subjectWord: string
  entries: Entry[]
  /** The `else` branch's value, or null when the chain has no `else`. */
  defaultText: string | null
  /** Whole-line range the chain occupies. */
  replaceStart: number
  replaceEnd: number
  /** Where the table goes — the start of the top-level statement's line. */
  anchor: number
  /** True when that statement is a `def`/`class`, which wants two blank lines. */
  anchorIsDefinition: boolean
}

interface DispatchMatch {
  head: IfStmt
  /** Chosen in `detect`, so a batch of several chains cannot pick one name twice. */
  name: string
}

/** Longest replacement line we will fold a whole chain into. */
const MAX_LINE = 100

/** A screaming-snake-case name: the universal Python signal for "constant". */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Every identifier the file mentions anywhere, nested scopes included.
 *
 * `freshName` deliberately reports a name as free when the only thing using it
 * is a local inside a nested `def` — for its own purposes that is right, but a
 * module-level table has to dodge those too, or a function with a local of the
 * same name would shadow the table it is trying to read.
 */
function allNames(module: Module): Set<string> {
  const out = new Set<string>()
  walk(module as AnyNode, (n) => {
    switch (n.type) {
      case 'Name':
        out.add(n.id)
        break
      case 'FunctionDef':
      case 'ClassDef':
        out.add(n.name)
        break
      case 'Param':
        out.add(n.name)
        break
      case 'ImportAlias':
        out.add(n.asname ?? n.name.split('.')[0])
        break
      case 'ExceptHandler':
        if (n.name) out.add(n.name)
        break
      case 'Global':
      case 'Nonlocal':
        for (const x of n.names) out.add(x)
        break
      default:
        break
    }
  })
  return out
}

/**
 * A module-level name nothing else in the file uses — and that no *other* match
 * in this same detect run has already claimed, which is what stops two chains
 * over the same variable both calling their table `_MODE_TABLE`.
 */
function pickName(ctx: RefactorContext, used: Set<string>, base: string): string | null {
  for (let i = 0; i < 100; i++) {
    const candidate = freshName(ctx.module, i === 0 ? base : `${base}_${i + 1}`)
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  return null
}

/**
 * A dict key's identity — what Python will actually hash — or null when the
 * literal is not one we can compare confidently.
 *
 * Source text is not enough: `1` and `1.0` are two branches but one key, and
 * `'go'` and `"go"` likewise. Numbers compare by value; strings only when they
 * are a plain, single-quoted, escape-free literal, so the text between the
 * quotes *is* the string.
 */
function keyIdentity(expr: Expr): string | null {
  const e = unwrap(expr)
  if (e.type !== 'Constant') return null
  if (e.kind === 'number') {
    const value = literalNumber(e)
    return value == null ? null : `n:${value}`
  }
  if (e.kind !== 'string') return null
  if (e.prefix) return null
  const raw = e.raw
  const quote = raw[0]
  if (quote !== '"' && quote !== "'") return null
  // `''` is the empty key; `'''…'''` is a triple-quoted one. Both start `qq`.
  if (raw.length < 3 || raw[1] === quote || raw[raw.length - 1] !== quote) return null
  const body = raw.slice(1, -1)
  // A backslash means escapes we would have to interpret; a stray quote means
  // this is two adjacent literals the parser joined into one constant.
  if (body.includes(quote) || body.includes('\\') || /[\r\n]/.test(body)) return null
  return `s:${body}`
}

/** Can this expression be dropped into a dict literal or an argument list as-is? */
function usableAsValue(ctx: RefactorContext, expr: Expr): boolean {
  const e = unwrap(expr)
  // A bare tuple would arrive as extra dict entries or extra arguments.
  if (e.type === 'Tuple' && !e.parenthesized) return false
  if (e.type === 'Starred') return false
  return !/[\r\n]/.test(textOf(ctx, expr))
}

/** The single statement a branch body holds, or null. */
function loneStatement(body: readonly Stmt[]): Stmt | null {
  return body.length === 1 ? body[0] : null
}

/** The top-level statement of the module that contains `node`. */
function topLevelOwner(ctx: RefactorContext, node: AnyNode): Stmt | null {
  for (const stmt of ctx.module.body) {
    if (stmt.start <= node.start && node.end <= stmt.end) return stmt
  }
  return null
}

/**
 * Names a module-level table sitting at `anchor` could actually read: the ones
 * bound by top-level statements above it.
 *
 * This is the check that stops the rewrite hoisting a closure out of its scope.
 * `return scale * 2` is perfectly pure, but `scale` is the enclosing function's
 * parameter — evaluate it at module level and the file raises `NameError` on
 * import. A name defined *below* the table is no better: the dict is built where
 * it is written, not where it is used.
 */
function namesVisibleAt(ctx: RefactorContext, anchor: number): Set<string> {
  return localBindings(ctx.module.body.filter((s) => s.end <= anchor))
}

/**
 * Prove the whole rewrite, or return null. Shared by `detect` and `apply`, so
 * the Problems panel never shows a hint with no fix behind it.
 */
function analyse(ctx: RefactorContext, head: IfStmt): Dispatch | null {
  // Only the head of a chain: an `elif` in the middle is a slice of one.
  if (head.isElif) return null

  // Walk the chain, collecting the branches and whatever `else` ends it.
  const branches: IfStmt[] = [head]
  let cur = head
  for (;;) {
    const next = cur.orelse.length === 1 ? cur.orelse[0] : null
    if (!next || next.type !== 'If' || !next.isElif) break
    cur = next
    branches.push(cur)
  }
  // Whatever the chain ends with: nothing, or a real `else` block.
  const elseBody = cur.orelse
  // Two cases are an `if`/`else`; a table only starts paying at three.
  if (branches.length < 3) return null

  // Every test must be `<the same expression> == <a literal>`.
  let subjectText = ''
  let subjectWord = ''
  const keys: Expr[] = []
  const identities = new Set<string>()
  for (const branch of branches) {
    const test = unwrap(branch.test)
    if (test.type !== 'Compare' || test.ops.length !== 1 || test.ops[0] !== '==') return null
    const subject = test.left
    const key = test.comparators[0]
    const identity = keyIdentity(key)
    // Distinct keys: two branches that hash the same would silently lose one.
    if (identity == null || identities.has(identity)) return null
    identities.add(identity)
    if (!usableAsValue(ctx, key)) return null

    const text = textOf(ctx, subject).trim()
    if (subjectText === '') {
      // The subject is written once in the rewrite but read up to N times in the
      // chain, so it has to be pure — and a dotted name, which is both provably
      // cheap and the only thing we can name the table after.
      if (!isPureExpression(subject)) return null
      const dotted = dottedName(subject)
      if (!dotted) return null
      const word = dotted.split('.').pop() ?? ''
      if (!IDENTIFIER.test(word)) return null
      subjectText = text
      subjectWord = word.replace(/^_+/, '').toUpperCase()
      if (subjectWord === '') return null
    } else if (text !== subjectText) {
      return null
    }
    keys.push(key)
  }

  // Every branch body must be one statement, and all of them the same shape.
  const bodies = branches.map((b) => loneStatement(b.body))
  if (bodies.some((s) => s == null)) return null
  const statements = bodies as Stmt[]
  const elseStmt = elseBody.length > 0 ? loneStatement(elseBody) : null
  if (elseBody.length > 0 && !elseStmt) return null

  let shape: 'return' | 'assign'
  let targetText = ''
  if (statements.every((s) => s.type === 'Return' && s.value != null)) {
    shape = 'return'
  } else if (statements.every((s) => s.type === 'Assign' && s.targets.length === 1)) {
    shape = 'assign'
    const first = statements[0] as Assign
    const target = unwrap(first.targets[0])
    // A `Name` or an attribute: written once in the rewrite, exactly as the
    // chain wrote it. A subscript target would hide a lookup we cannot vouch for.
    if (target.type !== 'Name' && target.type !== 'Attribute') return null
    targetText = textOf(ctx, first.targets[0]).trim()
    if (/[\r\n]/.test(targetText)) return null
    for (const s of statements) {
      if (textOf(ctx, (s as Assign).targets[0]).trim() !== targetText) return null
    }
  } else {
    return null
  }

  /** The value a branch statement contributes, once proved usable. */
  const valueOf = (stmt: Stmt): Expr | null => {
    let value: Expr | undefined
    if (shape === 'return' && stmt.type === 'Return') value = stmt.value
    else if (shape === 'assign' && stmt.type === 'Assign' && stmt.targets.length === 1) {
      if (textOf(ctx, stmt.targets[0]).trim() !== targetText) return null
      value = stmt.value
    }
    if (!value) return null
    // THE check: a dict builds every value eagerly, where the chain built one.
    if (!isPureExpression(value)) return null
    if (!usableAsValue(ctx, value)) return null
    return value
  }

  /** Every expression that moves out of the function and into the table. */
  const moved: Expr[] = []
  const entries: Entry[] = []
  for (let i = 0; i < statements.length; i++) {
    const value = valueOf(statements[i])
    if (!value) return null
    moved.push(value)
    entries.push({ keyText: textOf(ctx, keys[i]).trim(), valueText: textOf(ctx, value).trim() })
  }

  let defaultText: string | null = null
  if (elseStmt) {
    const value = valueOf(elseStmt)
    if (!value) return null
    // The default stays where it is, as `.get`'s second argument, so unlike the
    // table's values it may go on reading the function's own locals.
    defaultText = textOf(ctx, value).trim()
  } else if (shape === 'assign') {
    // No `else`: the chain leaves the target alone, `.get` would set it to None.
    return null
  } else {
    // No `else`, and a `return` chain: only exact when falling off the end of
    // the chain fell off the end of the function too.
    const fn: FunctionDef | null = (() => {
      const enclosing = enclosingFunction(head)
      return enclosing && enclosing.type === 'FunctionDef' ? enclosing : null
    })()
    if (!fn || fn.body[fn.body.length - 1] !== head) return null
  }

  // The chain must own its lines outright: we replace them wholesale.
  const indent = indentAt(ctx.src, head.start)
  const replaceStart = lineStart(ctx.src, head.start)
  if (replaceStart + indent.length !== head.start) return null
  const replaceEnd = lineEnd(ctx.src, head.end)
  if (!/^[ \t]*\r?\n?$/.test(ctx.src.slice(head.end, replaceEnd))) return null
  // A comment anywhere in those lines would go with them.
  if (ctx.comments.some((c) => c.start >= replaceStart && c.start < replaceEnd)) return null

  const owner = topLevelOwner(ctx, head)
  if (!owner) return null
  let anchor = lineStart(ctx.src, owner.start)
  // A comment block sitting on top of that statement introduces it, so put the
  // table above the comment rather than between the comment and its code.
  while (anchor > 0) {
    const prev = lineStart(ctx.src, anchor - 1)
    if (!ctx.src.slice(prev, anchor).trim().startsWith('#')) break
    anchor = prev
  }
  if (anchor > replaceStart) return null

  // The table's values leave the function behind, so every name they read has to
  // be one the module has already bound by the time the table is built.
  const visible = namesVisibleAt(ctx, anchor)
  for (const name of namesRead(moved as AnyNode[])) {
    if (!visible.has(name)) return null
  }

  return {
    shape,
    targetText,
    subjectText,
    subjectWord,
    entries,
    defaultText,
    replaceStart,
    replaceEnd,
    anchor,
    anchorIsDefinition: owner.type === 'FunctionDef' || owner.type === 'ClassDef'
  }
}

/** The one line that replaces the chain. */
function replacementLine(ctx: RefactorContext, plan: Dispatch, name: string): string {
  const indent = indentAt(ctx.src, plan.replaceStart)
  const args = plan.defaultText == null ? plan.subjectText : `${plan.subjectText}, ${plan.defaultText}`
  const lookup = `${name}.get(${args})`
  const head = plan.shape === 'return' ? 'return ' : `${plan.targetText} = `
  return `${indent}${head}${lookup}`
}

export const dictDispatchRule = defineRule<DispatchMatch>({
  id: 'dict-dispatch',
  title: 'Replace the chain with a lookup table',
  message: 'This chain compares one value against literals — that is a dict, written out longhand',
  catalogue: 13,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-dict-dispatch',
  // The table is built eagerly, at import time, and a missing key now answers
  // `None` instead of falling through. Both deserve a human look, so "Tidy this
  // file" never batches this one.
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<DispatchMatch>[] {
    const out: RefactorMatch<DispatchMatch>[] = []
    const used = allNames(ctx.module)
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      const plan = analyse(ctx, node)
      if (!plan) return
      const name = pickName(ctx, used, `_${plan.subjectWord}_TABLE`)
      if (!name) return
      // A table that is worse to read than the chain is not a tidy-up.
      if (replacementLine(ctx, plan, name).length > MAX_LINE) return
      const missing =
        plan.defaultText == null
          ? ' — note that a key the table does not hold now answers `None` instead of falling through'
          : ''
      out.push({
        ruleId: 'dict-dispatch',
        start: node.start,
        end: node.end,
        message: `\`${plan.subjectText}\` picks one of ${plan.entries.length} values — a dict says that in one lookup${missing}`,
        data: { head: node, name }
      })
    })
    return out
  },

  apply(match: RefactorMatch<DispatchMatch>, ctx: RefactorContext): TextEdit[] | null {
    const plan = analyse(ctx, match.data.head)
    if (!plan) return null
    const { name } = match.data
    const unit = ctx.indentUnit
    const eol = ctx.eol

    const rows = plan.entries.map((e) => `${unit}${e.keyText}: ${e.valueText},`)
    // A blank line under the table, two when the next thing is a `def`/`class`.
    const gap = plan.anchorIsDefinition ? eol + eol : eol
    const table = [`${name} = {`, ...rows, '}'].join(eol) + eol + gap

    const line = replacementLine(ctx, plan, name)
    if (/[\r\n]/.test(line)) return null
    const endsWithNewline = plan.replaceEnd > 0 && ctx.src[plan.replaceEnd - 1] === '\n'

    return [
      { start: plan.anchor, end: plan.anchor, newText: table },
      {
        start: plan.replaceStart,
        end: plan.replaceEnd,
        newText: line + (endsWithNewline ? eol : '')
      }
    ]
  }
})
