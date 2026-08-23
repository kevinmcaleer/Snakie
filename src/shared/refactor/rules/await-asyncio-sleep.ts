/**
 * Rule 39 — **Await asyncio.sleep instead** (epic #634 §3.6).
 *
 * ```python
 * async def heartbeat(led):        async def heartbeat(led):
 *     while True:                      while True:
 *         led.toggle()                     led.toggle()
 *         time.sleep(0.5)                  await asyncio.sleep(0.5)
 * ```
 *
 * `time.sleep()` blocks the interpreter. Inside a coroutine that means it blocks
 * the **whole event loop**: for those 500 ms the sensor poll doesn't run, the
 * watchdog isn't fed, the web handler never answers and the motor ramp freezes
 * mid-ramp. `await asyncio.sleep()` yields to the loop instead, so everything
 * else keeps running while this task waits.
 *
 * That is a latent bug rather than a style nit — hence `severity: 'warning'` —
 * and it is the single most common thing that goes wrong the first time someone
 * moves a robot from a `while True:` loop onto asyncio.
 *
 * The rule stays deliberately narrow. It rewrites only what it can prove: a
 * blocking sleep from `time`/`utime`, called as a statement, inside an
 * `async def`, with the asyncio module already imported. Anything else is
 * reported but not rewritten (see `apply`).
 */
import type { AnyNode, Call, Expr } from '../ast'
import { enclosingFunction, walk } from '../ast'
import { dottedName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/**
 * The blocking sleeps we recognise, mapped to the asyncio coroutine that
 * replaces them. `sleep_us` maps to null: asyncio has no microsecond sleep, and
 * rewriting it as `sleep_ms(n / 1000)` would silently change the timing, so we
 * report the stall and decline the rewrite.
 */
const SLEEPS = new Map<string, string | null>([
  ['sleep', 'sleep'],
  ['sleep_ms', 'sleep_ms'],
  ['sleep_us', null]
])

/** Modules whose `sleep` is the blocking one. */
const TIME_MODULES = ['time', 'utime']

/** Modules that provide the event loop, under either MicroPython spelling. */
const ASYNCIO_MODULES = ['asyncio', 'uasyncio']

interface SleepMatch {
  /** The blocking call, e.g. `time.sleep(0.5)`. */
  call: Call
  /** The asyncio coroutine to await, or null when there is no equivalent. */
  target: string | null
}

/**
 * The canonical blocking-sleep name this call resolves to, or null.
 *
 * Handles both import styles beginners mix freely. A dotted `time.sleep(…)` is
 * unambiguous. A bare `sleep(…)` is only accepted when the file actually
 * imported it from `time`/`utime` — `from asyncio import sleep` binds the
 * *coroutine* to exactly the same name, and a hand-written `def sleep(ms)`
 * helper is common enough that guessing here would rewrite working code.
 */
function blockingSleepName(ctx: RefactorContext, call: Call): string | null {
  const dotted = dottedName(call.func)
  if (!dotted) return null
  const parts = dotted.split('.')

  if (parts.length === 2) {
    if (!TIME_MODULES.includes(parts[0])) return null
    return SLEEPS.has(parts[1]) ? parts[1] : null
  }
  if (parts.length === 1) return importedFromTime(ctx, parts[0])
  return null
}

/**
 * The `time`/`utime` function a bare name was imported from, honouring an
 * `as` rename (`from utime import sleep_ms as delay`), or null.
 */
function importedFromTime(ctx: RefactorContext, bound: string): string | null {
  const found: string[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'ImportFrom') return
    if (node.level !== 0 || !node.module || !TIME_MODULES.includes(node.module)) return
    for (const alias of node.names) {
      if ((alias.asname ?? alias.name) === bound && SLEEPS.has(alias.name)) found.push(alias.name)
    }
  })
  return found.length > 0 ? found[0] : null
}

/**
 * The name the event loop module is bound to in this file — `asyncio` for
 * `import uasyncio as asyncio`, `uasyncio` for a plain `import uasyncio` — or
 * null when it was never imported.
 */
function asyncioAlias(ctx: RefactorContext): string | null {
  const found: string[] = []
  walk(ctx.module as AnyNode, (node) => {
    if (node.type !== 'Import') return
    for (const a of node.names) {
      if (ASYNCIO_MODULES.includes(a.name)) found.push(a.asname ?? a.name)
    }
  })
  return found.length > 0 ? found[0] : null
}

/** A single plain positional argument — no `*args`, no keywords. */
function lonePositionalArg(call: Call): Expr | null {
  if (call.args.length !== 1 || call.keywords.length > 0) return null
  const only = call.args[0]
  return only.type === 'Starred' ? null : only
}

export const awaitAsyncioSleepRule = defineRule<SleepMatch>({
  id: 'await-asyncio-sleep',
  title: 'Await asyncio.sleep instead',
  message: 'A blocking `sleep()` inside a coroutine stalls the whole event loop',
  catalogue: 39,
  category: 'micropython',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-await-asyncio-sleep',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<SleepMatch>[] {
    const out: RefactorMatch<SleepMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      // Only a sleep used as a statement. `t = time.sleep(1)` is nonsense we
      // shouldn't be touching, and `await asyncio.sleep(1)` is an `Await`, not
      // a `Call` — which is also what keeps this rule idempotent.
      if (node.type !== 'ExprStmt') return
      const call = node.value
      if (call.type !== 'Call') return

      const sleep = blockingSleepName(ctx, call)
      if (!sleep) return
      if (!lonePositionalArg(call)) return

      // The nearest enclosing `def` is what matters: a synchronous helper
      // nested inside a coroutine blocks only its own caller.
      const fn = enclosingFunction(node)
      if (!fn || fn.type !== 'FunctionDef' || !fn.isAsync) return

      const target = SLEEPS.get(sleep) ?? null
      out.push({
        ruleId: 'await-asyncio-sleep',
        start: node.start,
        end: node.end,
        title: target ? `Await ${target} instead` : 'Await instead of blocking here',
        message: target
          ? `\`${sleep}()\` blocks the event loop — \`await asyncio.${target}()\` yields instead`
          : `\`${sleep}()\` blocks the event loop, and asyncio has no microsecond sleep to replace it`,
        data: { call, target }
      })
    })
    return out
  },

  apply(match: RefactorMatch<SleepMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { call, target } = match.data
    // `sleep_us` — no asyncio equivalent exists, so there is nothing to offer
    // beyond the warning itself.
    if (!target) return null

    // Without the module in scope the rewrite would need a new import, and
    // silently editing someone's import block is a bigger change than this rule
    // is entitled to make. The hint still appears; only the fix stands down.
    const alias = asyncioAlias(ctx)
    if (!alias) return null

    // Replace only the callee, so the argument — and any comment trailing the
    // line — survives byte-identical.
    return [{ start: call.func.start, end: call.func.end, newText: `await ${alias}.${target}` }]
  }
})
