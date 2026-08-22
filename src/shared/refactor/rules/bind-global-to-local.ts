/**
 * Rule 83 — **Bind the global to a local** (epic #634 §3.8, MicroPython).
 *
 * ```python
 * # before                          # after
 * THRESHOLD = 500                   THRESHOLD = 500
 *
 * def scan(samples):                def scan(samples):
 *     hits = 0                          limit = THRESHOLD
 *     for s in samples:                 hits = 0
 *         if s > THRESHOLD:             for s in samples:
 *             hits += 1                     if s > limit:
 *     return hits                               hits += 1
 *                                       return hits
 * ```
 *
 * Why it matters: a local variable is a numbered slot. The compiler works out
 * which slot at compile time, so reading one is an array index — about as fast
 * as anything MicroPython does. A *global* is a name in the module's dictionary,
 * and reading it means hashing the string and probing that dictionary, every
 * single time, on every pass of the loop.
 *
 * That is the second recommendation in the official *Maximising MicroPython
 * speed* guide, and it costs one line. It matters most for the things people
 * reach for most: a module-level threshold, a helper function called in a tight
 * loop, an imported name like `sqrt`.
 *
 * Snakie only points at it, for two reasons. The first is that the *name* of the
 * local is a readability decision — `limit = THRESHOLD` reads well, `THRESHOLD =
 * THRESHOLD` does not, and only you know what the value means here. The second
 * matters more: **if anything reassigns that global while the loop runs, caching
 * it changes behaviour.** A flag set by an interrupt handler is exactly that
 * case, and it is common in robot code — bind it to a local and your loop stops
 * noticing the interrupt. Snakie cannot see an interrupt coming, so it will not
 * make this change for you.
 *
 * Constants written in `const()` are skipped: the compiler already inlines those
 * at every use site, so there is nothing left to look up.
 */
import type { AnyNode, FunctionDef, ForStmt, Name, WhileStmt } from '../ast'
import { walk } from '../ast'
import { dottedName } from '../expr'
import { localBindings, namesWritten } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface BindGlobalMatch {
  name: string
  count: number
}

/** Reads before caching is worth suggesting. */
const REPEATS = 2

/** Builtins are looked up too, but rebinding them reads badly; leave them. */
const BUILTINS = new Set([
  'len', 'range', 'int', 'float', 'str', 'bytes', 'bytearray', 'list', 'dict', 'set', 'tuple',
  'print', 'abs', 'min', 'max', 'sum', 'round', 'enumerate', 'zip', 'sorted', 'reversed',
  'isinstance', 'getattr', 'setattr', 'hasattr', 'ord', 'chr', 'hex', 'bin', 'type', 'super',
  'True', 'False', 'None'
])

/** Names assigned at module level, with whether each is a `const()`. */
function moduleBindings(ctx: RefactorContext): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const stmt of ctx.module.body) {
    if (stmt.type === 'Assign') {
      const isConst =
        stmt.value.type === 'Call' && (dottedName(stmt.value.func) ?? '').endsWith('const')
      for (const target of stmt.targets) {
        if (target.type === 'Name') out.set(target.id, isConst)
      }
    } else if (stmt.type === 'FunctionDef' || stmt.type === 'ClassDef') {
      out.set(stmt.name, false)
    } else if (stmt.type === 'Import' || stmt.type === 'ImportFrom') {
      for (const alias of stmt.names) out.set(alias.asname ?? alias.name.split('.')[0], false)
    }
  }
  return out
}

export const bindGlobalToLocalRule = defineRule<BindGlobalMatch>({
  id: 'bind-global-to-local',
  title: 'Bind the global to a local',
  message: 'This global is a dictionary lookup on every pass — bind it to a local first',
  catalogue: 83,
  category: 'micropython',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-bind-global-to-local',
  safe: false,
  // Caching a global that an interrupt reassigns changes behaviour, and Snakie
  // cannot see the interrupt coming.
  hintOnly: true,

  detect(ctx: RefactorContext): RefactorMatch<BindGlobalMatch>[] {
    const globals = moduleBindings(ctx)
    if (globals.size === 0) return []
    const out: RefactorMatch<BindGlobalMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'FunctionDef') return
      const fn = node as FunctionDef
      const params = new Set(fn.params.map((p) => p.name))
      const locals = localBindings(fn.body)

      walk(fn as AnyNode, (inner) => {
        if (inner.type !== 'For' && inner.type !== 'While') return undefined
        const loop = inner as ForStmt | WhileStmt
        const reassigned = namesWritten(loop.body)
        const reads = new Map<string, Name[]>()
        walk(loop as AnyNode, (n) => {
          if (n.type !== 'Name') return undefined
          // An attribute's base is a read; the attribute itself is not a name.
          if (n.parent?.type === 'Attribute' && n.parent.value !== n) return undefined
          const list = reads.get(n.id)
          if (list) list.push(n)
          else reads.set(n.id, [n])
          return undefined
        })

        for (const [name, nodes] of reads) {
          if (nodes.length < REPEATS) continue
          if (BUILTINS.has(name)) continue
          // A parameter or a local is already a slot; nothing to gain.
          if (params.has(name) || locals.has(name)) continue
          const isConst = globals.get(name)
          if (isConst === undefined) continue
          // `const()` is inlined by the compiler — there is no lookup left.
          if (isConst) continue
          // The loop writes it, so it is not the module binding being read.
          if (reassigned.has(name)) continue
          out.push({
            ruleId: 'bind-global-to-local',
            start: nodes[0].start,
            end: nodes[0].end,
            message:
              `\`${name}\` is a global read ${nodes.length} times in this loop — ` +
              'a local is an array index, a global is a dictionary probe',
            data: { name, count: nodes.length }
          })
        }
        return undefined
      })
    })
    return out.sort((a, b) => a.start - b.start)
  },

  apply(): TextEdit[] | null {
    return null
  }
})
