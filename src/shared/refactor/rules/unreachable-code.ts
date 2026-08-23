/**
 * Rule 66 — **Remove the unreachable code** (epic #634 §3.8).
 *
 * ```python
 * # before — the motor never stops, whatever the last line says
 * def drive(motor, speed):
 *     motor.duty(speed)
 *     return speed
 *     motor.stop()
 *
 * # after
 * def drive(motor, speed):
 *     motor.duty(speed)
 *     return speed
 * ```
 *
 * Anything after a `return`, `raise`, `break` or `continue` in the same block
 * can never run. This is `warning`, not `hint`: it is almost never a style
 * choice, it is a line someone believed was doing something. The motor that was
 * supposed to stop, the pin that was supposed to be pulled low — the code reads
 * as if it happens, and the hardware says otherwise. Deleting it makes the file
 * say what it does, and puts the missing stop somewhere it will actually run.
 *
 * The rule declines rather than guesses in five cases:
 *
 * - a `def` or `class` in the dead span — the *name* may still be imported from
 *   another module, and deleting a definition is not a local decision;
 * - a `yield` in the dead span — `return` followed by `yield` is the standard
 *   empty-generator idiom, and removing the `yield` turns the generator into an
 *   ordinary function;
 * - a `global`/`nonlocal` declaration — those bind at compile time for the whole
 *   function, reachable or not, so deleting one changes what the *live* code
 *   above it assigns to;
 * - an assignment whose name the live code reads but never binds — for the same
 *   compile-time reason. `print(counter)` above a dead `counter = 1` raises
 *   `UnboundLocalError` today and would quietly start printing the global if we
 *   deleted the dead line, which is a behaviour change even though the old
 *   behaviour was a bug (see {@link bindsALocalTheLiveCodeReads});
 * - a comment anywhere in the span — someone wrote it on purpose, and deciding
 *   it can go is their call, not ours.
 */
import type { AnyNode, Stmt } from '../ast'
import { blocksOf, walk } from '../ast'
import { bodyOf, nameUses, namesWritten, scopeOf } from '../scope'
import { lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface UnreachableMatch {
  /** The `return`/`raise`/`break`/`continue` that ends the block. */
  terminator: Stmt
  /** Everything after it in the same statement list. */
  dead: Stmt[]
}

/** The keyword each terminator is written with, and what it does. */
const TERMINATORS: Record<string, { keyword: string; effect: string }> = {
  Return: { keyword: 'return', effect: 'leaves the function' },
  Raise: { keyword: 'raise', effect: 'throws' },
  Break: { keyword: 'break', effect: 'leaves the loop' },
  Continue: { keyword: 'continue', effect: 'jumps back to the top of the loop' }
}

/** Does this statement contain a `yield` anywhere? */
function containsYield(stmt: Stmt): boolean {
  let found = false
  walk(stmt as AnyNode, (n) => {
    if (n.type === 'Yield') found = true
  })
  return found
}

/**
 * Would deleting `dead` change which binding the *live* code sees?
 *
 * Python decides a function's locals when it compiles the body, not when it
 * runs it, so a dead `counter = 1` makes `counter` local everywhere in the
 * function — including in the live `print(counter)` above it, which therefore
 * raises `UnboundLocalError`. Delete the dead line and that same `print` starts
 * reading the global instead. The old behaviour is a bug, but it is not our bug
 * to fix silently, so we decline.
 *
 * Only names the live code reads and never binds matter: if the function
 * assigns the name anywhere else (or takes it as a parameter) it is local with
 * or without the dead statement.
 */
function bindsALocalTheLiveCodeReads(dead: readonly Stmt[]): boolean {
  const scope = scopeOf(dead[0] as AnyNode)
  // Only a function body has compile-time locals; module and class bodies look
  // names up dynamically, so a dead binding there changes nothing.
  if (scope.type !== 'FunctionDef') return false
  const bound = namesWritten(dead as readonly AnyNode[])
  if (bound.size === 0) return false

  const first = dead[0]
  const last = dead[dead.length - 1]
  const uses = nameUses(bodyOf(scope))
  for (const name of bound) {
    if (scope.params.some((p) => p.name === name)) continue
    let readOutside = false
    let boundOutside = false
    for (const use of uses) {
      if (use.name !== name) continue
      if (use.node.start >= first.start && use.node.end <= last.end) continue
      if (use.kind === 'read') readOutside = true
      else boundOutside = true
    }
    if (readOutside && !boundOutside) return true
  }
  return false
}

/**
 * The whole-line span to delete, or null when we cannot prove the deletion is
 * both safe and confined to the dead statements. Shared by `detect` and
 * `apply` so the menu never offers something `apply` would refuse.
 */
function deletionRange(
  ctx: RefactorContext,
  terminator: Stmt,
  dead: readonly Stmt[]
): { start: number; end: number } | null {
  for (const stmt of dead) {
    if (stmt.type === 'FunctionDef' || stmt.type === 'ClassDef') return null
    if (stmt.type === 'Global' || stmt.type === 'Nonlocal') return null
    if (containsYield(stmt)) return null
  }
  if (bindsALocalTheLiveCodeReads(dead)) return null

  const first = dead[0]
  const last = dead[dead.length - 1]
  const start = lineStart(ctx.src, first.start)
  const end = lineEnd(ctx.src, last.end)

  // `return 1; motor.stop()` puts live and dead code on one line, where taking
  // whole lines would take the `return` with it.
  if (!/^[ \t]*$/.test(ctx.src.slice(start, first.start))) return null
  // Nothing but a stray `;` may follow the last dead statement on its line.
  if (!/^[;\s]*$/.test(ctx.src.slice(last.end, end))) return null

  // A comment between the terminator and the end of the dead code would either
  // be deleted with it or left dangling above nothing. Either way, not our call.
  const guardFrom = lineEnd(ctx.src, terminator.end)
  for (const comment of ctx.comments) {
    if (comment.start >= guardFrom && comment.start < end) return null
  }

  return { start, end }
}

export const unreachableCodeRule = defineRule<UnreachableMatch>({
  id: 'unreachable-code',
  title: 'Remove the unreachable code',
  message: 'This code can never run — the statement above always jumps away',
  catalogue: 66,
  category: 'control-flow',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-unreachable-code',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<UnreachableMatch>[] {
    const out: RefactorMatch<UnreachableMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      for (const block of blocksOf(node)) {
        // Only the first terminator matters: everything after it is dead, and
        // that one deletion removes any later terminators along with it.
        for (let i = 0; i < block.length - 1; i++) {
          const terminator = TERMINATORS[block[i].type]
          if (!terminator) continue
          const dead = block.slice(i + 1)
          if (deletionRange(ctx, block[i], dead)) {
            out.push({
              ruleId: 'unreachable-code',
              start: dead[0].start,
              end: dead[dead.length - 1].end,
              message: `This code can never run — the \`${terminator.keyword}\` above always ${terminator.effect}`,
              data: { terminator: block[i], dead }
            })
          }
          break
        }
      }
    })
    return out
  },

  apply(match: RefactorMatch<UnreachableMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { terminator, dead } = match.data
    if (dead.length === 0) return null
    const range = deletionRange(ctx, terminator, dead)
    if (!range) return null
    return [{ start: range.start, end: range.end, newText: '' }]
  }
})
