/**
 * Rule 14 — **Give the number a name** (epic #634 §3.3).
 *
 * ```python
 * # before                              # after
 * from machine import ADC, PWM, Pin     from machine import ADC, PWM, Pin
 *
 * left = PWM(Pin(14), freq=1000)        PWM_FREQ = 1000
 * right = PWM(Pin(15), freq=1000)       READING_MAX = 42000
 *
 * def on_line(sensor):                  left = PWM(Pin(14), freq=PWM_FREQ)
 *     return sensor.read_u16() > 42000  right = PWM(Pin(15), freq=PWM_FREQ)
 * ```
 *
 * Why it matters: the second time a number appears it stops being a number and
 * starts being a *decision* — this is the PWM frequency, this is where the line
 * sensor says "black". Written out twice, nothing links the two, so the day the
 * frequency changes one of them gets missed and the robot pulls to one side for
 * reasons no one can see. A name at the top of the file makes the pair one fact,
 * puts the tuning knobs where a beginner can find them, and (on MicroPython)
 * hands rule 34 something it can wrap in `const()`.
 *
 * The hard part is not finding the repeats, it is **naming them**, and a bad
 * name is worse than the literal it replaces — `MAGIC_1 = 42000` teaches nothing
 * and now has to be maintained. So the rule only ever offers a name it can
 * *derive* from what the code already says:
 *
 * | what the occurrences have in common | the name |
 * |---|---|
 * | the same keyword argument | `PWM(…, freq=1000)` → `PWM_FREQ` |
 * | assigned to the same name each time | `self.cruise_duty = 48000` → `CRUISE_DUTY` |
 * | …and a word for a value | `self.mode = "cruise"` → `CRUISE_MODE` |
 * | compared against the same name | `reading > 42000` → `READING_MAX` |
 * | the same parameter of a `def` in this file | `set_pulse(s, 1500)` → `PULSE` |
 *
 * When none of those fit, the rule says nothing at all. That is the point: a
 * literal we cannot name is a literal the *author* has to name.
 *
 * Note what is deliberately *not* on that list: naming a string after its own
 * text. `RUFF = "ruff"` and `MESSAGE = "message"` are not names, they are the
 * literal spelled twice, and running that over a real file turns every dict key
 * and every command word in it into a constant nobody asked for. A name has to
 * come from the value's *role*, or not at all.
 *
 * Literals that are already fine as they are get skipped outright — `0`, `1`,
 * `-1`, `2` and `100`; a float that only ever appears in one statement; anything
 * inside `range(…)`, where the number is the shape of the loop rather than a
 * setting; anything already living in a `const(…)` or an `ALL_CAPS = …`, which
 * is both the "someone has named this" case and what makes the rule idempotent
 * on its own output; empty and single-character strings; docstrings; and strings
 * that are mostly dict keys, which read perfectly well as literals.
 */
import type { AnyNode, Constant, Expr, FunctionDef, Module, Stmt } from '../ast'
import { unwrap, walk } from '../ast'
import { dottedName, literalNumber, textOf } from '../expr'
import { freshName } from '../scope'
import { lineEnd, lineStart } from '../text'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface NamedConstantMatch {
  /** The literal's exact source text, reused verbatim in the definition. */
  literal: string
  /** The module-level name, chosen in `detect` so a batch cannot pick one twice. */
  name: string
  /** Every occurrence to replace. */
  nodes: Constant[]
  /** Only the first match of a batch opens the block with a blank line… */
  leadingBlank: boolean
  /** …and only the last closes it with one. */
  trailingBlank: boolean
}

/** What one occurrence is doing, which is all we have to name it with. */
type Role =
  | { kind: 'keyword'; func: string; kw: string }
  | { kind: 'positional'; func: string; index: number; bound: boolean }
  | { kind: 'assign'; target: string }
  | { kind: 'compare'; other: string; bound: 'MAX' | 'MIN' }
  | { kind: 'other' }

/** Numbers that are already as clear as a name would make them. */
const BORING_NUMBERS = new Set([0, 1, 2, 100])

/** A screaming-snake-case name: the universal Python signal for "constant". */
const ALL_CAPS = /^_*[A-Z][A-Z0-9_]*$/

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A string whose text is a plain word, so the word itself is the best name. */
const WORD = /^[A-Za-z][A-Za-z0-9_]*$/

/** Names that say nothing. Producing one of these is the same as declining. */
const EMPTY_WORDS = new Set(['VAL', 'VALUE', 'TMP', 'ARG', 'ARGS', 'NUM', 'DATA', 'ITEM', 'RES'])

/**
 * Longest name we will hand back. Past this the derivation has stopped
 * describing the value and started reciting the call it sits in
 * (`ASSERT_ALMOST_EQUAL_PLACES`), which is exactly the badly-named constant we
 * would rather not create.
 */
const MAX_NAME = 24

/**
 * Every identifier the file mentions anywhere, nested scopes included.
 *
 * `freshName` reports a name as free when the only thing using it is a local
 * inside a nested `def` — right for its own purposes, wrong for a module-level
 * constant, which such a local would shadow at exactly the site we rewrote.
 */
function allNames(module: Module): Set<string> {
  const out = new Set<string>()
  walk(module as AnyNode, (n) => {
    switch (n.type) {
      case 'Name':
        out.add(n.id)
        break
      case 'FunctionDef':
      case 'ClassDef':
        out.add(n.name)
        break
      case 'Param':
        out.add(n.name)
        break
      case 'ImportAlias':
        out.add(n.asname ?? n.name.split('.')[0])
        break
      case 'ExceptHandler':
        if (n.name) out.add(n.name)
        break
      case 'Global':
      case 'Nonlocal':
        for (const x of n.names) out.add(x)
        break
      default:
        break
    }
  })
  return out
}

/** A module-level name nothing else uses, and no earlier match has claimed. */
function pickName(ctx: RefactorContext, used: Set<string>, base: string): string | null {
  for (let i = 0; i < 100; i++) {
    const candidate = freshName(ctx.module, i === 0 ? base : `${base}_${i + 1}`)
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  return null
}

/** The node a literal really hangs off, seeing through any parentheses. */
function effectiveChild(node: Constant): { child: AnyNode; parent: AnyNode | undefined } {
  let child: AnyNode = node
  let parent = node.parent
  while (parent && parent.type === 'Group') {
    child = parent
    parent = parent.parent
  }
  return { child, parent }
}

/** The last segment of a dotted name, or null: `self.cruise_duty` → `cruise_duty`. */
function lastSegment(expr: Expr): string | null {
  const dotted = dottedName(expr)
  if (!dotted) return null
  const seg = dotted.split('.').pop() ?? ''
  return IDENTIFIER.test(seg) ? seg : null
}

/** Work out what this occurrence is doing in the code around it. */
function roleOf(node: Constant): Role {
  const { child, parent } = effectiveChild(node)
  if (!parent) return { kind: 'other' }

  if (parent.type === 'Keyword' && parent.value === child && parent.arg) {
    const call = parent.parent
    if (call && call.type === 'Call') {
      const func = lastSegment(call.func)
      if (func) return { kind: 'keyword', func, kw: parent.arg }
    }
    return { kind: 'other' }
  }

  if (parent.type === 'Call') {
    const index = parent.args.indexOf(child as Expr)
    const func = lastSegment(parent.func)
    // `obj.method(x)` passes the receiver as `self` without writing it, so the
    // argument list and the parameter list are one apart.
    if (index >= 0 && func) {
      return { kind: 'positional', func, index, bound: unwrap(parent.func).type === 'Attribute' }
    }
    return { kind: 'other' }
  }

  if (parent.type === 'Assign' && parent.value === child && parent.targets.length === 1) {
    const target = lastSegment(parent.targets[0])
    if (target) return { kind: 'assign', target }
    return { kind: 'other' }
  }

  if (parent.type === 'AnnAssign' && parent.value === child) {
    const target = lastSegment(parent.target)
    if (target) return { kind: 'assign', target }
    return { kind: 'other' }
  }

  if (parent.type === 'Compare' && parent.ops.length === 1) {
    const onRight = parent.comparators[0] === child
    const other = lastSegment(onRight ? parent.left : parent.comparators[0])
    if (!other) return { kind: 'other' }
    // Read the operator from the literal's point of view, so `42000 < reading`
    // and `reading > 42000` name the same bound.
    const op = parent.ops[0]
    const facing = onRight ? op : { '<': '>', '>': '<', '<=': '>=', '>=': '<=' }[op] ?? op
    if (facing === '>' || facing === '>=') return { kind: 'compare', other, bound: 'MAX' }
    if (facing === '<' || facing === '<=') return { kind: 'compare', other, bound: 'MIN' }
  }

  return { kind: 'other' }
}

/** The nearest enclosing statement, for the "one statement only" float test. */
function statementOf(node: AnyNode): AnyNode | null {
  let cur: AnyNode | undefined = node.parent
  while (cur) {
    if (
      cur.type === 'Assign' ||
      cur.type === 'AnnAssign' ||
      cur.type === 'AugAssign' ||
      cur.type === 'ExprStmt' ||
      cur.type === 'Return' ||
      cur.type === 'If' ||
      cur.type === 'While' ||
      cur.type === 'For' ||
      cur.type === 'Raise' ||
      cur.type === 'Assert' ||
      cur.type === 'With' ||
      cur.type === 'FunctionDef' ||
      cur.type === 'ClassDef'
    ) {
      return cur
    }
    cur = cur.parent
  }
  return null
}

/** Is the literal somewhere inside a call to `name`? */
function insideCallTo(node: Constant, name: string): boolean {
  let child: AnyNode = node
  let cur: AnyNode | undefined = node.parent
  while (cur) {
    if (cur.type === 'Call' && cur.func !== child && dottedName(cur.func) === name) return true
    child = cur
    cur = cur.parent
  }
  return false
}

/** Is the literal part of the value of an `ALL_CAPS = …`? Then it already has a name. */
function insideNamedConstant(node: Constant): boolean {
  let child: AnyNode = node
  let cur: AnyNode | undefined = node.parent
  while (cur) {
    if (cur.type === 'Assign' && cur.value === child && cur.targets.length === 1) {
      const target = unwrap(cur.targets[0])
      if (target.type === 'Name' && ALL_CAPS.test(target.id)) return true
    }
    if (cur.type === 'AnnAssign' && cur.value === child) {
      const target = unwrap(cur.target)
      if (target.type === 'Name' && ALL_CAPS.test(target.id)) return true
    }
    child = cur
    cur = cur.parent
  }
  return false
}

/** Is this literal a bare string statement — a docstring, or a stray note? */
function isBareStatement(node: Constant): boolean {
  const { child, parent } = effectiveChild(node)
  return parent != null && parent.type === 'ExprStmt' && parent.value === child
}

/** Is this literal being used as a mapping key — `{"mode": …}` or `d["mode"]`? */
function isMappingKey(node: Constant): boolean {
  const { child, parent } = effectiveChild(node)
  if (!parent) return false
  if (parent.type === 'Dict') return parent.keys.includes(child as Expr)
  if (parent.type === 'Subscript') return parent.slice === child
  return false
}

/** The text between the quotes, when the literal is a plain one-line string. */
function stringContent(node: Constant): string | null {
  if (node.kind !== 'string' || node.prefix) return null
  const raw = node.raw
  const quote = raw[0]
  if (quote !== '"' && quote !== "'") return null
  if (raw.length < 2 || raw[raw.length - 1] !== quote) return null
  // `''` is empty, `'''…'''` is triple-quoted; both open with two quote marks.
  if (raw.length >= 2 && raw[1] === quote) return null
  const body = raw.slice(1, -1)
  // A stray quote means the parser joined two adjacent literals into one.
  if (body.includes(quote) || /[\r\n]/.test(body)) return null
  return body
}

/** Every top-level and class-level `def` in the file, by name. */
function functionsByName(module: Module): Map<string, FunctionDef[]> {
  const out = new Map<string, FunctionDef[]>()
  walk(module as AnyNode, (n) => {
    if (n.type !== 'FunctionDef') return
    const list = out.get(n.name)
    if (list) list.push(n)
    else out.set(n.name, [n])
  })
  return out
}

/** Do all the roles agree, and if so what do they call this value? */
function deriveBase(
  module: Module,
  nodes: readonly Constant[],
  roles: readonly Role[]
): string | null {
  // Screaming snake case, with camelCase broken up on the way: `endLine` has to
  // become END_LINE, because ENDLINE is not a word anyone can read.
  const upper = (s: string): string =>
    s
      .replace(/^_+/, '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toUpperCase()

  const first = roles[0]
  if (!roles.every((r) => r.kind === first.kind)) return null

  if (first.kind === 'keyword') {
    const kws = roles as { kind: 'keyword'; func: string; kw: string }[]
    if (!kws.every((r) => r.kw === first.kw)) return null
    const kw = upper(first.kw)
    // `f(value=3)` names the slot "value", which is no name at all.
    if (EMPTY_WORDS.has(kw)) return null
    // `PWM(…, freq=1000)` reads better as PWM_FREQ than as a bare FREQ, but only
    // when the call adds something the keyword did not already say.
    if (kws.every((r) => r.func === first.func) && upper(first.func) !== kw) {
      return `${upper(first.func)}_${kw}`
    }
    return kw
  }

  if (first.kind === 'assign') {
    const assigns = roles as { kind: 'assign'; target: string }[]
    if (!assigns.every((r) => r.target === first.target)) return null
    if (first.target.length < 2) return null
    const target = upper(first.target)
    // The target names the *slot*, which is only the whole story for a setting.
    // `self.mode = "cruise"` has a slot and a value, and MODE = "cruise" would
    // be a lie about which is which — CRUISE_MODE says both.
    const content = stringContent(nodes[0])
    if (content && WORD.test(content) && content.length >= 2) {
      const word = upper(content)
      return word === target ? target : `${word}_${target}`
    }
    return target
  }

  if (first.kind === 'compare') {
    const compares = roles as { kind: 'compare'; other: string; bound: 'MAX' | 'MIN' }[]
    if (!compares.every((r) => r.other === first.other && r.bound === first.bound)) return null
    if (first.other.length < 2) return null
    return `${upper(first.other)}_${first.bound}`
  }

  if (first.kind === 'positional') {
    const args = roles as { kind: 'positional'; func: string; index: number; bound: boolean }[]
    if (!args.every((r) => r.func === first.func && r.index === first.index)) return null
    if (!args.every((r) => r.bound === first.bound)) return null
    // Only a function defined in THIS file can tell us what its parameter means.
    const defs = functionsByName(module).get(first.func)
    if (!defs || defs.length !== 1) return null
    const params = defs[0].params.filter((p) => p.kind === 'normal')
    // A method called through an instance never writes its `self` argument.
    const shift = first.bound && (params[0]?.name === 'self' || params[0]?.name === 'cls') ? 1 : 0
    const param = params[first.index + shift]
    if (!param || param.name === 'self' || param.name.length < 3) return null
    const paramName = upper(param.name)
    // A parameter called `value` or `data` tells us nothing the literal did not.
    if (EMPTY_WORDS.has(paramName)) return null
    const funcName = upper(first.func)
    // `set_pulse(servo, pulse)` wants PULSE, not SET_PULSE_PULSE — the verb is
    // already in the parameter's name.
    if (funcName === paramName || funcName.endsWith(`_${paramName}`)) return paramName
    return `${funcName}_${paramName}`
  }

  return null
}

/**
 * Where the definitions go: after the file's opening docstring and its head
 * import block, which is at or before every statement that could use them, so a
 * constant is always bound before the line that reads it runs.
 */
function anchorFor(ctx: RefactorContext): number {
  let at = -1
  for (const stmt of ctx.module.body) {
    if (isDocstringStatement(stmt)) {
      at = lineEnd(ctx.src, stmt.end)
      continue
    }
    if (stmt.type === 'Import' || stmt.type === 'ImportFrom') {
      at = lineEnd(ctx.src, stmt.end)
      continue
    }
    break
  }
  if (at >= 0) return at

  const first = ctx.module.body[0]
  if (!first) return ctx.src.length
  let start = lineStart(ctx.src, first.start)
  // A comment block on top of that statement introduces it, so sit above the
  // comment rather than wedging the constant between the note and its code.
  while (start > 0) {
    const prev = lineStart(ctx.src, start - 1)
    if (!ctx.src.slice(prev, start).trim().startsWith('#')) break
    start = prev
  }
  return start
}

/** Is this statement a bare string — a module or function docstring? */
function isDocstringStatement(stmt: Stmt): boolean {
  return stmt.type === 'ExprStmt' && stmt.value.type === 'Constant' && stmt.value.kind === 'string'
}

/** Is the line starting at `at` blank? */
function lineIsBlank(src: string, at: number): boolean {
  return src.slice(at, lineEnd(src, at)).trim() === ''
}

/** Is the line just before `at` blank (or is there nothing before it)? */
function previousLineIsBlank(src: string, at: number): boolean {
  if (at <= 0) return true
  return src.slice(lineStart(src, at - 1), at).trim() === ''
}

export const namedConstantRule = defineRule<NamedConstantMatch>({
  id: 'named-constant',
  title: 'Give the number a name',
  message: 'This literal is repeated — a name at the top of the file makes it one fact',
  catalogue: 14,
  category: 'conditionals',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-named-constant',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<NamedConstantMatch>[] {
    const threshold = Math.max(2, ctx.settings.magicLiteralRepeats)

    // Group by exact source text: `700` and `0x2BC` are the same value but two
    // different things to a reader, and we only ever splice text.
    const groups = new Map<string, Constant[]>()
    walk(ctx.module as AnyNode, (n) => {
      if (n.type !== 'Constant') return
      if (n.kind !== 'number' && n.kind !== 'string') return
      const text = textOf(ctx, n)
      const list = groups.get(text)
      if (list) list.push(n)
      else groups.set(text, [n])
    })

    const anchor = anchorFor(ctx)
    const used = allNames(ctx.module)
    const candidates: { literal: string; name: string; nodes: Constant[] }[] = []

    for (const [literal, nodes] of groups) {
      if (nodes.length < threshold) continue
      // Everything we rewrite has to sit below the definition we are inserting.
      if (nodes.some((n) => n.start < anchor)) continue
      // Already named, by `const()` or by an ALL_CAPS assignment — including the
      // definition this rule itself inserts, which is what keeps it idempotent.
      if (nodes.some((n) => insideNamedConstant(n) || insideCallTo(n, 'const'))) continue

      if (nodes[0].kind === 'number') {
        const value = literalNumber(nodes[0])
        if (value == null) continue
        if (BORING_NUMBERS.has(Math.abs(value))) continue
        // `range(4)` is the shape of a loop, not a setting anyone tunes.
        if (nodes.some((n) => insideCallTo(n, 'range'))) continue
        // A float that never leaves one statement is a coefficient in a formula,
        // and pulling it out would make the formula harder to read, not easier.
        if (/^(?!0[xXoObB])[0-9_]*[.eE]/.test(literal)) {
          const statements = new Set(nodes.map((n) => statementOf(n)))
          if (statements.size < 2) continue
        }
      } else {
        const content = stringContent(nodes[0])
        // Empty and one-character strings are already as short as a name.
        if (content == null || content.length < 2) continue
        if (nodes.some((n) => isBareStatement(n))) continue
        // Mostly a mapping key: `config["mode"]` reads fine exactly as written.
        const keys = nodes.filter((n) => isMappingKey(n)).length
        if (keys * 2 > nodes.length) continue
      }

      const roles = nodes.map((n) => roleOf(n))
      const base = deriveBase(ctx.module, nodes, roles)
      // Nothing in the code says what this value is. `MAGIC_3` would not either,
      // so we say nothing: naming it is the author's job, not ours.
      if (!base || base.length < 3 || base.length > MAX_NAME || EMPTY_WORDS.has(base)) continue
      const name = pickName(ctx, used, base)
      if (!name) continue
      candidates.push({ literal, name, nodes })
    }

    // In first-occurrence order, so the block of definitions reads down the file
    // in the same order as the code that uses them.
    candidates.sort((a, b) => a.nodes[0].start - b.nodes[0].start)

    return candidates.map((c, i) => ({
      ruleId: 'named-constant',
      start: c.nodes[0].start,
      end: c.nodes[0].end,
      title: `Name it \`${c.name}\``,
      message: `\`${c.literal}\` appears ${c.nodes.length} times — name it \`${c.name}\` and change it in one place`,
      data: {
        literal: c.literal,
        name: c.name,
        nodes: c.nodes,
        // One blank line opens the block and one closes it, however many
        // definitions land between them.
        leadingBlank: i === 0 && anchor > 0 && !previousLineIsBlank(ctx.src, anchor),
        trailingBlank: i === candidates.length - 1 && !lineIsBlank(ctx.src, anchor)
      }
    }))
  },

  apply(match: RefactorMatch<NamedConstantMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { literal, name, nodes, leadingBlank, trailingBlank } = match.data
    if (nodes.length === 0) return null
    const anchor = anchorFor(ctx)
    if (anchor < 0 || anchor > ctx.src.length) return null
    // The definition must come first, or the name would be read before it exists.
    if (nodes.some((n) => n.start < anchor)) return null
    // Splice the literal exactly as written, so `0x2BC` stays `0x2BC`.
    if (nodes.some((n) => textOf(ctx, n) !== literal)) return null

    const eol = ctx.eol
    const definition = `${leadingBlank ? eol : ''}${name} = ${literal}${eol}${trailingBlank ? eol : ''}`

    return [
      { start: anchor, end: anchor, newText: definition },
      ...nodes.map((n) => ({ start: n.start, end: n.end, newText: name }))
    ]
  }
})
