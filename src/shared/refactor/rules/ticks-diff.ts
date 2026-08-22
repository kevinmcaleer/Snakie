/**
 * Rule 80 — **Use ticks_diff for the elapsed time** (epic #634 §3.8, MicroPython).
 *
 * ```python
 * # before                              # after
 * start = ticks_ms()                    start = ticks_ms()
 * while ticks_ms() - start < 500:       while ticks_diff(ticks_ms(), start) < 500:
 *     poll_sensors()                        poll_sensors()
 * ```
 *
 * Why it matters: **tick counters wrap.** `ticks_ms()` and friends do not return
 * a time, they return a counter that counts up to a port-defined ceiling and then
 * starts again from zero — on many ports `ticks_us()` wraps roughly every 17
 * minutes and `ticks_ms()` roughly every 12 days. Subtracting two of them with a
 * plain `-` is only right while no wrap falls between the two readings. When one
 * does, the subtraction goes hugely negative, and the timer built on it either
 * fires on every single pass forever or never fires again — a robot that stops
 * responding, or a "debounce" that stops debouncing.
 *
 * `ticks_diff(new, old)` exists precisely for this: it is defined to compute the
 * signed difference correctly across the wrap. It is also the only supported way
 * to compare two tick values at all — the MicroPython docs are explicit that the
 * values are opaque and arithmetic on them is not portable.
 *
 * This is a latent field bug, not a style nit: it cannot show up on the bench,
 * because the bench session is shorter than the wrap. Hence `severity: 'warning'`.
 *
 * The rewrite keeps whichever spelling the file already uses — `time.ticks_ms()`
 * becomes `time.ticks_diff(…)`, a bare `ticks_ms()` becomes a bare
 * `ticks_diff(…)` — and when the bare form is used but `ticks_diff` was never
 * imported it is added to the `from time import …` line the tick function itself
 * came from. If the file already means something else by the name `ticks_diff`,
 * or the bare name cannot be traced to a `time`/`utime` import at all, `apply`
 * declines: the warning still stands, but we will not call a function we cannot
 * prove exists.
 */
import type { AnyNode, BinOp, Call, Expr, ImportFrom } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import { namesWritten } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** The tick counters whose values are opaque and wrap. */
const TICKS_FUNCS = new Set(['ticks_ms', 'ticks_us', 'ticks_cpu'])

/** Modules that provide the tick counters, under either MicroPython spelling. */
const TIME_MODULES = ['time', 'utime']

/** The wrap-safe subtraction the rewrite calls. */
const TICKS_DIFF = 'ticks_diff'

/** A resolved `ticks_*()` call: which counter, and how the file spells it. */
interface TicksCall {
  call: Call
  /** `ticks_ms`, `ticks_us` or `ticks_cpu`. */
  func: string
  /** The module name as written (`time`, `utime`, an alias), or null when bare. */
  prefix: string | null
}

interface TicksMatch {
  /** The raw `A - B` subtraction to replace. */
  node: BinOp
  ticks: TicksCall
}

/** How to reach `ticks_diff` from this file, and whether an import must grow. */
interface DiffAccess {
  /** The text to call, e.g. `time.ticks_diff` or `ticks_diff`. */
  callee: string
  /** The `from time import …` statement to extend, or null when none is needed. */
  extend: ImportFrom | null
}

/** Is `name` bound to `time`/`utime` by an `import` in this file? */
function isTimeModuleAlias(ctx: RefactorContext, name: string): boolean {
  // The plain spellings are accepted outright: a file that says `time.ticks_ms()`
  // means the time module even if the import sits in a package `__init__`.
  if (TIME_MODULES.includes(name)) return true
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Import') return
    for (const alias of node.names) {
      if ((alias.asname ?? alias.name.split('.')[0]) === name && TIME_MODULES.includes(alias.name)) {
        found = true
      }
    }
  })
  return found
}

/**
 * Resolve an expression to a tick-counter call, or null.
 *
 * A tick counter takes no arguments, so anything with an argument list is
 * something else wearing the same name and is left alone.
 */
function resolveTicksCall(ctx: RefactorContext, expr: Expr): TicksCall | null {
  const e = unwrap(expr)
  if (e.type !== 'Call') return null
  if (e.args.length > 0 || e.keywords.length > 0) return null
  const dotted = dottedName(e.func)
  if (!dotted) return null
  const parts = dotted.split('.')
  if (parts.length === 1) {
    return TICKS_FUNCS.has(parts[0]) ? { call: e, func: parts[0], prefix: null } : null
  }
  if (parts.length === 2 && TICKS_FUNCS.has(parts[1]) && isTimeModuleAlias(ctx, parts[0])) {
    return { call: e, func: parts[1], prefix: parts[0] }
  }
  return null
}

/** Every `from time import …` / `from utime import …` in the file, in order. */
function timeImports(ctx: RefactorContext): ImportFrom[] {
  const out: ImportFrom[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom') return
    if (node.level !== 0 || !node.module || !TIME_MODULES.includes(node.module)) return
    out.push(node)
  })
  return out
}

/**
 * Work out how this file can call `ticks_diff`.
 *
 * For a dotted call the answer is always the module the counter came from. For a
 * bare call we need a bare name, which means one of: already imported (possibly
 * under an `as` name), brought in by a star import, or added to the very import
 * the counter came from. Anything else — including a file that already binds
 * `ticks_diff` to something of its own — returns null so `apply` declines.
 */
function diffAccess(ctx: RefactorContext, ticks: TicksCall): DiffAccess | null {
  if (ticks.prefix) return { callee: `${ticks.prefix}.${TICKS_DIFF}`, extend: null }

  const imports = timeImports(ctx)
  for (const imp of imports) {
    // `from time import *` brings `ticks_diff` in with everything else.
    if (imp.isStar) return { callee: TICKS_DIFF, extend: null }
    for (const alias of imp.names) {
      if (alias.name === TICKS_DIFF) return { callee: alias.asname ?? TICKS_DIFF, extend: null }
    }
  }

  // Not imported yet, so the rewrite would introduce the name. Refuse if the
  // file already means something else by it — a helper of the same name is
  // exactly the trap this rule must not walk into.
  if (namesWritten([...ctx.module.body]).has(TICKS_DIFF)) return null

  // Extend the import the counter itself came from, so the two names stay
  // together. The alias must be un-renamed, or the bare call we matched is not
  // the one that import bound.
  for (const imp of imports) {
    if (imp.names.some((a) => a.name === ticks.func && !a.asname)) {
      return { callee: TICKS_DIFF, extend: imp }
    }
  }
  return null
}

/**
 * An insertion anchored on one real character.
 *
 * Two matches in the same file both want `ticks_diff` on the same import line.
 * A zero-width insert cannot overlap another zero-width insert at the same
 * offset, so a batch would happily add the name twice. Widening the edit by the
 * neighbouring character (and putting it back) makes the engine see the clash,
 * keep the first and re-offer the rest on the next pass — by which time the
 * import already has the name and no second edit is produced.
 */
function anchoredInsert(src: string, at: number, text: string): TextEdit {
  return { start: at - 1, end: at, newText: src[at - 1] + text }
}

export const ticksDiffRule = defineRule<TicksMatch>({
  id: 'ticks-diff',
  title: 'Use ticks_diff for the elapsed time',
  message: 'Tick counters wrap — subtracting them directly breaks the timer',
  catalogue: 80,
  category: 'micropython',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-ticks-diff',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<TicksMatch>[] {
    const out: RefactorMatch<TicksMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'BinOp' || node.op !== '-') return
      // Only a counter on the LEFT is unambiguously "now minus then". A
      // `deadline - ticks_ms()` is the same hazard, but which way round the
      // arguments go is then a guess, and a wrong guess flips the sign.
      const ticks = resolveTicksCall(ctx, node.left)
      if (!ticks) return
      out.push({
        ruleId: 'ticks-diff',
        start: node.start,
        end: node.end,
        message: `\`${ticks.func}()\` wraps — use \`${TICKS_DIFF}()\` so the elapsed time survives the wrap`,
        data: { node, ticks }
      })
    })
    return out
  },

  apply(match: RefactorMatch<TicksMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { node, ticks } = match.data
    const access = diffAccess(ctx, ticks)
    // No name we can prove resolves to the real `ticks_diff`. The warning stays;
    // only the automatic fix stands down.
    if (!access) return null

    const left = textOf(ctx, node.left).trim()
    const right = textOf(ctx, node.right).trim()
    if (!left || !right) return null

    const edits: TextEdit[] = [
      { start: node.start, end: node.end, newText: `${access.callee}(${left}, ${right})` }
    ]

    if (access.extend) {
      const last = access.extend.names[access.extend.names.length - 1]
      if (!last || last.end <= 0 || last.end > ctx.src.length) return null
      const insert = anchoredInsert(ctx.src, last.end, `, ${TICKS_DIFF}`)
      // An import line and an expression can never overlap, but a malformed
      // range would corrupt the file, so prove it rather than assume it.
      if (insert.start < node.end && node.start < insert.end) return null
      edits.push(insert)
    }

    return edits
  }
})
