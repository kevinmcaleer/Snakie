/**
 * Rule 15 — **Split the boolean flag into two functions** (epic #634 §3.8).
 *
 * ```python
 * def draw_status(display, battery, verbose=True):
 *     if verbose:
 *         display.text("battery {}%".format(battery), 0, 0)
 *         display.text("mode: manual", 0, 10)
 *     else:
 *         display.text("{}%".format(battery), 0, 0)
 * ```
 *
 * A boolean parameter that picks between two behaviours means the function is
 * really two functions wearing one name, and the call site pays for it:
 * `draw_status(oled, level, False)` tells the reader nothing at all. Splitting
 * it — `draw_status(oled, level)` and `draw_status_compact(oled, level)` — puts
 * the choice in the name, deletes the branch, and makes each half easy to test
 * on its own. (Where a split really is wrong, a keyword-only argument at least
 * forces the call site to say `verbose=False` out loud.)
 *
 * This one is **hint only**: which half keeps the original name, what the other
 * is called, and how the shared setup is divided are all judgement calls about
 * *this* program, and every caller has to move with it. `apply` returns null —
 * the panel shows the explanation and the "Why?" article, never a diff.
 */
import type { AnyNode, FunctionDef, IfStmt, Param } from '../ast'
import { unwrap, walk } from '../ast'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface BooleanTrapMatch {
  fn: FunctionDef
  param: Param
  ifStmt: IfStmt
}

/** Parameters that can carry a default value at all. */
const VALUE_PARAMS = new Set(['normal', 'kwarg'])

/** Does this parameter default to `True` or `False`? */
function isBooleanFlag(param: Param): boolean {
  if (!VALUE_PARAMS.has(param.kind) || !param.default) return false
  const value = unwrap(param.default)
  return value.type === 'Constant' && value.kind === 'bool'
}

/**
 * The `if <flag>:` … `else:` inside `fn` that branches on `name`, or null.
 *
 * Nested `def`s, `lambda`s and classes are skipped: a parameter of the same name
 * in there is a different variable, and flagging the outer function for it would
 * be a false positive.
 */
function branchOnFlag(fn: FunctionDef, name: string): IfStmt | null {
  const hits: IfStmt[] = []
  for (const stmt of fn.body) {
    walk(stmt, (node) => {
      if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
        return false
      }
      if (node.type !== 'If') return undefined
      // Only the bare `if flag:` shape — `if flag and ready:` is a condition
      // about two things, not a switch between two functions.
      const test = unwrap(node.test)
      if (test.type !== 'Name' || test.id !== name) return undefined
      // Without an `else` there is one behaviour plus an extra, which a caller
      // can read; with one, the name covers two different jobs.
      if (node.orelse.length === 0) return undefined
      // An `elif` chain — on either side of this branch — is a three-way choice
      // on more than the flag alone, so splitting in two is no longer obviously
      // the right answer.
      if (node.isElif) return undefined
      if (node.orelse.length === 1 && node.orelse[0].type === 'If' && node.orelse[0].isElif) {
        return undefined
      }
      hits.push(node)
      return undefined
    })
    if (hits.length > 0) break
  }
  return hits.length > 0 ? hits[0] : null
}

export const booleanParameterTrapRule = defineRule<BooleanTrapMatch>({
  id: 'boolean-parameter-trap',
  title: 'Split the boolean flag into two functions',
  message: 'A boolean parameter that switches behaviour hides what the call site does',
  catalogue: 15,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-boolean-parameter-trap',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<BooleanTrapMatch>[] {
    const out: RefactorMatch<BooleanTrapMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return
      for (const param of node.params) {
        if (!isBooleanFlag(param)) continue
        const ifStmt = branchOnFlag(node, param.name)
        if (!ifStmt) continue
        out.push({
          ruleId: 'boolean-parameter-trap',
          // Point at the parameter: that is the thing to change, and it keeps
          // the marker off the body the reader is trying to read.
          start: param.start,
          end: param.end,
          message: `\`${param.name}\` picks between two behaviours — \`${node.name}\` is really two functions`,
          data: { fn: node, param, ifStmt }
        })
      }
    })
    return out
  },

  apply(): TextEdit[] | null {
    // Hint only (§3.8): splitting the function is a judgement call about this
    // program, and every caller has to move with it. We explain; you decide.
    return null
  }
})
