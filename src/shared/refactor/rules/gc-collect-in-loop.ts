/**
 * Rule 61 — **This `gc.collect()` is the stall** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                              # after
 * for step in range(steps):             for step in range(steps):
 *     hip.duty_u16(1500 + step * 20)        hip.duty_u16(1500 + step * 20)
 *     gc.collect()                          time.sleep_ms(20)
 *     time.sleep_ms(20)
 * ```
 *
 * Why it matters: `gc.collect()` is not a hint. It is a full mark-and-sweep of
 * the entire heap, right now, before the next line runs. On a Pico that is
 * single-digit milliseconds every time you call it — and calling it *inside* the
 * loop means paying it on **every single iteration**, whether there was anything
 * to collect or not.
 *
 * This line almost always arrives the same way: something raised
 * `MemoryError`, the internet said "call `gc.collect()`", it went into the loop
 * because that is where the error appeared, and the crash went away. What
 * actually happened is that a memory problem was traded for a speed problem. The
 * loop now runs at a fraction of its old rate, misses encoder edges, jitters the
 * servo timing — and none of that looks like the "fix" that caused it.
 *
 * Collect where a pause costs nothing: in the idle path between jobs, once
 * before a timing-critical section starts, or on a `Timer` that fires when the
 * robot is stationary. Not in the loop whose timing you care about.
 *
 * **When this rule stays quiet.** If the loop body genuinely allocates on every
 * pass — it builds a list or a dict, formats an f-string, appends to something —
 * then the collect may well be deliberate, holding a fragmenting heap together
 * while the real fix waits. That author knows something the file does not say
 * out loud, so the rule leaves them alone entirely and does not even raise the
 * hint. (Rules 57, 58, 85 and 36 are the ones that go after the allocation
 * itself, which is the better fix in every case.)
 *
 * Gated on a board being connected at all: it is advice about the collector on
 * the chip in front of you, and Snakie says nothing about a board it cannot see.
 */
import type { AnyNode, ForStmt, Stmt, WhileStmt } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName } from '../expr'
import { fullLineRange, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The two loop forms this rule looks inside. */
type Loop = ForStmt | WhileStmt

interface CollectMatch {
  stmt: Stmt
  /** 'for' or 'while', for the message. */
  loopKind: 'for' | 'while'
}

/** Is `name` bound to the `gc` module by an import in this file? */
function isGcAlias(ctx: RefactorContext, name: string): boolean {
  if (name === 'gc') return true
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Import') return undefined
    for (const alias of node.names) {
      const bound = alias.asname ?? alias.name.split('.')[0]
      if (bound === name && alias.name === 'gc') found = true
    }
    return undefined
  })
  return found
}

/**
 * Did a bare `collect` come from `from gc import collect`?
 *
 * A bare `collect()` is far too ordinary a name to claim on sight — a sensor
 * driver, a scheduler and half the tutorial code on the internet have one.
 * Without an import to point at, the rule says nothing.
 */
function hasBareCollectImport(ctx: RefactorContext): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom') return undefined
    if (node.level !== 0 || node.module !== 'gc') return undefined
    if (node.names.some((a) => a.name === 'collect' && !a.asname)) found = true
    return undefined
  })
  return found
}

/** Is this statement a bare `gc.collect()` and nothing else? */
function isGcCollect(ctx: RefactorContext, stmt: Stmt, bareIsCollect: boolean): boolean {
  if (stmt.type !== 'ExprStmt') return false
  const call = unwrap(stmt.value)
  if (call.type !== 'Call') return false
  if (call.args.length > 0 || call.keywords.length > 0) return false
  const dotted = dottedName(call.func)
  if (!dotted) return false
  const parts = dotted.split('.')
  if (parts.length === 1) return bareIsCollect && parts[0] === 'collect'
  if (parts.length !== 2) return false
  return parts[1] === 'collect' && isGcAlias(ctx, parts[0])
}

/**
 * Does this loop body allocate on every pass in a way that suggests the collect
 * was put there on purpose?
 *
 * A list or dict display, an f-string and an `.append()` are the three shapes
 * that fill a heap fast enough for someone to have reached for `gc.collect()`
 * deliberately. When one of them is present the rule stands down completely —
 * that author probably knows exactly what they are doing, and second-guessing
 * them is how a linter gets switched off.
 */
function allocatesEveryPass(loop: Loop): boolean {
  let found = false
  for (const stmt of loop.body) {
    walk(stmt as AnyNode, (n) => {
      if (n.type === 'List' || n.type === 'Dict') {
        found = true
        return false
      }
      if (n.type === 'Constant' && n.kind === 'string' && (n.prefix ?? '').includes('f')) {
        found = true
        return false
      }
      if (n.type === 'Call') {
        const method = dottedName(n.func)?.split('.').pop()
        if (method === 'append') {
          found = true
          return false
        }
      }
      return undefined
    })
    if (found) break
  }
  return found
}

/** Is the statement the only thing on its line, bar a trailing comment? */
function ownsItsLine(ctx: RefactorContext, node: { start: number; end: number }): boolean {
  if (ctx.lines.positionAt(node.start).line !== ctx.lines.positionAt(node.end).line) return false
  if (ctx.src.slice(lineStart(ctx.src, node.start), node.start).trim() !== '') return false
  const tail = ctx.src.slice(node.end, lineEnd(ctx.src, node.end)).replace(/\r?\n$/, '')
  return tail.trim() === '' || tail.trimStart().startsWith('#')
}

export const gcCollectInLoopRule = defineRule<CollectMatch>({
  id: 'gc-collect-in-loop',
  title: 'This gc.collect() is the stall',
  message: 'Collecting every iteration pays for a full heap scan every iteration',
  catalogue: 61,
  category: 'board',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-gc-collect-in-loop',
  // Removing a collect changes when the heap is swept. That is a judgement about
  // the whole program, so it is never batched into "Tidy this file".
  safe: false,
  // On-device advice about the collector on the chip in front of you: no board,
  // no hint.
  requires: () => true,

  detect(ctx: RefactorContext): RefactorMatch<CollectMatch>[] {
    const out: RefactorMatch<CollectMatch>[] = []
    const bareIsCollect = hasBareCollectImport(ctx)

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return undefined
      // A collect guarded by an `if` is not a per-iteration collect, so only
      // statements sitting directly in the loop body count.
      const collects = node.body.filter((s) => isGcCollect(ctx, s, bareIsCollect))
      if (collects.length === 0) return undefined
      // Deleting every statement would leave the loop with no body at all.
      if (node.body.length <= collects.length) return undefined
      if (allocatesEveryPass(node)) return undefined

      const loopKind: 'for' | 'while' = node.type === 'For' ? 'for' : 'while'
      for (const stmt of collects) {
        if (!ownsItsLine(ctx, stmt)) continue
        out.push({
          ruleId: 'gc-collect-in-loop',
          start: stmt.start,
          end: stmt.end,
          message: `This \`${loopKind}\` pays for a full heap scan on every pass — collect in the idle path, or once before the loop, not inside it`,
          data: { stmt, loopKind }
        })
      }
      return undefined
    })

    return out
  },

  apply(match: RefactorMatch<CollectMatch>, ctx: RefactorContext): TextEdit[] | null {
    const range = fullLineRange(ctx.src, match.data.stmt)
    return [{ start: range.start, end: range.end, newText: '' }]
  }
})
