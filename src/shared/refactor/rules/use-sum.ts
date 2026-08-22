/**
 * Rule 20 — **Use the built-in accumulator** (epic #634 §3.4).
 *
 * ```python
 * total = 0                          total = sum(cell.voltage() for cell in cells)
 * for cell in cells:
 *     total += cell.voltage()
 * ```
 *
 * Three lines of bookkeeping collapse into one that says what it means. `sum`
 * runs its addition in C rather than in the interpreter loop, so on a
 * microcontroller it is also the faster of the two — and passing a **generator**
 * rather than a list comprehension matters there: `sum(x for x in xs)` adds as
 * it goes, while `sum([x for x in xs])` first builds a whole second list in RAM,
 * which is exactly what you do not want on a board with 264 KB of it.
 *
 * When the loop body adds the loop variable itself, the generator is redundant
 * and the answer is simply `total = sum(readings)`.
 *
 * We decline whenever the starting value is not `0` (`sum` starts from zero, so
 * `total = offset` is a different sum), whenever the loop carries an `else`
 * clause, and whenever the loop variable is still read afterwards — a `for` loop
 * leaks its variable into the enclosing scope and a generator expression does
 * not, so dropping the loop would unbind a name the code still uses.
 */
import type { AnyNode, Assign, AugAssign, Expr, ForStmt, Stmt } from '../ast'
import { ancestors, blocksOf, unwrap, walk } from '../ast'
import { textOf } from '../expr'
import type { Scope } from '../scope'
import { bodyOf, nameUses, namesRead, namesWritten, scopeOf } from '../scope'
import type { TextEdit } from '../text'
import { lineEnd, lineStart } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface UseSumMatch {
  /** The `total = 0` that seeds the accumulator. */
  assign: Assign
  /** The loop that adds into it. */
  loop: ForStmt
  /** The loop's only statement, `total += <expr>`. */
  aug: AugAssign
  /** The accumulator's name. */
  accumulator: string
}

/** Expression shapes that are not legal (or not equivalent) inside a generator. */
const NOT_IN_A_GENERATOR = new Set(['Yield', 'Await', 'NamedExpr', 'Starred', 'Lambda'])

/** Can `expr` be moved verbatim into `sum(<expr> for x in xs)`? */
function fitsInAGenerator(expr: Expr): boolean {
  const e = unwrap(expr)
  // A bare tuple would turn into extra arguments of `sum`.
  if (e.type === 'Tuple' && !e.parenthesized) return false
  let ok = true
  walk(expr as AnyNode, (n) => {
    if (NOT_IN_A_GENERATOR.has(n.type)) {
      ok = false
      return false
    }
    return undefined
  })
  return ok
}

/** Every statement list in the file, so we can look at adjacent statements. */
function statementLists(ctx: RefactorContext): Stmt[][] {
  const lists: Stmt[][] = []
  walk(ctx.module as AnyNode, (node) => {
    for (const block of blocksOf(node)) lists.push(block)
  })
  return lists
}

/**
 * Is `name` still live at `offset` — read before anything rebinds it? A later
 * loop that reuses the same variable name rebinds it first, so it does not count.
 */
function liveAfter(scope: Scope, name: string, offset: number): boolean {
  for (const use of nameUses(bodyOf(scope))) {
    if (use.name !== name || use.node.start < offset) continue
    return use.kind === 'read'
  }
  return false
}

/** Has the file rebound `sum`? Then it no longer means what Python means by it. */
function builtinRebound(ctx: RefactorContext, node: AnyNode, name: string): boolean {
  if (namesWritten(ctx.module.body).has(name)) return true
  for (const a of ancestors(node)) {
    if (a.type === 'FunctionDef') {
      if (a.params.some((p) => p.name === name)) return true
      if (namesWritten(a.body).has(name)) return true
    } else if (a.type === 'ClassDef' && namesWritten(a.body).has(name)) {
      return true
    }
  }
  return false
}

/** Is `name` declared `global`/`nonlocal` here, so dropping its binding is visible elsewhere? */
function declaredOutside(node: AnyNode, name: string): boolean {
  const scope = scopeOf(node)
  if (scope.type === 'Lambda' || scope.type === 'Module') return false
  let found = false
  for (const stmt of scope.body) {
    walk(stmt, (n) => {
      if ((n.type === 'Global' || n.type === 'Nonlocal') && n.names.includes(name)) found = true
      if (
        n !== stmt &&
        (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef')
      ) {
        return false
      }
      return undefined
    })
  }
  return found
}

/** Nothing else may share the statement's line — we delete the whole line. */
function standsAlone(ctx: RefactorContext, node: { start: number; end: number }): boolean {
  const from = lineStart(ctx.src, node.start)
  const to = lineEnd(ctx.src, node.end)
  return ctx.src.slice(from, node.start).trim() === '' && ctx.src.slice(node.end, to).trim() === ''
}

export const useSumRule = defineRule<UseSumMatch>({
  id: 'use-sum',
  title: 'Use the built-in accumulator',
  message: 'This loop only adds things up — `sum()` says so in one line',
  catalogue: 20,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-use-sum',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<UseSumMatch>[] {
    const out: RefactorMatch<UseSumMatch>[] = []
    for (const list of statementLists(ctx)) {
      for (let k = 0; k + 1 < list.length; k++) {
        const assign = list[k]
        if (assign.type !== 'Assign' || assign.targets.length !== 1) continue
        const acc = unwrap(assign.targets[0])
        if (acc.type !== 'Name') continue
        // `sum` starts from integer zero; any other seed is a different total.
        const seed = unwrap(assign.value)
        if (seed.type !== 'Constant' || seed.kind !== 'number' || seed.raw !== '0') continue

        const loop = list[k + 1]
        if (loop.type !== 'For' || loop.isAsync) continue
        // A `for … else` runs extra code when the loop finishes; `sum` cannot.
        if (loop.orelse.length > 0) continue
        if (loop.body.length !== 1) continue

        const item = unwrap(loop.target)
        if (item.type !== 'Name' || item.id === acc.id) continue

        const aug = loop.body[0]
        if (aug.type !== 'AugAssign' || aug.op !== '+') continue
        const augTarget = unwrap(aug.target)
        if (augTarget.type !== 'Name' || augTarget.id !== acc.id) continue

        // The running total must not feed back into what is being added, or the
        // order of accumulation is part of the answer.
        if (namesRead([aug.value as AnyNode]).has(acc.id)) continue
        if (namesRead([loop.iter as AnyNode]).has(acc.id)) continue

        // A generator expression does not leak its variable the way `for` does.
        if (liveAfter(scopeOf(loop as AnyNode), item.id, loop.end)) continue
        if (declaredOutside(loop as AnyNode, item.id)) continue
        if (builtinRebound(ctx, loop as AnyNode, 'sum')) continue

        if (!fitsInAGenerator(aug.value)) continue
        const iter = unwrap(loop.iter)
        if (iter.type === 'Tuple' && !iter.parenthesized) continue

        // The rewrite is one line, so everything it folds in has to be one line.
        if (/[\r\n]/.test(textOf(ctx, aug.value))) continue
        if (/[\r\n]/.test(textOf(ctx, loop.iter))) continue

        out.push({
          ruleId: 'use-sum',
          start: assign.start,
          end: loop.end,
          data: { assign, loop, aug, accumulator: acc.id }
        })
      }
    }
    return out
  },

  apply(match: RefactorMatch<UseSumMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { assign, loop, aug, accumulator } = match.data

    // We delete the seed line outright and swallow the loop whole, so refuse if
    // either would take something of the user's with it.
    if (!standsAlone(ctx, assign)) return null
    for (const comment of ctx.comments) {
      if (comment.start >= assign.end && comment.start < loop.end) return null
    }

    const item = unwrap(loop.target)
    const value = unwrap(aug.value)
    const iterText = textOf(ctx, loop.iter)

    // `total += reading` over `readings` is just the sequence itself.
    const inner =
      item.type === 'Name' && value.type === 'Name' && value.id === item.id
        ? iterText
        : `${textOf(ctx, aug.value)} for ${textOf(ctx, loop.target)} in ${iterText}`

    return [
      { start: lineStart(ctx.src, assign.start), end: lineEnd(ctx.src, assign.end), newText: '' },
      { start: loop.start, end: loop.end, newText: `${accumulator} = sum(${inner})` }
    ]
  }
})
