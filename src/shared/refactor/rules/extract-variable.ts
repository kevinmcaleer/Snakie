/**
 * Rule 9 — **Give the expression a name** (epic #634 §3.2).
 *
 * ```python
 * def blend(base, trim):              def blend(base, trim):
 *     if base + trim * 2 > LIMIT:         value = base + trim * 2
 *         report("clipped")               if value > LIMIT:
 *     return base + trim * 2                  report("clipped")
 *                                         return value
 * ```
 *
 * The same sum written twice is the same *idea* written twice, and the reader has
 * to compare them character by character to be sure they really are the same. A
 * name says it once, and the second reading is free. It is also the first half of
 * every larger refactoring: you cannot extract a function out of an expression
 * you have not named yet.
 *
 * **What this rule will not touch**, because it cannot prove the rewrite is
 * behaviour-preserving:
 *
 * - Anything with a **call or a subscript** in it. `sensor.read()` twice is two
 *   reads of live hardware, and naming it collapses them into one — that is a
 *   real change, and only the author knows whether it is the change they want.
 * - Anything with an **attribute** in it. `self.motor.speed` looks like a plain
 *   read, but it may run a property, and any call sitting between the two
 *   occurrences may rewrite it. Neither is provable from one file, so expressions
 *   here are built from plain names, literals and operators only.
 * - Occurrences that are **evaluated conditionally** — the right-hand side of an
 *   `and`/`or`, either arm of `a if c else b`. `if divisor and total / divisor:`
 *   guards the division on purpose; hoisting it above the guard turns a working
 *   program into a `ZeroDivisionError`.
 * - Occurrences in **different blocks**. The new assignment goes immediately
 *   before the first statement that uses it, in that statement's own block, so a
 *   copy inside a loop and a copy outside it are simply left alone rather than
 *   hoisted past the loop boundary.
 * - Anything whose ingredients are **rewritten in between** — if `speed` is
 *   reassigned between the two copies then they were never the same value, and
 *   naming them would quietly pick one.
 */
import type { AnyNode, Expr, Stmt } from '../ast'
import { walk } from '../ast'
import { isPureExpression, textOf } from '../expr'
import type { Scope } from '../scope'
import { isNameFree, namesRead, namesWritten, scopeOf } from '../scope'
import { indentAt, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ExtractVariableMatch {
  /** Every occurrence to replace, in source order. */
  occurrences: Expr[]
  /** The statement the new assignment goes in front of. */
  before: Stmt
  /** Starting point for the new variable's name. */
  base: string
  /**
   * How many earlier extractions in this scope already want a name from `base`.
   * Every match is measured against the *original* source, so without this two
   * extractions in one function would both pick `value` and the second would
   * quietly rebind the first (§2.6.3 — a batch has to be right as a batch).
   */
  rank: number
}

/** Shortest expression worth naming. Below this the name is longer than the sum. */
const MIN_LENGTH = 8

/** Expression forms that are worth naming in their own right. */
const CANDIDATE_ROOTS = new Set(['BinOp', 'UnaryOp', 'BoolOp', 'Compare', 'IfExp'])

/**
 * What may appear anywhere inside a candidate. Deliberately tiny: names,
 * literals and operators are the only things whose value provably cannot change
 * between two occurrences that nothing in between rewrites.
 */
const ALLOWED_INSIDE = new Set([
  'Name',
  'Constant',
  'BinOp',
  'UnaryOp',
  'BoolOp',
  'Compare',
  'IfExp',
  'Group'
])

/** Nodes that open a scope of their own — a copy in there is a different variable. */
const NESTED_SCOPES = new Set([
  'FunctionDef',
  'Lambda',
  'ClassDef',
  'ListComp',
  'SetComp',
  'GeneratorExp',
  'DictComp'
])

/** One statement of a block, plus the block it belongs to. */
interface Slot {
  /** The node's own array, so two slots can be compared by identity. */
  list: Stmt[]
  stmt: Stmt
  index: number
}

/** Every statement list a node owns, as the node's own arrays. */
function listsOf(node: AnyNode): Stmt[][] {
  switch (node.type) {
    case 'Module':
    case 'FunctionDef':
    case 'ClassDef':
    case 'With':
    case 'ExceptHandler':
      return [node.body]
    case 'For':
    case 'While':
    case 'If':
      return [node.body, node.orelse]
    case 'Try':
      return [node.body, node.orelse, node.finalbody]
    default:
      return []
  }
}

/**
 * The innermost block `node` sits in, and which of that block's statements holds
 * it. Two occurrences share a slot list exactly when they are descendants of
 * statements of the *same* block with no `if`, loop or `try` in between — which
 * is precisely when one assignment placed in that block covers both.
 */
function innermostSlot(node: AnyNode): Slot | null {
  let cur: AnyNode = node
  let parent = node.parent
  while (parent) {
    for (const list of listsOf(parent)) {
      const index = list.indexOf(cur as Stmt)
      if (index >= 0) return { list, stmt: cur as Stmt, index }
    }
    cur = parent
    parent = parent.parent
  }
  return null
}

/** Does the path from `node` up to `stop` pass through a nested scope? */
function crossesNestedScope(node: AnyNode, stop: AnyNode): boolean {
  let cur: AnyNode = node
  while (cur !== stop && cur.parent) {
    cur = cur.parent
    if (cur === stop) return false
    if (NESTED_SCOPES.has(cur.type)) return true
  }
  return false
}

/**
 * Is this occurrence reached only when something else is true? The short-circuit
 * arms of `and`/`or`, both branches of `a if c else b` and an `assert`'s message
 * all run conditionally, so an assignment hoisted above them would evaluate
 * something the original program deliberately skipped.
 */
function conditionallyEvaluated(node: AnyNode, stop: AnyNode): boolean {
  let cur: AnyNode = node
  let parent = cur.parent
  while (parent && cur !== stop) {
    if (parent.type === 'BoolOp' && parent.values[0] !== cur) return true
    if (parent.type === 'IfExp' && parent.test !== cur) return true
    if (parent.type === 'Assert' && parent.msg === cur) return true
    cur = parent
    parent = cur.parent
  }
  return false
}

/** Does the subtree hold an f-string? Its placeholders can hide any call at all. */
function containsFString(expr: Expr): boolean {
  let found = false
  walk(expr as AnyNode, (n) => {
    if (n.type === 'Constant' && (n.prefix ?? '').includes('f')) found = true
    return undefined
  })
  return found
}

/** Is this node an expression this rule is willing to name? */
function isCandidate(ctx: RefactorContext, node: AnyNode): node is Expr {
  if (!CANDIDATE_ROOTS.has(node.type)) return false
  const expr = node as Expr
  let allowed = true
  walk(expr as AnyNode, (n) => {
    if (!ALLOWED_INSIDE.has(n.type)) {
      allowed = false
      return false
    }
    return undefined
  })
  if (!allowed) return false
  // Belt and braces: the whitelist already excludes calls and subscripts, but
  // the engine's contract is that nothing impure is ever duplicated (§2.6.6).
  if (!isPureExpression(expr)) return false
  if (containsFString(expr)) return false
  const text = textOf(ctx, expr)
  if (text.length < MIN_LENGTH) return false
  // A name spliced into a multi-line expression would leave the continuation
  // dangling, and the new assignment would not fit on one line either.
  if (/[\r\n]/.test(text)) return false
  return true
}

/** An honest starting point for the name. A test reads as a condition; the rest is a value. */
function baseNameFor(expr: Expr): string {
  if (expr.type === 'Compare' || expr.type === 'BoolOp') return 'condition'
  if (expr.type === 'UnaryOp' && expr.op === 'not') return 'condition'
  return 'value'
}

/**
 * `base`, `base2`, `base3`, … — the (`rank` + 1)-th of those still free in
 * `scope`. `freshName` always answers with the first, which is the wrong answer
 * when several extractions in one scope are applied together.
 */
function rankedName(scope: Scope, base: string, rank: number): string | null {
  let skipped = 0
  for (let i = 1; i < 200; i++) {
    const candidate = i === 1 ? base : `${base}${i}`
    if (!isNameFree(scope, candidate)) continue
    if (skipped === rank) return candidate
    skipped++
  }
  return null
}

/** Does anything in the file declare one of these names `global`/`nonlocal`? */
function declaredElsewhere(ctx: RefactorContext, names: Set<string>): boolean {
  let found = false
  walk(ctx.module as AnyNode, (n) => {
    if (n.type !== 'Global' && n.type !== 'Nonlocal') return undefined
    if (n.names.some((name) => names.has(name))) found = true
    return undefined
  })
  return found
}

export const extractVariableRule = defineRule<ExtractVariableMatch>({
  id: 'extract-variable',
  title: 'Give the expression a name',
  message: 'This expression is written more than once here — name it and use the name',
  catalogue: 9,
  category: 'extraction',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-extract-variable',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<ExtractVariableMatch>[] {
    // Grouped by the block the occurrence belongs to, then by its exact source
    // text: two copies in different blocks are never one extraction.
    const byBlock = new Map<Stmt[], Map<string, { expr: Expr; slot: Slot }[]>>()

    walk(ctx.module as AnyNode, (node) => {
      if (!isCandidate(ctx, node)) return
      const expr = node as Expr
      // Replacing a copy the author already parenthesised would leave `(value)`.
      if (expr.parent?.type === 'Group') return
      const slot = innermostSlot(expr as AnyNode)
      if (!slot) return
      if (crossesNestedScope(expr as AnyNode, slot.stmt)) return
      if (conditionallyEvaluated(expr as AnyNode, slot.stmt)) return

      let byText = byBlock.get(slot.list)
      if (!byText) {
        byText = new Map()
        byBlock.set(slot.list, byText)
      }
      const key = textOf(ctx, expr)
      const found = byText.get(key)
      if (found) found.push({ expr, slot })
      else byText.set(key, [{ expr, slot }])
    })

    const candidates: RefactorMatch<ExtractVariableMatch>[] = []
    for (const byText of byBlock.values()) {
      for (const hits of byText.values()) {
        if (hits.length < 2) continue
        const sorted = [...hits].sort((a, b) => a.expr.start - b.expr.start)
        const first = sorted[0]
        const list = first.slot.list

        // The span the new binding has to stay true across: every statement of
        // the block from the first occurrence to the last.
        const from = Math.min(...sorted.map((h) => h.slot.index))
        const to = Math.max(...sorted.map((h) => h.slot.index))
        const span = list.slice(from, to + 1)

        // If anything in that span rewrites an ingredient, the two copies were
        // never the same value and naming them would silently pick one.
        const reads = namesRead([first.expr as AnyNode])
        const rewritten = namesWritten(span)
        if ([...reads].some((name) => rewritten.has(name))) continue
        // A `global speed` anywhere means a call in the span could rewrite it
        // without the span ever naming it.
        if (declaredElsewhere(ctx, reads)) continue

        // The new line goes above this statement, so the statement has to start
        // its own line for there to be a line to go above.
        const before = list[from]
        if (ctx.src.slice(lineStart(ctx.src, before.start), before.start).trim() !== '') continue

        candidates.push({
          ruleId: 'extract-variable',
          start: first.expr.start,
          end: first.expr.end,
          message: `\`${textOf(ctx, first.expr)}\` is written ${sorted.length} times here — name it once`,
          data: {
            occurrences: sorted.map((h) => h.expr),
            before,
            base: baseNameFor(first.expr),
            rank: 0
          }
        })
      }
    }

    // Longest first, then drop anything nested inside something already taken:
    // naming `a * b + c` makes the `a * b` inside it a one-off.
    candidates.sort(
      (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start
    )
    const claimed: { start: number; end: number }[] = []
    const out: RefactorMatch<ExtractVariableMatch>[] = []
    for (const match of candidates) {
      const spans = match.data.occurrences
      if (spans.some((s) => claimed.some((c) => s.start < c.end && c.start < s.end))) continue
      for (const s of spans) claimed.push({ start: s.start, end: s.end })
      out.push(match)
    }
    out.sort((a, b) => a.start - b.start)

    // Hand out the names in source order, so a batch of extractions in one
    // function reads `value`, `value2`, … instead of rebinding one name.
    const taken = new Map<string, number>()
    for (const match of out) {
      const scope = scopeOf(match.data.before as AnyNode)
      const key = `${scope.start}\x00${match.data.base}`
      const rank = taken.get(key) ?? 0
      match.data.rank = rank
      taken.set(key, rank + 1)
    }
    return out
  },

  apply(match: RefactorMatch<ExtractVariableMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { occurrences, before, base, rank } = match.data
    if (occurrences.length < 2) return null

    const name = rankedName(scopeOf(before as AnyNode), base, rank)
    if (!name) return null
    const text = textOf(ctx, occurrences[0])
    const at = lineStart(ctx.src, before.start)
    const indent = indentAt(ctx.src, before.start)

    const edits: TextEdit[] = [
      { start: at, end: at, newText: `${indent}${name} = ${text}${ctx.eol}` }
    ]
    for (const occurrence of occurrences) {
      edits.push({ start: occurrence.start, end: occurrence.end, newText: name })
    }
    return edits
  }
})
