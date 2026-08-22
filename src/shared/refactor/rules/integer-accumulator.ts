/**
 * Rule 40 — **Integer maths would be faster here** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * # before                              # after (by hand)
 * def average_volts(samples):           def average_millivolts(samples):
 *     total = 0.0                           total_mv = 0
 *     for _ in range(samples):              for _ in range(samples):
 *         total += read_u16()                   total_mv += read_u16()
 *     return total / samples                return total_mv // samples
 * ```
 *
 * Why it matters: the RP2040 has no floating-point unit, and neither do most of
 * the other chips MicroPython runs on. Every float operation is therefore a call
 * into a soft-float library — a routine that unpacks two mantissas, aligns the
 * exponents, does the arithmetic in integers anyway and packs the result back
 * up. On top of that each result is a *heap object*, so a loop accumulating into
 * a float allocates once per iteration and hands the garbage collector work it
 * did not need. Integer addition, by comparison, is one machine instruction on a
 * small int that never leaves the register.
 *
 * The tell this rule looks for is an accumulator that was *declared* a float —
 * `total = 0.0` — but only ever has whole numbers added to it. That is almost
 * always a habit picked up from desktop Python, where the `0.0` costs nothing
 * and saves you from integer division later. On a microcontroller it is paying
 * the soft-float tax on every single sample for no benefit at all.
 *
 * **This is a trade, and an honest rule says so.** Keeping the sum in integers
 * usually means changing units — millivolts instead of volts, ticks instead of
 * millimetres, hundredths of a degree instead of degrees — and scaling once at
 * the end. That is faster and exact, but it does make the code read a little
 * further from the physical quantity, and it puts the burden of remembering the
 * scale on whoever reads it next. Worth it in a sampling loop; not worth it in a
 * function that runs twice.
 *
 * So the rule is `hintOnly`: it points at the accumulation, names the float that
 * started it, and lets the author decide. There is no mechanical rewrite,
 * because choosing the new unit is the entire job.
 */
import type { AnyNode, Assign, AugAssign, Expr, ForStmt, WhileStmt } from '../ast'
import { enclosingLoop, unwrap, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import { bodyOf, isScope, nameUses, scopeOf } from '../scope'
import type { Scope } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface AccumulatorMatch {
  /** The `total += …` inside the loop that the marker points at. */
  augAssign: AugAssign
  /** The accumulator's name. */
  name: string
  /** The float literal it was initialised to, as written. */
  initial: string
}

/**
 * Is this literal written as a float? `0.0` and `1e3` are; `0`, `0x20` and a
 * negated `-0.5` (a UnaryOp, not a Constant) are not.
 */
function isFloatLiteral(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Constant' || e.kind !== 'number') return false
  const raw = e.raw.replace(/_/g, '')
  if (/^0[xXoObB]/.test(raw)) return false
  if (/[jJ]$/.test(raw)) return false
  return raw.includes('.') || /[eE]/.test(raw)
}

/** Is this literal written as a whole number? `1`, `4_096` and `0x20` are. */
function isIntLiteral(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Constant' || e.kind !== 'number') return false
  const raw = e.raw.replace(/_/g, '')
  if (/[jJ]$/.test(raw)) return false
  // In `0xbe` and `0b1101` the `e`/`b` are digits, not an exponent, so the
  // radix prefixes are settled before the float test runs.
  if (/^0[xXoObB]/.test(raw)) return true
  return !raw.includes('.') && !/[eE]/.test(raw)
}

/**
 * Walk one scope's own statements, without descending into nested `def`s,
 * `lambda`s or classes — their `total` is a different variable.
 */
function walkScopeBody(scope: Scope, fn: (node: AnyNode) => void): void {
  for (const stmt of bodyOf(scope)) {
    walk(stmt, (n) => {
      if (isScope(n)) return false
      fn(n)
      return undefined
    })
  }
}

/** Every plain `name = …` in this scope (not `+=`, not a tuple unpack). */
function plainAssignsTo(scope: Scope, name: string): Assign[] {
  const out: Assign[] = []
  walkScopeBody(scope, (n) => {
    if (n.type !== 'Assign' || n.targets.length !== 1) return
    const target = unwrap(n.targets[0])
    if (target.type === 'Name' && target.id === name) out.push(n)
  })
  return out
}

/** Every `name op= …` in this scope. */
function augAssignsTo(scope: Scope, name: string): AugAssign[] {
  const out: AugAssign[] = []
  walkScopeBody(scope, (n) => {
    if (n.type !== 'AugAssign') return
    const target = unwrap(n.target)
    if (target.type === 'Name' && target.id === name) out.push(n)
  })
  return out
}

/**
 * Does this expression visibly produce a float?
 *
 * A float literal, a `float()` call, a name we have already decided is a float
 * — and any `/`, because in Python 3 true division yields a float even when
 * both operands are whole: `1 / 2` is `0.5`. That last one matters more than
 * the literals do, since `volts = raw * 3.3 / 65535` and `scale = vref / 65535`
 * are how a float actually reaches an accumulator in real code.
 */
function looksFloat(expr: Expr, floatNames: ReadonlySet<string>): boolean {
  let found = false
  walk(expr as AnyNode, (n) => {
    if (n.type === 'Constant' && isFloatLiteral(n)) found = true
    else if (n.type === 'BinOp' && n.op === '/') found = true
    else if (n.type === 'Name' && floatNames.has(n.id)) found = true
    else if (n.type === 'Call' && dottedName(n.func) === 'float') found = true
    return undefined
  })
  return found
}

/** Names one scope assigns a visibly-float value to. Returns true if it added any. */
function floatNamesIn(scope: Scope, into: Set<string>): boolean {
  const before = into.size
  walkScopeBody(scope, (n) => {
    if (n.type === 'Assign' && n.targets.length === 1) {
      const target = unwrap(n.targets[0])
      if (target.type === 'Name' && looksFloat(n.value, into)) into.add(target.id)
      return
    }
    if (n.type === 'AugAssign') {
      const target = unwrap(n.target)
      if (target.type === 'Name' && looksFloat(n.value, into)) into.add(target.id)
    }
  })
  return into.size > before
}

/**
 * Names that are visibly floats, so we can spot a float being added to an
 * integer-looking accumulator. The module's own constants count as well as the
 * function's locals — `STEP_VOLTS = 0.05` at the top of the file is exactly the
 * case that would otherwise earn a wrong hint.
 *
 * Repeated to a fixpoint (cheaply — three passes is plenty for `VREF = 3.3`,
 * `SCALE = VREF / 65535`, `volts = raw * SCALE`) so a float that reaches the
 * accumulator through two hops is still spotted whatever order it was written.
 */
function floatValuedNames(ctx: RefactorContext, scope: Scope): Set<string> {
  const out = new Set<string>()
  for (let pass = 0; pass < 4; pass++) {
    let grew = floatNamesIn(ctx.module, out)
    if (scope !== ctx.module) grew = floatNamesIn(scope, out) || grew
    if (!grew) break
  }
  return out
}

/**
 * Is everything added to the accumulator a whole number, as far as this file
 * can tell?
 *
 * Deliberately narrow: an integer literal, or a plain name that the scope never
 * assigns a float literal to. A call could return anything, and an expression
 * mixing units could be either — those two get no hint rather than a wrong one.
 */
function addsWholeNumbers(value: Expr, floatNames: ReadonlySet<string>): boolean {
  const e = unwrap(value)
  if (isIntLiteral(e)) return true
  return e.type === 'Name' && !floatNames.has(e.id)
}

/** How many times does this scope bind `name` at all? */
function bindingCount(scope: Scope, name: string): number {
  return nameUses(bodyOf(scope)).filter((u) => u.kind === 'write' && u.name === name).length
}

/** How to describe the loop this accumulation sits in. */
function loopKindOf(loop: ForStmt | WhileStmt): 'for' | 'while' {
  return loop.type === 'For' ? 'for' : 'while'
}

export const integerAccumulatorRule = defineRule<AccumulatorMatch>({
  id: 'integer-accumulator',
  title: 'Integer maths would be faster here',
  message: 'This accumulator starts as a float but only ever gains whole numbers',
  catalogue: 40,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-integer-accumulator',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<AccumulatorMatch>[] {
    const out: RefactorMatch<AccumulatorMatch>[] = []
    // One hint per accumulator, however many `+=` lines the loop holds.
    const reported = new Set<string>()

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'AugAssign' || node.op !== '+') return
      const target = unwrap(node.target)
      if (target.type !== 'Name') return
      // `enclosingLoop` stops at a function boundary, which is also where the
      // initialiser search below stops — the two have to agree.
      const loop = enclosingLoop(node)
      if (!loop) return

      const scope = scopeOf(node)
      const name = target.id
      const key = `${scope.start}:${name}`
      if (reported.has(key)) return

      // Exactly one plain assignment, before the loop: the initialiser. Two of
      // them and we cannot say which value the loop starts from.
      const assigns = plainAssignsTo(scope, name)
      if (assigns.length !== 1) return
      const initialiser = assigns[0]
      if (initialiser.start >= loop.start) return
      if (!isFloatLiteral(initialiser.value)) return

      // Nothing else may bind the name — no `for total in …`, no `global`
      // rebinding, no tuple unpack — or the float we found is not the whole story.
      const augs = augAssignsTo(scope, name)
      if (bindingCount(scope, name) !== 1 + augs.length) return

      // *Every* accumulation into it must be a whole number, not just this one.
      const floatNames = floatValuedNames(ctx, scope)
      if (!augs.every((a) => a.op === '+' && addsWholeNumbers(a.value, floatNames))) return

      reported.add(key)
      out.push({
        ruleId: 'integer-accumulator',
        start: node.start,
        end: node.end,
        message: `\`${name}\` starts at \`${textOf(ctx, initialiser.value)}\` but this \`${loopKindOf(loop)}\` only ever adds whole numbers — on a chip with no FPU each float add is a soft-float library call`,
        data: { augAssign: node, name, initial: textOf(ctx, initialiser.value) }
      })
    })

    return out
  },

  // Hint only. Moving the sum into integers means choosing a new unit —
  // millivolts, ticks, hundredths of a degree — and scaling once at the end.
  // That is the whole job, and it is the author's to do.
  apply(): TextEdit[] | null {
    return null
  }
})
