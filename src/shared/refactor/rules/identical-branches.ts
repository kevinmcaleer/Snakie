/**
 * Rule 67 — **Collapse the identical branches** (epic #634 §3.8).
 *
 * ```python
 * # before
 * def pick_gear(load, gearbox):
 *     if load > 0.75:
 *         gearbox.select("low")
 *         gearbox.engage()
 *     else:
 *         gearbox.select("low")
 *         gearbox.engage()
 *
 * # after
 * def pick_gear(load, gearbox):
 *     gearbox.select("low")
 *     gearbox.engage()
 * ```
 *
 * Both branches do the same thing, so the test decides nothing. This is
 * `warning` rather than `hint` because it is nearly always the fossil of a
 * copy-paste: the `else` was meant to say `"high"` and never got edited. Seeing
 * the two branches side by side as one block is what makes that obvious — and
 * if the collapse looks wrong, the branch that was supposed to differ has just
 * been found.
 *
 * The rule declines rather than guesses when:
 *
 * - the condition is not pure — dropping `if sensor.read() > 100:` would skip a
 *   hardware read, and a rewrite that quietly stops talking to a device is
 *   exactly the kind of "fix" that costs the feature its trust;
 * - the `if` is part of an `elif` chain, in either direction — collapsing a
 *   branch out of the middle of a chain is a different (and much fiddlier)
 *   rewrite;
 * - a comment sits in the replaced range but outside the kept block, so
 *   collapsing would delete it. Comments *inside* the two blocks are safe:
 *   the blocks are byte-identical, so every comment that goes has an identical
 *   twin that stays;
 * - the block contains a multi-line string, whose contents would change when
 *   the block is dedented.
 */
import type { IfStmt, Stmt } from '../ast'
import type { AnyNode } from '../ast'
import { walk } from '../ast'
import { dedent, lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { isPureExpression } from '../expr'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface IdenticalBranchesMatch {
  ifStmt: IfStmt
}

/** The spans a collapse would replace and keep. */
interface Regions {
  /** Start of the `if` line — everything from here to `ifStmt.end` goes. */
  replaceStart: number
  /** Start of the first line of the `if` body — this block is what stays. */
  bodyStart: number
  /** End of the last statement of the `if` body. */
  bodyEnd: number
  /** Start of the first line of the `else` body. */
  elseStart: number
  /** End of the last statement of the `else` body. */
  elseEnd: number
}

/** Does any statement in `stmts` hold a string literal spanning several lines? */
function hasMultilineString(stmts: readonly Stmt[]): boolean {
  let found = false
  for (const stmt of stmts) {
    walk(stmt as AnyNode, (n) => {
      if (n.type === 'Constant' && n.kind === 'string' && n.raw.includes('\n')) found = true
    })
  }
  return found
}

/**
 * Work out the two branch blocks and prove the collapse is safe, or return
 * null. Shared by `detect` and `apply` so the menu never offers something
 * `apply` would then refuse.
 */
function regionsFor(ctx: RefactorContext, ifStmt: IfStmt): Regions | null {
  const src = ctx.src
  const body = ifStmt.body
  const orelse = ifStmt.orelse
  if (body.length === 0 || orelse.length === 0 || ifStmt.orelseStart == null) return null

  // An `elif` — in either direction — is a chain, not a two-way choice.
  if (ifStmt.isElif) return null
  if (orelse.length === 1 && orelse[0].type === 'If' && orelse[0].isElif) return null

  // Dropping the test must not drop a side effect with it.
  if (!isPureExpression(ifStmt.test)) return null

  const lineOf = (offset: number): number => ctx.lines.positionAt(offset).line
  // A one-liner (`if x: blink()`) has no indented block to keep.
  if (lineOf(ifStmt.start) === lineOf(body[0].start)) return null
  if (lineOf(ifStmt.orelseStart) === lineOf(orelse[0].start)) return null

  const replaceStart = lineStart(src, ifStmt.start)
  if (!/^[ \t]*$/.test(src.slice(replaceStart, ifStmt.start))) return null

  // Each block starts on the line after its header, so a comment sitting
  // between the header and the first statement travels with the block.
  const bodyStart = lineEnd(src, ifStmt.test.end)
  const elseStart = lineEnd(src, ifStmt.orelseStart)
  const bodyEnd = body[body.length - 1].end
  const elseEnd = orelse[orelse.length - 1].end
  if (bodyStart > body[0].start || elseStart > orelse[0].start) return null
  if (bodyEnd <= bodyStart || elseEnd <= elseStart) return null
  // Prove that what we skipped really is just the header, so no fragment of it
  // can end up inside the block we keep.
  if (!/^\s*:\s*$/.test(src.slice(ifStmt.test.end, bodyStart))) return null
  if (!/^else\s*:\s*$/.test(src.slice(ifStmt.orelseStart, elseStart))) return null

  // The whole test: identical once each block loses its own level of indent.
  const unit = ctx.indentUnit
  if (dedent(src.slice(bodyStart, bodyEnd), unit) !== dedent(src.slice(elseStart, elseEnd), unit)) {
    return null
  }

  // Dedenting a block also dedents the inside of any triple-quoted string in it.
  if (hasMultilineString(body)) return null

  // Every comment in the replaced range must be one we keep, or one that has an
  // identical twin in the block we keep — the two blocks being byte-identical is
  // what makes the second case true. A comment on a header line, or between the
  // branches, is neither: decline instead of deleting it.
  for (const comment of ctx.comments) {
    if (comment.end <= replaceStart || comment.start >= ifStmt.end) continue
    if (comment.start >= bodyStart && comment.end <= bodyEnd) continue
    if (comment.start >= elseStart && comment.end <= elseEnd) continue
    return null
  }

  return { replaceStart, bodyStart, bodyEnd, elseStart, elseEnd }
}

export const identicalBranchesRule = defineRule<IdenticalBranchesMatch>({
  id: 'identical-branches',
  title: 'Collapse the identical branches',
  message: 'Both branches run exactly the same code — the test decides nothing',
  catalogue: 67,
  category: 'control-flow',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-identical-branches',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<IdenticalBranchesMatch>[] {
    const out: RefactorMatch<IdenticalBranchesMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'If') return
      if (!regionsFor(ctx, node)) return
      out.push({
        ruleId: 'identical-branches',
        start: node.start,
        end: node.end,
        data: { ifStmt: node }
      })
    })
    return out
  },

  apply(match: RefactorMatch<IdenticalBranchesMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { ifStmt } = match.data
    const regions = regionsFor(ctx, ifStmt)
    if (!regions) return null
    // The kept block ends at the last statement, not at the end of its line, so
    // anything trailing the `if` on that last line survives untouched.
    const kept = ctx.src.slice(regions.bodyStart, regions.bodyEnd)
    return [
      {
        start: regions.replaceStart,
        end: ifStmt.end,
        newText: dedent(kept, ctx.indentUnit)
      }
    ]
  }
})
