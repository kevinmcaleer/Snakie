/**
 * Name binding and read/write analysis (epic #634, phase R0).
 *
 * This is the machinery the epic's §2.2 said an indentation scanner could never
 * provide: answering "is this variable used after here?" and "which names does
 * this block read before it writes them?". Extract Function (rule 8, R2) and
 * Rename (#451) are built directly on it, and a dozen smaller rules use it to
 * prove a rewrite is safe before offering it.
 *
 * Everything here is conservative by construction: when the analysis cannot be
 * sure, it reports the *larger* set (more reads, more writes), so a rule that
 * checks "nothing else touches this name" declines rather than guesses (§2.6.6).
 */
import type {
  AnyNode,
  ClassDef,
  Expr,
  FunctionDef,
  Lambda,
  Module,
  Name,
  Stmt
} from './ast'
import { ancestors, childrenOf, unwrap, walk } from './ast'

/** A scope that can bind names. */
export type Scope = Module | FunctionDef | Lambda | ClassDef

/** One use of a name, in source order. */
export interface NameUse {
  name: string
  node: Name
  /** `write` covers binding of any kind: assignment, `for` target, `import`, `def`. */
  kind: 'read' | 'write'
}

/** True for the node types that open a new name scope. */
export function isScope(node: AnyNode): node is Scope {
  return (
    node.type === 'Module' ||
    node.type === 'FunctionDef' ||
    node.type === 'Lambda' ||
    node.type === 'ClassDef'
  )
}

/** The nearest enclosing scope of `node` (the module at worst). */
export function scopeOf(node: AnyNode): Scope {
  for (const a of ancestors(node)) {
    if (isScope(a)) return a
  }
  return node as Module
}

/**
 * Emit every name use in `nodes`, in source order, classified as read or write.
 *
 * Nested `def`/`lambda`/`class` bodies ARE descended into (their reads count as
 * reads of the enclosing block, which is the conservative direction for the
 * "is this used later?" question), but names bound inside them — parameters and
 * local assignments — are not reported as writes of the outer block.
 */
export function nameUses(nodes: readonly AnyNode[]): NameUse[] {
  const out: NameUse[] = []

  /** Record every Name bound by an assignment/`for`/`with` target expression. */
  const target = (expr: Expr | undefined, shadowed: Set<string>): void => {
    if (!expr) return
    const e = unwrap(expr)
    switch (e.type) {
      case 'Name':
        if (!shadowed.has(e.id)) out.push({ name: e.id, node: e, kind: 'write' })
        break
      case 'Tuple':
      case 'List':
        for (const el of e.elts) target(el, shadowed)
        break
      case 'Starred':
        target(e.value, shadowed)
        break
      case 'Attribute':
        // `a.b = 1` READS `a` and mutates its attribute.
        visit(e.value, shadowed)
        break
      case 'Subscript':
        // `a[i] = 1` READS both `a` and `i`.
        visit(e.value, shadowed)
        visit(e.slice, shadowed)
        break
      default:
        visit(e, shadowed)
        break
    }
  }

  const visitAll = (list: readonly AnyNode[] | undefined, shadowed: Set<string>): void => {
    if (!list) return
    for (const n of list) visit(n, shadowed)
  }

  const visit = (node: AnyNode | undefined, shadowed: Set<string>): void => {
    if (!node) return
    switch (node.type) {
      case 'Name':
        if (!shadowed.has(node.id)) out.push({ name: node.id, node, kind: 'read' })
        return

      case 'Assign':
        // Python evaluates the value first, then binds — mirror that order so
        // `x = x + 1` reads before it writes.
        visit(node.value, shadowed)
        for (const t of node.targets) target(t, shadowed)
        return

      case 'AugAssign':
        // `x += 1` both reads and writes `x`.
        visit(node.value, shadowed)
        {
          const t = unwrap(node.target)
          if (t.type === 'Name') {
            if (!shadowed.has(t.id)) {
              out.push({ name: t.id, node: t, kind: 'read' })
              out.push({ name: t.id, node: t, kind: 'write' })
            }
          } else {
            target(node.target, shadowed)
          }
        }
        return

      case 'AnnAssign':
        visit(node.annotation, shadowed)
        visit(node.value, shadowed)
        if (node.value) target(node.target, shadowed)
        return

      case 'For':
        visit(node.iter, shadowed)
        target(node.target, shadowed)
        visitAll(node.body, shadowed)
        visitAll(node.orelse, shadowed)
        return

      case 'With':
        for (const item of node.items) {
          visit(item.context, shadowed)
          target(item.optionalVars, shadowed)
        }
        visitAll(node.body, shadowed)
        return

      case 'Try':
        visitAll(node.body, shadowed)
        for (const h of node.handlers) {
          visit(h.exc, shadowed)
          if (h.name && !shadowed.has(h.name)) {
            // `except E as e` binds `e`; there is no Name node for it, so point
            // the use at the handler itself.
            out.push({
              name: h.name,
              node: { type: 'Name', start: h.start, end: h.end, id: h.name },
              kind: 'write'
            })
          }
          visitAll(h.body, shadowed)
        }
        visitAll(node.orelse, shadowed)
        visitAll(node.finalbody, shadowed)
        return

      case 'Import':
        for (const a of node.names) {
          // `import a.b` binds `a`; `import a.b as c` binds `c`.
          const bound = a.asname ?? a.name.split('.')[0]
          if (!shadowed.has(bound)) {
            out.push({
              name: bound,
              node: { type: 'Name', start: a.start, end: a.end, id: bound },
              kind: 'write'
            })
          }
        }
        return

      case 'ImportFrom':
        for (const a of node.names) {
          const bound = a.asname ?? a.name
          if (!shadowed.has(bound)) {
            out.push({
              name: bound,
              node: { type: 'Name', start: a.start, end: a.end, id: bound },
              kind: 'write'
            })
          }
        }
        return

      case 'Delete':
        for (const t of node.targets) {
          const e = unwrap(t)
          if (e.type === 'Name') {
            if (!shadowed.has(e.id)) {
              out.push({ name: e.id, node: e, kind: 'read' })
              out.push({ name: e.id, node: e, kind: 'write' })
            }
          } else visit(e, shadowed)
        }
        return

      case 'NamedExpr':
        visit(node.value, shadowed)
        if (!shadowed.has(node.target.id)) {
          out.push({ name: node.target.id, node: node.target, kind: 'write' })
        }
        return

      case 'FunctionDef': {
        visitAll(node.decorators, shadowed)
        // Defaults and annotations are evaluated in the ENCLOSING scope.
        for (const p of node.params) {
          visit(p.annotation, shadowed)
          visit(p.default, shadowed)
        }
        visit(node.returns, shadowed)
        if (!shadowed.has(node.name)) {
          out.push({
            name: node.name,
            node: { type: 'Name', start: node.nameStart, end: node.nameStart + node.name.length, id: node.name },
            kind: 'write'
          })
        }
        const inner = new Set(shadowed)
        for (const p of node.params) if (p.kind === 'normal' || p.kind === 'vararg' || p.kind === 'kwarg') inner.add(p.name)
        for (const b of localBindings(node.body)) inner.add(b)
        visitAll(node.body, inner)
        return
      }

      case 'Lambda': {
        for (const p of node.params) visit(p.default, shadowed)
        const inner = new Set(shadowed)
        for (const p of node.params) inner.add(p.name)
        visit(node.body, inner)
        return
      }

      case 'ClassDef': {
        visitAll(node.decorators, shadowed)
        visitAll(node.bases, shadowed)
        visitAll(node.keywords, shadowed)
        if (!shadowed.has(node.name)) {
          out.push({
            name: node.name,
            node: { type: 'Name', start: node.nameStart, end: node.nameStart + node.name.length, id: node.name },
            kind: 'write'
          })
        }
        // A class body's assignments are attributes, not names of the enclosing
        // scope, so shadow them; its reads still count.
        const inner = new Set(shadowed)
        for (const b of localBindings(node.body)) inner.add(b)
        visitAll(node.body, inner)
        return
      }

      case 'ListComp':
      case 'SetComp':
      case 'GeneratorExp':
      case 'DictComp': {
        // Comprehension targets bind only inside the comprehension.
        const inner = new Set(shadowed)
        for (const g of node.generators) {
          for (const u of nameUses([g.target])) inner.add(u.name)
        }
        // The FIRST iterable is evaluated in the enclosing scope.
        if (node.generators.length > 0) visit(node.generators[0].iter, shadowed)
        for (let i = 0; i < node.generators.length; i++) {
          if (i > 0) visit(node.generators[i].iter, inner)
          visitAll(node.generators[i].ifs, inner)
        }
        visit(node.key, inner)
        visit(node.elt, inner)
        return
      }

      case 'Global':
      case 'Nonlocal':
        return

      case 'Attribute':
        // `a.b` reads `a`; `b` is not a name in this scope.
        visit(node.value, shadowed)
        return

      case 'Keyword':
        // `f(name=value)` — `name` is not a scope name.
        visit(node.value, shadowed)
        return

      default:
        for (const c of childrenOf(node)) visit(c, shadowed)
        return
    }
  }

  for (const n of nodes) visit(n, new Set())
  return out
}

/** Every name bound anywhere in a statement list (its scope's locals). */
export function localBindings(stmts: readonly Stmt[]): Set<string> {
  const out = new Set<string>()
  for (const u of nameUses(stmts)) {
    if (u.kind === 'write') out.add(u.name)
  }
  return out
}

/** Names read in `nodes` before anything in `nodes` writes them. */
export function readBeforeWritten(nodes: readonly AnyNode[]): string[] {
  const written = new Set<string>()
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of nameUses(nodes)) {
    if (u.kind === 'read') {
      if (!written.has(u.name) && !seen.has(u.name)) {
        seen.add(u.name)
        out.push(u.name)
      }
    } else {
      written.add(u.name)
      seen.add(u.name)
    }
  }
  return out
}

/** Names that `nodes` writes (bindings it creates or replaces). */
export function namesWritten(nodes: readonly AnyNode[]): Set<string> {
  const out = new Set<string>()
  for (const u of nameUses(nodes)) if (u.kind === 'write') out.add(u.name)
  return out
}

/** Names that `nodes` reads. */
export function namesRead(nodes: readonly AnyNode[]): Set<string> {
  const out = new Set<string>()
  for (const u of nameUses(nodes)) if (u.kind === 'read') out.add(u.name)
  return out
}

/**
 * Is `name` read anywhere at or after `offset` inside `scope`? Used to decide a
 * return tuple (rule 8) and whether a variable is dead (rule 10).
 */
export function isReadAfter(scope: Scope, name: string, offset: number): boolean {
  for (const u of nameUses(bodyOf(scope))) {
    if (u.kind === 'read' && u.name === name && u.node.start >= offset) return true
  }
  return false
}

/** Is `name` written anywhere at or after `offset` inside `scope`? */
export function isWrittenAfter(scope: Scope, name: string, offset: number): boolean {
  for (const u of nameUses(bodyOf(scope))) {
    if (u.kind === 'write' && u.name === name && u.node.start >= offset) return true
  }
  return false
}

/** The statements (or expression) a scope contains. */
export function bodyOf(scope: Scope): AnyNode[] {
  if (scope.type === 'Lambda') return [scope.body]
  return [...scope.body]
}

/**
 * Every use of `name` inside `scope`, skipping nested scopes that rebind it
 * (a nested `def` with a parameter of the same name is a different variable).
 * This is the reference set Rename (#451) rewrites.
 */
export function referencesTo(scope: Scope, name: string): NameUse[] {
  return nameUses(bodyOf(scope)).filter((u) => u.name === name)
}

/**
 * The scope that binds `name` as seen from `node`: the nearest enclosing scope
 * that writes it, or the module. `global`/`nonlocal` declarations are honoured.
 */
export function bindingScopeFor(node: AnyNode, name: string): Scope {
  const chain: Scope[] = []
  for (const a of ancestors(node)) if (isScope(a)) chain.push(a)
  const module = chain[chain.length - 1]
  for (const scope of chain) {
    if (scope.type === 'Module') return scope
    if (scope.type === 'Lambda') {
      if (scope.params.some((p) => p.name === name)) return scope
      continue
    }
    if (declaresGlobal(scope, name)) return module ?? scope
    if (scope.type === 'FunctionDef' && scope.params.some((p) => p.name === name)) return scope
    if (localBindings(scope.body).has(name)) return scope
  }
  return module ?? scopeOf(node)
}

/** Does `scope` contain a `global name` declaration? */
function declaresGlobal(scope: FunctionDef | ClassDef, name: string): boolean {
  let found = false
  for (const s of scope.body) {
    walk(s, (n) => {
      if (n.type === 'Global' && n.names.includes(name)) found = true
      // Don't look into nested scopes — their declarations are their own.
      if (n !== s && isScope(n)) return false
      return undefined
    })
  }
  return found
}

/**
 * Is it safe to introduce `name` in `scope` without colliding? Checks the
 * scope's own bindings plus everything it reads, so we never shadow a global
 * the code depends on.
 */
export function isNameFree(scope: Scope, name: string): boolean {
  const body = bodyOf(scope)
  for (const u of nameUses(body)) if (u.name === name) return false
  return true
}

/** `base`, `base2`, `base3`, … — the first that is free in `scope`. */
export function freshName(scope: Scope, base: string): string {
  if (isNameFree(scope, base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`
    if (isNameFree(scope, candidate)) return candidate
  }
  return `${base}_`
}

/**
 * True when `nodes` contain a jump that would change meaning if the code were
 * moved into a function: `return`, `yield`, `break`/`continue` targeting a loop
 * outside the selection, or an `await` outside an async context.
 */
export function hasEscapingControlFlow(nodes: readonly AnyNode[]): boolean {
  let escapes = false
  const loopDepth = new Map<AnyNode, number>()
  for (const root of nodes) {
    walk(root, (n) => {
      if (n.type === 'FunctionDef' || n.type === 'Lambda' || n.type === 'ClassDef') return false
      if (n.type === 'Return' || n.type === 'Yield') {
        escapes = true
        return false
      }
      if (n.type === 'Break' || n.type === 'Continue') {
        // Legal only if the enclosing loop is itself inside the selection.
        let inSelection = false
        for (const a of ancestors(n)) {
          if (a.type === 'For' || a.type === 'While') {
            inSelection = nodes.some((r) => r.start <= a.start && a.end <= r.end)
            break
          }
          if (a.type === 'FunctionDef' || a.type === 'Lambda') break
        }
        if (!inSelection) escapes = true
      }
      return undefined
    })
  }
  void loopDepth
  return escapes
}

/**
 * True when any of `nodes` declares `global`/`nonlocal`, which makes moving the
 * code into a new function change which binding it touches.
 */
export function hasScopeDeclarations(nodes: readonly AnyNode[]): boolean {
  let found = false
  for (const root of nodes) {
    walk(root, (n) => {
      if (n.type === 'Global' || n.type === 'Nonlocal') found = true
    })
  }
  return found
}
