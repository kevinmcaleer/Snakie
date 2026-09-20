/**
 * f-STRINGS AS A TEMPLATE AND ITS HOLES.
 * =============================================================================
 *
 * `print(f"ping.distance {ping.distance()}")` is how every sensor program on a
 * board says what it read, and until now it was a grey block: the reader knew
 * only the one f-string shape the format blocks themselves write (`f"{t:.1f}"`),
 * and the palette had nothing a learner could type such a line into.
 *
 * The block that fixes it holds the f-string the way a learner thinks of it —
 * as a TEMPLATE, the text of the string with a `{}` wherever a value goes —
 * and grows one socket per hole. So the face reads `f" ping.distance {} "` with a
 * socket beside it, and the mirror shows `f"ping.distance {ping.distance()}"`.
 *
 * THE TEMPLATE IS THE f-STRING'S OWN TEXT with the expressions lifted out. That
 * is the whole trick: `{{` is still a literal brace, `{:.1f}` still says how a
 * value is written, and the reader's job is a split rather than a translation.
 * Nothing in here knows about Blockly; these three functions are the pure half,
 * which is why they are a unit test rather than a canvas.
 */

/** One hole in a template: the text between its braces (`!r:>10`, or ``). */
export interface Hole {
  /** Where the `{` is in the template. */
  start: number
  /** One past the `}`. */
  end: number
  /** The conversion and format spec, `!r:>10` — everything that is not the value. */
  inner: string
}

/**
 * The holes in a template, in order.
 *
 * `{{` and `}}` are literal braces and not holes, exactly as in Python. A hole
 * whose inside carries a brace is a nested format (`{:{w}}`), which this block
 * cannot hold — it is skipped rather than counted, so the socket count never
 * runs ahead of what the generator can fill.
 */
export function templateHoles(template: string): Hole[] {
  const out: Hole[] = []
  let i = 0
  while (i < template.length) {
    const ch = template[i]
    if (ch === '{' && template[i + 1] === '{') {
      i += 2
      continue
    }
    if (ch === '}' && template[i + 1] === '}') {
      i += 2
      continue
    }
    if (ch === '{') {
      const close = template.indexOf('}', i + 1)
      if (close === -1) break
      const inner = template.slice(i + 1, close)
      if (!inner.includes('{')) out.push({ start: i, end: close + 1, inner })
      i = close + 1
      continue
    }
    i += 1
  }
  return out
}

/** How many sockets a template needs. */
export function countHoles(template: string): number {
  return templateHoles(template).length
}

/**
 * The template with its holes filled: `f"ping.distance {ping.distance()}"`.
 *
 * `pieces[i]` is the Python for hole `i`, already generated. An EMPTY piece
 * drops its hole rather than writing `{}` — a `{}` with nothing in it is a
 * syntax error, and a learner who has not filled a socket yet should still get
 * the rest of their line.
 *
 * The literal text is escaped for a double-quoted string: a quote, a backslash
 * and a newline are the three characters a child can type that would otherwise
 * end or break the line.
 */
export function renderFString(template: string, pieces: readonly string[]): string {
  const holes = templateHoles(template)
  let out = ''
  let from = 0
  holes.forEach((hole, i) => {
    out += escapeText(template.slice(from, hole.start))
    const piece = pieces[i] ?? ''
    if (piece !== '') out += `{${piece}${hole.inner}}`
    from = hole.end
  })
  out += escapeText(template.slice(from))
  return `f"${out}"`
}

/** Literal text as it sits inside a double-quoted f-string body. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/** An f-string read apart: the template, and one expression per hole. */
export interface ReadFString {
  template: string
  exprs: string[]
}

/**
 * `f"ping.distance {ping.distance()}"` → the template and its expressions, or
 * null for an f-string this block cannot hold.
 *
 * DOUBLE QUOTES ONLY, which is what the block writes: `f'…'` is the same string
 * and a different line, and a block has nowhere to record which quote the
 * learner used. A BACKSLASH anywhere declines, for the same reason
 * `readStringLiteral` declines one — the escapes are Python's business, and a
 * line that stays raw regenerates verbatim.
 *
 * Also declined, each because the block would regenerate a different line:
 * a `{x=}` debug field, an expression with a `"` in it (illegal before 3.12
 * inside a `"…"` f-string, and the reader's lexer would not survive it), a
 * nested format spec, an empty hole, and an unbalanced brace.
 */
export function readFString(literal: string): ReadFString | null {
  const m = /^f"(.*)"$/s.exec(literal)
  if (!m) return null
  const body = m[1]
  if (body.includes('\\')) return null

  let template = ''
  const exprs: string[] = []
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '{' && body[i + 1] === '{') {
      template += '{{'
      i += 2
      continue
    }
    if (ch === '}' && body[i + 1] === '}') {
      template += '}}'
      i += 2
      continue
    }
    if (ch === '}') return null
    if (ch !== '{') {
      template += ch
      i += 1
      continue
    }
    // A hole. The expression runs to the first top-level `!`, `:` or `}` —
    // top-level meaning outside every bracket and every single-quoted string,
    // so `{d['a']}` and `{f(x, y)}` keep their insides. `!=` is an operator
    // and not a conversion.
    let depth = 0
    let quote: string | null = null
    let j = i + 1
    let exprEnd = -1
    for (; j < body.length; j++) {
      const c = body[j]
      if (quote) {
        if (c === quote) quote = null
        continue
      }
      if (c === '"') return null
      if (c === "'") {
        quote = c
        continue
      }
      if (c === '(' || c === '[' || c === '{') depth += 1
      else if (c === ')' || c === ']') depth -= 1
      else if (c === '}') {
        if (depth === 0) {
          exprEnd = j
          break
        }
        depth -= 1
      } else if (depth === 0 && (c === ':' || (c === '!' && body[j + 1] !== '='))) {
        exprEnd = j
        break
      }
    }
    if (exprEnd === -1 || quote) return null
    const expr = body.slice(i + 1, exprEnd).trim()
    if (expr === '' || expr.endsWith('=')) return null
    // The rest of the hole — conversion and spec — up to its `}`. A brace in
    // the spec is a nested format, which the template cannot hold.
    const close = body.indexOf('}', exprEnd)
    if (close === -1) return null
    const inner = body.slice(exprEnd, close)
    if (/[{}]/.test(inner)) return null
    exprs.push(expr)
    template += `{${inner}}`
    i = close + 1
  }
  return { template, exprs }
}
