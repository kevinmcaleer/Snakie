/**
 * Rule 17 — **Simplify the length test** (epic #634 §3.3).
 *
 * ```python
 * if len(samples) > 0:        if samples:
 *     flush(samples)              flush(samples)
 *
 * while len(queue) == 0:      while not queue:
 *     sleep_ms(10)                sleep_ms(10)
 * ```
 *
 * Every built-in container is already falsy when it is empty, so counting its
 * items to ask "is there anything in here?" says the quiet part twice. The short
 * form is the idiom the MicroPython docs and every library use, it reads as the
 * question actually being asked, and it costs one truth test instead of a global
 * lookup plus a call — which on a Pico's inner loop is measurable.
 *
 * The rewrite fires **only where the value is used as a condition**. `n =
 * len(xs) > 0` stores a bool where `n = xs` stores the list: outside a condition
 * those are different programs, so the rule declines rather than guess which one
 * was meant.
 */
import type { AnyNode, Compare, Expr } from '../ast'
import { unwrap, walk } from '../ast'
import { literalNumber, textOf } from '../expr'
import { bodyOf, isScope, namesWritten } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

// ---------------------------------------------------------------------------
// Condition context — shared with rule 16 (`simplify-comparison`)
// ---------------------------------------------------------------------------

/** Knobs for {@link isConditionContext}; each rule opts in to what it allows. */
export interface ConditionContextOptions {
  /** Count the test of an `assert`. Rule 17 does; rule 16 deliberately doesn't. */
  assert?: boolean
}

/**
 * Is this expression used for its **truthiness** rather than its value?
 *
 * The interesting case is `and`/`or`: those hand the operand's actual value
 * onwards (`xs and go()` evaluates to `xs`, not to `True`), so being an operand
 * of one settles nothing on its own — the question passes up to whatever the
 * whole boolean expression feeds. `not` is the opposite: it always yields a
 * bool, so anything underneath it is a condition wherever the `not` itself ends
 * up. Everything else — a `return`, an assignment, a call argument — keeps the
 * value, and answers no.
 */
export function isConditionContext(expr: Expr, opts: ConditionContextOptions = {}): boolean {
  let cur: AnyNode = expr
  let parent = cur.parent
  while (parent) {
    switch (parent.type) {
      case 'Group':
        // Parentheses don't change what a value is used for.
        if (parent.value !== cur) return false
        break
      case 'UnaryOp':
        // `not x` is a bool no matter where it lands, so stop here and say yes.
        return parent.op === 'not' && parent.operand === cur
      case 'BoolOp':
        // The operand's value flows outwards — keep walking up to find out what
        // happens to it.
        if (!(parent.values as AnyNode[]).includes(cur)) return false
        break
      case 'If':
      case 'While':
      case 'IfExp':
        return parent.test === cur
      case 'Assert':
        return opts.assert === true && parent.test === cur
      case 'Comprehension':
        return (parent.ifs as AnyNode[]).includes(cur)
      default:
        return false
    }
    cur = parent
    parent = cur.parent
  }
  return false
}

/**
 * `not <text>`, parenthesised when the expression it replaces sits directly
 * under another `not` — `not not xs` is legal but nobody reads it twice.
 */
export function negate(text: string, node: AnyNode): string {
  const inner = `not ${text}`
  return node.parent?.type === 'UnaryOp' ? `(${inner})` : inner
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/** Expressions that can be spliced into a condition (or after `not`) as-is. */
const SPLICEABLE = new Set([
  'Name',
  'Attribute',
  'Subscript',
  'Call',
  'Constant',
  'Group',
  'List',
  'Set',
  'Dict',
  'ListComp',
  'SetComp',
  'DictComp'
])

interface TruthinessMatch {
  compare: Compare
  /** The argument of the `len(…)` call, spliced verbatim into the rewrite. */
  arg: Expr
  /** True when the test means "not empty", false when it means "empty". */
  truthy: boolean
}

/** The single argument of a bare `len(x)` call, or null for anything else. */
function lenArgument(expr: Expr): Expr | null {
  const call = unwrap(expr)
  if (call.type !== 'Call') return null
  const func = unwrap(call.func)
  // `bus.len(buf)` is somebody's own method, not the built-in.
  if (func.type !== 'Name' || func.id !== 'len') return null
  if (call.args.length !== 1 || call.keywords.length > 0) return null
  const arg = call.args[0]
  // Keep the argument's own parentheses if it has them: a `Group` splices
  // safely, a bare generator or `*rest` does not.
  if (!SPLICEABLE.has(arg.type)) return null
  return arg
}

/**
 * Does `len(x) <op> <n>` mean "not empty" (true), "empty" (false), or something
 * this rule has no opinion about (null)?
 */
function emptinessTest(op: string, n: number): boolean | null {
  if (n === 0 && (op === '>' || op === '!=')) return true
  if (n === 1 && op === '>=') return true
  if (n === 0 && op === '==') return false
  if (n === 1 && op === '<') return false
  return null
}

/**
 * Has this file rebound the built-in `len`? A `def len(...)`, a `len = …` or a
 * parameter called `len` anywhere makes "an empty container is falsy" an
 * assumption rather than a fact, so we decline for the whole file instead of
 * reasoning about which binding is in scope where.
 */
function lenIsRebound(ctx: RefactorContext): boolean {
  let rebound = false
  walk(ctx.module as AnyNode, (node) => {
    if (isScope(node) && namesWritten(bodyOf(node)).has('len')) rebound = true
    if (node.type === 'FunctionDef' || node.type === 'Lambda') {
      if (node.params.some((p) => p.name === 'len')) rebound = true
    }
  })
  return rebound
}

export const simplifyTruthinessRule = defineRule<TruthinessMatch>({
  id: 'simplify-truthiness',
  title: 'Simplify the length test',
  message: 'An empty container is already falsy — this `len()` call says it twice',
  catalogue: 17,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-simplify-truthiness',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<TruthinessMatch>[] {
    const out: RefactorMatch<TruthinessMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Compare' || node.ops.length !== 1) return
      // `assert len(xs) > 0` reads the truthiness too, so it counts here even
      // though rule 16 leaves asserts alone.
      if (!isConditionContext(node, { assert: true })) return
      const arg = lenArgument(node.left)
      if (!arg) return
      const bound = unwrap(node.comparators[0])
      if (bound.type !== 'Constant' || bound.kind !== 'number') return
      const n = literalNumber(bound)
      if (n == null) return
      const truthy = emptinessTest(node.ops[0], n)
      if (truthy == null) return
      const shown = truthy ? textOf(ctx, arg).trim() : `not ${textOf(ctx, arg).trim()}`
      out.push({
        ruleId: 'simplify-truthiness',
        start: node.start,
        end: node.end,
        message: 'An empty container is already falsy — this test is just `' + shown + '`',
        data: { compare: node, arg, truthy }
      })
    })
    // One scan of the file's bindings, and only when there is something to lose.
    if (out.length > 0 && lenIsRebound(ctx)) return []
    return out
  },

  apply(match: RefactorMatch<TruthinessMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { compare, arg, truthy } = match.data
    const text = textOf(ctx, arg)
    if (!text.trim()) return null
    return [
      {
        start: compare.start,
        end: compare.end,
        newText: truthy ? text : negate(text, compare)
      }
    ]
  }
})
