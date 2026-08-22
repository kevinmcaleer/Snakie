/**
 * Rule 10 — **Inline the variable** (epic #634 §3.2).
 *
 * ```python
 * def duty_for(angle):                def duty_for(angle):
 *     span = MAX_DUTY - MIN_DUTY          return MIN_DUTY + (MAX_DUTY - MIN_DUTY) * angle // 180
 *     return MIN_DUTY + span * angle // 180
 * ```
 *
 * The mirror image of rule 9. A name earns its keep when it says something the
 * expression does not, or when it saves the reader from working the same thing
 * out twice. A name used exactly once, that says no more than the expression it
 * holds, does neither — it just puts a step between the reader and the answer.
 * Removing it is how you tell whether the name was pulling its weight: if the
 * inlined line is harder to read, the name was doing real work and you keep it.
 *
 * **The trap this rule spends most of its effort on** is what the expression
 * *sees*. Moving `speed + step` down to where the variable was used means it is
 * evaluated later, so anything that rewrites `speed` in between changes the
 * answer:
 *
 * ```python
 * step = base + rate
 * while base < LIMIT:
 *     base = base + step     # inlining `step` here would compound the climb
 * ```
 *
 * So every name the expression reads has to be provably untouched between the
 * assignment and the use. A reader inside a loop the assignment sits outside of
 * is refused outright: source order stops answering "what changed in between"
 * once the body's later lines run before the next pass's reader, and on a
 * microcontroller it would turn one calculation into one per pass. A `global`
 * declaration anywhere in the file is a refusal too — some call in between could
 * be rewriting the name without ever naming it.
 *
 * The value must also be **pure**. Inlining `raw = sensor.read_u16()` moves a
 * hardware read to a different moment, which is a change to the program, not a
 * tidy-up.
 *
 * Attributes get a tighter version of the same test. `x = self.speed * 2` reads
 * `self`, but `self.speed = 0` is a *read* of `self` too, and `self.stop()` can
 * rewrite the attribute without naming it — so the name analysis cannot see the
 * value move on. Where the expression reaches through a dot, the reader has to be
 * the very next statement, with no call, no attribute write and no short-circuit
 * ahead of it: nothing at all runs in between, so nothing can have changed.
 *
 * Two names are left alone on principle rather than on safety: a
 * `SCREAMING_SNAKE_CASE` constant, which is the author saying the *name* is the
 * point (and which rules 14 and 34 exist to encourage), and any assignment with
 * a comment sitting on top of it, whose comment would otherwise be left
 * describing whatever line moved up into its place.
 */
import type { AnyNode, Assign, Expr, Name, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { isPureExpression, textOf } from '../expr'
import { bodyOf, nameUses, namesRead, referencesTo, scopeOf } from '../scope'
import { lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface InlineVariableMatch {
  /** The assignment whose line disappears. */
  assign: Assign
  /** The one place the name is read. */
  read: Name
  /** The name being removed, for the message. */
  name: string
}

/** Nodes that open a scope of their own — a use in there runs at another time. */
const NESTED_SCOPES = new Set([
  'FunctionDef',
  'Lambda',
  'ClassDef',
  'ListComp',
  'SetComp',
  'GeneratorExp',
  'DictComp'
])

/**
 * Expression forms that never need parentheses wherever they are dropped: they
 * are already a single atom in the grammar. (A `Tuple` joins them only when the
 * author wrote the brackets — a bare `a, b` is handled separately.)
 */
const ATOMIC = new Set([
  'Name',
  'Constant',
  'Call',
  'Attribute',
  'Subscript',
  'Group',
  'List',
  'Set',
  'Dict'
])

/** Expression forms that bind looser than a comparison. */
const LOOSE = new Set(['Lambda', 'IfExp', 'NamedExpr', 'Yield', 'Await'])

/** Every statement list a node owns, as the node's own arrays. */
function listsOf(node: AnyNode): Stmt[][] {
  switch (node.type) {
    case 'Module':
    case 'FunctionDef':
    case 'ClassDef':
    case 'With':
    case 'ExceptHandler':
      return [node.body]
    case 'For':
    case 'While':
    case 'If':
      return [node.body, node.orelse]
    case 'Try':
      return [node.body, node.orelse, node.finalbody]
    default:
      return []
  }
}

/** The block `node` belongs to, and where in it. */
function slotOf(node: AnyNode): { list: Stmt[]; stmt: Stmt; index: number } | null {
  let cur: AnyNode = node
  let parent = node.parent
  while (parent) {
    for (const list of listsOf(parent)) {
      const index = list.indexOf(cur as Stmt)
      if (index >= 0) return { list, stmt: cur as Stmt, index }
    }
    cur = parent
    parent = parent.parent
  }
  return null
}

/** Which statement of `list` contains `node`, if any. */
function memberOf(node: AnyNode, list: Stmt[]): { stmt: Stmt; index: number } | null {
  let cur: AnyNode | undefined = node
  while (cur) {
    const index = list.indexOf(cur as Stmt)
    if (index >= 0) return { stmt: cur as Stmt, index }
    cur = cur.parent
  }
  return null
}

/** Does the path from `node` up to `stop` pass through a nested scope? */
function crossesNestedScope(node: AnyNode, stop: AnyNode): boolean {
  let cur: AnyNode = node
  while (cur !== stop && cur.parent) {
    cur = cur.parent
    if (cur === stop) return false
    if (NESTED_SCOPES.has(cur.type)) return true
  }
  return false
}

/** Is `node` somewhere inside a loop that lies within `stop`? */
function insideLoopWithin(node: AnyNode, stop: Stmt): boolean {
  if (stop.type === 'For' || stop.type === 'While') return true
  let cur: AnyNode | undefined = node.parent
  while (cur && cur !== stop) {
    if (cur.type === 'For' || cur.type === 'While') return true
    cur = cur.parent
  }
  return false
}

/**
 * Does the expression read through an attribute? `self.speed * 2` looks like a
 * plain read, but `self.speed = 0` is recorded as a *read* of `self`, and any
 * method call in between could do it without naming the attribute at all — so
 * the name analysis above cannot see that the value has moved on.
 */
function readsThroughAttribute(expr: Expr): boolean {
  let found = false
  walk(expr as AnyNode, (n) => {
    if (n.type === 'Attribute') found = true
    return undefined
  })
  return found
}

/** Nodes that make the source order of a statement stop matching its evaluation order. */
const REORDERS = new Set([
  'BoolOp',
  'IfExp',
  'Lambda',
  'ListComp',
  'SetComp',
  'GeneratorExp',
  'DictComp'
])

/** Does anything between `node` and `stop` shuffle or repeat the order of evaluation? */
function reordersEvaluation(node: AnyNode, stop: AnyNode): boolean {
  let cur: AnyNode | undefined = node.parent
  while (cur && cur !== stop) {
    if (REORDERS.has(cur.type)) return true
    cur = cur.parent
  }
  return false
}

/** Is `expr` the target of a binding, rather than a value being read? */
function isBindingTarget(node: AnyNode): boolean {
  const parent = node.parent
  if (!parent) return false
  switch (parent.type) {
    case 'Assign':
    case 'Delete':
      return parent.targets.includes(node as Expr)
    case 'AugAssign':
    case 'AnnAssign':
      return parent.target === node
    case 'For':
      return parent.target === node
    case 'WithItem':
      return parent.optionalVars === node
    case 'Comprehension':
      return parent.target === node
    case 'Tuple':
    case 'List':
    case 'Starred':
      return isBindingTarget(parent)
    default:
      return false
  }
}

/**
 * Could anything in `stmt` that runs before `offset` change what an attribute
 * read would see? Any call at all counts — a method is free to rewrite whatever
 * it likes — as does writing straight to an attribute or an item.
 */
function mutatesBefore(stmt: Stmt, offset: number): boolean {
  let found = false
  walk(stmt, (n) => {
    if (n.type === 'Attribute' || n.type === 'Subscript') {
      // Conservative on position: an assignment's target is written textually
      // first and evaluated last, and either way it is a refusal.
      if (isBindingTarget(n)) found = true
      return undefined
    }
    if (n.end > offset) return undefined
    if (n.type === 'Call' || n.type === 'Await' || n.type === 'NamedExpr') found = true
    return undefined
  })
  return found
}

/**
 * Is this a constant by convention? `WINDOW = 3` is the author saying "this
 * number has a meaning, call it by its name" — the same thing rules 14 and 34
 * are built to encourage — so unwinding it would be arguing with the file.
 */
function isConstantName(name: string): boolean {
  return name.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(name)
}

/** Is there an own-line comment sitting directly on top of this line? */
function documentedFromAbove(ctx: RefactorContext, at: number): boolean {
  if (at <= 0) return false
  const previous = ctx.src.slice(lineStart(ctx.src, at - 1), at).trim()
  return previous.startsWith('#')
}

/** Does the subtree hold an f-string? Its placeholders can hide any call at all. */
function containsFString(expr: Expr): boolean {
  let found = false
  walk(expr as AnyNode, (n) => {
    if (n.type === 'Constant' && (n.prefix ?? '').includes('f')) found = true
    return undefined
  })
  return found
}

/** Does anything in the file declare one of these names `global`/`nonlocal`? */
function declaredElsewhere(ctx: RefactorContext, names: Iterable<string>): boolean {
  const wanted = new Set(names)
  let found = false
  walk(ctx.module as AnyNode, (n) => {
    if (n.type !== 'Global' && n.type !== 'Nonlocal') return undefined
    if (n.names.some((name) => wanted.has(name))) found = true
    return undefined
  })
  return found
}

/**
 * Does the expression need parentheses where the name used to sit? Only the
 * tight-binding positions matter — an operand of an operator, the thing being
 * subscripted or called, a `with` item, a comprehension's iterable — and an
 * expression that is already an atom never does.
 */
function needsParens(expr: Expr, use: Name): boolean {
  // `x = a, b` inlined into `f(x)` would otherwise become `f(a, b)`.
  if (expr.type === 'Tuple') return !expr.parenthesized
  if (ATOMIC.has(expr.type)) return false
  const parent = use.parent
  if (!parent) return false
  switch (parent.type) {
    case 'BinOp':
    case 'UnaryOp':
    case 'Starred':
    case 'Await':
    case 'Slice':
    case 'Comprehension':
    case 'WithItem':
    case 'FunctionDef':
    case 'ClassDef':
      return true
    case 'Attribute':
    case 'Subscript':
      return parent.value === use
    case 'Call':
      return parent.func === use
    case 'Compare':
      // `a + b < 5` is fine; `(a if c else b) < 5` is not.
      return LOOSE.has(expr.type) || expr.type === 'Compare' || expr.type === 'BoolOp'
    case 'BoolOp':
      // `a or b` dropped into an `and` changes which way the tree leans.
      return LOOSE.has(expr.type) || expr.type === 'BoolOp'
    default:
      return false
  }
}

export const inlineVariableRule = defineRule<InlineVariableMatch>({
  id: 'inline-variable',
  title: 'Inline the variable',
  message: 'This name is used once and says no more than the expression — inline it',
  catalogue: 10,
  category: 'extraction',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-inline-variable',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<InlineVariableMatch>[] {
    const out: RefactorMatch<InlineVariableMatch>[] = []

    walk(ctx.module as AnyNode, (node) => {
      if (node.type !== 'Assign') return
      const assign = node
      if (assign.targets.length !== 1) return
      const target = unwrap(assign.targets[0])
      if (target.type !== 'Name') return
      const name = target.id
      if (isConstantName(name)) return

      // Only a calculation over things we can move safely (§2.6.6). An
      // augmented or annotated assignment is not this shape at all — the AST
      // gives those their own node types, so they never reach here.
      const value = unwrap(assign.value)
      if (!isPureExpression(value)) return
      if (containsFString(value)) return
      const valueText = textOf(ctx, assign.value)
      if (/[\r\n]/.test(valueText)) return

      // Locals only. A name bound at module or class level is part of what the
      // file hands out — `from rover import span`, `Rover.span` — and one file
      // is not enough to prove nobody is holding on to it. Inside a function the
      // scope is the whole story.
      const scope = scopeOf(assign as AnyNode)
      if (scope.type !== 'FunctionDef') return
      // A parameter already has a meaning at the top of the function; removing
      // an assignment to one does not remove the name.
      if (scope.params.some((p) => p.name === name)) return
      if (declaredElsewhere(ctx, [name])) return

      const uses = referencesTo(scope, name)
      const writes = uses.filter((u) => u.kind === 'write')
      const reads = uses.filter((u) => u.kind === 'read')
      // Exactly one binding (ours) and exactly one reader, or the name is
      // carrying more than this one value.
      if (writes.length !== 1 || writes[0].node !== target) return
      if (reads.length !== 1) return
      const read = reads[0].node
      if (read.start < assign.end) return

      // The reader has to be downstream of the assignment in the same block, so
      // that reaching the reader proves the assignment ran.
      const slot = slotOf(assign as AnyNode)
      if (!slot || slot.stmt !== (assign as Stmt)) return
      const container = memberOf(read as AnyNode, slot.list)
      if (!container || container.index <= slot.index) return
      if (NESTED_SCOPES.has(container.stmt.type)) return
      if (crossesNestedScope(read as AnyNode, container.stmt)) return

      // The reader must not sit inside a loop the assignment is outside of. That
      // is two refusals in one: on a microcontroller it would turn one
      // calculation into one per pass, and the body's later lines run before the
      // next pass's reader, so "what changed in between" stops being a question
      // source order can answer.
      if (insideLoopWithin(read as AnyNode, container.stmt)) return

      // Nothing between the two points may rewrite what the expression reads.
      const ingredients = namesRead([assign.value as AnyNode])
      if (declaredElsewhere(ctx, ingredients)) return
      for (const use of nameUses(bodyOf(scope))) {
        if (use.kind !== 'write' || !ingredients.has(use.name)) continue
        if (use.node.start >= assign.end && use.node.start < read.start) return
      }

      // An attribute read is only provably unchanged when *nothing* runs between
      // the two points: the reader has to be the very next statement, reached in
      // order, with no call ahead of it.
      if (readsThroughAttribute(assign.value)) {
        if (container.index !== slot.index + 1) return
        if (reordersEvaluation(read as AnyNode, container.stmt)) return
        if (mutatesBefore(container.stmt, read.start)) return
      }

      // The whole line goes, so the line must hold nothing else — no second
      // statement after a `;`, no trailing comment to lose with it, and no
      // comment above that would be left describing the next statement instead.
      const from = lineStart(ctx.src, assign.start)
      if (ctx.src.slice(from, assign.start).trim() !== '') return
      const tail = ctx.src.slice(assign.end, lineEnd(ctx.src, assign.end)).replace(/\r?\n$/, '')
      if (tail.trim() !== '') return
      if (documentedFromAbove(ctx, from)) return

      out.push({
        ruleId: 'inline-variable',
        start: assign.start,
        end: assign.end,
        message: `\`${name}\` is used once — the expression itself would read the same`,
        data: { assign, read, name }
      })
    })

    return out
  },

  apply(match: RefactorMatch<InlineVariableMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { assign, read } = match.data
    const from = lineStart(ctx.src, assign.start)
    const to = lineEnd(ctx.src, assign.end)
    if (read.start < to) return null

    // The author's own parentheses come along in the text, and a `Group` is
    // already an atom — so the decision is made on the value as written.
    const text = textOf(ctx, assign.value)
    const replacement = needsParens(assign.value, read) ? `(${text})` : text

    return [
      { start: from, end: to, newText: '' },
      { start: read.start, end: read.end, newText: replacement }
    ]
  }
})
