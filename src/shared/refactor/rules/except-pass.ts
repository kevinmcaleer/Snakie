/**
 * Rule 79 — **Do not silently swallow the error** (epic #634 §3.9).
 *
 * ```python
 * try:
 *     imu.calibrate()
 * except:
 *     pass          # ← the robot now drives on uncalibrated, and nothing said so
 * ```
 *
 * This is the silent-failure half of rule 30. A handler whose entire body is
 * `pass` throws the error away: the sensor never initialised, the file never
 * saved, the I2C device was never there — and the program carries on as though
 * it worked. Debugging that costs an evening, because the one piece of evidence
 * was deleted at the moment it was produced.
 *
 * **Hint only, on purpose.** There are three good fixes and no way to tell from
 * the code which one is meant:
 *
 * - `print("no IMU:", err)` — carry on, but say so;
 * - `raise` — this level cannot handle it, let the caller decide;
 * - handle it properly — fall back to a default, retry, light the error LED.
 *
 * Guessing would be worse than asking, so `apply` returns null and the preview
 * shows the explanation instead of a diff.
 *
 * A handler carrying a comment is left alone: `except OSError:  # display is
 * optional` is a decision someone wrote down, not an oversight.
 */
import type { ExceptHandler } from '../ast'
import type { AnyNode } from '../ast'
import { walk } from '../ast'
import { lineEnd } from '../text'
import type { TextEdit } from '../text'
import { textOf } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface ExceptPassMatch {
  handler: ExceptHandler
}

/** Is there a `#` comment anywhere inside the handler, or trailing its `pass`? */
function isExplained(ctx: RefactorContext, handler: ExceptHandler): boolean {
  const end = lineEnd(ctx.src, handler.end)
  return ctx.comments.some((c) => c.start >= handler.start && c.start < end)
}

export const exceptPassRule = defineRule<ExceptPassMatch>({
  id: 'except-pass',
  title: 'Do not silently swallow the error',
  message: 'This handler throws the error away — log it, re-raise it, or handle it',
  catalogue: 79,
  category: 'functions',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-except-pass',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<ExceptPassMatch>[] {
    const out: RefactorMatch<ExceptPassMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Try') return
      for (const handler of node.handlers) {
        if (handler.body.length !== 1 || handler.body[0].type !== 'Pass') continue
        if (isExplained(ctx, handler)) continue
        const caught = handler.exc ? textOf(ctx, handler.exc) : 'everything'
        out.push({
          ruleId: 'except-pass',
          start: handler.start,
          end: handler.end,
          message: `This handler catches ${caught} and throws it away — log it, re-raise it, or handle it`,
          data: { handler }
        })
      }
    })
    return out
  },

  /**
   * No automatic rewrite: see the note above. The engine drops the offer's diff
   * and shows the "Why?" article, which is the whole point of a hint-only rule.
   */
  apply(): TextEdit[] | null {
    return null
  }
})
