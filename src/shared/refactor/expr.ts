/**
 * Expression helpers shared across the rule catalogue (epic #634).
 *
 * Two things nearly every rule needs: the exact source text of a node (because
 * rewrites splice source, never unparse a tree), and a *correct* inversion of a
 * condition. Inversion is where a refactoring tool quietly breaks someone's
 * robot, so the rules here are deliberately narrow and everything else falls
 * back to wrapping in `not (…)`, which is always right.
 */
import type { Expr, AnyNode } from './ast'
import { unwrap, walk } from './ast'
import type { RefactorContext } from './types'

/** The exact source text of a node. */
export function textOf(ctx: RefactorContext, node: { start: number; end: number }): string {
  return ctx.src.slice(node.start, node.end)
}

/** Comparison operators and their true negation (single comparisons only). */
const NEGATED_COMPARE: Record<string, string> = {
  '==': '!=',
  '!=': '==',
  '<': '>=',
  '>': '<=',
  '<=': '>',
  '>=': '<',
  in: 'not in',
  'not in': 'in',
  is: 'is not',
  'is not': 'is'
}

/**
 * Source text for the logical negation of `expr`.
 *
 * Handles the cases a human would write by hand — `not x` → `x`, `a == b` →
 * `a != b`, `a is None` → `a is not None` — and falls back to `not (…)` for
 * everything else.
 *
 * Deliberately NOT handled: chained comparisons (`a < b < c`), whose negation
 * is emphatically not `a >= b >= c`. Those take the parenthesised fallback.
 */
export function invertCondition(ctx: RefactorContext, expr: Expr): string {
  const e = unwrap(expr)

  if (e.type === 'UnaryOp' && e.op === 'not') {
    // `not (a and b)` → `(a and b)`: keep the parens the user wrote, but drop
    // ours if the operand is already an atom.
    const inner = e.operand
    const text = textOf(ctx, inner)
    return inner.type === 'Group' ? text.slice(1, -1).trim() : text
  }

  if (e.type === 'Compare' && e.ops.length === 1) {
    const negated = NEGATED_COMPARE[e.ops[0]]
    if (negated) {
      const left = textOf(ctx, e.left)
      const right = textOf(ctx, e.comparators[0])
      return `${left} ${negated} ${right}`
    }
  }

  if (e.type === 'Constant' && e.kind === 'bool') {
    return e.raw === 'True' ? 'False' : 'True'
  }

  // De Morgan, but only when every operand inverts cleanly on its own — a
  // half-inverted `not a or not (f(x) and g())` is harder to read than the
  // parenthesised form it replaces.
  if (e.type === 'BoolOp' && e.values.every(invertsCleanly)) {
    const joiner = e.op === 'and' ? ' or ' : ' and '
    return e.values.map((v) => invertCondition(ctx, v)).join(joiner)
  }

  return `not ${wrapForNot(ctx, e)}`
}

/** Would {@link invertCondition} produce something better than `not (…)`? */
function invertsCleanly(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type === 'UnaryOp' && e.op === 'not') return true
  if (e.type === 'Compare' && e.ops.length === 1) return NEGATED_COMPARE[e.ops[0]] != null
  if (e.type === 'Constant' && e.kind === 'bool') return true
  return false
}

/** Parenthesise an operand of `not` when its precedence is looser than `not`. */
function wrapForNot(ctx: RefactorContext, e: Expr): string {
  const text = textOf(ctx, e)
  switch (e.type) {
    case 'Name':
    case 'Constant':
    case 'Call':
    case 'Attribute':
    case 'Subscript':
    case 'List':
    case 'Dict':
    case 'Set':
    case 'Group':
      return text
    default:
      return `(${text})`
  }
}

/**
 * True when evaluating `expr` cannot have side effects and is cheap enough to
 * duplicate — names, literals, attribute reads and simple arithmetic over them.
 * A call or subscript may cost real time on a microcontroller (or touch
 * hardware), so those are never duplicated.
 */
export function isPureExpression(expr: Expr): boolean {
  let pure = true
  walk(expr as AnyNode, (n) => {
    switch (n.type) {
      case 'Call':
      case 'Await':
      case 'Yield':
      case 'NamedExpr':
      case 'Subscript':
      case 'ListComp':
      case 'SetComp':
      case 'DictComp':
      case 'GeneratorExp':
        pure = false
        return false
      default:
        return undefined
    }
  })
  return pure
}

/** True when two nodes have identical source text, ignoring surrounding space. */
export function sameText(ctx: RefactorContext, a: Expr, b: Expr): boolean {
  return textOf(ctx, a).trim() === textOf(ctx, b).trim()
}

/** The dotted name of a call target: `machine.Pin` → `machine.Pin`, or null. */
export function dottedName(expr: Expr): string | null {
  const e = unwrap(expr)
  if (e.type === 'Name') return e.id
  if (e.type === 'Attribute') {
    const base = dottedName(e.value)
    return base ? `${base}.${e.attr}` : null
  }
  return null
}

/** The last segment of a dotted call target: `time.sleep` → `sleep`. */
export function callName(expr: Expr): string | null {
  const name = dottedName(expr)
  return name ? name.split('.').pop()! : null
}

/**
 * Does this call match `module.func` or a bare `func`? Handles both import
 * styles beginners mix freely (`import time` vs `from time import sleep`).
 */
export function isCallTo(expr: Expr, moduleNames: readonly string[], func: string): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Call') return false
  const dotted = dottedName(e.func)
  if (!dotted) return false
  if (dotted === func) return true
  const parts = dotted.split('.')
  if (parts.length !== 2) return false
  return parts[1] === func && moduleNames.includes(parts[0])
}

/** Numeric value of a literal (including a negated one), or null. */
export function literalNumber(expr: Expr): number | null {
  const e = unwrap(expr)
  if (e.type === 'UnaryOp' && e.op === '-') {
    const inner = literalNumber(e.operand)
    return inner == null ? null : -inner
  }
  if (e.type === 'UnaryOp' && e.op === '+') return literalNumber(e.operand)
  if (e.type !== 'Constant' || e.kind !== 'number') return null
  const raw = e.raw.replace(/_/g, '')
  if (/[jJ]$/.test(raw)) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Does the expression need parentheses to be used as an operand of `and`/`or`?
 * (`a if b else c`, a lambda and a bare tuple all do.)
 */
export function needsParensInBoolOp(expr: Expr): boolean {
  const e = unwrap(expr)
  return e.type === 'IfExp' || e.type === 'Lambda' || (e.type === 'Tuple' && !e.parenthesized)
}
