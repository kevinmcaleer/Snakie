/**
 * Rule 88 — **Use integer division** (epic #634 §3.8, MicroPython).
 *
 * ```python
 * # before                                 # after
 * revs = int(distance_mm / CIRCUM_MM)      revs = distance_mm // CIRCUM_MM
 * middle = int((left + right) / 2)         middle = (left + right) // 2
 * cell = histogram[int(reading / band)]    cell = histogram[reading // band]
 * ```
 *
 * Why it matters: in Python 3 a single `/` *always* yields a float, even when
 * both operands are whole numbers. Most MicroPython targets — the RP2040
 * certainly — have no floating-point unit, so that one slash costs a soft-float
 * library call plus a freshly allocated float object on a heap that has nothing
 * to spare, and then `int()` throws the fraction away again. `//` never leaves
 * integer arithmetic: no allocation, no soft-float routine, and it states the
 * intent instead of hiding it behind a conversion.
 *
 * **The caveat, and it is a real one.** These are not the same function.
 * `int()` truncates *towards zero*; `//` *floors*. They agree on every
 * non-negative value and disagree the moment a negative one turns up:
 * `int(-7 / 2)` is `-3`, but `-7 // 2` is `-4`. For encoder counts, buffer
 * indices and byte offsets that never happens; for a signed motor error or a
 * sub-zero temperature it certainly can.
 *
 * Rather than guess which kind of number flows through a given expression — a
 * guess we could only ever get half right — the rule offers the rewrite every
 * time and says so plainly. That is why it is `safe: false`: it stays out of
 * "Tidy this file" (R7), and the negative-number warning is repeated in the
 * preview message so nobody accepts it unread.
 *
 * **What it will not do is offer the rewrite on a float it can see.** `int()`
 * always hands back an `int`; `//` only does when *both* operands are integers.
 * `int(7.5 / 2)` is `3`, but `7.5 // 2` is `3.0` — a float, which then blows up
 * as `xs[i]`, `range(n)` or `bytes(n)` with a TypeError, and goes on paying the
 * soft-float tax this rule exists to avoid. So whenever the file itself says an
 * operand is a float — a `1.5` literal, a `float()` call, a name assigned one of
 * those — the match is not offered at all. Names whose type the file cannot
 * settle still are; that is what the preview message is for.
 *
 * The rewrite itself is exact. `//` sits at the same precedence and
 * associativity as `/`, so both operands can be spliced across verbatim, and the
 * only judgement is whether the *surrounding* expression needs the result
 * wrapped — `-int(x / 2)` must become `-(x // 2)`, never `-x // 2`.
 */
import type { AnyNode, BinOp, Call, Expr } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import { isScope, localBindings } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface IntegerDivisionMatch {
  call: Call
  /** The `/` division inside the `int(…)`. */
  division: BinOp
}

/** Operators that bind as tightly as `//` does. */
const MULTIPLICATIVE = new Set(['*', '/', '//', '%', '@'])

/**
 * Would `a // b` be re-associated by whatever encloses the call it replaces?
 *
 * `//` binds looser than a power, a unary sign, an attribute lookup, a
 * subscript or a call, and it is left-associative, so appearing on the *right*
 * of another multiplicative operator changes the grouping too. Everything else
 * — `+`, comparisons, `and`/`or`, an argument, a list element, a statement —
 * already binds looser and needs nothing.
 */
function needsParens(call: Call): boolean {
  const parent = call.parent
  if (!parent) return false
  switch (parent.type) {
    case 'BinOp':
      // `int(a / b) ** 2` would become `a // b ** 2`.
      if (parent.op === '**') return true
      // `c / int(a / b)` would become `c / a // b`, i.e. `(c / a) // b`.
      return MULTIPLICATIVE.has(parent.op) && parent.right === call
    case 'UnaryOp':
      // `-int(x / 2)` → `-x // 2` is `(-x) // 2`, a different answer. `not` is
      // looser than `//`, so it is the one unary operator that is safe.
      return parent.op !== 'not'
    case 'Attribute':
      return true
    case 'Subscript':
      return parent.value === call
    case 'Call':
      return parent.func === call
    case 'Await':
    case 'Starred':
      return true
    default:
      return false
  }
}

/** The `int(<a> / <b>)` this call is, or null. */
function divisionArg(call: Call): BinOp | null {
  if (dottedName(call.func) !== 'int') return null
  // `int(x, 16)` is a base conversion, and `int(*parts)` hides how many
  // arguments there really are.
  if (call.args.length !== 1 || call.keywords.length > 0) return null
  const only: Expr = call.args[0]
  if (only.type === 'Starred') return null
  const inner = unwrap(only)
  return inner.type === 'BinOp' && inner.op === '/' ? inner : null
}

/**
 * Is this literal written as a float? `0.5` and `1e3` are; `2`, `0x20` and
 * `0b1101` are not (their `e`/`b` are digits, not an exponent).
 */
function isFloatLiteral(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Constant' || e.kind !== 'number') return false
  const raw = e.raw.replace(/_/g, '')
  if (/^0[xXoObB]/.test(raw)) return false
  if (/[jJ]$/.test(raw)) return false
  return raw.includes('.') || /[eE]/.test(raw)
}

/**
 * Names the file binds to a float literal — `STEP_MM = 0.5`, `VREF = 3.3`.
 * Collected across the whole file rather than per scope: a constant at the top
 * and a local of the same name are both reasons to keep quiet.
 */
function floatLiteralNames(ctx: RefactorContext): Set<string> {
  const out = new Set<string>()
  walk(ctx.module as AnyNode, (node) => {
    if (node.type === 'Assign') {
      if (!isFloatLiteral(node.value)) return undefined
      for (const t of node.targets) {
        const target = unwrap(t)
        if (target.type === 'Name') out.add(target.id)
      }
      return undefined
    }
    if ((node.type === 'AnnAssign' || node.type === 'AugAssign') && node.value) {
      const target = unwrap(node.target)
      if (target.type === 'Name' && isFloatLiteral(node.value)) out.add(target.id)
    }
    return undefined
  })
  return out
}

/**
 * Does this operand hold a float, as far as the file itself says?
 *
 * `//` on a float returns a float, where `int()` returned an `int`, so a
 * visible float anywhere in an operand means the rewrite would change the
 * result's *type* — not just its rounding — and we decline. Unknown names and
 * calls are not floats "as far as the file says", so they stay offerable.
 */
function looksFloat(expr: Expr, floatNames: ReadonlySet<string>): boolean {
  let found = false
  walk(expr as AnyNode, (node) => {
    if (node.type === 'Constant' && isFloatLiteral(node)) found = true
    else if (node.type === 'Name' && floatNames.has(node.id)) found = true
    else if (node.type === 'Call' && dottedName(node.func) === 'float') found = true
    return undefined
  })
  return found
}

/**
 * Does anything in the file bind the name `int`?
 *
 * A module that defines its own `int()` — a rounding helper, a parser — means
 * the call we are looking at is not the builtin at all, and the rewrite would
 * quietly drop a function call. Checked once per `detect`, not once per match.
 */
function rebindsInt(ctx: RefactorContext): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type === 'FunctionDef' || node.type === 'Lambda') {
      if (node.params.some((p) => p.name === 'int')) found = true
    }
    if (!isScope(node) || node.type === 'Lambda') return undefined
    if (localBindings(node.body).has('int')) found = true
    return undefined
  })
  return found
}

export const integerDivisionRule = defineRule<IntegerDivisionMatch>({
  id: 'integer-division',
  title: 'Use integer division',
  message: '`int(a / b)` divides in floats and then throws the fraction away — `//` stays in integers',
  catalogue: 88,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-integer-division',
  // Not behaviour-preserving for negative operands, so never batched by R7.
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<IntegerDivisionMatch>[] {
    if (rebindsInt(ctx)) return []

    // Built on first use: a file with no `int(a / b)` in it should not pay for
    // a second walk on every keystroke.
    let floatNames: Set<string> | null = null
    const floats = (): ReadonlySet<string> => {
      if (!floatNames) floatNames = floatLiteralNames(ctx)
      return floatNames
    }

    const out: RefactorMatch<IntegerDivisionMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Call') return
      const division = divisionArg(node)
      if (!division) return
      // Deleting `int(` and `)` also deletes the brackets that were holding a
      // multi-line expression together, so only rewrite a call on one line.
      if (ctx.lines.positionAt(node.start).line !== ctx.lines.positionAt(node.end).line) return
      // A visible float means `//` would hand back a float where `int()` handed
      // back an int — a changed type, not a changed rounding. Decline (§2.6.5).
      if (looksFloat(division.left, floats()) || looksFloat(division.right, floats())) return

      out.push({
        ruleId: 'integer-division',
        start: node.start,
        end: node.end,
        message:
          '`int(a / b)` divides in floats and truncates — `a // b` stays in integer maths. ' +
          'They differ for negative operands: `int(-7 / 2)` is -3, `-7 // 2` is -4, ' +
          'and `//` hands back a float if either operand turns out to be one.',
        data: { call: node, division }
      })
    })
    return out
  },

  apply(match: RefactorMatch<IntegerDivisionMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { call, division } = match.data
    // `//` shares `/`'s precedence and left-associativity, so each operand's
    // own source text is already grouped correctly and can be spliced verbatim.
    const left = textOf(ctx, division.left).trim()
    const right = textOf(ctx, division.right).trim()
    if (!left || !right) return null

    const rewritten = `${left} // ${right}`
    return [
      {
        start: call.start,
        end: call.end,
        newText: needsParens(call) ? `(${rewritten})` : rewritten
      }
    ]
  }
})
