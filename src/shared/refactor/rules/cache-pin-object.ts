/**
 * Rule 41 — **Cache the pin object** (epic #634 §3.6, MicroPython).
 *
 * ```python
 * def read_bumpers():
 *     left = Pin(14, Pin.IN, Pin.PULL_UP).value()
 *     right = Pin(15, Pin.IN, Pin.PULL_UP).value()
 *     front = Pin(14, Pin.IN, Pin.PULL_UP).value()   # ← the same pin again
 * ```
 *
 * Why it matters: `Pin(14, …)` is not a lookup, it is a *constructor*. Each one
 * allocates a new object and re-applies the pad configuration — mode, pull,
 * drive strength — to a pin that was already set up. Two of them in the same
 * function is the beginner's mental model of `Pin` as a way of *naming* a pin
 * rather than a way of *claiming* one, and it costs heap on a board that has
 * none to lose. Worse, the two objects can disagree: reconfigure one and the
 * other still holds the old idea of the pad.
 *
 * **Hint only.** The fix — hoist it to a module-level object, stash it on
 * `self`, hand it in as a parameter — is a design decision about who owns the
 * hardware, and that is the author's call, not ours. So this rule points, names
 * the repeat, and offers no automatic rewrite; `apply` always declines.
 */
import type { AnyNode, Call, FunctionDef, Lambda } from '../ast'
import { enclosingFunction, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface CachePinMatch {
  /** The argument list as written, e.g. `16, Pin.OUT`. */
  args: string
  /** How many identical constructions share this owner. */
  count: number
}

/** Is this call `Pin(…)` or `machine.Pin(…)`? */
function isPinCall(node: AnyNode): node is Call {
  if (node.type !== 'Call') return false
  const dotted = dottedName(node.func)
  return dotted === 'Pin' || dotted === 'machine.Pin'
}

/** The argument list, normalised to source text so `Pin(16)` ≠ `Pin(17)`. */
function argKey(ctx: RefactorContext, call: Call): string {
  const positional = call.args.map((a) => textOf(ctx, a).trim())
  const keywords = call.keywords.map(
    (k) => `${k.arg ? `${k.arg}=` : '**'}${textOf(ctx, k.value).trim()}`
  )
  return [...positional, ...keywords].join(', ')
}

/**
 * Which body this call belongs to. Two `Pin(16)`s in *different* functions may
 * genuinely be two independent users of the pin — only repeats within one body
 * are unambiguous.
 */
function ownerKey(call: Call): string {
  const fn: FunctionDef | Lambda | null = enclosingFunction(call)
  return fn ? `fn@${fn.start}` : 'module'
}

export const cachePinObjectRule = defineRule<CachePinMatch>({
  id: 'cache-pin-object',
  title: 'Cache the pin object',
  message: 'This pin is constructed more than once here — build it once and keep the object',
  catalogue: 41,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-cache-pin-object',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<CachePinMatch>[] {
    const groups = new Map<string, Call[]>()

    walk(ctx.module as AnyNode, (node) => {
      if (!isPinCall(node)) return
      const args = argKey(ctx, node)
      // `Pin()` with no arguments tells us nothing about which pin it is.
      if (!args) return
      const key = `${ownerKey(node)}\x00${args}`
      const list = groups.get(key)
      if (list) list.push(node)
      else groups.set(key, [node])
    })

    const out: RefactorMatch<CachePinMatch>[] = []
    for (const [key, calls] of groups) {
      if (calls.length < 2) continue
      const args = key.slice(key.indexOf('\x00') + 1)
      for (const call of calls) {
        out.push({
          ruleId: 'cache-pin-object',
          start: call.start,
          end: call.end,
          message: `\`Pin(${args})\` is constructed ${calls.length} times here — build it once and reuse the object`,
          data: { args, count: calls.length }
        })
      }
    }
    // Source order, so the Problems panel reads top to bottom.
    return out.sort((a, b) => a.start - b.start)
  },

  apply(): TextEdit[] | null {
    // Where the cached object should live — module global, instance attribute,
    // parameter — is a design decision about hardware ownership. We point at
    // the repeat and let the author choose.
    return null
  }
})
