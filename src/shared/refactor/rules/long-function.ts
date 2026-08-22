/**
 * Rule 11 — **This function is long** (epic #634 §3.2).
 *
 * ```python
 * def run():                       def run():
 *     # --- set up the pins ---        pins = setup_pins()
 *     ...  18 lines ...               calibrate(pins)
 *     # --- calibrate ---              drive_loop(pins)
 *     ...  22 lines ...
 *     # --- drive ---
 *     ...  28 lines ...
 * ```
 *
 * Length on its own is not a bug, and this rule is careful not to pretend it is.
 * What a long function costs you is *working memory*: to change line 60 you have
 * to hold what lines 1–59 did to every variable still in play. A function you can
 * see all of at once is one you can reason about without a notebook.
 *
 * The useful part of the hint is not the number, it is **where the seams are**.
 * A function that has grown past forty lines has almost always already been
 * divided by its author — with a blank line, or with a `# ---- calibrate ----`
 * heading. Those are the author telling you where the parts start, and each part
 * is usually a function with a name waiting to be given to it. So the message
 * counts them and says so.
 *
 * **Hint only.** Cutting a function up means choosing what each half is called
 * and which locals cross the boundary, and getting either wrong changes
 * behaviour — that is Extract Function's job (rule 8), driven by a human who
 * knows what the block is *for*. `apply` returns null, so this never lands in
 * "Tidy this file". The threshold is `settings.longFunctionLines`, so a person
 * who disagrees with forty can say so instead of learning to ignore the hint.
 */
import type { AnyNode, FunctionDef } from '../ast'
import { walk } from '../ast'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface LongFunctionMatch {
  fn: FunctionDef
  /** Lines from the `def` to the last line of the body, inclusive. */
  length: number
  /** Own-line `#` comments inside the body — the author's own headings. */
  headings: number
  /** Blank-line-separated groups of top-level statements in the body. */
  groups: number
}

/**
 * End of the `def` line, trailing whitespace trimmed. Underlining the whole
 * function would light up half the file; the header is what the Problems panel
 * should point at.
 */
function headerEnd(src: string, fn: FunctionDef): number {
  const nl = src.indexOf('\n', fn.defStart)
  let end = nl < 0 ? fn.end : Math.min(nl, fn.end)
  while (end > fn.defStart && /\s/.test(src[end - 1])) end--
  return end
}

/**
 * Own-line comments sitting inside the function. Counted from the `def` keyword
 * rather than from the first statement, because the heading a person writes for
 * the first section usually sits above it — between the header and the body.
 */
function headingsIn(ctx: RefactorContext, fn: FunctionDef): number {
  return ctx.comments.filter((c) => c.ownLine && c.start > fn.defStart && c.end <= fn.end).length
}

/** How many blank-line-separated runs the body's top-level statements fall into. */
function groupsIn(ctx: RefactorContext, fn: FunctionDef): number {
  if (fn.body.length === 0) return 0
  let groups = 1
  for (let i = 1; i < fn.body.length; i++) {
    const between = ctx.src.slice(fn.body[i - 1].end, fn.body[i].start)
    if (/\n[ \t]*\r?\n/.test(between)) groups++
  }
  return groups
}

/** The half of the message that points at the seams, when there are any. */
function seamAdvice(headings: number, groups: number): string {
  if (headings >= 2) {
    return `there are ${headings} comment headings inside it that look like seams`
  }
  if (groups >= 3) {
    return `it falls into ${groups} blank-line-separated groups that look like seams`
  }
  return 'naming its parts would say more than re-reading them'
}

export const longFunctionRule = defineRule<LongFunctionMatch>({
  id: 'long-function',
  title: 'This function is long',
  message: 'This function is long enough that its parts are hard to hold in your head at once',
  catalogue: 11,
  category: 'extraction',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-long-function',
  // Nothing to batch: there is no rewrite.
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<LongFunctionMatch>[] {
    const threshold = Math.max(1, ctx.settings.longFunctionLines)
    const out: RefactorMatch<LongFunctionMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return
      // Measured from the `def` rather than from `start`, so a stack of
      // decorators is not counted against the body's length.
      const firstLine = ctx.lines.positionAt(node.defStart).line
      const lastLine = ctx.lines.positionAt(node.end).line
      const length = lastLine - firstLine + 1
      if (length <= threshold) return

      const headings = headingsIn(ctx, node)
      const groups = groupsIn(ctx, node)
      out.push({
        ruleId: 'long-function',
        start: node.defStart,
        end: headerEnd(ctx.src, node),
        message: `${length} lines — ${seamAdvice(headings, groups)}`,
        data: { fn: node, length, headings, groups }
      })
    })

    return out
  },

  /**
   * Where to cut, what each half is called and which locals cross the boundary
   * are the author's decisions (§2.6.6). The hint points; Extract Function
   * (rule 8) does the move.
   */
  apply(): TextEdit[] | null {
    return null
  }
})
