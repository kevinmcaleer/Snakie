/**
 * Rule 21 — **Hoist the invariant out of the loop** (epic #634 §3.4).
 *
 * ```python
 * for angle in sweep:                span = MAX - MIN
 *     span = MAX - MIN               for angle in sweep:
 *     servo.write(angle)                 servo.write(angle)
 *     log(angle / span)                  log(angle / span)
 * ```
 *
 * The assignment does not depend on anything the loop changes, so it computes
 * the same value on every pass. On a microcontroller that is not a stylistic
 * point: a thousand-iteration loop that recomputes a constant is a thousand
 * needless divisions, and on a Pico each one is time the next sensor read does
 * not get. Moving it above the loop makes the loop body say only what actually
 * varies, which is also easier to read.
 *
 * **Why this one is offered but never batched.** Hoisting changes how many
 * times the expression is evaluated — once instead of once per pass. For a
 * calculation over names and literals that is invisible, and that is the only
 * case rewritten automatically. The interesting case is the *impure* one:
 *
 * ```python
 * while running:
 *     limit = sensor.read_u16()   # is this meant to be re-read every pass?
 * ```
 *
 * Hoisting that is the bigger win and the bigger risk — it may be a deliberate
 * re-read of live hardware, or it may be an accident nobody noticed. Only a
 * human knows which, so the rule declines rather than guessing
 * ({@link isPureExpression} gates it), and `safe: false` keeps it out of
 * "Tidy this file".
 *
 * Two further refusals worth knowing about: a fresh `[]`/`{}`/`set()` per pass
 * is almost never invariant in intent — hoisting it makes every pass share one
 * mutable object — and if the variable is read *after* the loop, hoisting also
 * decides whether it is bound at all when the loop body never runs.
 */
import type { AnyNode, Assign, Expr, ForStmt, Name, WhileStmt } from '../ast'
import { unwrap, walk } from '../ast'
import { isPureExpression } from '../expr'
import type { Scope } from '../scope'
import { isReadAfter, nameUses, namesRead, namesWritten, scopeOf } from '../scope'
import { indentAt, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The two loop forms this rule hoists out of. */
type Loop = ForStmt | WhileStmt

interface HoistMatch {
  loop: Loop
  stmt: Assign
  /** The name the statement binds — kept so the message can name it. */
  name: string
}

/** The single `Name` an assignment binds, or null for anything else. */
function singleNameTarget(stmt: Assign): Name | null {
  if (stmt.targets.length !== 1) return null
  const target = unwrap(stmt.targets[0])
  return target.type === 'Name' ? target : null
}

/**
 * Does the expression build a new object each time it runs? A list, dict, set
 * or lambda display is "pure" in the side-effect sense but emphatically not
 * invariant: `rows = []` inside a loop wants a fresh list per pass, and hoisting
 * it would silently make every pass append to the same one.
 */
function buildsFreshObject(expr: Expr): boolean {
  let fresh = false
  walk(expr as AnyNode, (n) => {
    if (n.type === 'List' || n.type === 'Dict' || n.type === 'Set' || n.type === 'Lambda') {
      fresh = true
      return false
    }
    return undefined
  })
  return fresh
}

/** Does this scope declare `name` `global` or `nonlocal`? Then leave it alone. */
function declaresName(scope: Scope, name: string): boolean {
  if (scope.type === 'Lambda') return false
  let found = false
  for (const stmt of scope.body) {
    walk(stmt, (n) => {
      if ((n.type === 'Global' || n.type === 'Nonlocal') && n.names.includes(name)) found = true
      return undefined
    })
  }
  return found
}

/**
 * Is the node the only thing on its line (bar a trailing comment)? Moving a
 * whole line is only a move if the line holds nothing else — `a = 1; step()`
 * and a statement continued over several physical lines both take the refusal.
 */
function ownsItsLine(ctx: RefactorContext, node: { start: number; end: number }): boolean {
  if (ctx.lines.positionAt(node.start).line !== ctx.lines.positionAt(node.end).line) return false
  const from = lineStart(ctx.src, node.start)
  if (ctx.src.slice(from, node.start).trim() !== '') return false
  const tail = ctx.src.slice(node.end, lineEnd(ctx.src, node.end)).replace(/\r?\n$/, '')
  return tail.trim() === '' || tail.trimStart().startsWith('#')
}

/**
 * Every statement in this loop's body that provably computes the same value on
 * every pass. Gathered per loop rather than per statement so the rule can tell
 * when hoisting *everything* would leave the loop with an empty body.
 */
function invariantsIn(ctx: RefactorContext, loop: Loop): HoistMatch[] {
  // A loop that shares its line with something else has nowhere to hoist to.
  const loopLineStart = lineStart(ctx.src, loop.start)
  if (ctx.src.slice(loopLineStart, loop.start).trim() !== '') return []

  const scope = scopeOf(loop)
  const writtenInLoop = namesWritten([loop])
  const uses = nameUses([loop])
  const readInElse = loop.orelse.length > 0 ? namesRead(loop.orelse) : new Set<string>()

  const out: HoistMatch[] = []
  for (const stmt of loop.body) {
    if (stmt.type !== 'Assign') continue
    const target = singleNameTarget(stmt)
    if (!target) continue
    const name = target.id

    // Only a calculation over names and literals moves automatically (§2.6.6).
    if (!isPureExpression(stmt.value)) continue
    if (buildsFreshObject(stmt.value)) continue

    // Invariant means: nothing the loop rewrites — the loop target included —
    // feeds this expression.
    let invariant = true
    for (const read of namesRead([stmt.value])) {
      if (writtenInLoop.has(read)) {
        invariant = false
        break
      }
    }
    if (!invariant) continue

    // The name must be settled by this statement alone. A second assignment
    // (or a `del`) inside the loop means the value the loop ends with is not
    // the value we would hoist, and a read *before* this line sees last pass's
    // value — which hoisting would replace with this pass's on the very first
    // iteration.
    let sole = true
    for (const use of uses) {
      if (use.name !== name) continue
      const inside = use.node.start >= stmt.start && use.node.end <= stmt.end
      if (use.kind === 'write' && !inside) sole = false
      if (use.kind === 'read' && use.node.start < stmt.start) sole = false
      if (!sole) break
    }
    if (!sole) continue

    // Hoisting binds the name even when the loop body never runs. That is only
    // unobservable while nothing downstream reads it.
    if (readInElse.has(name)) continue
    if (isReadAfter(scope, name, loop.end)) continue
    if (declaresName(scope, name)) continue

    if (!ownsItsLine(ctx, stmt)) continue
    out.push({ loop, stmt, name })
  }
  return out
}

export const hoistLoopInvariantRule = defineRule<HoistMatch>({
  id: 'hoist-loop-invariant',
  title: 'Hoist the invariant out of the loop',
  message: 'This value never changes inside the loop — work it out once, before it',
  catalogue: 21,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-hoist-loop-invariant',
  // The rewrite changes how many times the expression runs, so "Tidy this
  // file" never applies it unasked.
  safe: false,

  detect(ctx: RefactorContext): RefactorMatch<HoistMatch>[] {
    const out: RefactorMatch<HoistMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return
      const found = invariantsIn(ctx, node)
      // Hoisting every statement would leave the loop with no body at all, so
      // at least one statement has to stay behind.
      if (found.length === 0 || found.length >= node.body.length) return
      for (const data of found) {
        out.push({
          ruleId: 'hoist-loop-invariant',
          start: data.stmt.start,
          end: data.stmt.end,
          message: `\`${data.name}\` is the same on every pass — work it out before the loop`,
          data
        })
      }
    })
    return out
  },

  apply(match: RefactorMatch<HoistMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { loop, stmt } = match.data
    const from = lineStart(ctx.src, stmt.start)
    const to = lineEnd(ctx.src, stmt.end)
    const insertAt = lineStart(ctx.src, loop.start)
    // The loop header must genuinely come first, or the "move" is a no-op.
    if (insertAt >= from) return null

    // Take the line verbatim — trailing comment and all — and re-indent it to
    // sit level with the loop it is leaving.
    const line = ctx.src.slice(from, to).replace(/\r?\n$/, '')
    const moved = `${indentAt(ctx.src, loop.start)}${line.trimStart()}${ctx.eol}`

    return [
      { start: insertAt, end: insertAt, newText: moved },
      { start: from, end: to, newText: '' }
    ]
  }
})
