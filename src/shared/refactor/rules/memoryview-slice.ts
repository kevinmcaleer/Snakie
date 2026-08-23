/**
 * Rule 58 — **Slice with a memoryview** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                                  # after (by hand)
 * rx = bytearray(128)                       rx = bytearray(128)
 *                                           view = memoryview(rx)
 * for _ in range(packets):                  for _ in range(packets):
 *     header = rx[offset:offset + 2]            header = view[offset:offset + 2]
 *     payload = rx[offset + 2:offset + 10]      payload = view[offset + 2:offset + 10]
 * ```
 *
 * Why it matters: **slicing a `bytearray` copies.** `rx[0:2]` does not hand you a
 * window onto the two bytes already sitting in memory; it asks the heap for a
 * brand-new two-byte object and copies them in. Inside a loop that is a fresh
 * allocation every single iteration, for data you already have, in memory you
 * already own. Two slices per packet at 200 packets a second is 400 short-lived
 * objects a second, and every one of them is work for the garbage collector that
 * eventually stops your loop to sweep them up.
 *
 * `memoryview(rx)` wraps the same buffer, and slicing the view is free:
 * `view[0:2]` is a *view*, not a copy. No allocation, no garbage, no collector
 * pause. Everything that reads bytes — `sum()`, `int.from_bytes()`,
 * `struct.unpack_from()`, `uart.write()` — takes a memoryview happily, because
 * they all speak the buffer protocol.
 *
 * The one catch worth knowing: a memoryview **keeps the underlying buffer
 * alive**, and while any view exists you cannot resize the bytearray it points
 * at. So make the view where the buffer is made, use it, and do not hold one
 * longer than you need it.
 *
 * This is a hint and stays a hint. Where the view should live — next to the
 * buffer, once, at import time — and which of the slices in a file should use it
 * are decisions about the shape of your program, not a substitution a tool can
 * make blind. So the rule points at the copy and explains, and changes nothing.
 *
 * Gated on a board being connected at all: it is advice about the heap on the
 * chip in front of you, and Snakie says nothing about a board it cannot see.
 */
import type { AnyNode, Expr, ForStmt, Subscript, WhileStmt } from '../ast'
import { enclosingLoop, unwrap, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import { bindingScopeFor } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { bindingValues } from './readinto-buffer'

interface SliceMatch {
  node: Subscript
  /** The buffer being sliced, for the message. */
  name: string
  /** 'for' or 'while', for the message. */
  loopKind: 'for' | 'while'
}

/** Does this expression evaluate to a `bytes` or `bytearray`? */
function isByteBuffer(expr: Expr): boolean {
  const e = unwrap(expr)
  // A `b"…"` literal — the lexer records the prefix, so `rb"…"` counts too.
  if (e.type === 'Constant' && e.kind === 'string') return (e.prefix ?? '').includes('b')
  if (e.type === 'Call') {
    const factory = dottedName(e.func)?.split('.').pop()
    return factory === 'bytes' || factory === 'bytearray'
  }
  return false
}

/**
 * Is `name` a buffer this file can vouch for?
 *
 * Every binding of the name has to be a `bytes`/`bytearray`, and there has to be
 * at least one. A parameter, a `for` target or a name we cannot see the binding
 * of comes back as unknown, and unknown means silent: `memoryview()` on a `list`
 * is a `TypeError`, and slicing a `str` copies but a view of one is not a thing
 * at all. Note that a name bound to `memoryview(...)` fails this test, which is
 * how the rule stays quiet about code that has already taken the advice.
 */
function isKnownByteBuffer(node: AnyNode, name: string): boolean {
  const scope = bindingScopeFor(node, name)
  const values = bindingValues(scope as AnyNode, name)
  if (!values || values.length === 0) return false
  return values.every(isByteBuffer)
}

/**
 * Is this subscript being written to rather than read from?
 *
 * `rx[at:at + 8] = chunk` is a slice *store*: it copies bytes into the buffer
 * you already have, which is the good thing this rule is arguing for. Only the
 * reading side allocates.
 */
function isStoreTarget(node: Subscript): boolean {
  const parent = node.parent
  if (!parent) return false
  switch (parent.type) {
    case 'Assign':
      return parent.targets.some((t) => unwrap(t) === (node as Expr))
    case 'AugAssign':
    case 'AnnAssign':
      return unwrap(parent.target) === (node as Expr)
    case 'Delete':
      return parent.targets.some((t) => unwrap(t) === (node as Expr))
    default:
      return false
  }
}

/** How to describe the loop this slice sits in. */
function loopKindOf(loop: ForStmt | WhileStmt): 'for' | 'while' {
  return loop.type === 'For' ? 'for' : 'while'
}

export const memoryviewSliceRule = defineRule<SliceMatch>({
  id: 'memoryview-slice',
  title: 'Slice with a memoryview',
  message: 'Slicing a bytearray copies it — a memoryview slice is a view, not an allocation',
  catalogue: 58,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-memoryview-slice',
  // A view keeps its buffer alive and pins its size; that is the author's call.
  safe: false,
  hintOnly: true,
  // On-device advice about the heap on the chip in front of you: no board, no hint.
  requires: () => true,

  detect(ctx: RefactorContext): RefactorMatch<SliceMatch>[] {
    const out: RefactorMatch<SliceMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Subscript') return undefined
      const slice = node.slice
      if (slice.type !== 'Slice') return undefined
      // `buf[:]` is the copy idiom, written deliberately by someone who wanted a
      // copy. Saying "this allocates" to them is telling them what they asked for.
      if (!slice.lower && !slice.upper && !slice.step) return undefined

      const value = unwrap(node.value)
      if (value.type !== 'Name') return undefined
      if (isStoreTarget(node)) return undefined

      // `enclosingLoop` stops at a function boundary, so one slice in a helper is
      // not reported on the strength of a loop somewhere else calling it.
      const loop = enclosingLoop(node)
      if (!loop) return undefined
      if (!isKnownByteBuffer(node, value.id)) return undefined

      out.push({
        ruleId: 'memoryview-slice',
        start: node.start,
        end: node.end,
        message: `\`${textOf(ctx, node)}\` copies those bytes on every pass of this \`${loopKindOf(loop)}\` — a \`memoryview(${value.id})\` slice is a view, not an allocation`,
        data: { node, name: value.id, loopKind: loopKindOf(loop) }
      })
      return undefined
    })

    return out
  },

  // Hint only. Where the view lives, how long it lives and which slices should
  // use it are decisions about the program's shape — and a view pins the
  // buffer's size for as long as it exists. The rule explains and changes nothing.
  apply(): TextEdit[] | null {
    return null
  }
})
