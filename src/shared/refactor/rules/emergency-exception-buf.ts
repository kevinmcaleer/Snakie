/**
 * Rule 56 — **Add alloc_emergency_exception_buf** (epic #634 §3.6).
 *
 * ```python
 * from machine import Pin              from machine import Pin
 *                                      import micropython
 *
 *                                      micropython.alloc_emergency_exception_buf(100)
 *
 * button.irq(handler=on_press)         button.irq(handler=on_press)
 * ```
 *
 * When an exception escapes an interrupt handler, MicroPython needs memory to
 * build the traceback — and the heap is exactly what it may not touch in
 * interrupt context. Without a pre-allocated buffer it therefore prints
 * *nothing at all*. Your handler dies, the robot quietly stops responding to the
 * bumper, and the REPL shows a blank line. People lose whole evenings to this.
 *
 * `micropython.alloc_emergency_exception_buf(100)` reserves 100 bytes once, at
 * import time, and the traceback appears. It costs a hundred bytes and a line,
 * it is in every serious MicroPython codebase, and it is missing from almost
 * every beginner one — which is what makes it one of the highest-value rules in
 * the catalogue.
 *
 * One match per file: the fix is one line, wherever the interrupts are.
 */
import type { AnyNode, Call, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName } from '../expr'
import { localBindings } from '../scope'
import { lineEnd } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

/** Bytes to reserve — the number the MicroPython docs use, and plenty. */
const BUFFER_BYTES = 100

const ALLOC_FUNC = 'alloc_emergency_exception_buf'

interface BufMatch {
  /** The `.irq(...)` call that proves this file needs the buffer. */
  irq: Call
}

/** The first `something.irq(...)` registration in the file, or null. */
function firstIrqCall(ctx: RefactorContext): Call | null {
  const found: Call[] = []
  walk(ctx.module as AnyNode, (n) => {
    if (found.length > 0) return false
    if (n.type !== 'Call') return undefined
    const func = unwrap(n.func)
    if (func.type !== 'Attribute' || func.attr !== 'irq') return undefined
    // `pin.irq()` with nothing in it registers nothing.
    if (n.args.length === 0 && n.keywords.length === 0) return undefined
    found.push(n)
    return false
  })
  return found[0] ?? null
}

/** Does the file already reserve the buffer, under either spelling? */
function alreadyReserved(ctx: RefactorContext): boolean {
  const hits: Call[] = []
  walk(ctx.module as AnyNode, (n) => {
    if (n.type !== 'Call') return
    const dotted = dottedName(unwrap(n.func))
    if (dotted && dotted.split('.').pop() === ALLOC_FUNC) hits.push(n)
  })
  return hits.length > 0
}

/**
 * The name `micropython` is bound to at module level (`micropython`, or the
 * alias from `import micropython as mp`), or null when it was never imported.
 *
 * Only top-level imports count: a module-level call cannot use a name that an
 * import inside some function bound.
 */
function micropythonAlias(ctx: RefactorContext): string | null {
  for (const stmt of ctx.module.body) {
    if (stmt.type !== 'Import') continue
    for (const alias of stmt.names) {
      if (alias.name === 'micropython') return alias.asname ?? alias.name
    }
  }
  return null
}

/** Offset at which the new line(s) should be inserted. */
function insertionPoint(ctx: RefactorContext): number {
  // After the last top-level import — the conventional home for it, and the one
  // place we know runs before any handler can be registered.
  let last: Stmt | null = null
  for (const stmt of ctx.module.body) {
    if (stmt.type === 'Import' || stmt.type === 'ImportFrom') last = stmt
  }
  if (last) return lineEnd(ctx.src, last.end)

  // No imports at all (rare — `.irq` came from somewhere). Go after the module
  // docstring so we never split it from the top of the file.
  const first = ctx.module.body[0]
  if (first && first.type === 'ExprStmt' && first.value.type === 'Constant' && first.value.kind === 'string') {
    return lineEnd(ctx.src, first.end)
  }
  return 0
}

export const emergencyExceptionBufRule = defineRule<BufMatch>({
  id: 'emergency-exception-buf',
  title: 'Add alloc_emergency_exception_buf',
  message: 'This file registers an interrupt but reserves no emergency exception buffer',
  catalogue: 56,
  category: 'micropython',
  kind: 'quickfix',
  severity: 'warning',
  helpArticle: 'refactor-emergency-exception-buf',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<BufMatch>[] {
    const irq = firstIrqCall(ctx)
    if (!irq) return []
    // Already reserved anywhere in the file — including a bare call from
    // `from micropython import alloc_emergency_exception_buf`. This is also what
    // stops the rule firing on its own output.
    if (alreadyReserved(ctx)) return []

    return [
      {
        ruleId: 'emergency-exception-buf',
        start: irq.start,
        end: irq.end,
        message:
          'An exception in this handler will print no traceback at all — reserve the emergency buffer',
        data: { irq }
      }
    ]
  },

  apply(_match: RefactorMatch<BufMatch>, ctx: RefactorContext): TextEdit[] | null {
    const eol = ctx.eol
    const alias = micropythonAlias(ctx)

    // Nothing imports the module, and something else already owns the name —
    // adding `import micropython` would rebind it. Decline rather than guess.
    if (!alias && localBindings(ctx.module.body).has('micropython')) return null

    const name = alias ?? 'micropython'
    const at = insertionPoint(ctx)

    // Don't glue onto an unterminated final line.
    const lead = at > 0 && ctx.src[at - 1] !== '\n' ? eol : ''
    const importLine = alias ? '' : `import micropython${eol}`
    // Leave a blank line after whatever follows, unless there already is one.
    const rest = ctx.src.slice(at, lineEnd(ctx.src, at))
    const gap = rest.trim() === '' ? '' : eol

    return [
      {
        start: at,
        end: at,
        newText: `${lead}${importLine}${eol}${name}.${ALLOC_FUNC}(${BUFFER_BYTES})${eol}${gap}`
      }
    ]
  }
})
