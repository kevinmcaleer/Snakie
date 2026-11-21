/**
 * What the hover says about one of the user's own functions: its signature,
 * parameters, docstring, every place it is used, and a few hints.
 *
 * Like `python-definitions.ts` this reads the file line by line rather than
 * parsing it, so it still answers on half-written code. Usages are matched by
 * name, not by scope: a local variable that happens to share a function's name
 * would be counted, which in a MicroPython script is rare enough to accept.
 */
import { codeOnly } from './python-definitions'

export interface FunctionParam {
  name: string
  annotation: string | null
  default: string | null
  /** `*args` / `**kwargs` are 'star' / 'starstar'. */
  kind: 'normal' | 'star' | 'starstar'
}

export interface FunctionInfo {
  name: string
  /** 1-based line of the `def`. */
  line: number
  /** 1-based column of the name on that line. */
  column: number
  isAsync: boolean
  /** The class this is a method of, or null for a plain function. */
  className: string | null
  decorators: string[]
  /** Parameters, without `self`/`cls` and the bare `*` / `/` markers. */
  params: FunctionParam[]
  returns: string | null
  /** The signature as one line: `def drive(speed: int = 50) -> None`. */
  signature: string
  docstring: string | null
  /** 1-based first and last line of the body (after the header). */
  bodyStart: number
  bodyEnd: number
}

export interface Usage {
  line: number
  column: number
  /** The line's code, trimmed. */
  text: string
  /** True when the name is called here (`stop()`), false for a reference (`cb = stop`). */
  call: boolean
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*'
const indentOf = (line: string): number => line.length - line.trimStart().length

/** Split on commas that are not inside brackets or strings. */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') {
        cur += s[++i] ?? ''
      } else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** The index of the bracket closing the one at `open`, or -1. Strings are skipped. */
function closingParen(s: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function parseParam(raw: string): FunctionParam | null {
  let s = raw.trim()
  if (!s || s === '*' || s === '/') return null
  let kind: FunctionParam['kind'] = 'normal'
  if (s.startsWith('**')) {
    kind = 'starstar'
    s = s.slice(2)
  } else if (s.startsWith('*')) {
    kind = 'star'
    s = s.slice(1)
  }
  const eq = splitOnFirstTopLevel(s, '=')
  const head = eq[0]
  const dflt = eq.length > 1 ? eq[1].trim() : null
  const colon = head.indexOf(':')
  const name = (colon >= 0 ? head.slice(0, colon) : head).trim()
  const annotation = colon >= 0 ? head.slice(colon + 1).trim() || null : null
  if (!new RegExp(`^${IDENT}$`).test(name)) return null
  return { name, annotation, default: dflt, kind }
}

/** Split `s` at the first `sep` that is outside brackets and strings. */
function splitOnFirstTopLevel(s: string, sep: string): string[] {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === sep && depth === 0) return [s.slice(0, i), s.slice(i + 1)]
  }
  return [s]
}

/** Read a docstring starting at line index `n`, or null if the body doesn't open with one. */
function readDocstring(lines: string[], n: number): string | null {
  const first = lines[n]?.trim() ?? ''
  const m = /^[rRuU]?("""|'''|"|')/.exec(first)
  if (!m) return null
  const q = m[1]
  const startAt = first.indexOf(q) + q.length
  if (q.length === 1) {
    const end = first.indexOf(q, startAt)
    return end >= 0 ? first.slice(startAt, end).trim() : null
  }
  const sameLine = first.indexOf(q, startAt)
  if (sameLine >= 0) return first.slice(startAt, sameLine).trim()
  const parts = [first.slice(startAt)]
  for (let i = n + 1; i < lines.length; i++) {
    const at = lines[i].indexOf(q)
    if (at >= 0) {
      parts.push(lines[i].slice(0, at))
      break
    }
    parts.push(lines[i])
  }
  // Dedent the continuation lines by their common indent.
  const rest = parts.slice(1)
  const indents = rest.filter((l) => l.trim()).map(indentOf)
  const cut = indents.length ? Math.min(...indents) : 0
  return [parts[0].trim(), ...rest.map((l) => l.slice(cut).trimEnd())].join('\n').trim()
}

/** Everything the hover shows about the function defined on `defLine`, or null if it isn't a `def`. */
export function functionInfo(text: string, defLine: number): FunctionInfo | null {
  const lines = text.split('\n')
  const raw = lines[defLine - 1]
  if (raw === undefined) return null
  const head = new RegExp(`^(\\s*)(async\\s+)?def\\s+(${IDENT})\\s*\\(`).exec(raw)
  if (!head) return null
  const indent = head[1].length
  const name = head[3]

  // The header can span lines: join until the parameter list closes and the `:` follows.
  let joined = ''
  let headerEnd = defLine - 1
  for (let i = defLine - 1; i < lines.length && i < defLine + 30; i++) {
    joined += (i === defLine - 1 ? '' : ' ') + codeOnlyKeepStrings(lines[i])
    headerEnd = i
    const open = joined.indexOf('(')
    const close = closingParen(joined, open)
    if (close >= 0 && /:\s*$/.test(joined.slice(close))) break
  }
  const open = joined.indexOf('(')
  const close = closingParen(joined, open)
  const paramText = close >= 0 ? joined.slice(open + 1, close) : joined.slice(open + 1)
  const after = close >= 0 ? joined.slice(close + 1) : ''
  const retM = /->\s*(.+?)\s*:\s*$/.exec(after)
  const returns = retM ? retM[1] : null

  // Enclosing class and decorators, looking upwards.
  let className: string | null = null
  for (let i = defLine - 2; i >= 0; i--) {
    const l = lines[i]
    if (!l.trim() || l.trim().startsWith('#')) continue
    if (indentOf(l) < indent) {
      const cm = new RegExp(`^\\s*class\\s+(${IDENT})`).exec(l)
      if (cm) className = cm[1]
      break
    }
  }
  const decorators: string[] = []
  for (let i = defLine - 2; i >= 0; i--) {
    const t = lines[i].trim()
    if (t.startsWith('@')) decorators.unshift(t)
    else break
  }

  const allParams = splitTopLevel(paramText)
    .map(parseParam)
    .filter((p): p is FunctionParam => p !== null)
  const params =
    className !== null && allParams[0] && ['self', 'cls'].includes(allParams[0].name)
      ? allParams.slice(1)
      : allParams

  // Body: every following line indented deeper than the `def` (blank lines included).
  let bodyEnd = headerEnd + 1
  for (let i = headerEnd + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim()) continue
    if (indentOf(l) <= indent) break
    bodyEnd = i + 1
  }
  const bodyStart = headerEnd + 2
  let firstStmt = headerEnd + 1
  while (firstStmt < lines.length && !lines[firstStmt].trim()) firstStmt++
  const docstring =
    firstStmt < lines.length && indentOf(lines[firstStmt]) > indent ? readDocstring(lines, firstStmt) : null

  const shownParams = splitTopLevel(paramText)
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join(', ')
  const signature = `${head[2] ? 'async ' : ''}def ${name}(${shownParams})${returns ? ` -> ${returns}` : ''}`

  return {
    name,
    line: defLine,
    column: raw.indexOf(name, raw.indexOf('def') + 3) + 1,
    isAsync: !!head[2],
    className,
    decorators,
    params,
    returns,
    signature,
    docstring,
    bodyStart,
    bodyEnd: Math.max(bodyEnd, bodyStart - 1)
  }
}

/** Strip a trailing comment but keep string contents (defaults like `"LED"` stay readable). */
function codeOnlyKeepStrings(line: string): string {
  const blanked = codeOnly(line)
  return line.slice(0, blanked.length)
}

/**
 * Every place the function is used, top to bottom. A method is matched only as
 * an attribute (`self.drive(…)`, `bot.drive(…)`); a plain function only as a
 * bare name (`drive(…)`), so `machine.reset` never counts as a use of `reset`.
 */
export function findUsages(text: string, info: FunctionInfo): Usage[] {
  const lines = text.split('\n')
  const out: Usage[] = []
  const re = new RegExp(`(?<![\\w])${info.name}(?!\\w)`, 'g')
  let inTriple: string | null = null
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]
    if (inTriple) {
      if (raw.includes(inTriple)) inTriple = null
      continue
    }
    const tq = /("""|''')/.exec(raw)
    if (tq && raw.split(tq[1]).length === 2) {
      inTriple = tq[1]
      continue
    }
    const code = codeOnly(raw)
    if (new RegExp(`^\\s*(async\\s+)?def\\s+${info.name}\\b`).test(code)) continue
    for (const m of code.matchAll(re)) {
      const at = m.index ?? 0
      const before = code.slice(0, at)
      const dotted = /\.\s*$/.test(before)
      if (info.className !== null ? !dotted : dotted) continue
      const call = /^\s*\(/.test(code.slice(at + info.name.length))
      out.push({ line: n + 1, column: at + 1, text: raw.trim(), call })
    }
  }
  return out
}

/** A function body reduced to its shape: docstring, comments, numbers and strings stripped. */
function bodyShape(text: string, info: FunctionInfo): string {
  const lines = text.split('\n').slice(info.bodyStart - 1, info.bodyEnd)
  // Drop triple-quoted blocks (the docstring) whole, then single-line strings.
  const kept: string[] = []
  let inTriple: string | null = null
  for (const l of lines) {
    if (inTriple) {
      if (l.includes(inTriple)) inTriple = null
      continue
    }
    const tq = /("""|''')/.exec(l)
    if (tq && l.split(tq[1]).length === 2) {
      inTriple = tq[1]
      continue
    }
    kept.push(l)
  }
  return kept
    .map((l) => codeOnly(l).trim())
    .filter((l) => l && !/^("|')/.test(l))
    .map((l) =>
      l
        .replace(/(["'])\s*\1/g, 'S')
        .replace(/\b\d+(\.\d+)?\b/g, 'N')
        .replace(/\bTrue\b|\bFalse\b/g, 'B')
        .replace(/\s+/g, '')
    )
    .join(';')
}

/** Every function in the file, top to bottom. */
export function allFunctions(text: string): FunctionInfo[] {
  const out: FunctionInfo[] = []
  text.split('\n').forEach((l, i) => {
    if (/^\s*(async\s+)?def\s/.test(l)) {
      const f = functionInfo(text, i + 1)
      if (f) out.push(f)
    }
  })
  return out
}

/** The text Snakie's blocks put in a docstring until the learner writes one. */
const PLACEHOLDER_DOC = /^describe this function/i

/**
 * Plain-language suggestions about the function, most useful first. Pure: the
 * caller adds any hints from the refactoring catalogue on top.
 */
export function functionHints(text: string, info: FunctionInfo, usages: Usage[]): string[] {
  const hints: string[] = []
  const name = `\`${info.name}\``
  const dunder = /^__\w+__$/.test(info.name)

  if (!info.docstring) {
    hints.push(`Add a docstring: a \`"""…"""\` line under the \`def\` saying what ${name} does shows up right here.`)
  } else if (PLACEHOLDER_DOC.test(info.docstring)) {
    hints.push(`The docstring is still the placeholder. Say what ${name} does and it shows up right here.`)
  }

  if (!dunder && info.decorators.length === 0 && usages.length === 0) {
    hints.push(`${name} isn't used anywhere in this file. Call it, or delete it if it's left over.`)
  } else if (!dunder && usages.length > 0 && usages.every((u) => !u.call)) {
    hints.push(`${name} is passed around but never called directly here (as a callback, perhaps).`)
  }

  if (info.params.length > 5) {
    hints.push(`${info.params.length} parameters is a lot to remember. Could some of them travel together in a class or a dict?`)
  }

  const bodyLines = text
    .split('\n')
    .slice(info.bodyStart - 1, info.bodyEnd)
    .filter((l) => l.trim() && !l.trim().startsWith('#')).length
  if (bodyLines > 40) {
    hints.push(`${name} is ${bodyLines} lines long. Splitting it into smaller named steps makes it easier to read and test.`)
  }

  const mutable = info.params.find((p) => p.default !== null && /^(\[|\{|dict\(|list\(|set\()/.test(p.default))
  if (mutable) {
    hints.push(
      `\`${mutable.name}\` defaults to a mutable \`${mutable.default}\`, which is shared between calls. Default to \`None\` and create it inside instead.`
    )
  }

  if (!/^[a-z_][a-z0-9_]*$/.test(info.name) && !dunder) {
    hints.push(`Python names functions in snake_case (\`${toSnake(info.name)}\`).`)
  }

  // Functions with the same shape that differ only in their numbers or strings
  // (`forward`, `left`, `stop` each setting the motors to different values).
  const shape = bodyShape(text, info)
  if (shape.split(';').length >= 2) {
    const twins = allFunctions(text).filter(
      (f) => f.line !== info.line && f.className === info.className && f.params.length === info.params.length && bodyShape(text, f) === shape
    )
    if (twins.length) {
      const names = twins.map((f) => `\`${f.name}\``)
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      hints.push(
        `${name} has the same shape as ${list}, only with different values. One function that takes those values as parameters could replace ${twins.length === 1 ? 'both' : 'them all'}.`
      )
    }
  }
  return hints
}

function toSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .toLowerCase()
}
