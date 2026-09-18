/**
 * A LEXER FOR THE SUBSET WE EMIT (#1019, epic #1007).
 * =============================================================================
 *
 * The spike's answer, in code. #1019 asks where a Python AST comes from in the
 * renderer, and the honest answer turned out to be that **we do not need one**:
 *
 *  - the bundled MicroPython WASM has no `ast` module and its `compile()`
 *    returns an opaque `code` object with no readable attributes — checked, not
 *    assumed (see `docs/blockly-epic.md` §5);
 *  - a real CPython `ast` is one JSON-RPC call away on the desktop and absent on
 *    the web build, which is exactly where the classrooms are;
 *  - a general Python parser in JS is a megabyte of WASM for a language whose
 *    subset we define ourselves.
 *
 * Python is LINE-ORIENTED with significant indentation, and the code this has to
 * read is code our own generator wrote. So the shape that fits is a lexer and a
 * logical-line splitter, not a parser: a few hundred bytes, pure, node-testable,
 * identical on desktop and web — and #1018's raw-Python blocks are a per-line
 * fallback that is always correct for anything it cannot classify.
 *
 * WHERE THIS DIFFERS FROM `python-check.ts`. That module walks the same text but
 * wants POSITIONS — is this offset inside a string, how deep are the brackets —
 * and blanks out what it isn't looking at. This one wants the tokens themselves.
 * Two outputs of the same walk, and trying to serve both from one function makes
 * a function that is bad at each.
 */

/** One logical line: everything up to a newline that is not inside brackets. */
export interface LogicalLine {
  /** Leading spaces on the FIRST physical line, in characters. */
  indent: number
  /** The line's text, joined and with the indent removed. */
  text: string
  /** Where it started, 1-based, for the report. */
  line: number
  /**
   * How many blank lines stood immediately above this one.
   *
   * KEPT, because a learner typing in the code pane uses them to think. Blank
   * lines carry no meaning to Python and the generator has always inserted its
   * own between sections — but the text in the pane is turned back into blocks
   * and regenerated from them, so anything this does not record is something
   * that disappears out from under the cursor a moment after it is typed.
   * `python-to-blocks.ts` turns each run into a spacer block that writes it back.
   */
  blankBefore: number
}

/** What a token is. `keyword` is split out because the parser branches on it. */
export type TokenKind = 'number' | 'string' | 'name' | 'keyword' | 'op' | 'open' | 'close'

export interface Token {
  kind: TokenKind
  /** The source text, verbatim — a string token keeps its quotes. */
  text: string
  /**
   * Where it sits in the line it came from.
   *
   * Carried so a caller can slice the ORIGINAL text back out rather than
   * re-joining tokens: an f-string, a starred argument, a comprehension all lex
   * into pieces that cannot be spaced back together the way they were written,
   * and a conversion that reformatted somebody's code while claiming to keep it
   * verbatim would be the worst kind of wrong.
   */
  start: number
  end: number
}

/** Python keywords the recogniser cares about. Everything else lexes as a name. */
const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'in',
  'is',
  'None',
  'True',
  'False',
  'if',
  'else',
  'elif',
  'for',
  'while',
  'def',
  'return',
  'break',
  'continue',
  'import',
  'from',
  'as',
  'pass',
  'lambda',
  'class',
  'with',
  'try',
  'except',
  'finally',
  'global',
  'nonlocal',
  'del',
  'raise',
  'assert',
  'yield'
])

/** Multi-character operators, longest first so `<=` never lexes as `<` then `=`. */
const OPERATORS = [
  '**=',
  '//=',
  '>>=',
  '<<=',
  '==',
  '!=',
  '<=',
  '>=',
  '**',
  '//',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
  '->',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '.',
  ',',
  ':',
  '&',
  '|',
  '^',
  '~',
  '@'
]

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

/**
 * Split source into logical lines.
 *
 * A newline inside brackets, or after a backslash, continues the line — which is
 * the one piece of Python's grammar a line-oriented reader cannot skip, because
 * a call split over three lines is one statement and treating it as three would
 * produce three blocks that each generate nonsense.
 *
 * Blank lines are COUNTED rather than dropped — their indentation is not, since
 * whitespace on an otherwise empty line would otherwise read as a dedent. The
 * count lands on the line below as {@link LogicalLine.blankBefore}, so a
 * conversion can put it back; nothing here treats it as structure.
 *
 * COMMENTS ARE KEPT, as their own line. They are somebody's writing, and a
 * conversion that silently deleted them would be a conversion nobody trusts;
 * `python-to-blocks.ts` turns each into a raw block that regenerates verbatim.
 */
export function logicalLines(source: string): LogicalLine[] {
  const out: LogicalLine[] = []
  const text = source.replace(/\r\n?/g, '\n')
  let i = 0
  let lineNo = 1
  /** Blank lines seen since the last line that was not one. */
  let blanks = 0

  while (i < text.length) {
    // Measure the indent, then find where this logical line ends.
    const startLine = lineNo
    let indent = 0
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
      indent += text[i] === '\t' ? 4 : 1
      i += 1
    }
    if (text[i] === '\n') {
      i += 1
      lineNo += 1
      // A blank line. Counted against the next line that is not one — and NOT
      // reset here, so a run of them arrives as a run.
      blanks += 1
      continue
    }

    const parts: string[] = []
    const open: string[] = []
    // Comments met INSIDE brackets (#1068) — see the `#` branch below.
    const folded: string[] = []
    let buffer = ''
    while (i < text.length) {
      const ch = text[i]
      if (ch === '\n') {
        if (open.length > 0) {
          // Inside brackets: fold the break into a single space, which is what
          // the generator would have written on one line anyway.
          parts.push(buffer.trimEnd())
          buffer = ''
          i += 1
          lineNo += 1
          while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1
          continue
        }
        i += 1
        lineNo += 1
        break
      }
      if (ch === '\\' && text[i + 1] === '\n') {
        parts.push(buffer.trimEnd())
        buffer = ''
        i += 2
        lineNo += 1
        while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1
        continue
      }
      if (ch === '#') {
        // To the end of the physical line, verbatim.
        let comment = ''
        while (i < text.length && text[i] !== '\n') {
          comment += text[i]
          i += 1
        }
        // A COMMENT INSIDE BRACKETS CANNOT STAY WHERE IT IS (#1068). The line
        // break after it is about to be folded into a space, so leaving the
        // comment in place puts the REST OF THE CALL inside it:
        //
        //     print(              became    print( 1,  # first 2)
        //         1,  # first
        //         2)
        //
        // — an unclosed bracket where valid Python used to be, written straight
        // back out by the raw block that held it. The whole logical line is
        // being reflowed onto one line whatever we do, so the comment goes to
        // the end of it, where a comment can live: nothing is lost and nothing
        // is broken.
        if (open.length > 0) folded.push(comment)
        else buffer += comment
        continue
      }
      if (ch === '"' || ch === "'") {
        const quote = text.slice(i, i + 3) === ch.repeat(3) ? ch.repeat(3) : ch
        const end = closingQuote(text, i + quote.length, quote)
        const stop = end === -1 ? text.length : end + quote.length
        const literal = text.slice(i, stop)
        // A triple-quoted string may span lines; keep the count honest.
        lineNo += (literal.match(/\n/g) ?? []).length
        buffer += literal
        i = stop
        continue
      }
      if (OPENERS[ch]) open.push(ch)
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (open.length > 0 && OPENERS[open[open.length - 1]] === ch) open.pop()
      }
      buffer += ch
      i += 1
    }
    parts.push(buffer.trimEnd())
    const code = parts.filter((p) => p !== '').join(' ').trim()
    // The folded comments ride at the end, two spaces off the code, which is the
    // shape PEP 8 asks for and what `trailingCommentAt` will find there.
    const comment = folded.join(' ')
    const joined =
      folded.length === 0 ? code : code === '' ? comment : `${code}  ${comment}`
    if (joined !== '') {
      out.push({ indent, text: joined, line: startLine, blankBefore: blanks })
      blanks = 0
    }
  }
  return out
}

/** Where a string literal opened at `from` closes, or -1. Honours backslashes. */
function closingQuote(text: string, from: number, quote: string): number {
  let i = from
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (quote.length === 1 && text[i] === '\n') return -1
    if (text.startsWith(quote, i)) return i
    i += 1
  }
  return -1
}

/**
 * Lex ONE logical line. Returns null when the text contains something this does
 * not understand — which the caller answers with a raw Python block rather than
 * with an error, because being unable to classify a line is the normal case.
 *
 * A trailing comment is dropped: it belongs to the line's text, and the caller
 * has the original for anything it needs to reproduce verbatim.
 */
export function tokenize(text: string): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t') {
      i += 1
      continue
    }
    if (ch === '#') break // a trailing comment ends the code
    if (ch === '"' || ch === "'") {
      const quote = text.slice(i, i + 3) === ch.repeat(3) ? ch.repeat(3) : ch
      const end = closingQuote(text, i + quote.length, quote)
      if (end === -1) return null // unterminated — not ours to interpret
      out.push({ kind: 'string', text: text.slice(i, end + quote.length), start: i, end: end + quote.length })
      i = end + quote.length
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const m = /^(0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)/.exec(
        text.slice(i)
      )
      if (!m) return null
      out.push({ kind: 'number', text: m[0], start: i, end: i + m[0].length })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))!
      out.push({
        kind: KEYWORDS.has(m[0]) ? 'keyword' : 'name',
        text: m[0],
        start: i,
        end: i + m[0].length
      })
      i += m[0].length
      continue
    }
    if (OPENERS[ch]) {
      out.push({ kind: 'open', text: ch, start: i, end: i + 1 })
      i += 1
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      out.push({ kind: 'close', text: ch, start: i, end: i + 1 })
      i += 1
      continue
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i))
    if (!op) return null
    out.push({ kind: 'op', text: op, start: i, end: i + op.length })
    i += op.length
    continue
  }
  return out
}

/**
 * Where a trailing comment starts on this line, or -1 (#1068).
 *
 * "Trailing" meaning a `#` that is really a `#` — not one inside a string, which
 * is why this walks rather than calling `indexOf`. For a line that is nothing
 * but a comment the answer is 0, which is still the right answer to the question
 * asked.
 *
 * `python-to-blocks.ts` uses it to REFUSE to recognise a line that carries one.
 * `tokenize` stops at the comment and hands back the code alone, so every
 * recogniser downstream matched the line and silently dropped the rest of it:
 * `x = 5  # how many times` came back as `x = 5`, and `time.sleep(1)  # pause`
 * as a wait block with the pause forgotten. A comment is somebody's writing.
 */
export function trailingCommentAt(text: string): number {
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '#') return i
    if (ch === '"' || ch === "'") {
      const quote = text.slice(i, i + 3) === ch.repeat(3) ? ch.repeat(3) : ch
      const end = closingQuote(text, i + quote.length, quote)
      // An unterminated literal has no comment after it — there is no "after".
      i = end === -1 ? text.length : end + quote.length
      continue
    }
    i += 1
  }
  return -1
}

/**
 * Is this line the header of an indented suite — does it end in a colon that is
 * really a colon?
 *
 * The test has to ignore a colon inside a string, a slice or a dict, which is
 * why it goes through the lexer rather than looking at the last character.
 */
export function isSuiteHeader(text: string): boolean {
  const tokens = tokenize(text)
  if (!tokens || tokens.length === 0) return false
  const last = tokens[tokens.length - 1]
  return last.kind === 'op' && last.text === ':'
}
