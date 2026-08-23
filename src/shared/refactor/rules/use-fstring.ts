/**
 * Rule 78 — **Use an f-string** (epic #634 §3.8).
 *
 * ```python
 * print("{} at {}".format(name, angle))     print(f"{name} at {angle}")
 * uart.write("speed %s\n" % motor.speed)  →  uart.write(f"speed {motor.speed}\n")
 * ```
 *
 * The value moves to the place it is printed, so there is no counting brackets
 * against arguments and no way to get them out of order. On MicroPython an
 * f-string is compiled to the same `str.format` call the first line already
 * made, so this costs nothing at runtime — it is purely about the person
 * reading it six months later.
 *
 * **The MicroPython quoting caveat.** MicroPython's parser predates PEP 701
 * (Python 3.12), so a replacement field may not contain the quote character
 * that delimits the f-string: `f"{d["key"]}"` is a syntax error on the board
 * even though CPython 3.12 accepts it. That is why every substituted argument
 * here must be a bare name or a dotted attribute — `sensor.raw` is fine,
 * `readings["left"]` is not — and why the rule additionally refuses any
 * argument whose source text contains the literal's own quote character. A
 * refactoring that only compiles on the desktop is worse than none at all.
 *
 * Declined, too, for: a prefixed or triple-quoted literal (`b""`, `r""`,
 * `"""…"""`); implicit concatenation of adjacent literals; a literal already
 * containing `{` or `}`, which would have to be doubled; anything but bare
 * `{}` placeholders, so `{0}`, `{name}` and `{:>4}` are all left alone; and a
 * mismatch between the number of placeholders and the number of arguments.
 *
 * **`%d` is deliberately not converted.** `"%d" % x` truncates a float — `3.7`
 * prints as `3` — while `f"{x}"` prints `3.7` and `f"{x:d}"` raises. Neither is
 * a faithful translation of what the board is doing today, and a tidy-up that
 * silently changes the numbers in a telemetry line (or starts throwing) is not
 * a tidy-up. The scanner still *recognises* `%d`, so it can tell a placeholder
 * it will not touch from a stray `%`, and then declines the whole match.
 */
import type { AnyNode, BinOp, Call, Constant, Expr } from '../ast'
import { unwrap, walk } from '../ast'
import { textOf } from '../expr'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface FStringMatch {
  /** The whole `"…".format(…)` call or `"…" % (…)` expression being replaced. */
  node: Call | BinOp
  /** The literal's quote character. */
  quote: string
  /** Literal text either side of each placeholder; always `args.length + 1` long. */
  parts: string[]
  /** The source text substituted into each placeholder. */
  args: string[]
}

/** A bare name or dotted attribute — the only thing safe inside a pre-3.12 field. */
const SIMPLE_TARGET = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/

/**
 * The inside of a plain, single-quoted-or-double-quoted, unprefixed literal.
 *
 * Returns null for a prefixed literal, a triple-quoted one, or two adjacent
 * literals the parser folded into one constant — in all three cases the
 * rewrite would have to understand more of the string than it does.
 */
function plainLiteral(node: Expr): { quote: string; body: string } | null {
  if (node.type !== 'Constant' || node.kind !== 'string') return null
  const constant = node as Constant
  if (constant.prefix) return null
  const raw = constant.raw
  const quote = raw[0]
  if (quote !== '"' && quote !== "'") return null
  if (raw.startsWith(quote + quote + quote)) return null
  let i = 1
  while (i < raw.length) {
    if (raw[i] === '\\') {
      i += 2
      continue
    }
    if (raw[i] === quote) break
    i++
  }
  // Anything after the closing quote means implicit concatenation.
  if (i !== raw.length - 1) return null
  return { quote, body: raw.slice(1, raw.length - 1) }
}

/**
 * Split a `.format()` template on its `{}` placeholders.
 *
 * Any other brace at all — `{0}`, `{name}`, `{:>4}`, a doubled `{{`, or a JSON
 * fragment — returns null, because reproducing it inside an f-string means
 * escaping rules this rule does not want to get wrong.
 */
function splitBraces(body: string): string[] | null {
  // A backslash immediately before a brace changes how the f-string parser
  // reads it; leave those alone entirely.
  if (/\\[{}]/.test(body)) return null
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '{') {
      if (body[i + 1] !== '}') return null
      parts.push(cur)
      cur = ''
      i++
      continue
    }
    if (c === '}') return null
    cur += c
  }
  parts.push(cur)
  return parts
}

/** Split a `%`-format template on its `%s`/`%d` placeholders. */
function splitPercent(body: string): { parts: string[]; kinds: string[] } | null {
  // Braces would have to be doubled to survive as literal text in an f-string.
  if (/[{}]/.test(body)) return null
  const parts: string[] = []
  const kinds: string[] = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '%') {
      const kind = body[i + 1]
      // `%%`, `%r`, `%5.2f`, a trailing `%` — all outside what we translate.
      if (kind !== 's' && kind !== 'd') return null
      parts.push(cur)
      cur = ''
      kinds.push(kind)
      i++
      continue
    }
    cur += body[i]
  }
  parts.push(cur)
  return { parts, kinds }
}

/** The source text of an argument, if it is safe to drop into a replacement field. */
function fieldText(ctx: RefactorContext, arg: Expr, quote: string): string | null {
  const e = unwrap(arg)
  if (e.type !== 'Name' && e.type !== 'Attribute') return null
  const text = textOf(ctx, e).trim()
  if (!SIMPLE_TARGET.test(text)) return null
  // Belt and braces: MicroPython cannot parse the literal's own quote inside a
  // replacement field, so never let one through even if the shape looks right.
  if (text.includes(quote)) return null
  return text
}

/** Every argument of a call, when it takes only plain positional ones. */
function positionalArgs(call: Call): Expr[] | null {
  if (call.keywords.length > 0) return null
  if (call.args.some((a) => unwrap(a).type === 'Starred')) return null
  return call.args
}

/** Weave the literal fragments and the replacement fields back into one f-string. */
function buildFString(quote: string, parts: readonly string[], args: readonly string[]): string {
  let out = `f${quote}`
  for (let i = 0; i < parts.length; i++) {
    out += parts[i]
    if (i < args.length) out += `{${args[i]}}`
  }
  return out + quote
}

/** `"…".format(a, b)`, or null when any of the conditions above fails. */
function fromFormatCall(ctx: RefactorContext, node: AnyNode): FStringMatch | null {
  if (node.type !== 'Call') return null
  if (node.func.type !== 'Attribute' || node.func.attr !== 'format') return null
  const literal = plainLiteral(node.func.value)
  if (!literal) return null
  const args = positionalArgs(node)
  if (!args || args.length === 0) return null
  const parts = splitBraces(literal.body)
  if (!parts || parts.length - 1 !== args.length) return null
  const fields: string[] = []
  for (const arg of args) {
    const text = fieldText(ctx, arg, literal.quote)
    if (text == null) return null
    fields.push(text)
  }
  return { node, quote: literal.quote, parts, args: fields }
}

/** `"…%s…" % (a, b)` or `"…%s" % a`, or null. */
function fromPercentOperator(ctx: RefactorContext, node: AnyNode): FStringMatch | null {
  if (node.type !== 'BinOp' || node.op !== '%') return null
  const literal = plainLiteral(node.left)
  if (!literal) return null
  const split = splitPercent(literal.body)
  if (!split) return null
  // See the header: `%d` is recognised so it is not mistaken for a stray `%`,
  // then refused, because no f-string spelling reproduces its truncation.
  if (split.kinds.includes('d')) return null

  const right = unwrap(node.right)
  // `% (a, b)` hands over a tuple; `% a` hands over the single value itself.
  const args: Expr[] = right.type === 'Tuple' ? right.elts : [right]
  if (args.length === 0) return null
  if (split.parts.length - 1 !== args.length) return null

  const fields: string[] = []
  for (const arg of args) {
    const text = fieldText(ctx, arg, literal.quote)
    if (text == null) return null
    fields.push(text)
  }
  return { node, quote: literal.quote, parts: split.parts, args: fields }
}

export const useFStringRule = defineRule<FStringMatch>({
  id: 'use-fstring',
  title: 'Use an f-string',
  message: 'An f-string puts each value where it is printed, so the order cannot drift',
  catalogue: 78,
  category: 'functions',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-use-fstring',
  safe: true,

  detect(ctx: RefactorContext): RefactorMatch<FStringMatch>[] {
    const out: RefactorMatch<FStringMatch>[] = []
    walk(ctx.module as AnyNode, (node) => {
      const found = fromFormatCall(ctx, node) ?? fromPercentOperator(ctx, node)
      if (!found) return
      out.push({
        ruleId: 'use-fstring',
        start: found.node.start,
        end: found.node.end,
        data: found
      })
    })
    return out
  },

  apply(match: RefactorMatch<FStringMatch>, ctx: RefactorContext): TextEdit[] | null {
    const { node, quote, parts, args } = match.data
    if (parts.length - 1 !== args.length) return null
    const text = buildFString(quote, parts, args)
    // The replacement is an atom, so it binds at least as tightly as whatever
    // it replaced — no parentheses are ever needed around it.
    if (text === textOf(ctx, node)) return null
    return [{ start: node.start, end: node.end, newText: text }]
  }
})

/** Exported for the tests that probe the literal and template scanners directly. */
export const _internals: {
  plainLiteral: typeof plainLiteral
  splitBraces: typeof splitBraces
  splitPercent: typeof splitPercent
} = { plainLiteral, splitBraces, splitPercent }
