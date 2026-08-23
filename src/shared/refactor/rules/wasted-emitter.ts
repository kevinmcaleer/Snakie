/**
 * Rule 47 — **This decorator is buying nothing** (epic #634 §3.7, board-specific).
 *
 * ```python
 * # before                                # after
 * @micropython.native                     def average(samples):
 * def average(samples):                       total = 0
 *     total = 0                               for value in samples:
 *     for value in samples:                       total += value
 *         total += value                      return total / len(samples)
 *     return total / len(samples)
 * ```
 *
 * Why it matters: the emitters are not free, and they are not magic. Compiling a
 * function to machine code produces something considerably bigger than the
 * bytecode it replaces — it costs flash to store and it costs RAM the moment the
 * module is imported. You pay that price whether or not the function gets any
 * faster.
 *
 * And there are shapes the emitters simply cannot help with:
 *
 * - **Floats.** Both emitters shine on integers. A function whose real work is
 *   `/` or `3.14` spends its time in floating-point runtime calls that the
 *   decorator does not touch. Under viper a float will not compile at all.
 * - **`*args` / `**kwargs` / keyword-only parameters.** Assembling that argument
 *   tuple or dict is Python object work at every single call.
 * - **`yield`.** A generator has to keep its frame alive across suspensions, so
 *   it stays on the bytecode interpreter no matter what you decorate it with.
 * - **Closures.** Reading a variable from the enclosing function goes through a
 *   cell object, which is a pointer chase the emitter cannot optimise away.
 * - **`try` / `except`.** Setting up an exception handler is bookkeeping in the
 *   runtime, not arithmetic; and under viper the handler is not supported.
 *
 * This one is a `warning` rather than a hint because the code is *paying* for
 * something. A hint you ignore costs nothing; a decorator you keep costs flash
 * and import RAM on a board that has very little of either, forever, in exchange
 * for no speed at all. Deleting the line is the entire fix.
 *
 * The rewrite removes the emitter decorator's own line and nothing else — an
 * `@staticmethod` or `@property` above or below it stays exactly where it was.
 * The `import micropython` line is left alone even when it becomes unused: ruff
 * owns unused imports (rule 33), and two tools quietly editing the same line is
 * how a fix turns into a merge conflict.
 */
import type { AnyNode, FunctionDef, Stmt } from '../ast'
import { ancestors, walk } from '../ast'
import { lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { localBindings, namesRead } from '../scope'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'
import { emitterDecoratorOf, isIntegerLiteral } from './convert-to-viper'

interface WastedMatch {
  fn: FunctionDef
  /** The decorator to delete. */
  decoratorStart: number
  decoratorEnd: number
  /** Short name of the emitter, for the message: 'native' or 'viper'. */
  emitter: string
  /** What the emitter cannot help with. */
  what: string
}

/** The emitters this rule judges. Assembly functions are a different animal. */
const JUDGED = new Map([
  ['micropython.native', 'native'],
  ['native', 'native'],
  ['micropython.viper', 'viper'],
  ['viper', 'viper']
])

/** The first thing in the signature the emitter cannot help with. */
function signatureWaste(fn: FunctionDef): string | null {
  for (const p of fn.params) {
    if (p.kind === 'vararg') return '`*args`, which builds a tuple at every call'
    if (p.kind === 'kwarg') return '`**kwargs`, which builds a dict at every call'
    if (p.kind === 'kwonly-marker') return 'keyword-only parameters, which are matched by name at every call'
  }
  return null
}

/** The first thing in the body the emitter cannot help with. */
function bodyWaste(fn: FunctionDef): string | null {
  const found: string[] = []

  const visitor = (node: AnyNode): void | false => {
    if (found.length > 0) return false
    // A nested `def` compiles under its own decorators; judging the outer
    // function by what its inner one does would be reading the wrong code.
    if (node.type === 'FunctionDef' || node.type === 'Lambda' || node.type === 'ClassDef') {
      return false
    }
    switch (node.type) {
      case 'Yield':
        found.push('`yield`, and a generator keeps its bytecode frame whatever you decorate it with')
        return false
      case 'Try':
        found.push('`try`/`except`, which is runtime bookkeeping rather than arithmetic')
        return false
      case 'Constant':
        if (node.kind === 'number' && !isIntegerLiteral(node.raw)) {
          found.push('floating-point literals, which the emitters do not speed up')
          return false
        }
        return undefined
      case 'BinOp':
        if (node.op === '/') {
          found.push('`/`, true division, which produces a float')
          return false
        }
        return undefined
      case 'AugAssign':
        if (node.op === '/') {
          found.push('`/=`, true division, which produces a float')
          return false
        }
        return undefined
      default:
        return undefined
    }
  }

  for (const stmt of fn.body as Stmt[]) walk(stmt as AnyNode, visitor)
  return found[0] ?? null
}

/**
 * Does this function read a variable belonging to the function it is nested in?
 *
 * Its own name does not count: a recursive call resolves through the same cell,
 * but recursion is not the thing the emitter is failing to speed up here.
 */
function closureWaste(fn: FunctionDef): string | null {
  const enclosing = ancestors(fn as AnyNode).filter(
    (a): a is FunctionDef => a.type === 'FunctionDef'
  )
  if (enclosing.length === 0) return null

  const own = new Set<string>(fn.params.map((p) => p.name))
  for (const name of localBindings(fn.body)) own.add(name)
  own.add(fn.name)
  const free = [...namesRead(fn.body)].filter((n) => !own.has(n))
  if (free.length === 0) return null

  for (const outer of enclosing) {
    const bound = new Set<string>(outer.params.map((p) => p.name))
    for (const name of localBindings(outer.body)) bound.add(name)
    bound.delete(fn.name)
    const captured = free.find((n) => bound.has(n))
    if (captured) {
      return `\`${captured}\` from the function it sits inside, which is a cell lookup the emitter cannot remove`
    }
  }
  return null
}

export const wastedEmitterRule = defineRule<WastedMatch>({
  id: 'wasted-emitter',
  title: 'This decorator is buying nothing',
  message: 'This emitter cannot speed this function up, and it still costs flash and import RAM',
  catalogue: 47,
  category: 'board',
  kind: 'refactor',
  severity: 'warning',
  helpArticle: 'refactor-wasted-emitter',
  // Removing a decorator changes how the function is compiled; the user decides.
  safe: false,
  requires: (caps) => caps.native,

  detect(ctx: RefactorContext): RefactorMatch<WastedMatch>[] {
    const out: RefactorMatch<WastedMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return undefined
      const dec = emitterDecoratorOf(node)
      if (!dec) return undefined
      const emitter = JUDGED.get(dec.name)
      if (!emitter) return undefined

      const what = signatureWaste(node) ?? bodyWaste(node) ?? closureWaste(node)
      if (!what) return undefined

      out.push({
        ruleId: 'wasted-emitter',
        start: dec.node.start,
        end: dec.node.end,
        message: `\`${node.name}()\` uses ${what} — @micropython.${emitter} cannot help, and the decorator still costs flash and import RAM`,
        data: {
          fn: node,
          decoratorStart: dec.node.start,
          decoratorEnd: dec.node.end,
          emitter,
          what
        }
      })
      return undefined
    })
    return out
  },

  apply(match: RefactorMatch<WastedMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { decoratorStart, decoratorEnd } = match.data
    const start = lineStart(ctx.src, decoratorStart)
    const end = lineEnd(ctx.src, decoratorEnd)
    // Only take the line when the line is only the decorator: `@` plus its
    // indentation in front, nothing but whitespace or a comment behind. Anything
    // else and we would be deleting something we did not read.
    if (ctx.src.slice(start, decoratorStart).trim() !== '@') return null
    const trailing = ctx.src.slice(decoratorEnd, end).trim()
    if (trailing !== '' && !trailing.startsWith('#')) return null
    return [{ start, end, newText: '' }]
  }
})
