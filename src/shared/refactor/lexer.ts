/**
 * Python tokenizer for the refactoring engine (epic #634, phase R0).
 *
 * Pure TypeScript, no dependencies — so it runs identically in the Electron
 * renderer, the standalone web build (#267, where there is no Python host) and
 * under vitest in plain node. See `parser.ts` for why we don't use tree-sitter.
 *
 * Emits the classic Python token stream: significant NEWLINE / INDENT / DEDENT
 * driven by leading whitespace, with blank and comment-only lines skipped and
 * implicit line joining inside `(` `[` `{` (plus explicit `\` continuations).
 * Comments are kept OUT of the token stream and collected separately, because
 * every rewrite is a ranged text edit computed from node offsets — comments
 * survive automatically as long as nothing rewrites the bytes they live in.
 *
 * Offsets are UTF-16 code-unit indexes into the original source, so they map
 * straight onto JS string slicing and Monaco positions.
 */

/** Token kinds. `nl`/comment trivia never reaches the parser. */
export type TokenType = 'name' | 'number' | 'string' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof'

/** A single token. `start`/`end` are offsets into the source string. */
export interface Token {
  type: TokenType
  /** Raw source text of the token (empty for indent/dedent/eof). */
  value: string
  start: number
  end: number
}

/** A `#` comment, kept aside from the token stream. */
export interface Comment {
  /** Text including the leading `#`. */
  text: string
  start: number
  end: number
  /** True when the comment is the only thing on its line. */
  ownLine: boolean
}

/** A lexing failure — bad indentation, an unterminated string, a stray char. */
export interface LexError {
  message: string
  start: number
  end: number
}

/** Everything the lexer produces. A non-empty `errors` means "do not refactor". */
export interface LexResult {
  tokens: Token[]
  comments: Comment[]
  errors: LexError[]
}

/** Python keywords. Kept as `name` tokens; the parser checks the value. */
export const KEYWORDS = new Set([
  'False',
  'None',
  'True',
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
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield'
])

/**
 * Operators and delimiters, longest-first so the scanner can take the first
 * match. `->` and `:=` are included; `!=` is here but a bare `!` is not.
 */
const OPERATORS = [
  '**=',
  '//=',
  '>>=',
  '<<=',
  '...',
  '!=',
  '>=',
  '<=',
  '==',
  '->',
  ':=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '@=',
  '**',
  '//',
  '<<',
  '>>',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '.',
  ';',
  '+',
  '-',
  '*',
  '/',
  '%',
  '@',
  '&',
  '|',
  '^',
  '~',
  '<',
  '>',
  '='
]

/** Valid string prefixes (lower-cased), longest first. */
const STRING_PREFIXES = ['rb', 'br', 'rf', 'fr', 'r', 'b', 'u', 'f']

const isDigit = (c: string): boolean => c >= '0' && c <= '9'

/** Python identifier start: letter, `_`, or any non-ASCII letter. */
function isIdentStart(c: string): boolean {
  return /[A-Za-z_]/.test(c) || c.charCodeAt(0) > 127
}

function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c) || c.charCodeAt(0) > 127
}

/**
 * Tokenize `src`. Never throws: anything it can't read becomes a {@link LexError},
 * which the engine treats as "this file does not parse, offer no refactorings".
 */
export function tokenize(src: string): LexResult {
  const tokens: Token[] = []
  const comments: Comment[] = []
  const errors: LexError[] = []
  /** Indent widths of the enclosing blocks; always starts with 0. */
  const indents: number[] = [0]
  let pos = 0
  let depth = 0
  /** True once a real token has been emitted on the current logical line. */
  let lineHasContent = false
  const n = src.length

  const push = (type: TokenType, value: string, start: number, end: number): void => {
    tokens.push({ type, value, start, end })
  }

  // A leading BOM is whitespace as far as the grammar is concerned.
  if (src.charCodeAt(0) === 0xfeff) pos = 1

  /** Consume `# …` to (not including) the end of the physical line. */
  const readComment = (ownLine: boolean): void => {
    const start = pos
    while (pos < n && src[pos] !== '\n' && src[pos] !== '\r') pos++
    comments.push({ text: src.slice(start, pos), start, end: pos, ownLine })
  }

  /**
   * At the start of a physical line with no open brackets: measure the indent,
   * skip blank/comment-only lines, and emit INDENT/DEDENT tokens.
   * Returns false when the source is exhausted.
   */
  const handleLineStart = (): boolean => {
    for (;;) {
      const lineStart = pos
      let width = 0
      while (pos < n) {
        const c = src[pos]
        if (c === ' ') width += 1
        else if (c === '\t') width += 8 - (width % 8)
        else if (c === '\f') width = 0
        else break
        pos++
      }
      if (pos >= n) return false
      const c = src[pos]
      // Blank line, or a comment on its own line: no indent processing at all.
      if (c === '\n' || c === '\r') {
        if (c === '\r' && src[pos + 1] === '\n') pos += 2
        else pos += 1
        continue
      }
      if (c === '#') {
        readComment(true)
        continue
      }
      if (width > indents[indents.length - 1]) {
        indents.push(width)
        push('indent', '', lineStart, pos)
      } else {
        while (width < indents[indents.length - 1]) {
          indents.pop()
          push('dedent', '', pos, pos)
        }
        if (width !== indents[indents.length - 1]) {
          errors.push({ message: 'unindent does not match any outer indentation level', start: lineStart, end: pos })
          // Recover by accepting the level, so later lines still lex.
          indents.push(width)
        }
      }
      return true
    }
  }

  /** Read a string literal starting at `pos` (already past any prefix). */
  const readString = (start: number, prefix: string): void => {
    const raw = /r/.test(prefix)
    const quote = src[pos]
    let terminator = quote
    if (src[pos + 1] === quote && src[pos + 2] === quote) terminator = quote + quote + quote
    pos += terminator.length
    for (;;) {
      if (pos >= n) {
        errors.push({ message: 'unterminated string literal', start, end: n })
        push('string', src.slice(start, n), start, n)
        return
      }
      const c = src[pos]
      if (c === '\\' && !raw) {
        // Even in a raw string a backslash still escapes the quote for the
        // purposes of finding the end, so only non-raw skips two chars here.
        pos += 2
        continue
      }
      if (c === '\\' && raw) {
        pos += 2
        continue
      }
      if (terminator.length === 1 && (c === '\n' || c === '\r')) {
        errors.push({ message: 'unterminated string literal', start, end: pos })
        push('string', src.slice(start, pos), start, pos)
        return
      }
      if (c === quote && src.startsWith(terminator, pos)) {
        pos += terminator.length
        push('string', src.slice(start, pos), start, pos)
        return
      }
      pos++
    }
  }

  for (;;) {
    if (depth === 0 && !lineHasContent) {
      if (!handleLineStart()) break
    }
    if (pos >= n) break

    const c = src[pos]

    // Horizontal whitespace between tokens.
    if (c === ' ' || c === '\t' || c === '\f') {
      pos++
      continue
    }

    // Explicit line continuation.
    if (c === '\\' && (src[pos + 1] === '\n' || src[pos + 1] === '\r')) {
      pos++
      if (src[pos] === '\r' && src[pos + 1] === '\n') pos += 2
      else pos += 1
      continue
    }

    if (c === '#') {
      readComment(!lineHasContent)
      continue
    }

    if (c === '\n' || c === '\r') {
      const start = pos
      if (c === '\r' && src[pos + 1] === '\n') pos += 2
      else pos += 1
      if (depth === 0 && lineHasContent) {
        push('newline', src.slice(start, pos), start, pos)
        lineHasContent = false
      }
      continue
    }

    const start = pos

    // String literal, with or without a prefix.
    if (c === '"' || c === "'") {
      readString(start, '')
      lineHasContent = true
      continue
    }
    if (isIdentStart(c)) {
      let p = pos
      while (p < n && isIdentPart(src[p])) p++
      const word = src.slice(pos, p)
      const lower = word.toLowerCase()
      if (
        (src[p] === '"' || src[p] === "'") &&
        word.length <= 2 &&
        STRING_PREFIXES.includes(lower)
      ) {
        pos = p
        readString(start, lower)
        lineHasContent = true
        continue
      }
      pos = p
      push('name', word, start, pos)
      lineHasContent = true
      continue
    }

    // Number: decimal, float, hex/octal/binary, imaginary, `_` separators.
    if (isDigit(c) || (c === '.' && isDigit(src[pos + 1]))) {
      let p = pos
      if (c === '0' && /[xXoObB]/.test(src[p + 1] ?? '')) {
        p += 2
        while (p < n && /[0-9a-fA-F_]/.test(src[p])) p++
      } else {
        while (p < n && /[0-9_]/.test(src[p])) p++
        if (src[p] === '.') {
          p++
          while (p < n && /[0-9_]/.test(src[p])) p++
        }
        if (/[eE]/.test(src[p] ?? '') && /[0-9+-]/.test(src[p + 1] ?? '')) {
          p += 2
          while (p < n && /[0-9_]/.test(src[p])) p++
        }
      }
      if (/[jJ]/.test(src[p] ?? '')) p++
      pos = p
      push('number', src.slice(start, pos), start, pos)
      lineHasContent = true
      continue
    }

    const op = OPERATORS.find((o) => src.startsWith(o, pos))
    if (op) {
      pos += op.length
      if (op === '(' || op === '[' || op === '{') depth++
      else if (op === ')' || op === ']' || op === '}') depth = Math.max(0, depth - 1)
      push('op', op, start, pos)
      lineHasContent = true
      continue
    }

    errors.push({ message: `unexpected character ${JSON.stringify(c)}`, start, end: start + 1 })
    pos++
    lineHasContent = true
  }

  // A file that ends mid-line still closes its logical line, then its blocks.
  if (lineHasContent) push('newline', '', n, n)
  while (indents.length > 1) {
    indents.pop()
    push('dedent', '', n, n)
  }
  push('eof', '', n, n)

  return { tokens, comments, errors }
}
