/**
 * The Python AST the refactoring engine works against (epic #634, phase R0).
 *
 * A typed, discriminated union rather than a generic CST: with ~90 rules in the
 * catalogue, having the compiler check `node.test` / `node.body` is worth the
 * extra declarations, and it makes each rule read like the smell it detects.
 *
 * Every node carries `start`/`end` offsets into the ORIGINAL source, because
 * every rewrite is a ranged text edit computed from those offsets — we never
 * unparse the tree (epic §2.2). `parent` is filled in by {@link linkParents}
 * after parsing so rules can walk upwards ("is this `if` the whole body of its
 * function?") without threading context through every visitor.
 *
 * Not modelled: `match` statements (MicroPython has no `match`, and a soft
 * keyword that is also a very common variable name is not worth the ambiguity).
 * A file using one fails to parse, which the engine treats as "offer nothing" —
 * the safe direction.
 */

/** Fields every node has. */
export interface NodeBase {
  /** Offset of the first character of the node in the source. */
  start: number
  /** Offset one past the last character of the node. */
  end: number
  /** Set by {@link linkParents}; absent on the module root. */
  parent?: AnyNode
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

/** A bare name: `motor`, `Pin`, `i`. */
export interface Name extends NodeBase {
  type: 'Name'
  id: string
}

/** A literal. `kind` distinguishes what the rules care about. */
export interface Constant extends NodeBase {
  type: 'Constant'
  kind: 'number' | 'string' | 'bool' | 'none' | 'ellipsis'
  /** Exactly as written, including any quotes and string prefix. */
  raw: string
  /** Lower-cased string prefix (`f`, `rb`, …); '' for plain strings/non-strings. */
  prefix?: string
}

/** `a.b` — `attr` is the name after the dot. */
export interface Attribute extends NodeBase {
  type: 'Attribute'
  value: Expr
  attr: string
  /** Offset of the attribute name itself (for precise edits). */
  attrStart: number
}

/** `a[b]`. */
export interface Subscript extends NodeBase {
  type: 'Subscript'
  value: Expr
  slice: Expr
}

/** `a:b:c` inside a subscript. */
export interface SliceExpr extends NodeBase {
  type: 'Slice'
  lower?: Expr
  upper?: Expr
  step?: Expr
}

/** A keyword argument. `arg` absent means `**kwargs` expansion. */
export interface Keyword extends NodeBase {
  type: 'Keyword'
  arg?: string
  value: Expr
}

/** `f(a, b=1, *rest, **kw)`. Star-args appear in `args` as {@link Starred}. */
export interface Call extends NodeBase {
  type: 'Call'
  func: Expr
  args: Expr[]
  keywords: Keyword[]
}

/** `*x` in a call, assignment target or display. */
export interface Starred extends NodeBase {
  type: 'Starred'
  value: Expr
}

/** `a + b`, `a << b`, `a @ b`, … */
export interface BinOp extends NodeBase {
  type: 'BinOp'
  left: Expr
  op: string
  right: Expr
  /** Offset of the operator token. */
  opStart: number
}

/** `not a`, `-a`, `+a`, `~a`. */
export interface UnaryOp extends NodeBase {
  type: 'UnaryOp'
  op: 'not' | '-' | '+' | '~'
  operand: Expr
}

/** `a and b and c` / `a or b` — flattened, so `values.length >= 2`. */
export interface BoolOp extends NodeBase {
  type: 'BoolOp'
  op: 'and' | 'or'
  values: Expr[]
}

/** `a < b <= c` — chained, so `ops.length === comparators.length`. */
export interface Compare extends NodeBase {
  type: 'Compare'
  left: Expr
  /** `<`, `>`, `<=`, `>=`, `==`, `!=`, `in`, `not in`, `is`, `is not`. */
  ops: string[]
  comparators: Expr[]
}

/** `a if cond else b`. */
export interface IfExp extends NodeBase {
  type: 'IfExp'
  test: Expr
  body: Expr
  orelse: Expr
}

/** `lambda a, b=1: expr`. */
export interface Lambda extends NodeBase {
  type: 'Lambda'
  params: Param[]
  body: Expr
}

/** `[a, b]`. */
export interface ListExpr extends NodeBase {
  type: 'List'
  elts: Expr[]
}

/** `(a, b)` or a bare `a, b`. `parenthesized` matters for rewrites. */
export interface TupleExpr extends NodeBase {
  type: 'Tuple'
  elts: Expr[]
  parenthesized: boolean
}

/** `{a, b}`. */
export interface SetExpr extends NodeBase {
  type: 'Set'
  elts: Expr[]
}

/** `{k: v, **rest}` — a null key marks `**rest`. */
export interface DictExpr extends NodeBase {
  type: 'Dict'
  keys: (Expr | null)[]
  values: Expr[]
}

/** One `for … in … if …` clause of a comprehension. */
export interface Comprehension extends NodeBase {
  type: 'Comprehension'
  target: Expr
  iter: Expr
  ifs: Expr[]
  isAsync: boolean
}

/** `[x for x in xs]` and friends; `key` is set only for a dict comprehension. */
export interface CompExpr extends NodeBase {
  type: 'ListComp' | 'SetComp' | 'GeneratorExp' | 'DictComp'
  key?: Expr
  elt: Expr
  generators: Comprehension[]
}

/** `await x`. */
export interface Await extends NodeBase {
  type: 'Await'
  value: Expr
}

/** `yield x` / `yield from x`. */
export interface Yield extends NodeBase {
  type: 'Yield'
  value?: Expr
  isFrom: boolean
}

/** `x := 1`. */
export interface NamedExpr extends NodeBase {
  type: 'NamedExpr'
  target: Name
  value: Expr
}

/** A parenthesised expression, kept so rewrites can drop redundant parens. */
export interface Group extends NodeBase {
  type: 'Group'
  value: Expr
}

/** Any expression node. */
export type Expr =
  | Name
  | Constant
  | Attribute
  | Subscript
  | SliceExpr
  | Call
  | Starred
  | BinOp
  | UnaryOp
  | BoolOp
  | Compare
  | IfExp
  | Lambda
  | ListExpr
  | TupleExpr
  | SetExpr
  | DictExpr
  | CompExpr
  | Await
  | Yield
  | NamedExpr
  | Group

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/** One parameter of a `def` or `lambda`. */
export interface Param extends NodeBase {
  type: 'Param'
  name: string
  kind: 'normal' | 'vararg' | 'kwarg' | 'posonly-marker' | 'kwonly-marker'
  annotation?: Expr
  default?: Expr
}

/** `import a.b as c, d`. */
export interface ImportAlias extends NodeBase {
  type: 'ImportAlias'
  name: string
  asname?: string
}

/** `with open(p) as f:` — one item. */
export interface WithItem extends NodeBase {
  type: 'WithItem'
  context: Expr
  optionalVars?: Expr
}

/** `except ValueError as e:` — one handler. */
export interface ExceptHandler extends NodeBase {
  type: 'ExceptHandler'
  /** Absent for a bare `except:`. */
  exc?: Expr
  name?: string
  body: Stmt[]
  isStar: boolean
}

export interface Module extends NodeBase {
  type: 'Module'
  body: Stmt[]
}

export interface FunctionDef extends NodeBase {
  type: 'FunctionDef'
  name: string
  /** Offset of the function's name token. */
  nameStart: number
  params: Param[]
  returns?: Expr
  body: Stmt[]
  decorators: Expr[]
  isAsync: boolean
  /** Offset of the `def`/`async` keyword (decorators start earlier). */
  defStart: number
}

export interface ClassDef extends NodeBase {
  type: 'ClassDef'
  name: string
  nameStart: number
  bases: Expr[]
  keywords: Keyword[]
  body: Stmt[]
  decorators: Expr[]
  /** Offset of the `class` keyword. */
  defStart: number
}

export interface Return extends NodeBase {
  type: 'Return'
  value?: Expr
}

export interface Delete extends NodeBase {
  type: 'Delete'
  targets: Expr[]
}

/** `a = b = value` — every target gets `value`. */
export interface Assign extends NodeBase {
  type: 'Assign'
  targets: Expr[]
  value: Expr
}

export interface AugAssign extends NodeBase {
  type: 'AugAssign'
  target: Expr
  /** The operator without the `=`, e.g. `+`. */
  op: string
  value: Expr
}

export interface AnnAssign extends NodeBase {
  type: 'AnnAssign'
  target: Expr
  annotation: Expr
  value?: Expr
}

export interface ForStmt extends NodeBase {
  type: 'For'
  target: Expr
  iter: Expr
  body: Stmt[]
  orelse: Stmt[]
  isAsync: boolean
}

export interface WhileStmt extends NodeBase {
  type: 'While'
  test: Expr
  body: Stmt[]
  orelse: Stmt[]
}

/**
 * `if` / `elif` / `else`. An `elif` is represented as a single nested `If` in
 * `orelse`, with `isElif` set so a rewrite can tell it apart from `else: if …`.
 */
export interface IfStmt extends NodeBase {
  type: 'If'
  test: Expr
  body: Stmt[]
  orelse: Stmt[]
  isElif: boolean
  /** Offset of the `else`/`elif` keyword, when there is one. */
  orelseStart?: number
}

export interface WithStmt extends NodeBase {
  type: 'With'
  items: WithItem[]
  body: Stmt[]
  isAsync: boolean
}

export interface Raise extends NodeBase {
  type: 'Raise'
  exc?: Expr
  cause?: Expr
}

export interface TryStmt extends NodeBase {
  type: 'Try'
  body: Stmt[]
  handlers: ExceptHandler[]
  orelse: Stmt[]
  finalbody: Stmt[]
}

export interface Assert extends NodeBase {
  type: 'Assert'
  test: Expr
  msg?: Expr
}

export interface Import extends NodeBase {
  type: 'Import'
  names: ImportAlias[]
}

export interface ImportFrom extends NodeBase {
  type: 'ImportFrom'
  /** Absent for `from . import x`. */
  module?: string
  names: ImportAlias[]
  /** Number of leading dots. */
  level: number
  /** True for `from x import *`. */
  isStar: boolean
}

export interface Global extends NodeBase {
  type: 'Global'
  names: string[]
}

export interface Nonlocal extends NodeBase {
  type: 'Nonlocal'
  names: string[]
}

/** A bare expression used as a statement. */
export interface ExprStmt extends NodeBase {
  type: 'ExprStmt'
  value: Expr
}

export interface Pass extends NodeBase {
  type: 'Pass'
}
export interface Break extends NodeBase {
  type: 'Break'
}
export interface Continue extends NodeBase {
  type: 'Continue'
}

/** Any statement node. */
export type Stmt =
  | FunctionDef
  | ClassDef
  | Return
  | Delete
  | Assign
  | AugAssign
  | AnnAssign
  | ForStmt
  | WhileStmt
  | IfStmt
  | WithStmt
  | Raise
  | TryStmt
  | Assert
  | Import
  | ImportFrom
  | Global
  | Nonlocal
  | ExprStmt
  | Pass
  | Break
  | Continue

/** Any node at all, including the helper nodes that are neither. */
export type AnyNode =
  | Module
  | Stmt
  | Expr
  | Param
  | ImportAlias
  | WithItem
  | ExceptHandler
  | Keyword
  | Comprehension

/** Statement types that own an indented block (used by nesting rules). */
export const BLOCK_STATEMENTS = new Set([
  'FunctionDef',
  'ClassDef',
  'For',
  'While',
  'If',
  'With',
  'Try'
])

/** Statements that end control flow in their block. */
export const TERMINATORS = new Set(['Return', 'Raise', 'Break', 'Continue'])

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/** Direct children of a node, in source order. Never returns undefined slots. */
export function childrenOf(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = []
  const add = (x: AnyNode | null | undefined): void => {
    if (x) out.push(x)
  }
  const addAll = (xs: readonly (AnyNode | null | undefined)[] | undefined): void => {
    if (xs) for (const x of xs) add(x)
  }
  switch (node.type) {
    case 'Module':
      addAll(node.body)
      break
    case 'FunctionDef':
      addAll(node.decorators)
      addAll(node.params)
      add(node.returns)
      addAll(node.body)
      break
    case 'ClassDef':
      addAll(node.decorators)
      addAll(node.bases)
      addAll(node.keywords)
      addAll(node.body)
      break
    case 'Return':
      add(node.value)
      break
    case 'Delete':
      addAll(node.targets)
      break
    case 'Assign':
      addAll(node.targets)
      add(node.value)
      break
    case 'AugAssign':
      add(node.target)
      add(node.value)
      break
    case 'AnnAssign':
      add(node.target)
      add(node.annotation)
      add(node.value)
      break
    case 'For':
      add(node.target)
      add(node.iter)
      addAll(node.body)
      addAll(node.orelse)
      break
    case 'While':
      add(node.test)
      addAll(node.body)
      addAll(node.orelse)
      break
    case 'If':
      add(node.test)
      addAll(node.body)
      addAll(node.orelse)
      break
    case 'With':
      addAll(node.items)
      addAll(node.body)
      break
    case 'WithItem':
      add(node.context)
      add(node.optionalVars)
      break
    case 'Raise':
      add(node.exc)
      add(node.cause)
      break
    case 'Try':
      addAll(node.body)
      addAll(node.handlers)
      addAll(node.orelse)
      addAll(node.finalbody)
      break
    case 'ExceptHandler':
      add(node.exc)
      addAll(node.body)
      break
    case 'Assert':
      add(node.test)
      add(node.msg)
      break
    case 'Import':
      addAll(node.names)
      break
    case 'ImportFrom':
      addAll(node.names)
      break
    case 'ExprStmt':
      add(node.value)
      break
    case 'Param':
      add(node.annotation)
      add(node.default)
      break
    case 'Attribute':
      add(node.value)
      break
    case 'Subscript':
      add(node.value)
      add(node.slice)
      break
    case 'Slice':
      add(node.lower)
      add(node.upper)
      add(node.step)
      break
    case 'Call':
      add(node.func)
      addAll(node.args)
      addAll(node.keywords)
      break
    case 'Keyword':
      add(node.value)
      break
    case 'Starred':
      add(node.value)
      break
    case 'BinOp':
      add(node.left)
      add(node.right)
      break
    case 'UnaryOp':
      add(node.operand)
      break
    case 'BoolOp':
      addAll(node.values)
      break
    case 'Compare':
      add(node.left)
      addAll(node.comparators)
      break
    case 'IfExp':
      // Source order is body, test, orelse — but children order only matters
      // for pretty printing, which we never do. Keep it evaluation-ordered.
      add(node.test)
      add(node.body)
      add(node.orelse)
      break
    case 'Lambda':
      addAll(node.params)
      add(node.body)
      break
    case 'List':
    case 'Tuple':
    case 'Set':
      addAll(node.elts)
      break
    case 'Dict':
      for (let i = 0; i < node.values.length; i++) {
        add(node.keys[i])
        add(node.values[i])
      }
      break
    case 'ListComp':
    case 'SetComp':
    case 'GeneratorExp':
    case 'DictComp':
      add(node.key)
      add(node.elt)
      addAll(node.generators)
      break
    case 'Comprehension':
      add(node.target)
      add(node.iter)
      addAll(node.ifs)
      break
    case 'Await':
      add(node.value)
      break
    case 'Yield':
      add(node.value)
      break
    case 'NamedExpr':
      add(node.target)
      add(node.value)
      break
    case 'Group':
      add(node.value)
      break
    default:
      break
  }
  return out
}

/** Depth-first pre-order visit. Return `false` from `fn` to skip a subtree. */
export function walk(node: AnyNode, fn: (n: AnyNode) => void | false): void {
  if (fn(node) === false) return
  for (const child of childrenOf(node)) walk(child, fn)
}

/** Every node in the subtree, pre-order. */
export function collect(node: AnyNode, match: (n: AnyNode) => boolean): AnyNode[] {
  const out: AnyNode[] = []
  walk(node, (n) => {
    if (match(n)) out.push(n)
  })
  return out
}

/** Assign `parent` on every node in the tree. Called once after parsing. */
export function linkParents(root: AnyNode, parent?: AnyNode): void {
  root.parent = parent
  for (const child of childrenOf(root)) linkParents(child, root)
}

/** Walk up from `node` (exclusive) to the module root. */
export function ancestors(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = []
  let cur = node.parent
  while (cur) {
    out.push(cur)
    cur = cur.parent
  }
  return out
}

/** The nearest enclosing `def` (or `lambda`), or null at module scope. */
export function enclosingFunction(node: AnyNode): FunctionDef | Lambda | null {
  for (const a of ancestors(node)) {
    if (a.type === 'FunctionDef' || a.type === 'Lambda') return a
  }
  return null
}

/** The nearest enclosing `for`/`while`, stopping at a function boundary. */
export function enclosingLoop(node: AnyNode): ForStmt | WhileStmt | null {
  for (const a of ancestors(node)) {
    if (a.type === 'For' || a.type === 'While') return a
    if (a.type === 'FunctionDef' || a.type === 'Lambda' || a.type === 'ClassDef') return null
  }
  return null
}

/** True when `inner` lies within `outer`'s source range. */
export function contains(outer: NodeBase, inner: NodeBase): boolean {
  return outer.start <= inner.start && inner.end <= outer.end
}

/** Strip any redundant {@link Group} wrappers to get at the real expression. */
export function unwrap(expr: Expr): Expr {
  let e = expr
  while (e.type === 'Group') e = e.value
  return e
}

/** All statement lists a block statement owns (body, else, handlers, finally). */
export function blocksOf(node: AnyNode): Stmt[][] {
  switch (node.type) {
    case 'Module':
      return [node.body]
    case 'FunctionDef':
    case 'ClassDef':
    case 'With':
      return [node.body]
    case 'For':
    case 'While':
    case 'If':
      return node.orelse.length ? [node.body, node.orelse] : [node.body]
    case 'Try':
      return [node.body, ...node.handlers.map((h) => h.body), node.orelse, node.finalbody].filter(
        (b) => b.length > 0
      )
    default:
      return []
  }
}
