/**
 * Rule 77 — **Use a for loop over range** (epic #634 §3.4).
 *
 * ```python
 * i = 0                              for i in range(steps):
 * while i < steps:                       servo.angle(i * 2)
 *     servo.angle(i * 2)                 time.sleep_ms(20)
 *     time.sleep_ms(20)
 *     i += 1
 * ```
 *
 * The hand-rolled counter is three separate promises the reader has to check:
 * that it starts at zero, that the test is the right way round, and that the
 * increment is reached on *every* path through the body. Forget the last one and
 * the robot sits there spinning forever with the motors on. `range` makes all
 * three the language's problem.
 *
 * Two things make this rewrite subtler than it looks, and both are worth
 * teaching:
 *
 * 1. **The counter's leftover value differs.** After the `while`, `i == steps`
 *    (that is why the loop stopped). After the `for`, `i == steps - 1` — and if
 *    `steps` was zero or less, `i` is never bound at all. So we decline the whole
 *    rewrite whenever `i` is still read after the loop.
 * 2. **A `continue` skips the increment.** In the `while` form a `continue`
 *    jumps straight back to the test without ever reaching `i += 1`, which is
 *    either an infinite loop or a deliberate re-try. `for` would advance anyway,
 *    so we never touch a body containing one.
 *
 * We also insist the bound is a pure expression the body never assigns to.
 * `while i < len(queue)` re-reads the length every single time round;
 * `range(len(queue))` reads it once, and a body that adds to `queue` would then
 * behave differently — as would `while i < self.count` over a body that winds
 * `self.count` down.
 */
import type { AnyNode, Assign, AugAssign, Expr, Stmt, WhileStmt } from '../ast'
import { ancestors, blocksOf, enclosingLoop, unwrap, walk } from '../ast'
import { isPureExpression, textOf } from '../expr'
import type { Scope } from '../scope'
import { bodyOf, nameUses, namesRead, namesWritten, scopeOf } from '../scope'
import type { TextEdit } from '../text'
import { lineEnd, lineStart } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface WhileCounterMatch {
  /** The `i = 0` seed. */
  assign: Assign
  /** The `while i < n:` loop. */
  loop: WhileStmt
  /** The trailing `i += 1`. */
  increment: AugAssign
  /** The counter's name. */
  counter: string
  /** The `n` in `i < n`, already unwrapped of any parentheses. */
  bound: Expr
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
 * loop that reuses `i` as its own counter rebinds it first, so it does not count.
 */
function liveAfter(scope: Scope, name: string, offset: number): boolean {
  for (const use of nameUses(bodyOf(scope))) {
    if (use.name !== name || use.node.start < offset) continue
    return use.kind === 'read'
  }
  return false
}

/** Has the file rebound `range`? Then it no longer counts 0..n-1. */
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

/**
 * Every place `stmts` binds something, as source text — plain names, but also
 * `self.count` and `buffer[k]`, which `namesWritten` reports as reads of their
 * base. `range` evaluates the bound once, so anything the body rewrites is out.
 */
function assignedTexts(ctx: RefactorContext, stmts: readonly Stmt[]): Set<string> {
  const out = new Set<string>()
  const record = (expr: Expr): void => {
    const e = unwrap(expr)
    switch (e.type) {
      case 'Name':
        out.add(e.id)
        return
      case 'Tuple':
      case 'List':
        for (const el of e.elts) record(el)
        return
      case 'Starred':
        record(e.value)
        return
      case 'Subscript':
        // Writing an element changes the container itself, so bar both.
        out.add(textOf(ctx, e).trim())
        record(e.value)
        return
      default:
        out.add(textOf(ctx, e).trim())
        return
    }
  }
  for (const stmt of stmts) {
    walk(stmt, (n) => {
      switch (n.type) {
        case 'Assign':
          for (const t of n.targets) record(t)
          return undefined
        case 'AugAssign':
        case 'AnnAssign':
          record(n.target)
          return undefined
        case 'Delete':
          for (const t of n.targets) record(t)
          return undefined
        case 'For':
          record(n.target)
          return undefined
        case 'With':
          for (const item of n.items) if (item.optionalVars) record(item.optionalVars)
          return undefined
        case 'NamedExpr':
          out.add(n.target.id)
          return undefined
        case 'Import':
          for (const a of n.names) out.add(a.asname ?? a.name.split('.')[0])
          return undefined
        case 'ImportFrom':
          for (const a of n.names) out.add(a.asname ?? a.name)
          return undefined
        case 'FunctionDef':
        case 'ClassDef':
          out.add(n.name)
          return undefined
        default:
          return undefined
      }
    })
  }
  return out
}

/** Does the body rewrite anything the bound is built from? */
function boundMovesUnderUs(ctx: RefactorContext, bound: Expr, assigned: Set<string>): boolean {
  let moves = false
  walk(bound as AnyNode, (n) => {
    if (assigned.has(ctx.src.slice(n.start, n.end).trim())) moves = true
    return undefined
  })
  return moves
}

/** Does a `continue` belonging to THIS loop appear in its body? */
function hasOwnContinue(loop: WhileStmt): boolean {
  let found = false
  for (const stmt of loop.body) {
    walk(stmt, (n) => {
      if (n.type === 'Continue' && enclosingLoop(n) === loop) found = true
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

export const whileCounterToForRule = defineRule<WhileCounterMatch>({
  id: 'while-counter-to-for',
  title: 'Use a for loop over range',
  message: 'A hand-counted `while` — `for i in range(...)` keeps the counter honest',
  catalogue: 77,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-while-counter-to-for',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<WhileCounterMatch>[] {
    const out: RefactorMatch<WhileCounterMatch>[] = []
    for (const list of statementLists(ctx)) {
      for (let k = 0; k + 1 < list.length; k++) {
        const assign = list[k]
        if (assign.type !== 'Assign' || assign.targets.length !== 1) continue
        const target = unwrap(assign.targets[0])
        if (target.type !== 'Name') continue
        const seed = unwrap(assign.value)
        // `range` counts from zero; any other start is a different sequence.
        if (seed.type !== 'Constant' || seed.kind !== 'number' || seed.raw !== '0') continue
        const counter = target.id

        const loop = list[k + 1]
        if (loop.type !== 'While') continue
        // A `while … else` reads the counter after the test failed; leave it be.
        if (loop.orelse.length > 0) continue

        const test = unwrap(loop.test)
        if (test.type !== 'Compare' || test.ops.length !== 1 || test.ops[0] !== '<') continue
        const left = unwrap(test.left)
        if (left.type !== 'Name' || left.id !== counter) continue

        const bound = unwrap(test.comparators[0])
        // `range(a, b)` is not what `i < (a, b)` means, and a `lambda` bound is
        // nonsense — but mostly this rejects calls, which `range` would stop
        // re-evaluating on every pass.
        if (bound.type === 'Tuple' || bound.type === 'Lambda') continue
        if (!isPureExpression(bound)) continue

        // Dropping the increment must leave a body behind.
        if (loop.body.length < 2) continue
        const increment = loop.body[loop.body.length - 1]
        if (increment.type !== 'AugAssign' || increment.op !== '+') continue
        const incTarget = unwrap(increment.target)
        if (incTarget.type !== 'Name' || incTarget.id !== counter) continue
        const step = unwrap(increment.value)
        if (step.type !== 'Constant' || step.kind !== 'number' || step.raw !== '1') continue

        // That increment must be the counter's ONLY write inside the loop.
        const writes = nameUses(loop.body).filter((u) => u.name === counter && u.kind === 'write')
        if (writes.length !== 1 || writes[0].node !== incTarget) continue

        // The bound is evaluated once by `range`, so nothing it reads may move.
        const written = namesWritten(loop.body)
        let boundMoves = false
        for (const name of namesRead([bound as AnyNode])) {
          if (written.has(name)) boundMoves = true
        }
        if (boundMoves) continue
        if (boundMovesUnderUs(ctx, bound, assignedTexts(ctx, loop.body))) continue

        if (hasOwnContinue(loop)) continue
        // `range` leaves `i == n - 1` where the `while` leaves `i == n`.
        if (liveAfter(scopeOf(loop as AnyNode), counter, loop.end)) continue
        if (declaredOutside(loop as AnyNode, counter)) continue
        if (builtinRebound(ctx, loop as AnyNode, 'range')) continue

        if (/[\r\n]/.test(textOf(ctx, bound))) continue

        out.push({
          ruleId: 'while-counter-to-for',
          start: assign.start,
          end: loop.test.end,
          data: { assign, loop, increment, counter, bound }
        })
      }
    }
    return out
  },

  apply(match: RefactorMatch<WhileCounterMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { assign, loop, increment, counter, bound } = match.data

    // Both deletions take a whole line, so neither line may carry anything else.
    if (!standsAlone(ctx, assign)) return null
    if (!standsAlone(ctx, increment)) return null
    // A one-line `while i < n: …` has no separate body lines to keep.
    if (ctx.lines.positionAt(loop.start).line === ctx.lines.positionAt(loop.body[0].start).line) {
      return null
    }

    return [
      { start: lineStart(ctx.src, assign.start), end: lineEnd(ctx.src, assign.end), newText: '' },
      {
        start: loop.start,
        end: loop.test.end,
        newText: `for ${counter} in range(${textOf(ctx, bound)})`
      },
      {
        start: lineStart(ctx.src, increment.start),
        end: lineEnd(ctx.src, increment.end),
        newText: ''
      }
    ]
  }
})
