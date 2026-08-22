/**
 * Rule 75 — **Iterate the dictionary directly** (epic #634 §3.8).
 *
 * ```python
 * for name in servos.keys():        for name in servos:
 *     print(name)                       print(name)
 *
 * for name in servos.keys():        for name, value in servos.items():
 *     servos[name].detach()             value.detach()
 * ```
 *
 * Iterating a dictionary already yields its keys, so `.keys()` is a call and a
 * throwaway view object per loop — on a microcontroller that is a real
 * allocation, and it is the sort of thing that shows up as a mysterious
 * `MemoryError` in a long-running loop rather than as slowness.
 *
 * The stronger form matters more. When the body's only use of the key is to
 * look the value straight back up, the loop is asking the dictionary for the
 * same entry twice: once to hand you the key, once to hash it again for
 * `servos[name]`. `.items()` gives you both halves from the one lookup, and the
 * body stops repeating the container's name on every line.
 *
 * We decline when the body mutates the dictionary — adding or removing entries
 * while iterating is a `RuntimeError` waiting to happen, and that code needs a
 * different conversation, not a tidy-up. The dictionary expression must also be
 * pure, so `read_config().keys()` is left alone: dropping the `.keys()` there
 * would still be one call, but the `.items()` form would not be.
 */
import type { AnyNode, Attribute, Call, Expr, ForStmt, Subscript } from '../ast'
import { unwrap, walk } from '../ast'
import { isPureExpression, textOf } from '../expr'
import { freshName, scopeOf } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface DictItemsMatch {
  loop: ForStmt
  /** The `d.keys()` call. */
  call: Call
  /** The `d` half of it. */
  dict: Expr
  /** The `keys` attribute, so we can retarget it precisely. */
  attr: Attribute
  /** Set only for the `.items()` rewrite: the `d[k]` lookups to replace. */
  lookups?: Subscript[]
}

/** Dict methods that change the mapping — iterating over one of those is broken. */
const MUTATORS = new Set(['clear', 'pop', 'popitem', 'setdefault', 'update'])

/** `<expr>.keys()` with no arguments, or null. */
function keysCall(iter: Expr): { call: Call; attr: Attribute; dict: Expr } | null {
  const call = unwrap(iter)
  if (call.type !== 'Call') return null
  if (call.args.length > 0 || call.keywords.length > 0) return null
  const attr = unwrap(call.func)
  if (attr.type !== 'Attribute' || attr.attr !== 'keys') return null
  return { call, attr, dict: attr.value }
}

/** Does anything in `nodes` rebind or mutate the dictionary? */
function mutatesDict(ctx: RefactorContext, nodes: readonly AnyNode[], dictText: string): boolean {
  const isDict = (e: Expr): boolean => textOf(ctx, e).trim() === dictText
  let mutates = false

  /** `d`, `d[k]` and `d.attr` as assignment/`del` targets all count. */
  const target = (expr: Expr): void => {
    const e = unwrap(expr)
    if (e.type === 'Tuple' || e.type === 'List') {
      for (const el of e.elts) target(el)
      return
    }
    if (e.type === 'Starred') return target(e.value)
    if (isDict(e)) mutates = true
    if (e.type === 'Subscript' && isDict(e.value)) mutates = true
    if (e.type === 'Attribute' && isDict(e.value)) mutates = true
  }

  for (const root of nodes) {
    walk(root, (n) => {
      switch (n.type) {
        case 'Assign':
          for (const t of n.targets) target(t)
          return
        case 'AugAssign':
        case 'AnnAssign':
          target(n.target)
          return
        case 'Delete':
          for (const t of n.targets) target(t)
          return
        case 'For':
          target(n.target)
          return
        case 'Call': {
          const fn = unwrap(n.func)
          if (fn.type === 'Attribute' && MUTATORS.has(fn.attr) && isDict(fn.value)) mutates = true
          return
        }
        default:
          return
      }
    })
  }
  return mutates
}

/** Every `Name` node with this id inside `nodes`. */
function namesNamed(nodes: readonly AnyNode[], id: string): AnyNode[] {
  const out: AnyNode[] = []
  for (const root of nodes) {
    walk(root, (n) => {
      if (n.type === 'Name' && n.id === id) out.push(n)
    })
  }
  return out
}

/** Does `nodes` contain a nested scope, whose names we cannot reason about? */
function hasNestedScope(nodes: readonly AnyNode[]): boolean {
  let found = false
  for (const root of nodes) {
    walk(root, (n) => {
      if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') found = true
    })
  }
  return found
}

/**
 * Does `nodes` contain another `for … in <expr>.keys():`? Two nested rewrites
 * would each pick the same fresh value name and the inner one would clobber the
 * outer, so the outer settles for dropping `.keys()`.
 */
function hasNestedKeysLoop(nodes: readonly AnyNode[]): boolean {
  let found = false
  for (const root of nodes) {
    walk(root, (n) => {
      if (n.type === 'For' && keysCall(n.iter)) found = true
    })
  }
  return found
}

/** The rewrite, shared by `detect` and `apply`. */
function rewrite(data: DictItemsMatch): TextEdit[] | null {
  const { loop, call, dict, attr, lookups } = data

  if (!lookups) {
    // Just drop the `.keys()`, leaving every other byte where it was.
    if (dict.end >= call.end) return null
    return [{ start: dict.end, end: call.end, newText: '' }]
  }

  const value = freshName(scopeOf(loop), 'value')
  const edits: TextEdit[] = [
    { start: loop.target.end, end: loop.target.end, newText: `, ${value}` },
    { start: attr.attrStart, end: attr.attrStart + 'keys'.length, newText: 'items' }
  ]
  for (const lookup of lookups) {
    edits.push({ start: lookup.start, end: lookup.end, newText: value })
  }
  return edits
}

export const iterateDictItemsRule = defineRule<DictItemsMatch>({
  id: 'iterate-dict-items',
  title: 'Iterate the dictionary directly',
  message: 'Looping over a dictionary already gives you its keys',
  catalogue: 75,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-iterate-dict-items',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<DictItemsMatch>[] {
    const out: RefactorMatch<DictItemsMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For') return
      const keys = keysCall(node.iter)
      if (!keys) return
      // `read_config().keys()` would become one call instead of one call plus a
      // view — cheaper, but not the same program.
      if (!isPureExpression(keys.dict)) return
      const dictText = textOf(ctx, keys.dict).trim()
      if (!dictText || /[\r\n]/.test(dictText)) return

      const body: AnyNode[] = [...node.body, ...node.orelse]
      // Mutating a dict while iterating it is already broken; that needs fixing,
      // not tidying.
      if (mutatesDict(ctx, body, dictText)) return

      const data: DictItemsMatch = {
        loop: node,
        call: keys.call,
        dict: keys.dict,
        attr: keys.attr
      }

      // The stronger form: the key is only ever used to look the value back up.
      const target = unwrap(node.target)
      if (
        target.type === 'Name' &&
        node.orelse.length === 0 &&
        !hasNestedScope(node.body) &&
        !hasNestedKeysLoop(node.body)
      ) {
        const uses = namesNamed(node.body, target.id)
        const lookups: Subscript[] = []
        let onlyLookups = uses.length > 0
        for (const use of uses) {
          const parent = use.parent
          if (
            parent &&
            parent.type === 'Subscript' &&
            unwrap(parent.slice) === use &&
            textOf(ctx, parent.value).trim() === dictText
          ) {
            lookups.push(parent)
          } else {
            onlyLookups = false
          }
        }
        if (onlyLookups && lookups.length > 0) data.lookups = lookups
      }

      if (!rewrite(data)) return
      out.push({
        ruleId: 'iterate-dict-items',
        start: node.start,
        end: keys.call.end,
        data
      })
    })
    return out
  },

  // Every edit is computed from node offsets already carried in the match, so
  // this one needs no context at all.
  apply(match: RefactorMatch<DictItemsMatch>): TextEdit[] | null {
    return rewrite(match.data)
  }
})
