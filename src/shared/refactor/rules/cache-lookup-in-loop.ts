/**
 * Rule 82 — **Cache the lookup before the loop** (epic #634 §3.8, MicroPython).
 *
 * ```python
 * # before                            # after
 * while True:                         duty = self.motor.duty_u16
 *     self.motor.duty_u16(left)       while True:
 *     self.motor.duty_u16(right)          duty(left)
 *                                         duty(right)
 * ```
 *
 * Why it matters: `self.motor.duty_u16` is not a name, it is *work*. Every time
 * that expression is evaluated MicroPython looks `motor` up in the instance
 * dictionary, then looks `duty_u16` up in the object's type, then builds a bound
 * method object to hold the pair. Three dictionary probes and an allocation, on
 * every single pass of your control loop, to reach a function that was never
 * going to change.
 *
 * Binding it to a local once, before the loop, turns all of that into a single
 * array index — locals are numbered slots the compiler resolves at compile time,
 * not names looked up at run time. This is the first thing the official
 * *Maximising MicroPython speed* guide tells you to do, and on a loop that ran
 * three attribute chains per pass it is routinely a double-digit percentage.
 *
 * Snakie only points, because *where* to bind it is a judgement about your
 * program's shape. A local before the loop is the usual answer, but if the loop
 * is a method that runs often, `self._duty = self.motor.duty_u16` in `__init__`
 * is better, and if the object can be swapped at run time then caching it is
 * wrong and the lookup is the point.
 *
 * One caveat worth knowing: this trades a little readability for speed, so it
 * belongs in the loop that is actually your bottleneck, not everywhere. Measure
 * first — the Benchmark button in the preview exists for exactly this argument.
 */
import type { AnyNode, Expr, ForStmt, WhileStmt } from '../ast'
import { walk } from '../ast'
import { dottedName, textOf } from '../expr'
import { namesWritten } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface CacheLookupMatch {
  /** The repeated attribute chain, e.g. `self.motor.duty_u16`. */
  chain: string
  /** How many times it appears in the loop. */
  count: number
}

/** How many times a name is repeated before caching is worth suggesting. */
const REPEATS = 2

/** Attribute chains in this subtree, by source text, with their nodes. */
function attributeChains(ctx: RefactorContext, root: AnyNode): Map<string, Expr[]> {
  const out = new Map<string, Expr[]>()
  walk(root, (node) => {
    if (node.type !== 'Attribute') return
    // Only whole chains: skip `self.motor` when we are inside
    // `self.motor.duty_u16`, so the count reflects real lookups.
    if (node.parent?.type === 'Attribute') return
    const dotted = dottedName(node)
    // A chain of pure names only — `a.b[0].c` is a different animal.
    if (!dotted) return
    const text = textOf(ctx, node)
    if (text !== dotted) return
    const list = out.get(text)
    if (list) list.push(node)
    else out.set(text, [node])
  })
  return out
}

/** The name at the root of a dotted chain: `self.motor.duty` -> `self`. */
function rootName(chain: string): string {
  return chain.split('.')[0]
}

export const cacheLookupInLoopRule = defineRule<CacheLookupMatch>({
  id: 'cache-lookup-in-loop',
  title: 'Cache the lookup before the loop',
  message: 'This attribute chain is looked up every pass — bind it to a local first',
  catalogue: 82,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-cache-lookup-in-loop',
  safe: false,
  // Where the cache should live — a local, an __init__ attribute, nowhere —
  // is a design decision about the object's lifetime.
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<CacheLookupMatch>[] {
    const out: RefactorMatch<CacheLookupMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' && node.type !== 'While') return
      const loop = node as ForStmt | WhileStmt
      // Names the loop reassigns cannot be hoisted — the lookup has to happen
      // again each pass because the object it starts from may be different.
      const rebound = namesWritten(loop.body)
      for (const [chain, nodes] of attributeChains(ctx, loop as AnyNode)) {
        if (nodes.length < REPEATS) continue
        if (rebound.has(rootName(chain))) continue
        // Only report the innermost loop that contains them, so a nested loop
        // does not produce the same hint twice.
        let innerLoopHasIt = false
        walk(loop as AnyNode, (inner) => {
          if (inner === loop) return undefined
          if (inner.type !== 'For' && inner.type !== 'While') return undefined
          const nested = attributeChains(ctx, inner)
          if ((nested.get(chain)?.length ?? 0) >= REPEATS) innerLoopHasIt = true
          return undefined
        })
        if (innerLoopHasIt) continue
        out.push({
          ruleId: 'cache-lookup-in-loop',
          start: nodes[0].start,
          end: nodes[0].end,
          message:
            `\`${chain}\` is looked up ${nodes.length} times per pass — ` +
            'binding it to a local before the loop makes each use an array index',
          data: { chain, count: nodes.length }
        })
      }
    })
    return out.sort((a, b) => a.start - b.start)
  },

  apply(): TextEdit[] | null {
    return null
  }
})
