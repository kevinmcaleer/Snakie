/**
 * Rule 48 — **Viper integers wrap silently** (epic #634 §3.7, board-specific).
 *
 * ```python
 * @micropython.viper
 * def total_counts(buf, count: int) -> int:
 *     total = 0
 *     for i in range(count):
 *         total += int(buf[i])   # <- no overflow check lives here
 *     return total
 * ```
 *
 * Why it matters: a viper `int` is not a Python integer. Python integers are
 * arbitrary precision — they grow as large as the number needs and the heap
 * allows, which is why `2 ** 100` just works. A viper `int` is a **raw machine
 * word**: 32 bits on every board Snakie targets, held in a CPU register. That is
 * the whole reason viper is fast, and it is the whole reason this warning
 * exists.
 *
 * There is no overflow check. None. When a multiply, a shift or an accumulator
 * crosses `2**31` the value does not raise, does not saturate and does not warn
 * — it wraps to a negative number and the function carries on as if nothing
 * happened. A step counter that reads 2,147,483,647 one second and
 * −2,147,483,648 the next. A checksum that matches on short packets and fails on
 * long ones. A fixed-point multiply that puts the robot into reverse at exactly
 * the wrong throttle. These are hours-long bugs precisely because the code looks
 * right, the maths looks right, and Python has spent your whole career making
 * this class of bug impossible.
 *
 * What to do about it, in rough order of preference:
 *
 * - **Bound the inputs.** Mask intermediate results (`& 0xFFFF`), or shift down
 *   before you multiply up, so the widest value the expression can produce still
 *   fits in 31 bits and a sign bit. A masked result is not reported here.
 * - **Reset the accumulator.** A running total that is drained every loop
 *   iteration cannot climb; one that runs for hours will.
 * - **Keep a plain-Python fallback.** Do the narrow, hot case in viper and hand
 *   the wide case to an undecorated function, where Python's arbitrary precision
 *   is waiting for you. Two functions is not a failure; it is the honest shape
 *   of "fast when it can be, correct always".
 *
 * This one never rewrites anything. Which bound is right for your data is not
 * something a refactoring tool can know, and quietly inserting a mask would be a
 * behaviour change dressed up as a fix.
 */
import type { AnyNode, Expr, FunctionDef, Stmt } from '../ast'
import { enclosingLoop, unwrap, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { hasViperDecorator, isIntegerLiteral } from './convert-to-viper'

/** What kind of overflow this is, for the message. */
type Hazard = 'multiply' | 'shift' | 'accumulate'

interface OverflowMatch {
  fn: FunctionDef
  hazard: Hazard
}

/**
 * Calls that hand back a machine word rather than an arbitrary object. `ptr8`
 * and friends are viper's own pointer casts — the very idiom whose loads feed
 * these expressions.
 */
const INT_RETURNING_CALLS = new Set(['int', 'len', 'ord', 'abs', 'ptr8', 'ptr16', 'ptr32'])

/**
 * Does this expression look like machine-word integer maths?
 *
 * Conservative in the direction that matters: anything we cannot see the type of
 * — an attribute, an unrecognised call, a string, a float — means this is object
 * arithmetic, where Python's arbitrary precision is still in charge and there is
 * nothing to warn about.
 */
function looksIntegral(expr: Expr): boolean {
  let ok = true
  walk(expr as AnyNode, (node) => {
    if (!ok) return false
    switch (node.type) {
      case 'Constant':
        if (node.kind !== 'number' || !isIntegerLiteral(node.raw)) ok = false
        return undefined
      case 'Call': {
        const name = dottedName(node.func)
        if (name == null || !INT_RETURNING_CALLS.has(name)) ok = false
        return undefined
      }
      case 'Attribute':
      case 'Lambda':
      case 'List':
      case 'Tuple':
      case 'Set':
      case 'Dict':
      case 'ListComp':
      case 'SetComp':
      case 'DictComp':
      case 'GeneratorExp':
      case 'Await':
      case 'Yield':
        ok = false
        return false
      default:
        return undefined
    }
  })
  return ok
}

/**
 * Is this result immediately masked back down to a known width?
 *
 * `(crc << 1) & 0xFF` cannot overflow no matter how many times round the loop it
 * goes, and reporting it would train people to ignore the warning. The mask has
 * to be a literal: `x & mask` with a computed mask tells us nothing.
 */
function isMaskedDown(node: Expr): boolean {
  let child: AnyNode = node
  let parent = node.parent
  // A parenthesised expression sits inside a Group; walk out of it first.
  while (parent && parent.type === 'Group') {
    child = parent
    parent = parent.parent
  }
  if (!parent || parent.type !== 'BinOp' || parent.op !== '&') return false
  const other = parent.left === child ? parent.right : parent.left
  const lit = unwrap(other)
  return lit.type === 'Constant' && lit.kind === 'number' && isIntegerLiteral(lit.raw)
}

/** The name a statement accumulates into (`total += x`, `total = total + x`), or null. */
function accumulatorName(node: AnyNode): string | null {
  if (node.type === 'AugAssign') {
    if (node.op !== '+') return null
    const target = unwrap(node.target)
    if (target.type !== 'Name' || !looksIntegral(node.value)) return null
    return target.id
  }
  if (node.type === 'Assign' && node.targets.length === 1) {
    const target = unwrap(node.targets[0])
    const value = unwrap(node.value)
    if (target.type !== 'Name' || value.type !== 'BinOp' || value.op !== '+') return null
    const left = unwrap(value.left)
    const right = unwrap(value.right)
    const feedsItself =
      (left.type === 'Name' && left.id === target.id) ||
      (right.type === 'Name' && right.id === target.id)
    if (!feedsItself || !looksIntegral(value) || isMaskedDown(value)) return null
    return target.id
  }
  return null
}

/**
 * A running total that climbs every pass of a loop.
 *
 * A hand-rolled loop counter — `while i < n: … i += 1` — is deliberately not
 * one: it is bounded by the very condition it is compared against, and warning
 * about it would teach people to skip past this rule's real findings.
 */
function isLoopAccumulation(node: AnyNode): boolean {
  const name = accumulatorName(node)
  if (name == null) return false
  const loop = enclosingLoop(node)
  if (!loop) return false
  if (loop.type === 'While') {
    let bounded = false
    walk(loop.test as AnyNode, (n) => {
      if (n.type === 'Name' && n.id === name) bounded = true
    })
    if (bounded) return false
  }
  return true
}

/** The first thing in this viper function that can quietly exceed a machine word. */
function firstHazard(fn: FunctionDef): { node: AnyNode; hazard: Hazard } | null {
  const hits: { node: AnyNode; hazard: Hazard }[] = []

  const visitor = (node: AnyNode): void | false => {
    if (hits.length > 0) return false
    // A nested `def` is compiled on its own terms, under its own decorators.
    if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
      return false
    }
    if (node.type === 'BinOp' && (node.op === '*' || node.op === '<<')) {
      if (looksIntegral(node) && !isMaskedDown(node)) {
        hits.push({ node, hazard: node.op === '*' ? 'multiply' : 'shift' })
        return false
      }
    }
    if (isLoopAccumulation(node)) {
      hits.push({ node, hazard: 'accumulate' })
      return false
    }
    return undefined
  }

  for (const stmt of fn.body as Stmt[]) walk(stmt as AnyNode, visitor)
  return hits[0] ?? null
}

/** How to describe the hazard in the Problems panel. */
function describe(hazard: Hazard, text: string): string {
  const snippet = text.length > 42 ? `${text.slice(0, 40)}…` : text
  switch (hazard) {
    case 'multiply':
      return `\`${snippet}\` is a machine-word multiply — viper does not check overflow, so a wide product wraps to a negative number in silence`
    case 'shift':
      return `\`${snippet}\` shifts bits off the top of a machine word — viper does not check overflow, and the lost bits go without a word`
    case 'accumulate':
      return `\`${snippet}\` accumulates every pass with no overflow check — past 2**31 a viper int wraps negative rather than growing`
  }
}

export const viperOverflowWarningRule = defineRule<OverflowMatch>({
  id: 'viper-overflow-warning',
  title: 'Viper integers wrap silently',
  message: 'A viper int is a raw machine word — this arithmetic can overflow with no error at all',
  catalogue: 48,
  category: 'board',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-viper-overflow-warning',
  // Nothing to batch: bounding the value is a decision about the data.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.viper,

  detect(ctx: RefactorContext): RefactorMatch<OverflowMatch>[] {
    const out: RefactorMatch<OverflowMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return undefined
      if (!hasViperDecorator(node)) return undefined
      // One warning per function. Three multiplies in a row are one thing to
      // think about, not three entries in the Problems panel.
      const hazard = firstHazard(node)
      if (!hazard) return undefined
      out.push({
        ruleId: 'viper-overflow-warning',
        start: hazard.node.start,
        end: hazard.node.end,
        message: describe(hazard.hazard, textOf(ctx, hazard.node).trim()),
        data: { fn: node, hazard: hazard.hazard }
      })
      return undefined
    })
    return out
  },

  // Hint only. Which mask, which width, or whether the wide case belongs in a
  // plain-Python fallback are answers about the author's data — inserting one on
  // their behalf would be a behaviour change wearing a fix's clothes.
  apply(): TextEdit[] | null {
    return null
  }
})
