/**
 * Rule 5 — **Extract this deeply nested block** (epic #634 §3.1, §3.8).
 *
 * ```python
 * # before — five levels in, and the line that matters is the hardest to see
 * def log_run(readings, log):
 *     for reading in readings:
 *         if reading.valid:
 *             for sample in reading.samples:
 *                 if sample > LIMIT:
 *                     log.write(sample)
 *
 * # after — the inner test moves out and gets a name
 * def log_run(readings, log):
 *     for reading in readings:
 *         if reading.valid:
 *             record_overshoots(reading, log)
 * ```
 *
 * Every level of indentation is a condition the reader has to keep in their
 * head, and by the fourth one the interesting line is also the least readable.
 * Pulling the inner block out into a named function replaces four remembered
 * conditions with one name.
 *
 * This rule **only points** — it is `hintOnly`. An automatic rewrite would have
 * to invent a function name and work out which locals to pass and return, and
 * getting either wrong changes behaviour, so the choice stays with the person
 * who knows what the block is for. Extract Function (rule 8) is the tool that
 * does the move once they have decided.
 *
 * Depth is counted **locally** rather than with `nestingDepth` from `engine.ts`,
 * for two reasons that both come down to matching what the reader sees:
 *
 * - an `elif` is a peer of its `if`, not a level deeper, even though the AST
 *   nests it inside the parent's `orelse`;
 * - an `except` body sits at the same indentation as its `try` body, so the
 *   handler adds one level between them, not two.
 *
 * Both differences would otherwise invent nesting the file does not have, and a
 * false "this is too deep" is exactly the hint that teaches people to ignore
 * hints.
 */
import type { FunctionDef, IfStmt, Stmt } from '../ast'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface DeepNestingMatch {
  /** The function the offending block sits in. */
  fn: FunctionDef
  /** The outermost statement at (or past) the threshold. */
  stmt: Stmt
  /** How many blocks deep that statement is, counting from the `def`. */
  depth: number
}

/** State threaded through the scan, so the walkers stay short. */
interface Scan {
  ctx: RefactorContext
  threshold: number
  out: RefactorMatch<DeepNestingMatch>[]
  /** Functions already reported — one hint per function, not one per line. */
  reported: Set<FunctionDef>
}

/** Is this `if`'s `else` really an `elif`? */
function hasElif(stmt: IfStmt): boolean {
  return stmt.orelse.length === 1 && stmt.orelse[0].type === 'If' && stmt.orelse[0].isElif
}

/**
 * End of the first line of a statement, with trailing whitespace trimmed. A
 * whole nested block would be a very noisy marker; the header line is enough to
 * point at, and it is what the Problems panel underlines.
 */
function headerEnd(src: string, node: { start: number; end: number }): number {
  const nl = src.indexOf('\n', node.start)
  let end = nl < 0 ? node.end : Math.min(nl, node.end)
  while (end > node.start && /\s/.test(src[end - 1])) end--
  return end
}

/**
 * Walk one statement list at `depth`, reporting the first statement in the
 * enclosing function that has sunk to the threshold.
 *
 * Because this is a pre-order walk, the first qualifying statement in a
 * function is also the outermost and earliest one — exactly the statement whose
 * block a reader would lift out first.
 */
function scanBlock(stmts: readonly Stmt[], depth: number, fn: FunctionDef | null, s: Scan): void {
  for (const stmt of stmts) {
    if (fn && depth >= s.threshold && !s.reported.has(fn)) {
      s.reported.add(fn)
      s.out.push({
        ruleId: 'deep-nesting',
        start: stmt.start,
        end: headerEnd(s.ctx.src, stmt),
        message: `${depth} levels deep — extracting the inner block would flatten this`,
        data: { fn, stmt, depth }
      })
    }
    descend(stmt, depth, fn, s)
  }
}

/** Visit the blocks a statement owns, each at the depth the reader sees. */
function descend(stmt: Stmt, depth: number, fn: FunctionDef | null, s: Scan): void {
  switch (stmt.type) {
    case 'FunctionDef':
      // A nested `def` restarts the count: its body is not "deep", it is a new
      // function that happens to live here.
      scanBlock(stmt.body, 0, stmt, s)
      return
    case 'ClassDef':
      // Statements in a class body are not in a function, so they are never
      // reported; a method inside restarts the count when we reach its `def`.
      scanBlock(stmt.body, 0, null, s)
      return
    case 'If':
      scanBlock(stmt.body, depth + 1, fn, s)
      scanBlock(stmt.orelse, hasElif(stmt) ? depth : depth + 1, fn, s)
      return
    case 'For':
    case 'While':
      scanBlock(stmt.body, depth + 1, fn, s)
      scanBlock(stmt.orelse, depth + 1, fn, s)
      return
    case 'With':
      scanBlock(stmt.body, depth + 1, fn, s)
      return
    case 'Try':
      scanBlock(stmt.body, depth + 1, fn, s)
      for (const handler of stmt.handlers) scanBlock(handler.body, depth + 1, fn, s)
      scanBlock(stmt.orelse, depth + 1, fn, s)
      scanBlock(stmt.finalbody, depth + 1, fn, s)
      return
    default:
      return
  }
}

export const deepNestingRule = defineRule<DeepNestingMatch>({
  id: 'deep-nesting',
  title: 'Extract this deeply nested block',
  message: 'This block is nested deeply — extracting the inner part would flatten it',
  catalogue: 5,
  category: 'control-flow',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-deep-nesting',
  // Not batchable by "Tidy this file": there is no rewrite to batch.
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<DeepNestingMatch>[] {
    const scan: Scan = {
      ctx,
      threshold: Math.max(1, ctx.settings.maxNestingDepth),
      out: [],
      reported: new Set()
    }
    scanBlock(ctx.module.body, 0, null, scan)
    return scan.out
  },

  /**
   * There is no automatic rewrite — naming the extracted function and choosing
   * its parameters is the user's call (§2.6.6). Returning null keeps the hint in
   * the Problems panel and out of "Tidy this file".
   */
  apply(): TextEdit[] | null {
    return null
  }
})
