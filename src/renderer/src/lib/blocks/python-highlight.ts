/**
 * MINIMAL PYTHON HIGHLIGHTING FOR THE MIRROR (#1009, epic #1007).
 * =============================================================================
 *
 * The Python pane beside the canvas is a MIRROR, not an editor: it is read-only,
 * it is regenerated whenever the blocks change (#1010), and #1016 hangs
 * hover-linked highlighting off its per-line elements. Mounting a second Monaco
 * to render text nobody can type into would cost the editor's multi-megabyte
 * chunk inside the blocks chunk, and buy an editing surface we then have to take
 * away again.
 *
 * So the mirror renders its own lines, and this is the colouring. It does not
 * attempt Python — it attempts THE PYTHON WE GENERATE, which is a far smaller
 * language: imports, calls, numbers, single-line strings, comments, and the
 * handful of keywords the core palette emits (#1011). Anything it doesn't
 * recognise falls through as an identifier, which is the correct look for a
 * name, and the one failure mode is a token that should have been coloured and
 * wasn't.
 *
 * Pure and DOM-free so it unit-tests in node, and so the renderer isn't where
 * anyone discovers the regexes are wrong.
 */

/** The token classes, matching the Soft Shell syntax tokens in `index.css`. */
export type PyTokenKind = 'kw' | 'str' | 'num' | 'com' | 'ident' | 'op'

export interface PyToken {
  kind: PyTokenKind
  text: string
}

/**
 * The keywords the generated subset uses. Deliberately not all of Python:
 * `nonlocal` never appears in generated code, and listing it would imply this
 * is a Python highlighter rather than a mirror for what we emit.
 */
const KEYWORDS = new Set([
  'and',
  'as',
  'break',
  'continue',
  'def',
  'elif',
  'else',
  'False',
  'for',
  'from',
  'if',
  'import',
  'in',
  'is',
  'None',
  'not',
  'or',
  'pass',
  'return',
  'True',
  'while'
])

/**
 * One line of generated Python, split into coloured runs.
 *
 * Line-at-a-time on purpose: the mirror renders one element per line for
 * #1016's block↔line highlighting, and a tokeniser that spanned lines would
 * make a line's colour depend on the one above it — which is exactly what
 * breaks when a single line is re-rendered on a block change. The cost is that
 * triple-quoted strings are not tracked across lines, and the generated subset
 * has none.
 */
export function highlightPythonLine(line: string): PyToken[] {
  const out: PyToken[] = []
  let i = 0

  const push = (kind: PyTokenKind, text: string): void => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += text
    else out.push({ kind, text })
  }

  while (i < line.length) {
    const c = line[i]

    // A comment runs to the end of the line — including the blocks footer, which
    // is why the mirror never shows it: `blocks-doc.ts` strips it before we see
    // the code at all.
    if (c === '#') {
      push('com', line.slice(i))
      break
    }

    if (c === '"' || c === "'") {
      const end = closingQuote(line, i)
      push('str', line.slice(i, end))
      i = end
      continue
    }

    if (isDigit(c) || (c === '.' && isDigit(line[i + 1] ?? ''))) {
      let j = i
      while (j < line.length && /[0-9a-fA-FxXoObB._]/.test(line[j])) j++
      push('num', line.slice(i, j))
      i = j
      continue
    }

    if (isWordStart(c)) {
      let j = i
      while (j < line.length && isWordPart(line[j])) j++
      const word = line.slice(i, j)
      push(KEYWORDS.has(word) ? 'kw' : 'ident', word)
      i = j
      continue
    }

    push('op', c)
    i++
  }

  return out
}

/** Every line of `code`, tokenised. An empty source is no lines, not one. */
export function highlightPython(code: string): PyToken[][] {
  if (code === '') return []
  return code.split('\n').map(highlightPythonLine)
}

/**
 * Index just past the string starting at `start`, or the end of the line for an
 * unterminated one — a half-typed string colours as a string to its end, which
 * is what every editor does and what stops the rest of the line flickering.
 */
function closingQuote(line: string, start: number): number {
  const quote = line[start]
  for (let i = start + 1; i < line.length; i++) {
    if (line[i] === '\\') {
      i++
      continue
    }
    if (line[i] === quote) return i + 1
  }
  return line.length
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isWordStart = (c: string): boolean => /[A-Za-z_]/.test(c)
const isWordPart = (c: string): boolean => /[A-Za-z0-9_]/.test(c)
