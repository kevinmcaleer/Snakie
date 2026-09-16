/**
 * IS THIS PYTHON, OR IS IT A TYPO? (#1018, epic #1007).
 * =============================================================================
 *
 * The escape-hatch blocks take free text and put it straight into a child's
 * program. That is the whole point — an unknown library must never be a wall —
 * but "generated verbatim" and "trusted" are different things. A missing bracket
 * typed into a block should surface ON THAT BLOCK, before Run, not as a
 * `SyntaxError` from a board naming a line number in a file the learner did not
 * write.
 *
 * WHAT THIS IS NOT. It is not a Python parser. Snakie has no Python AST in the
 * renderer — that is exactly the open question #1019 has to answer, and the web
 * build (#267), which is where the classrooms are, has no interpreter to borrow
 * one from. So this is a LINT with a deliberately small, honest remit: the
 * mistakes that actually happen when somebody types code into a small box.
 *
 *  - a bracket or quote left open — by far the commonest, and the one whose
 *    device traceback is least readable;
 *  - a statement where an expression belongs (`x = 1` plugged into a socket),
 *    which Python rejects and which no amount of squinting at a block reveals;
 *  - a line ending in `:` — a `for`/`if`/`def` header with no body, which is an
 *    `IndentationError` and, more usefully, a sign the learner wanted one of the
 *    Control blocks instead.
 *
 * Everything it does not recognise, it passes. A checker that guessed would be
 * worse than none: the one thing these blocks must never do is refuse code that
 * would have worked.
 *
 * Pure — no Blockly, no DOM — so every rule is a unit test rather than something
 * you discover by wiring up a board.
 */

/** What the text is being used as, which decides two of the rules. */
export type PythonContext = 'statement' | 'expression'

/** A problem worth putting on the block, in the words a learner needs. */
export interface PythonProblem {
  /** The sentence shown on the warning badge. */
  message: string
  /** A short machine-readable reason, for tests and for telemetry-free grouping. */
  code:
    | 'unclosed-bracket'
    | 'stray-bracket'
    | 'unclosed-string'
    | 'assignment-in-expression'
    | 'statement-in-expression'
    | 'dangling-colon'
    | 'trailing-operator'
}

/** Python keywords that can only ever start a STATEMENT. */
const STATEMENT_KEYWORDS = new Set([
  'assert',
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
  'nonlocal',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield'
])

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS = new Set([')', ']', '}'])

/** One scanned token position that matters — used by every rule below. */
interface Scan {
  /** Bracket depth at the end, and what is still open (innermost last). */
  open: string[]
  /** A closer with nothing to close, if there was one. */
  strayCloser: string | null
  /** The quote character still open at the end, if any. */
  openQuote: string | null
  /**
   * The text with every string literal and comment blanked out, same length.
   *
   * Every rule after the scan works on THIS rather than the raw text, so a colon
   * inside `print("a: b")` is not a dangling colon and an `=` inside a string is
   * not an assignment. Same length, so any offset still lines up.
   */
  bare: string
  /** Depth at each character of `bare`, so a rule can ask "was this top level?". */
  depth: number[]
}

/**
 * Walk the text once, tracking strings, comments and brackets.
 *
 * One pass rather than a regex per rule, because the rules all need the same
 * two facts — am I inside a string, and how deep am I — and a regex cannot know
 * either.
 */
/**
 * What a string literal is replaced by, one character for one (#1062).
 *
 * NOT A SPACE, and that distinction cost a whole file. A string is a TERM —
 * `x in " ."` is a finished thought — but blanked to spaces the line trimmed to
 * `x in`, which the trailing-operator rule below reads as somebody who stopped
 * typing mid-expression. One such line anywhere in a module made `lintOk` false
 * for the whole file, and #1037's gate then refused to convert ANY of it: the
 * canvas stayed empty and nothing said why.
 *
 * An underscore is an identifier character, so a blanked string reads as the
 * term it is, and it is still one character per character — every rule here
 * indexes `bare` against `depth` by position.
 *
 * Comments stay blanked to spaces: a comment really is not code, and a line
 * that is only a comment should reach no rule at all.
 */
const STRING_STANDIN = '_'

function scan(text: string): Scan {
  const open: string[] = []
  const depth: number[] = []
  let strayCloser: string | null = null
  let openQuote: string | null = null
  let bare = ''

  let i = 0
  while (i < text.length) {
    const ch = text[i]

    // A comment runs to the end of the line, and nothing in it is code.
    if (ch === '#') {
      while (i < text.length && text[i] !== '\n') {
        bare += ' '
        depth.push(open.length)
        i += 1
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      // Triple quotes are a real thing a learner will paste, and treating the
      // first two characters of `"""` as an empty string would then leave the
      // third one looking unterminated.
      const triple = text.slice(i, i + 3)
      const quote = triple === '"""' || triple === "'''" ? triple : ch
      const end = closingQuote(text, i + quote.length, quote)
      const stop = end === -1 ? text.length : end + quote.length
      for (let k = i; k < stop; k++) {
        bare += STRING_STANDIN
        depth.push(open.length)
      }
      if (end === -1) openQuote = quote
      i = stop
      continue
    }

    if (OPENERS[ch]) {
      open.push(ch)
      bare += ch
      depth.push(open.length)
      i += 1
      continue
    }
    if (CLOSERS.has(ch)) {
      const last = open[open.length - 1]
      if (last && OPENERS[last] === ch) open.pop()
      else if (!strayCloser) strayCloser = ch
      bare += ch
      depth.push(open.length)
      i += 1
      continue
    }

    bare += ch
    depth.push(open.length)
    i += 1
  }

  return { open, strayCloser, openQuote, bare, depth }
}

/** Where a string literal opened at `from` closes, or -1. Honours backslashes. */
function closingQuote(text: string, from: number, quote: string): number {
  let i = from
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2
      continue
    }
    // A single-quoted literal cannot span a line; saying so is what turns an
    // unterminated quote into an error on the line that opened it.
    if (quote.length === 1 && text[i] === '\n') return -1
    if (text.startsWith(quote, i)) return i
    i += 1
  }
  return -1
}

/** The name of a bracket, for a message a ten-year-old can act on. */
const BRACKET_NAME: Record<string, string> = {
  '(': 'round bracket (',
  '[': 'square bracket [',
  '{': 'curly bracket {',
  ')': 'round bracket )',
  ']': 'square bracket ]',
  '}': 'curly bracket }'
}

/**
 * Check one piece of raw Python. Returns null when there is nothing to say.
 *
 * Blank text is NOT a problem: an empty escape-hatch block is one somebody has
 * dragged out and not filled in yet, and shouting at it would make the first
 * five seconds of using the block an error message.
 */
export function checkPython(text: string, context: PythonContext): PythonProblem | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  const s = scan(text)

  if (s.openQuote) {
    return {
      code: 'unclosed-string',
      message: `This text opens a quote (${s.openQuote}) and never closes it.`
    }
  }
  if (s.open.length > 0) {
    const last = s.open[s.open.length - 1]
    return {
      code: 'unclosed-bracket',
      message: `This ${BRACKET_NAME[last]} is never closed.`
    }
  }
  if (s.strayCloser) {
    return {
      code: 'stray-bracket',
      message: `There is a ${BRACKET_NAME[s.strayCloser]} with nothing to close.`
    }
  }

  const bare = s.bare
  const bareTrimmed = bare.trim()

  // A line that ENDS in a colon is the header of a block with no body. Python
  // calls that an IndentationError; what the learner actually wanted is almost
  // always one of the Control blocks, so the message says so.
  if (bareTrimmed.endsWith(':') && !bareTrimmed.endsWith('::')) {
    return {
      code: 'dangling-colon',
      message:
        'A line ending in “:” needs an indented block under it. Use a Control block (repeat, forever, if) and put this inside it.'
    }
  }

  if (context === 'expression') {
    const first = /^[A-Za-z_][A-Za-z0-9_]*/.exec(bareTrimmed)?.[0]
    if (first && STATEMENT_KEYWORDS.has(first)) {
      return {
        code: 'statement-in-expression',
        message: `“${first}” starts a statement, and this socket needs a value. Use the Python statement block instead.`
      }
    }
    if (topLevelAssignment(bare, s.depth)) {
      return {
        code: 'assignment-in-expression',
        message:
          'This looks like an assignment (=), and this socket needs a value. Did you mean “==” to compare, or the Python statement block?'
      }
    }
  }

  // A trailing binary operator is an unfinished thought — `x +`, `a and`. It is
  // what a half-typed expression looks like when the learner clicks away.
  if (/[+\-*/%<>&|^~,]$/.test(bareTrimmed) || /\b(and|or|not|in|is)$/.test(bareTrimmed)) {
    return {
      code: 'trailing-operator',
      message: 'This ends part-way through — there is nothing after the last operator.'
    }
  }

  return null
}

/**
 * Is there an `=` at bracket depth 0 that means assignment?
 *
 * The depth test is what makes `f(x=1)` fine and `x = 1` not: a keyword
 * argument's `=` is always inside the call's brackets. Comparisons and the
 * augmented operators are excluded by looking at the neighbouring character,
 * which is enough for every form Python has.
 */
function topLevelAssignment(bare: string, depth: readonly number[]): boolean {
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] !== '=' || depth[i] !== 0) continue
    if (bare[i + 1] === '=') {
      i += 1 // `==`
      continue
    }
    const prev = bare[i - 1]
    // `!=`, `<=`, `>=`, and every augmented assignment (`+=`, `//=`, `**=`…).
    if (prev && '=!<>+-*/%&|^'.includes(prev)) continue
    return true
  }
  return false
}

/**
 * Does this expression bind as tightly as a name, a call or a literal?
 *
 * The question every caller that plugs raw text into generated Python has to
 * answer: `sensor.read()` reads best unwrapped, and `a + b` is a wrong answer
 * unwrapped. Anything this cannot recognise is treated as loose and
 * parenthesised — wrong-looking brackets are a blemish, missing ones are a bug.
 *
 * Shared with #1017's manifest loader, which faces exactly the same problem with
 * a part author's `code` template. One rule, tested once.
 */
export function isAtomicExpression(text: string): boolean {
  const t = text.trim()
  if (t === '') return false
  if (/^(True|False|None)$/.test(t)) return true
  if (/^-?\d+(\.\d+)?$/.test(t)) return true
  // A dotted name, optionally called once, or subscripted — with no nested
  // brackets of its own: `sensor`, `sensor.value`, `sensor.read()`,
  // `tof.range(0)`, `values[i]`, `grid[y][x]`, `self.data[i]`.
  //
  // The subscript arm is #1071's finding 4: `total += values[i]` came back
  // `total += (values[i])`, because a raw value block reports `Order.NONE` and
  // every context therefore bracketed it. A subscript binds exactly as tightly
  // as the call beside it here, so the brackets were never needed — and the
  // default stays what it was for everything this cannot read, because a
  // wrong-looking bracket is a blemish and a missing one is a wrong answer.
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*(\([^()]*\)|(\[[^[\]()]+\])+)?$/.test(t)
}
