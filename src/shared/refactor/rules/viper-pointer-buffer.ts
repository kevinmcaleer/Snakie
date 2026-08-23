/**
 * Rule 45 — **Walk the buffer with `ptr8`** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # today                              # what viper makes possible
 * def brighten(step):                  @micropython.viper
 *     frame = bytearray(64)            def brighten(frame, step: int):
 *     for i in range(64):                  buf = ptr8(frame)
 *         frame[i] += step                 for i in range(64):
 *                                              buf[i] = buf[i] + step
 * ```
 *
 * Why it matters: this is the single biggest win the viper emitter has to offer,
 * and it is the reason `ptr8`/`ptr16`/`ptr32` exist at all.
 *
 * `frame[i]` is not one machine instruction. It is a full Python subscript: look
 * up the object's type, find its subscript slot, bounds-check the index, box the
 * result into an integer object, hand it back. Then `frame[i] = x` does the same
 * walk in reverse. Multiply by every pixel of a frame buffer, every byte of a
 * packet, every sample of an audio window, and the indexing costs more than the
 * arithmetic it is feeding.
 *
 * Inside a viper function, `ptr8(frame)` casts the buffer to a raw byte pointer.
 * `ptr8(frame)[i]` then compiles to a single load instruction: no type lookup,
 * no object, no allocation. Pixel buffers, frame buffers and packet parsing are
 * exactly where that pays, and the difference is usually not subtle.
 *
 * **`ptr8` has no bounds checking. None at all.** `buf[i]` raises `IndexError`
 * when `i` runs past the end; `ptr8(buf)[i]` reads whatever memory happens to be
 * at that address, and writing through it corrupts whatever was living there.
 * An off-by-one will not look like a bug in this function. It will look like the
 * board rebooting, or a different variable changing value on its own, or a hard
 * fault with a traceback pointing somewhere innocent. Hoist the length into a
 * local and check it yourself, because nothing else will.
 *
 * This rule is a hint and stays one. The rewrite is not a substitution: the
 * enclosing function has to become a viper function first (rule 44), the buffer
 * has to be reachable as a parameter or a local, and you have to decide where
 * the bounds check now lives. Pointing at the loop and explaining the prize is
 * the honest move; silently turning your frame buffer into an unchecked pointer
 * is not.
 */
import type { AnyNode, Expr, ForStmt, FunctionDef, Stmt, Subscript, WhileStmt } from '../ast'
import { ancestors, enclosingLoop, unwrap, walk } from '../ast'
import { dottedName, textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { isIntegerLiteral } from './convert-to-viper'

/** Which evidence says the name is a buffer, for the message. */
type Evidence = 'local' | 'parameter'

interface PointerMatch {
  /** The buffer's name. */
  name: string
  evidence: Evidence
}

/** Constructors that hand back something `ptr8()` can be pointed at. */
const BUFFER_BUILTINS = new Set(['bytearray', 'memoryview', 'bytes'])

/** Names in this scope bound to a `bytearray(…)`, `memoryview(…)` or `bytes(…)`. */
function bufferLocals(body: Stmt[]): Set<string> {
  const out = new Set<string>()
  for (const stmt of body) {
    walk(stmt as AnyNode, (node) => {
      if (node.type !== 'Assign' || node.targets.length !== 1) return undefined
      const target = unwrap(node.targets[0])
      const value = unwrap(node.value)
      if (target.type !== 'Name' || value.type !== 'Call') return undefined
      const called = dottedName(value.func)
      if (called != null && BUFFER_BUILTINS.has(called)) out.add(target.id)
      return undefined
    })
  }
  return out
}

/** Names in this scope that certainly hold an integer: `for i in range(…)`, `i = 0`. */
function integerNames(body: Stmt[]): Set<string> {
  const out = new Set<string>()
  for (const stmt of body) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'For') {
        const target = unwrap(node.target)
        const iter = unwrap(node.iter)
        if (target.type === 'Name' && iter.type === 'Call' && dottedName(iter.func) === 'range') {
          out.add(target.id)
        }
      }
      if (node.type === 'Assign' && node.targets.length === 1) {
        const target = unwrap(node.targets[0])
        const value = unwrap(node.value)
        if (
          target.type === 'Name' &&
          value.type === 'Constant' &&
          value.kind === 'number' &&
          isIntegerLiteral(value.raw)
        ) {
          out.add(target.id)
        }
      }
      return undefined
    })
  }
  return out
}

/**
 * Is this subscript index provably an integer?
 *
 * The point is to tell `frame[i]` apart from `table[key]`. A dictionary lookup
 * in a loop looks identical in the tree, and `ptr8` advice on one would be
 * nonsense, so an index we cannot pin down as an integer means no hint.
 */
function isIntegerIndex(expr: Expr, integers: Set<string>): boolean {
  const e = unwrap(expr)
  switch (e.type) {
    case 'Constant':
      return e.kind === 'number' && isIntegerLiteral(e.raw)
    case 'Name':
      return integers.has(e.id)
    case 'BinOp':
      return isIntegerIndex(e.left, integers) && isIntegerIndex(e.right, integers)
    case 'UnaryOp':
      return e.op !== 'not' && isIntegerIndex(e.operand, integers)
    default:
      return false
  }
}

/**
 * Is every use of this parameter an integer subscript or a `len()` of it?
 *
 * That is what separates a buffer that arrived as an argument from a list, a
 * dict or an object that merely happens to be indexed once. Iterating it,
 * slicing it, calling a method on it or passing it along all mean we do not know
 * enough, and the hint is withheld.
 */
function usedOnlyAsBuffer(fn: FunctionDef, name: string, integers: Set<string>): boolean {
  let ok = true
  for (const stmt of fn.body) {
    walk(stmt as AnyNode, (node) => {
      if (!ok) return false
      if (node.type !== 'Name' || node.id !== name) return undefined
      const parent = node.parent
      if (parent?.type === 'Subscript' && parent.value === node) {
        if (!isIntegerIndex(parent.slice, integers)) ok = false
        return undefined
      }
      if (parent?.type === 'Call' && dottedName(parent.func) === 'len' && parent.args[0] === node) {
        return undefined
      }
      ok = false
      return false
    })
  }
  return ok
}

/** Does this loop body do arithmetic — the shape where indexing cost shows up? */
function loopDoesArithmetic(loop: ForStmt | WhileStmt): boolean {
  let arithmetic = false
  for (const stmt of loop.body as Stmt[]) {
    walk(stmt as AnyNode, (node) => {
      if (node.type === 'BinOp' || node.type === 'AugAssign') arithmetic = true
      return undefined
    })
  }
  return arithmetic
}

/** What a scope tells us about the names inside it, worked out once per scope. */
interface ScopeFacts {
  /** Names holding a buffer built in this scope. */
  buffers: Set<string>
  /** Names certainly holding an integer. */
  integers: Set<string>
  /** The enclosing `def`, when there is one. */
  fn: FunctionDef | null
}

/** The scope a node lives in, with its facts cached across the whole detect run. */
function factsFor(
  ctx: RefactorContext,
  node: AnyNode,
  cache: Map<AnyNode, ScopeFacts>
): ScopeFacts {
  const fn = ancestors(node).find((a): a is FunctionDef => a.type === 'FunctionDef') ?? null
  const key: AnyNode = fn ?? (ctx.module as AnyNode)
  const hit = cache.get(key)
  if (hit) return hit
  const body: Stmt[] = fn ? fn.body : ctx.module.body
  const facts: ScopeFacts = { buffers: bufferLocals(body), integers: integerNames(body), fn }
  cache.set(key, facts)
  return facts
}

/** Why we believe this subscript walks a buffer, or null when we do not. */
function bufferEvidence(
  node: Subscript,
  facts: ScopeFacts
): { name: string; evidence: Evidence } | null {
  const base = unwrap(node.value)
  if (base.type !== 'Name') return null
  if (!isIntegerIndex(node.slice, facts.integers)) return null
  if (facts.buffers.has(base.id)) return { name: base.id, evidence: 'local' }
  const isParam = facts.fn?.params.some((p) => p.kind === 'normal' && p.name === base.id) === true
  if (isParam && facts.fn && usedOnlyAsBuffer(facts.fn, base.id, facts.integers)) {
    return { name: base.id, evidence: 'parameter' }
  }
  return null
}

export const viperPointerBufferRule = defineRule<PointerMatch>({
  id: 'viper-pointer-buffer',
  title: 'Walk the buffer with ptr8',
  message: 'Indexing a buffer element by element is the subscript protocol — viper can make it a raw load',
  catalogue: 45,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-viper-pointer-buffer',
  // Unchecked pointer access. Never batched, and never applied for you.
  safe: false,
  hintOnly: true,
  requires: (caps) => caps.viper,

  detect(ctx: RefactorContext): RefactorMatch<PointerMatch>[] {
    const hedge = ctx.capabilities?.inferred === true
    const cache = new Map<AnyNode, ScopeFacts>()
    // One hint per buffer per loop: five subscripts of the same bytearray in one
    // loop are one thing to do, not five entries in the Problems panel.
    const seen = new Set<string>()
    const out: RefactorMatch<PointerMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Subscript') return undefined
      // The innermost loop, stopping at a function boundary: how often a helper
      // gets called is not something this file can tell us.
      const loop = enclosingLoop(node)
      if (!loop || !loopDoesArithmetic(loop)) return undefined

      const hit = bufferEvidence(node, factsFor(ctx, node, cache))
      if (!hit) return undefined
      const key = `${loop.start}:${hit.name}`
      if (seen.has(key)) return undefined
      seen.add(key)

      const text = textOf(ctx, node).trim()
      const caveat =
        hit.evidence === 'parameter' ? `if \`${hit.name}\` is a bytearray or a memoryview, ` : ''
      const emitter = hedge ? 'a viper function (if your firmware has one)' : 'a viper function'
      out.push({
        ruleId: 'viper-pointer-buffer',
        start: node.start,
        end: node.end,
        message: `\`${text}\` goes through the whole subscript protocol every pass — ${caveat}inside ${emitter} \`ptr8(${hit.name})\` makes it a raw load with no bounds check`,
        data: { name: hit.name, evidence: hit.evidence }
      })
      return undefined
    })

    return out
  },

  // Hint only. The rewrite needs the enclosing function converted to viper
  // first (rule 44) and a bounds check written by someone who knows the buffer's
  // length — quietly swapping in an unchecked pointer would be the worst kind of
  // "helpful".
  apply(): TextEdit[] | null {
    return null
  }
})
