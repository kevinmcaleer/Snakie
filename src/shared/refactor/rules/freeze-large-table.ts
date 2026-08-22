/**
 * Rule 62 — **This board does not have room for that table** (epic #634 §3.7).
 *
 * ```python
 * # A 256-entry gamma table at module scope…
 * GAMMA = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, ...]
 *
 * # …on a board reporting 41 KB free is a meaningful fraction of what is left.
 * ```
 *
 * Why it matters: a literal at module scope is *built at import time* and stays
 * on the heap for as long as the program runs. On a desktop nobody notices. On a
 * board with 41 KB free, a 256-element list of small integers is roughly 2 KB of
 * pointers plus the boxed integers behind them — and it is there whether or not
 * the program is currently using it.
 *
 * This is the same smell as the plain large-table hint, escalated because Snakie
 * has *asked your board* how much heap is actually left and the answer was not
 * much. That is the difference between "this is a bit big" and "this is a bit
 * big and you have 41 KB" — the second is actionable and the first is noise,
 * which is why this one waits for a real measurement before it speaks.
 *
 * Three ways out, roughly in order of effort:
 *
 * - **`bytes` instead of a list.** If every value fits in a byte, `b'\x00\x01…'`
 *   is one object of exactly N bytes with no per-element boxing. Indexing it
 *   gives you an `int` back, so most code needs no other change.
 * - **`array.array`** for wider values — 2 or 4 bytes each, still unboxed.
 * - **Move it out of RAM entirely** — read it from a file on demand, or freeze
 *   the module into the firmware as frozen bytecode, where the table lives in
 *   flash and is never copied to the heap at all.
 *
 * Snakie only points, because which of those is right depends on what the values
 * mean and how often you read them, and getting that wrong trades a memory
 * problem for a speed one.
 */
import type { Expr, Stmt } from '../ast'
import { textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface FreezeTableMatch {
  name: string
  elements: number
  bytes: number
}

/** Free heap (bytes) below which a big table is worth mentioning. */
const TIGHT_HEAP = 64 * 1024

/** Elements before a literal counts as a table. */
const BIG_TABLE = 32

/** Element count of a list/tuple/dict/set display, or null if it is not one. */
function displaySize(expr: Expr): number | null {
  switch (expr.type) {
    case 'List':
    case 'Tuple':
    case 'Set':
      return expr.elts.length
    case 'Dict':
      return expr.values.length
    default:
      return null
  }
}

export const freezeLargeTableRule = defineRule<FreezeTableMatch>({
  id: 'freeze-large-table',
  title: 'This table is large for the RAM this board has left',
  message: 'A module-level table this size is a real fraction of your free heap',
  catalogue: 62,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-freeze-large-table',
  safe: false,
  hintOnly: true,
  // Probe-informed: only worth saying when we have measured the heap and it is
  // genuinely tight. A generous board gets the plain large-table hint instead.
  requires: (caps) => caps.memFree > 0 && caps.memFree < TIGHT_HEAP,

  detect(ctx: RefactorContext): RefactorMatch<FreezeTableMatch>[] {
    const free = ctx.capabilities?.memFree ?? 0
    const out: RefactorMatch<FreezeTableMatch>[] = []
    for (const stmt of ctx.module.body as Stmt[]) {
      if (stmt.type !== 'Assign' || stmt.targets.length !== 1) continue
      const target = stmt.targets[0]
      if (target.type !== 'Name') continue
      const size = displaySize(stmt.value)
      if (size == null || size < BIG_TABLE) continue

      const bytes = textOf(ctx, stmt.value).length
      const hedge = ctx.capabilities?.inferred ? ' (your board probably reports)' : ''
      out.push({
        ruleId: 'freeze-large-table',
        start: stmt.start,
        end: stmt.value.end,
        message:
          `\`${target.id}\` holds ${size} items at module scope, and this board has ` +
          `${Math.round(free / 1024)} KB free${hedge} — bytes, array.array, or a file would cost far less`,
        data: { name: target.id, elements: size, bytes }
      })
    }
    return out
  },

  apply(): TextEdit[] | null {
    return null
  }
})

/** Exported so the tests share one definition of "tight heap" and "big table". */
export const _thresholds = { TIGHT_HEAP, BIG_TABLE }
