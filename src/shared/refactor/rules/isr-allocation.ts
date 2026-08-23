/**
 * Rule 36 — **Do not allocate inside the interrupt handler** (epic #634 §3.6).
 *
 * ```python
 * def on_tick(pin):                    ticks = 0
 *     events.append({                  def on_tick(pin):
 *         "us": time.ticks_us()            global ticks
 *     })                                   ticks += 1
 *                                          micropython.schedule(log_tick, ticks)
 * encoder.irq(handler=on_tick)         encoder.irq(handler=on_tick)
 * ```
 *
 * An interrupt handler runs with the heap locked. Building a dict, an f-string,
 * a list, or joining two strings with `+` all ask the allocator for memory, and
 * in interrupt context MicroPython answers with
 * `MemoryError: memory allocation failed`. Worse, it does so *only* once the
 * heap happens to be busy — so it passes on the bench all afternoon and fires at
 * 3am with the robot halfway down a corridor.
 *
 * The cure is a restructuring, not a substitution: pre-allocate the buffers at
 * import time, have the handler write integers into them, and hand the
 * formatting to `micropython.schedule()` so it runs back on the main thread.
 * That is a judgement call about *your* data, so this rule is `hintOnly` — it
 * points at the allocation and explains, and never rewrites your ISR for you.
 *
 * The allocation scanner and the handler resolver below are shared with rule 89
 * (`timer-callback-allocation`), which is the same hazard reached through a
 * different door.
 */
import type { AnyNode, ClassDef, Call, Expr, FunctionDef, Keyword } from '../ast'
import { ancestors, unwrap, walk } from '../ast'
import { dottedName } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** One heap allocation found in a handler body, and how to describe it. */
export interface Allocation {
  node: AnyNode
  /** Human phrase for the message: 'a dict display', 'an f-string', … */
  what: string
}

/** Builtins that hand back a freshly allocated object. */
const ALLOCATING_BUILTINS = new Set(['list', 'dict', 'set', 'bytearray'])

/**
 * The first heap allocation in `nodes`, or null.
 *
 * Nested `def`/`lambda`/`class` bodies are skipped: defining them is not what
 * allocates, and their bodies run under whatever rules apply where they are
 * called. Everything reported here allocates unconditionally when the line runs,
 * which is what keeps this from crying wolf.
 */
export function findAllocation(nodes: readonly AnyNode[]): Allocation | null {
  const found: Allocation[] = []

  const note = (node: AnyNode, what: string): false => {
    found.push({ node, what })
    return false
  }

  for (const root of nodes) {
    if (found.length > 0) break
    walk(root, (n) => {
      if (found.length > 0) return false
      // A nested `def`/`lambda`/`class` is a definition, not a call: defining it
      // is not what allocates, and its body runs wherever it is invoked.
      if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') return false
      switch (n.type) {
        case 'List':
          return note(n, 'a list display')
        case 'Dict':
          return note(n, 'a dict display')
        case 'Set':
          return note(n, 'a set display')
        case 'ListComp':
        case 'SetComp':
        case 'DictComp':
          return note(n, 'a comprehension')
        case 'Constant':
          // An f-string builds a brand-new string every time it is evaluated.
          if (n.kind === 'string' && (n.prefix ?? '').includes('f')) return note(n, 'an f-string')
          return undefined
        case 'Call': {
          const func = unwrap(n.func)
          if (func.type === 'Attribute' && func.attr === 'format') {
            return note(n, 'a .format() call')
          }
          const dotted = dottedName(func)
          if (dotted && ALLOCATING_BUILTINS.has(dotted)) return note(n, `a ${dotted}() call`)
          return undefined
        }
        case 'BinOp':
          // `"tick " + str(n)` and `"tick %d" % n` both build a new string.
          if ((n.op === '+' || n.op === '%') && (isStringLiteral(n.left) || isStringLiteral(n.right))) {
            return note(n, 'string building')
          }
          return undefined
        default:
          return undefined
      }
    })
  }

  return found[0] ?? null
}

/** Is this expression a plain string literal (f-strings included)? */
function isStringLiteral(expr: Expr): boolean {
  const e = unwrap(expr)
  return e.type === 'Constant' && e.kind === 'string'
}

/** A handler expression resolved to the code that actually runs in interrupt context. */
export interface ResolvedHandler {
  /** What to call it in the message: `on_tick()`, `the lambda`. */
  label: string
  /** The statements (or the lambda's expression) to scan. */
  body: AnyNode[]
  /** Identity for de-duplicating two registrations of the same handler. */
  key: number
}

/**
 * Resolve the expression passed as a handler to the body that will run.
 *
 * Deliberately limited to what can be proven from the file alone: a lambda
 * written in place, a module- or class-level `def` referenced by name, and
 * `self.method` when the registration sits inside that class. A name bound to
 * two different `def`s, or a handler that arrives as a parameter, resolves to
 * null — we would only be guessing which body runs.
 */
export function resolveHandler(
  ctx: RefactorContext,
  handler: Expr,
  site: AnyNode
): ResolvedHandler | null {
  const expr = unwrap(handler)

  if (expr.type === 'Lambda') {
    return { label: 'the lambda', body: [expr.body], key: expr.start }
  }

  if (expr.type === 'Name') {
    const fn = uniqueFunction(ctx.module as AnyNode, expr.id)
    return fn ? { label: `${fn.name}()`, body: [...fn.body], key: fn.start } : null
  }

  // `self.on_tick` — look the method up in the class the registration is in.
  if (expr.type === 'Attribute') {
    const base = unwrap(expr.value)
    if (base.type !== 'Name' || base.id !== 'self') return null
    const cls = ancestors(site).find((a): a is ClassDef => a.type === 'ClassDef')
    if (!cls) return null
    const fn = uniqueFunction(cls as AnyNode, expr.attr)
    return fn ? { label: `${fn.name}()`, body: [...fn.body], key: fn.start } : null
  }

  return null
}

/** The one and only `def` of this name inside `root`, or null if it is ambiguous. */
function uniqueFunction(root: AnyNode, name: string): FunctionDef | null {
  const hits: FunctionDef[] = []
  walk(root, (n) => {
    if (n.type === 'FunctionDef' && n.name === name) hits.push(n)
  })
  return hits.length === 1 ? hits[0] : null
}

/** The value of keyword `name` in a call, if it was passed that way. */
export function keywordArg(call: Call, name: string): Expr | null {
  const kw = call.keywords.find((k: Keyword) => k.arg === name)
  return kw ? kw.value : null
}

/**
 * The handler a `.irq(...)` call registers: the `handler=` keyword when there
 * is one, otherwise the first positional argument (MicroPython's `irq()` takes
 * the handler first).
 */
function irqHandlerArg(call: Call): Expr | null {
  const kw = keywordArg(call, 'handler')
  if (kw) return kw
  const first = call.args[0]
  if (!first || first.type === 'Starred') return null
  return first
}

/** Every `something.irq(...)` call in the file, with the handler it registers. */
function irqRegistrations(ctx: RefactorContext): { call: Call; handler: Expr }[] {
  const out: { call: Call; handler: Expr }[] = []
  walk(ctx.module as AnyNode, (n) => {
    if (n.type !== 'Call') return
    const func = unwrap(n.func)
    if (func.type !== 'Attribute' || func.attr !== 'irq') return
    const handler = irqHandlerArg(n)
    if (handler) out.push({ call: n, handler })
  })
  return out
}

interface IsrMatch {
  label: string
  what: string
}

export const isrAllocationRule = defineRule<IsrMatch>({
  id: 'isr-allocation',
  title: 'Do not allocate inside the interrupt handler',
  message: 'This interrupt handler allocates — it will raise MemoryError on the robot',
  catalogue: 36,
  category: 'micropython',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-isr-allocation',
  safe: false,
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<IsrMatch>[] {
    const out: RefactorMatch<IsrMatch>[] = []
    const seen = new Set<number>()

    for (const { call, handler } of irqRegistrations(ctx)) {
      const resolved = resolveHandler(ctx, handler, call)
      if (!resolved) continue
      // The same handler on two pins is one problem, not two.
      if (seen.has(resolved.key)) continue
      seen.add(resolved.key)

      const alloc = findAllocation(resolved.body)
      if (!alloc) continue

      out.push({
        ruleId: 'isr-allocation',
        start: alloc.node.start,
        end: alloc.node.end,
        message: `${resolved.label} runs in interrupt context, where ${alloc.what} can fail with MemoryError`,
        data: { label: resolved.label, what: alloc.what }
      })
    }

    return out
  },

  // Hint only. Pre-allocating the buffers and moving the work to
  // `micropython.schedule()` changes what the program stores and when it says
  // it — that is the author's call to make, not a mechanical rewrite.
  apply(): TextEdit[] | null {
    return null
  }
})
