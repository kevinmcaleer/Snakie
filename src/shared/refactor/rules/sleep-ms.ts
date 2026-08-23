/**
 * Rule 81 — **Use sleep_ms with an integer** (epic #634 §3.8, MicroPython).
 *
 * ```python
 * # before                        # after
 * led.on()                        led.on()
 * time.sleep(0.1)                 time.sleep_ms(100)
 * led.off()                       led.off()
 * time.sleep(0.25)                time.sleep_ms(250)
 * ```
 *
 * Why it matters: `0.1` is a *float*, and on a microcontroller a float is not
 * free. Most MicroPython targets have no floating-point unit, so every float is
 * a heap-allocated object and every sum on it is a software routine — and
 * `time.sleep()` then has to convert it back into the integer milliseconds the
 * scheduler actually wants. `sleep_ms(100)` skips all of that: one small int, no
 * allocation, no soft-float maths.
 *
 * Portability is the sharper edge. The MicroPython docs are explicit that
 * `time.sleep()` with a *fractional* argument is not supported on every port —
 * on some it truncates to whole seconds, so `sleep(0.1)` becomes `sleep(0)` and
 * a carefully paced motor ramp turns into a blur. `sleep_ms()` and `sleep_us()`
 * are the portable spelling and exist everywhere MicroPython does.
 *
 * And it reads better: `sleep_ms(250)` states the unit that the rest of the file
 * is already using for its timeouts and periods.
 *
 * The rewrite is deliberately narrow. It fires only on a float literal that is a
 * whole number of milliseconds — `0.0005` is 500 µs and `sleep_us()` is the
 * right answer there, which is a different call with a different argument, so we
 * leave it alone. An integer `sleep(1)` is left alone too: it costs one small
 * int either way and reads perfectly well as seconds. A bare `sleep(…)` is only
 * touched when it can be traced to a `from time import sleep` — `asyncio` binds
 * a coroutine to exactly that name, and rewriting *that* would be a disaster.
 */
import type { AnyNode, Call, Expr, ImportFrom } from '../ast'
import { ancestors, unwrap, walk } from '../ast'
import { dottedName, literalNumber } from '../expr'
import { namesWritten } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** Modules whose `sleep()` takes seconds. */
const TIME_MODULES = ['time', 'utime']

/** The millisecond sleep we rewrite to. */
const SLEEP_MS = 'sleep_ms'

/** Milliseconds we will not rewrite past — beyond this the units stop helping. */
const MAX_MS = 86_400_000

interface SleepMsMatch {
  call: Call
  /** The float literal argument. */
  arg: Expr
  /** Whole milliseconds the literal is worth. */
  ms: number
  /** The module name as written, or null for a bare `sleep(…)`. */
  prefix: string | null
}

/** How to reach `sleep_ms` from this file, and whether an import must grow. */
interface SleepMsAccess {
  callee: string
  extend: ImportFrom | null
}

/** Is `name` bound to `time`/`utime` by an `import` in this file? */
function isTimeModuleAlias(ctx: RefactorContext, name: string): boolean {
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

/** Is there a `from <something-else> import *` that could be binding names? */
function hasForeignStarImport(ctx: RefactorContext): boolean {
  let found = false
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom' || !node.isStar) return
    if (node.level !== 0 || !node.module || !TIME_MODULES.includes(node.module)) found = true
  })
  return found
}

/**
 * The `from time import sleep` that bound a bare `sleep`, or null.
 *
 * Null covers every case where the bare name might be something else: an
 * `asyncio` import, a hand-written `def sleep(seconds)`, a wildcard import from
 * another module, or two imports fighting over the name. Rewriting a coroutine
 * into `sleep_ms()` would hang the event loop, so this stays strict.
 */
function bareSleepImport(ctx: RefactorContext): ImportFrom | null {
  if (hasForeignStarImport(ctx)) return null
  // Exactly one module-level binding of the name, or we cannot tell which wins.
  let bindings = 0
  for (const use of namesWritten([...ctx.module.body])) {
    if (use === 'sleep') bindings++
  }
  if (bindings !== 1) return null
  for (const imp of timeImports(ctx)) {
    if (imp.names.some((a) => a.name === 'sleep' && !a.asname)) return imp
  }
  return null
}

/** Resolve a call to a blocking `time.sleep(…)`, or null. */
function resolveSleep(ctx: RefactorContext, call: Call): { prefix: string | null } | null {
  const dotted = dottedName(call.func)
  if (!dotted) return null
  const parts = dotted.split('.')
  if (parts.length === 2 && parts[1] === 'sleep' && isTimeModuleAlias(ctx, parts[0])) {
    return { prefix: parts[0] }
  }
  if (parts.length === 1 && parts[0] === 'sleep' && bareSleepImport(ctx)) return { prefix: null }
  return null
}

/**
 * Is this literal written as a float? `0.5` and `5e-3` are; `1`, `0x20` and a
 * negated `-0.5` (a UnaryOp, not a Constant) are not.
 */
function isFloatLiteral(expr: Expr): boolean {
  const e = unwrap(expr)
  if (e.type !== 'Constant' || e.kind !== 'number') return false
  const raw = e.raw.replace(/_/g, '')
  if (/^0[xXoObB]/.test(raw)) return false
  if (/[jJ]$/.test(raw)) return false
  return raw.includes('.') || /[eE]/.test(raw)
}

/** The whole milliseconds a float literal is worth, or null if it is not whole. */
function wholeMilliseconds(expr: Expr): number | null {
  if (!isFloatLiteral(expr)) return null
  const seconds = literalNumber(expr)
  if (seconds == null) return null
  const ms = seconds * 1000
  const rounded = Math.round(ms)
  // Binary floats never land exactly on 100 for 0.1, so compare with a
  // tolerance far tighter than the sub-millisecond values we mean to exclude.
  if (Math.abs(ms - rounded) > 1e-6) return null
  if (rounded < 1 || rounded > MAX_MS) return null
  return rounded
}

/** A single plain positional argument — no `*args`, no keywords. */
function lonePositionalArg(call: Call): Expr | null {
  if (call.args.length !== 1 || call.keywords.length > 0) return null
  const only = call.args[0]
  return only.type === 'Starred' ? null : only
}

/** Work out how this file can call `sleep_ms`. */
function sleepMsAccess(ctx: RefactorContext, prefix: string | null): SleepMsAccess | null {
  if (prefix) return { callee: `${prefix}.${SLEEP_MS}`, extend: null }

  const imports = timeImports(ctx)
  for (const imp of imports) {
    if (imp.isStar) return { callee: SLEEP_MS, extend: null }
    for (const alias of imp.names) {
      if (alias.name === SLEEP_MS) return { callee: alias.asname ?? SLEEP_MS, extend: null }
    }
  }
  // We would be introducing the name, so refuse if the file already uses it.
  if (namesWritten([...ctx.module.body]).has(SLEEP_MS)) return null
  const home = bareSleepImport(ctx)
  return home ? { callee: SLEEP_MS, extend: home } : null
}

/**
 * An insertion anchored on one real character, so that two rewrites in the same
 * file cannot both add `sleep_ms` to the same import line. See the same trick in
 * `const-wrap`: the widened range makes the engine spot the clash, keep the
 * first edit and re-offer the rest once the import is already there.
 */
function anchoredInsert(src: string, at: number, text: string): TextEdit {
  return { start: at - 1, end: at, newText: src[at - 1] + text }
}

export const sleepMsRule = defineRule<SleepMsMatch>({
  id: 'sleep-ms',
  title: 'Use sleep_ms with an integer',
  message: 'A fractional `sleep()` costs a float and is not portable — `sleep_ms()` is',
  catalogue: 81,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-sleep-ms',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<SleepMsMatch>[] {
    const out: RefactorMatch<SleepMsMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Call') return
      // `await sleep(0.5)` is a coroutine by definition — never ours to touch.
      if (ancestors(node).some((a) => a.type === 'Await')) return
      const sleep = resolveSleep(ctx, node)
      if (!sleep) return
      const arg = lonePositionalArg(node)
      if (!arg) return
      const ms = wholeMilliseconds(arg)
      if (ms == null) return

      out.push({
        ruleId: 'sleep-ms',
        start: node.start,
        end: node.end,
        message: `\`sleep(${literalNumber(arg)})\` is a float — \`${SLEEP_MS}(${ms})\` is the portable, allocation-free spelling`,
        data: { call: node, arg, ms, prefix: sleep.prefix }
      })
    })
    return out
  },

  apply(match: RefactorMatch<SleepMsMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { call, arg, ms, prefix } = match.data
    const access = sleepMsAccess(ctx, prefix)
    // No name we can prove reaches the real `sleep_ms`, so decline rather than
    // invent one.
    if (!access) return null

    const edits: TextEdit[] = [
      // Replace the callee and the argument separately, so anything the author
      // wrote between them — spacing, a trailing comment — survives untouched.
      { start: call.func.start, end: call.func.end, newText: access.callee },
      { start: arg.start, end: arg.end, newText: String(ms) }
    ]

    if (access.extend) {
      const last = access.extend.names[access.extend.names.length - 1]
      if (!last || last.end <= 0 || last.end > ctx.src.length) return null
      const insert = anchoredInsert(ctx.src, last.end, `, ${SLEEP_MS}`)
      if (insert.start < call.end && call.start < insert.end) return null
      edits.push(insert)
    }

    return edits
  }
})
