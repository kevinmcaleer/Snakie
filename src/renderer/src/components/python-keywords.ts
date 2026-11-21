/**
 * Which Python keywords make sense at the cursor, for the editor's completions.
 *
 * Monaco's Python language has no keyword completions of its own, so typing
 * `fro` offered nothing. Offering every keyword everywhere would be noise
 * (`elif` on the first line of a file, `break` outside a loop), so this reads
 * just enough of the code around the cursor to offer the ones that are valid:
 *
 *   - at the start of a statement: the statement keywords (`import`, `from`,
 *     `def`, `if`, `for`, …), plus `elif`/`else` after an `if` block,
 *     `except`/`finally` after `try`, `return`/`yield` inside a `def`,
 *     `break`/`continue` inside a loop, `await` inside `async def`;
 *   - mid-statement: `import` after `from x`, `as` after `import x` /
 *     `except E` / `with f(…)`, `in` after `for x`, and the expression
 *     keywords (`True`, `False`, `None`, `not`, `and`, `or`, `is`, `in`,
 *     `lambda`, `if`/`else`) where an expression is going.
 *
 * Line-based like the rest of the editor's Python reading: it must answer on
 * half-written code. MicroPython and CircuitPython have the same keywords as
 * Python 3, so this is dialect-independent.
 */

export interface KeywordSuggestion {
  keyword: string
  /** One line on what it does, shown beside the suggestion. */
  detail: string
  /** Text to insert. Keywords that are always followed by something get a space. */
  insert: string
}

const DETAIL: Record<string, string> = {
  False: 'The boolean false value',
  None: 'The "no value" value',
  True: 'The boolean true value',
  and: 'True if both sides are true',
  as: 'Give the imported module, exception or context a name',
  assert: 'Stop with an error if a condition is false',
  async: 'Define a coroutine (async def) or async for/with',
  await: 'Wait for a coroutine to finish',
  break: 'Leave the loop now',
  class: 'Define a class',
  continue: 'Skip to the next pass of the loop',
  def: 'Define a function',
  del: 'Delete a name, item or attribute',
  elif: 'Otherwise, if this condition is true',
  else: 'Otherwise',
  except: 'Handle an error raised in the try block',
  finally: 'Always run this, error or not',
  for: 'Repeat for each item',
  from: 'Import names from a module',
  global: 'Assign to a module-level name inside a function',
  if: 'Run code only when a condition is true',
  import: 'Load a module',
  in: 'Loop over / test membership',
  is: 'Test whether two things are the same object',
  lambda: 'A small anonymous function',
  nonlocal: "Assign to an enclosing function's name",
  not: 'Negate a condition',
  or: 'True if either side is true',
  pass: 'Do nothing (a placeholder)',
  raise: 'Raise an error',
  return: 'Send a value back from the function',
  try: 'Run code and catch errors it raises',
  while: 'Repeat while a condition is true',
  with: 'Use a context manager (opened file, lock, …)',
  yield: 'Produce a value from a generator'
}

/** Keywords that are complete on their own: no trailing space. */
const BARE = new Set(['True', 'False', 'None', 'pass', 'break', 'continue', 'else', 'try', 'finally'])

const EXPRESSION_START = ['True', 'False', 'None', 'not', 'lambda']
const AFTER_TERM = ['and', 'or', 'not', 'in', 'is', 'if', 'else']

const indentOf = (line: string): number => line.length - line.trimStart().length

/** Strip a trailing comment and string contents (keeps quotes) so `#` / `"if "` don't fool us. */
function code(line: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\') {
        i++
        out += ' '
        continue
      }
      if (c === quote) quote = null
      out += quote ? ' ' : c
      continue
    }
    if (c === '#') break
    if (c === '"' || c === "'") quote = c
    out += c
  }
  return out
}

/** The blocks that enclose a line at `indent`, innermost first, read upwards from `lines`. */
function enclosing(lines: string[], indent: number): string[] {
  const out: string[] = []
  let limit = indent
  for (let i = lines.length - 1; i >= 0 && limit > 0; i--) {
    const raw = lines[i]
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const ind = indentOf(raw)
    if (ind >= limit) continue
    const head = /^\s*(async\s+def|def|class|for|async\s+for|while|if|elif|else|try|except|finally|with|async\s+with)\b/.exec(raw)
    if (head) out.push(head[1].replace(/\s+/g, ' '))
    limit = ind
  }
  return out
}

/** The previous statement header at exactly `indent` (the block the cursor could continue), if any. */
function previousAtIndent(lines: string[], indent: number): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const ind = indentOf(raw)
    if (ind > indent) continue
    if (ind < indent) return null
    const head = /^\s*(if|elif|else|for|async\s+for|while|try|except|finally)\b/.exec(raw)
    return head ? head[1].replace(/\s+/g, ' ') : 'other'
  }
  return null
}

function make(keywords: string[]): KeywordSuggestion[] {
  const seen = new Set<string>()
  return keywords
    .filter((k) => !seen.has(k) && !!seen.add(k))
    .map((k) => ({ keyword: k, detail: DETAIL[k] ?? 'Python keyword', insert: BARE.has(k) ? k : `${k} ` }))
}

/**
 * The keywords to offer.
 *
 * @param before Every line above the cursor's line (oldest first).
 * @param lineToCursor The cursor's line up to the cursor.
 */
export function keywordsAt(before: string[], lineToCursor: string): KeywordSuggestion[] {
  const line = code(lineToCursor)
  // The word being typed is replaced by the suggestion; look at what precedes it.
  const head = line.replace(/[A-Za-z_][A-Za-z0-9_]*$/, '')
  // Inside a string: nothing.
  if ((line.match(/["']/g) ?? []).length % 2 === 1) return []
  if (/\.\s*$/.test(head)) return []

  // Start of a statement.
  if (/^\s*$/.test(head)) {
    const indent = head.length
    const blocks = enclosing(before, indent)
    const inDef = blocks.some((b) => b === 'def' || b === 'async def')
    const inAsync = blocks.find((b) => b === 'def' || b === 'async def') === 'async def'
    const innerDef = blocks.findIndex((b) => b === 'def' || b === 'async def')
    const loopIdx = blocks.findIndex((b) => b === 'for' || b === 'async for' || b === 'while')
    // A loop counts only if no def sits between it and the cursor.
    const inLoop = loopIdx >= 0 && (innerDef < 0 || loopIdx < innerDef)
    const nestedDef = blocks.filter((b) => b === 'def' || b === 'async def').length >= 2

    const kws: string[] = []
    const prev = previousAtIndent(before, indent)
    if (prev === 'if' || prev === 'elif') kws.push('elif', 'else')
    if (prev === 'for' || prev === 'async for' || prev === 'while') kws.push('else')
    if (prev === 'try' || prev === 'except') kws.push('except', 'finally')
    if (prev === 'except') kws.push('else')
    kws.push('import', 'from', 'def', 'class', 'if', 'for', 'while', 'try', 'with', 'pass', 'raise', 'del', 'assert', 'async')
    if (inDef) kws.push('return', 'yield', 'global')
    if (nestedDef) kws.push('nonlocal')
    if (inLoop) kws.push('break', 'continue')
    if (inAsync) kws.push('await')
    if (!inDef) kws.push('global')
    kws.push(...EXPRESSION_START)
    return make(kws)
  }

  // Naming something (`def n…`, `class n…`, `as n…`, `import n…`): no keywords.
  if (/\b(def|class|as|import|global|nonlocal)\s+$/.test(head)) return []

  // `from machine i…` → import
  if (/^\s*from\s+[\w.]+\s+$/.test(head)) return make(['import'])
  // `import machine a…`, `from x import y a…`, `import a, b a…` → as
  if (/^\s*(import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*|from\s+[\w.]+\s+import\s+.*\w)\s+$/.test(head)) {
    return /\bas\s+\w*\s*$/.test(head) ? [] : make(['as'])
  }
  // `except OSError a…` / `with open(f) a…` → as
  if (/^\s*(except\s+.+\S|(async\s+)?with\s+.+\S)\s+$/.test(head) && !/\bas\s+\w*\s*$/.test(head)) return make(['as'])
  // `for x i…` → in
  if (/^\s*(async\s+)?for\s+[\w\s,()]+?\s+$/.test(head) && !/\bin\b/.test(head)) return make(['in'])

  // An expression is about to start: after `=`, an operator, an open bracket,
  // a comma, `:` (lambda / dict / slice) or a keyword that takes an expression.
  const inAsyncDef = enclosing(before, indentOf(lineToCursor) + 1).find((b) => b === 'def' || b === 'async def') === 'async def'
  if (
    /([=([{,:+\-*/%<>!&|^~@]|\b(return|yield|if|elif|while|and|or|not|in|is|assert|raise|del|lambda|else|await|print))\s*$/.test(head)
  ) {
    return make([...EXPRESSION_START, ...(inAsyncDef ? ['await'] : [])])
  }

  // After a finished term (`x `, `f(a) `, `"s" `): the operators that join terms.
  if (/[\w)\]}"']\s+$/.test(head)) return make(AFTER_TERM)
  return []
}
