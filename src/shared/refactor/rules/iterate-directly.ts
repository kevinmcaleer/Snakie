/**
 * Rule 18 — **Iterate over the items directly** (epic #634 §3.4).
 *
 * ```python
 * for i in range(len(readings)):     for reading in readings:
 *     if readings[i] > best:             if reading > best:
 *         best = readings[i]                 best = reading
 * ```
 *
 * `range(len(...))` is the single most common thing a beginner brings with them
 * from C, and it costs them twice: an index they have to keep in step by hand,
 * and a subscript on every use — which on a microcontroller is a real `__getitem__`
 * call per access, not free. Python's `for` already hands you the item.
 *
 * When the index genuinely is needed as well — a pixel number, a channel id —
 * the answer is `enumerate`, not a manual counter:
 *
 * ```python
 * for i in range(len(pixels)):       for i, pixel in enumerate(pixels):
 *     strip.set_pixel(i, pixels[i])      strip.set_pixel(i, pixel)
 * ```
 *
 * The rule is deliberately timid about *which* `range(len(xs))` loops it will
 * touch. `for i in range(len(xs))` freezes the length once; `for item in xs`
 * follows the live sequence, so a body that appends to, pops from or reassigns
 * `xs` is a different program. We therefore insist that every mention of the
 * sequence inside the body is one of the `xs[i]` reads we are about to replace —
 * anything else (a `.append`, another `len`, a rebind) and we decline. Writing
 * *through* the index (`xs[i] = 0`) is declined for the same reason: that loop
 * is not iterating values, it is filling a buffer.
 *
 * The one assumption left standing — the same one pylint's `consider-using-
 * enumerate` has made for years — is that `xs` is a **sequence**. Iterating a
 * dict yields its keys rather than `xs[i]`, but a dict indexed by `range(len(...))`
 * is already a list wearing the wrong type, so we let that one go.
 */
import type { AnyNode, Expr, ForStmt, Stmt, Subscript } from '../ast'
import { ancestors, unwrap, walk } from '../ast'
import { dottedName, isPureExpression, textOf } from '../expr'
import { freshName, namesWritten, nameUses, bodyOf, scopeOf } from '../scope'
import type { Scope } from '../scope'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface IterateDirectlyMatch {
  loop: ForStmt
  /** The sequence being indexed — `readings`, `self.motors`. Always a dotted name. */
  seq: Expr
  /** The `xs[i]` subscripts that become the new loop variable. */
  indexed: Subscript[]
  /** True when `i` is still wanted, so the rewrite goes through `enumerate`. */
  needsIndex: boolean
}

/** Names we must never hand back as a loop variable. */
const RESERVED = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'False',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'True',
  'try',
  'while',
  'with',
  'yield'
])

/** Scope-opening nodes: a reference inside one is not ours to rewrite. */
const NESTED_SCOPES = new Set([
  'FunctionDef',
  'Lambda',
  'ClassDef',
  'ListComp',
  'SetComp',
  'GeneratorExp',
  'DictComp'
])

/** `range(len(xs))` → the `xs` expression; null for anything else. */
function rangeLenArgument(iter: Expr): Expr | null {
  const outer = unwrap(iter)
  if (outer.type !== 'Call' || outer.args.length !== 1 || outer.keywords.length > 0) return null
  if (dottedName(outer.func) !== 'range') return null
  const inner = unwrap(outer.args[0])
  if (inner.type !== 'Call' || inner.args.length !== 1 || inner.keywords.length > 0) return null
  if (dottedName(inner.func) !== 'len') return null
  return unwrap(inner.args[0])
}

/**
 * A readable singular for the loop variable: `readings` → `reading`,
 * `self.motors` → `motor`. Anything we cannot singularise sensibly becomes
 * `item`, which always reads correctly even if it is not as descriptive.
 */
function itemBaseName(seqName: string): string {
  const last = seqName.split('.').pop() ?? ''
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(last) && last.endsWith('s') && !last.endsWith('ss')) {
    const singular = last.slice(0, -1)
    if (singular.length >= 2 && !RESERVED.has(singular)) return singular
  }
  return 'item'
}

/** Is `node` (or a tuple/list containing it) the target of a binding? */
function isWriteTarget(node: AnyNode): boolean {
  const parent = node.parent
  if (!parent) return false
  switch (parent.type) {
    case 'Assign':
      return parent.targets.includes(node as Expr)
    case 'AugAssign':
    case 'AnnAssign':
      return parent.target === node
    case 'Delete':
      return parent.targets.includes(node as Expr)
    case 'For':
      return parent.target === node
    case 'WithItem':
      return parent.optionalVars === node
    case 'Tuple':
    case 'List':
    case 'Starred':
      return isWriteTarget(parent)
    default:
      return false
  }
}

/** True when `node` sits inside a `def`/`lambda`/`class`/comprehension under `root`. */
function insideNestedScope(node: AnyNode, root: AnyNode): boolean {
  let cur = node.parent
  while (cur && cur !== root) {
    if (NESTED_SCOPES.has(cur.type)) return true
    cur = cur.parent
  }
  return false
}

/**
 * Is `name` still live at `offset` — read before anything rebinds it? A later
 * loop that reuses the same variable name rebinds it first, so it does not count
 * as a use of ours.
 */
function liveAfter(scope: Scope, name: string, offset: number): boolean {
  for (const use of nameUses(bodyOf(scope))) {
    if (use.name !== name || use.node.start < offset) continue
    return use.kind === 'read'
  }
  return false
}

/**
 * Has the file rebound one of the built-ins this rewrite leans on? `range`,
 * `len` and `enumerate` are only interchangeable while they still mean what
 * Python means by them.
 */
function builtinRebound(ctx: RefactorContext, node: AnyNode, name: string): boolean {
  if (namesWritten(ctx.module.body).has(name)) return true
  for (const a of ancestors(node)) {
    if (a.type === 'FunctionDef') {
      if (a.params.some((p) => p.name === name)) return true
      if (namesWritten(a.body).has(name)) return true
    } else if (a.type === 'ClassDef' && namesWritten(a.body).has(name)) {
      return true
    }
  }
  return false
}

/** Is `name` declared `global`/`nonlocal` here, so dropping its binding is visible elsewhere? */
function declaredOutside(node: AnyNode, name: string): boolean {
  const scope = scopeOf(node)
  if (scope.type === 'Lambda' || scope.type === 'Module') return false
  let found = false
  for (const stmt of scope.body) {
    walk(stmt, (n) => {
      if ((n.type === 'Global' || n.type === 'Nonlocal') && n.names.includes(name)) found = true
      if (n !== stmt && NESTED_SCOPES.has(n.type)) return false
      return undefined
    })
  }
  return found
}

export const iterateDirectlyRule = defineRule<IterateDirectlyMatch>({
  id: 'iterate-directly',
  title: 'Iterate over the items directly',
  message: '`range(len(...))` — loop over the sequence itself instead of an index',
  catalogue: 18,
  category: 'loops',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-iterate-directly',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<IterateDirectlyMatch>[] {
    const out: RefactorMatch<IterateDirectlyMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'For' || node.isAsync) return
      // `for … else` leaves the counter bound for the else branch to read.
      if (node.orelse.length > 0) return

      const target = unwrap(node.target)
      if (target.type !== 'Name') return
      const seq = rangeLenArgument(node.iter)
      if (!seq) return
      const seqName = dottedName(seq)
      // A dotted name is the only shape we can compare by text with confidence,
      // and purity means naming it twice cannot cost a device read.
      if (!seqName || !isPureExpression(seq)) return

      const counter = target.id
      if (seqName === counter || seqName.split('.')[0] === counter) return

      // `range(len(xs))` only means "the indices of xs" while both built-ins do.
      if (builtinRebound(ctx, node, 'range') || builtinRebound(ctx, node, 'len')) return
      // A `global i` makes the counter someone else's variable too.
      if (declaredOutside(node, counter)) return

      const body = node.body as Stmt[]
      // Rebinding the counter mid-body would make `xs[i]` mean something else.
      if (namesWritten(body).has(counter)) return
      // Rebinding what the sequence hangs off (`self = other`) swaps it wholesale
      // without ever naming it, which the mention scan below would not see.
      if (namesWritten(body).has(seqName.split('.')[0])) return

      const indexed: Subscript[] = []
      const indexSlices = new Set<AnyNode>()
      let declined = false

      for (const stmt of body) {
        walk(stmt, (n) => {
          if (declined) return false
          if (n.type !== 'Name' && n.type !== 'Attribute') return undefined
          if (dottedName(n as Expr) !== seqName) return undefined
          // Every mention of the sequence must be an `xs[i]` read; anything else
          // could mutate or rebind it, which iteration would not survive.
          const parent = n.parent
          if (!parent || parent.type !== 'Subscript' || parent.value !== n) {
            declined = true
            return false
          }
          const slice = unwrap(parent.slice)
          if (slice.type !== 'Name' || slice.id !== counter) {
            declined = true
            return false
          }
          if (isWriteTarget(parent) || insideNestedScope(n, node)) {
            declined = true
            return false
          }
          indexed.push(parent)
          indexSlices.add(slice)
          return undefined
        })
        if (declined) return
      }
      if (indexed.length === 0) return

      // Whatever is left of `i` decides between a plain loop and `enumerate`.
      let otherUse = false
      for (const stmt of body) {
        walk(stmt, (n) => {
          if (n.type !== 'Name' || n.id !== counter || indexSlices.has(n)) return undefined
          otherUse = true
          if (insideNestedScope(n, node)) declined = true
          return undefined
        })
      }
      if (declined) return

      const scope = scopeOf(node)
      const needsIndex = otherUse || liveAfter(scope, counter, node.end)
      if (needsIndex && builtinRebound(ctx, node, 'enumerate')) return

      out.push({
        ruleId: 'iterate-directly',
        start: node.start,
        end: node.iter.end,
        data: { loop: node, seq, indexed, needsIndex }
      })
    })
    return out
  },

  apply(match: RefactorMatch<IterateDirectlyMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { loop, seq, indexed, needsIndex } = match.data
    const target = unwrap(loop.target)
    if (target.type !== 'Name') return null

    const seqText = textOf(ctx, seq)
    if (/[\r\n]/.test(seqText)) return null

    const seqName = dottedName(seq)
    if (!seqName) return null

    const itemName = freshName(scopeOf(loop as AnyNode), itemBaseName(seqName))
    if (itemName === target.id || RESERVED.has(itemName)) return null

    const header = needsIndex
      ? `${target.id}, ${itemName} in enumerate(${seqText})`
      : `${itemName} in ${seqText}`

    const edits: TextEdit[] = [{ start: loop.target.start, end: loop.iter.end, newText: header }]
    for (const sub of indexed) {
      edits.push({ start: sub.start, end: sub.end, newText: itemName })
    }
    return edits
  }
})
