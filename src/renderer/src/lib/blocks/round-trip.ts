import type { BlocksWorkspace } from '../../../../shared/blocks-doc'
import { logicalLines, tokenize, trailingCommentAt, type Token } from './python-tokens'

/**
 * THE ROUND-TRIP GATE (#1068, epic #1007).
 * =============================================================================
 *
 * #1034 turns the code pane's text back into blocks whenever the learner pauses
 * typing, and from that moment the blocks are what the file is regenerated from.
 * So a conversion that lost something does not merely look wrong on the canvas:
 * the next block the learner touches writes the lossy version over their Python.
 *
 * #1019 promises this cannot happen — every line either becomes the block it
 * obviously is, or a raw block holding that exact line. The promise is checked by
 * `blocksPythonToBlocks.test.ts` over a corpus, which is the right test and the
 * wrong place for it to live alone: a corpus only covers the programs somebody
 * thought of, and #1068 found four it had not (a `while True:` with a `break`
 * under it, a trailing comment, an `else` after a dedented comment, a bare `==`).
 *
 * So the property becomes a RUNTIME CHECK as well. Convert, generate the blocks
 * straight back, and compare: if the program that comes out is not the program
 * that went in, the conversion does not get committed. The learner's text stays
 * exactly as they typed it — it is stored verbatim either way — and the blocks
 * they already have stay on screen, untouched and still true about the program
 * they were true about a moment ago.
 *
 * MakeCode has done this for a decade and it is the reason its decompiler is
 * trusted: it decompiles, recompiles, and refuses on a mismatch rather than
 * half-converting. Every future gap in `python-to-blocks.ts` is then "the blocks
 * did not update", which a learner can see and work around, instead of "my
 * program changed by itself", which they cannot.
 *
 * WHAT COUNTS AS THE SAME PROGRAM, and this is the whole design. Not the same
 * bytes — nowhere near it. The generator RENDERS the program in its own house
 * style, and always has:
 *
 *  - **The import section.** `imports.ts` owns it — it dedupes, groups and sorts,
 *    and it ADDS the import a recognised block needs, which is the single most
 *    useful thing the mirror does for somebody who typed `time.sleep(1)` and
 *    forgot the line above it. Comparing those lines would hold the blocks back
 *    from the learners who need them most.
 *  - **Whitespace.** Blank lines carry no meaning to `logicalLines`, and the
 *    generator indents with four spaces whatever the file did. Reindenting
 *    somebody's file is a documented consequence of the blocks being the source
 *    of truth; losing a line of it is not.
 *  - **Order.** It hoists every `def` above the body and every construction into
 *    a setup section, on purpose and for good reasons (`generator.ts`).
 *  - **Quotes, spacing and protected names.** A `text` block holds text, not the
 *    quotes around it, so `"1.0.0"` comes back `'1.0.0'`; `duty +=1` comes back
 *    `duty += 1`; and `names.ts` deliberately renames `id` to `id_` so a learner
 *    cannot lose the builtin. Every one of those is the generator doing its job.
 *  - **Brackets the language did not need.** `maths.ts` writes the minimal
 *    correct parenthesisation, so `(elapsed_us * 0.343) / 2` comes back
 *    `elapsed_us * 0.343 / 2`. One such line used to hold back every block in
 *    the file it was in. See {@link withoutRedundantBrackets}, which drops only
 *    the brackets Python's own precedence already implies — `a - (b - c)` and
 *    `(a + b) / 2` are untouched, because those two are not the same program.
 *
 * MEASURED, NOT GUESSED, and the measurement is why this is not a text
 * comparison. Run over the `.py` files this repo ships, comparing rendered text
 * rejected **two files in three** — `examples/hello_world.py` among them — on
 * nothing but hoisting and quote style. A gate with that false-positive rate is
 * not a gate, it is an outage: the blocks would simply stop following anybody
 * who typed a double-quoted string.
 *
 * So what is compared is the BAG OF LINE SIGNATURES: for each logical line that
 * is not an import, its nesting depth and its TOKEN SHAPE — operators and
 * keywords verbatim, every name, number and string reduced to a placeholder —
 * plus any comment on it, counted rather than sequenced.
 *
 * That catches the things a decompiler gets wrong:
 *
 *  - a line dropped, added or re-nested (the count or the depth moves);
 *  - a line mangled (`x == 5` written back as `x = = 5` is `n = = #`, not
 *    `n == #`);
 *  - a comment dropped, which is carried on the signature for exactly that
 *    reason — the token shape alone cannot see one.
 *
 * And it forgives everything in the list above. THE LIMIT, stated rather than
 * discovered: a change of literal VALUE with the shape intact — `print(100)`
 * becoming `print(10)` — reads as the same program here. Nothing in the
 * converter does that, and the alternative is a gate nobody can use.
 *
 * PURE, except for one dynamic import. {@link conversionShape} and
 * {@link sameProgram} are plain string work and test in node with no Blockly
 * anywhere near them; {@link verifyConversion} reaches for the generator only
 * when it is actually asked to check something, so this module can be imported
 * by the split without dragging the multi-megabyte canvas chunk in with it.
 */

/** A line that the import manager owns rather than the program. */
const IMPORT_LINE = /^(import|from)\s/

/**
 * The comparable shape of a program: `depth:text` per logical line, imports
 * dropped.
 *
 * Depth is counted off an indent STACK rather than taken from the character
 * count, so a file indented with two spaces has the same shape as the four-space
 * one the generator writes — while a body that escaped its loop, which is a real
 * change, still moves.
 */
export function conversionShape(source: string): string[] {
  const out: string[] = []
  const stack: number[] = []
  for (const line of logicalLines(source)) {
    while (stack.length > 0 && line.indent <= stack[stack.length - 1]) stack.pop()
    const depth = stack.length
    // Only a line that opens a suite can deepen the next one, and we do not need
    // to know which: an indent that grew is a level, and `logicalLines` has
    // already thrown away the blank lines that would otherwise look like one.
    stack.push(line.indent)
    if (IMPORT_LINE.test(line.text)) continue
    out.push(`${depth}:${lineSignature(line.text)}`)
  }
  return out
}

/**
 * One line reduced to what a conversion must not change: its operators and
 * keywords verbatim, its names, numbers and strings as placeholders, and any
 * comment on it.
 *
 * A line the lexer cannot read falls back to its own text with the whitespace
 * collapsed — those are the raw blocks, which regenerate verbatim anyway, so
 * comparing them exactly costs nothing and catches anything that mangles one.
 */
function lineSignature(text: string): string {
  const at = trailingCommentAt(text)
  const code = at >= 0 ? text.slice(0, at) : text
  // CARRIED SEPARATELY because the lexer stops at a `#` and would otherwise make
  // a dropped comment invisible to the very check meant to notice it.
  const comment = at >= 0 ? ` ${text.slice(at).trim()}` : ''
  const tokens = tokenize(code)
  if (!tokens) return `${code.replace(/\s+/g, ' ').trim()}${comment}`
  const shape = withoutRedundantBrackets(tokens)
    .map((t) =>
      t.kind === 'name' ? 'n' : t.kind === 'number' ? '#' : t.kind === 'string' ? 's' : t.text
    )
    .join(' ')
  return `${shape}${comment}`
}

/**
 * BRACKETS THE GENERATOR WOULD NOT HAVE WRITTEN.
 * ---------------------------------------------------------------------------
 *
 * `maths.ts` emits the MINIMAL correct parenthesisation — `a * b / c`, never
 * `(a * b) / c` — because that is what a learner who assembled those blocks
 * meant, and because Blockly's own bracketing is over-eager. So a file with a
 * bracket the language did not need came back one bracket lighter, the gate read
 * it as a different program, and every block in the file was held back:
 *
 *     distance = (elapsed_us * 0.343) / 2      <- what was typed
 *     distance = elapsed_us * 0.343 / 2        <- what came back
 *
 * That belongs on the list in this file's header, beside quote style and
 * indentation: it is the generator rendering the program in its own house style,
 * not a conversion losing something. Nobody writes that bracket by accident —
 * they write it because `(a * b) / c` is easier to read than `a * b / c` — and
 * holding the blocks back is a poor thanks for it.
 *
 * THE RULE IS THE ONE `maths.ts` GENERATES BY, read backwards. `( X )` can go
 * when what is inside binds TIGHTER than the operators on either side of it, or
 * binds equally and sits on the side that associates: `+ - * / // % @` are
 * left-associative, so a same-precedence LEFT operand needs no brackets and a
 * right operand — `a - (b - c)` — very much does.
 *
 * LOCAL, DELIBERATELY. It reads the operator immediately before the bracket and
 * the one immediately after, and nothing else. Python expressions are far larger
 * than the arithmetic this is about (comprehensions, slices, lambdas, ternaries,
 * keyword arguments, tuples) and a parser for all of them would be a parser with
 * somewhere to be wrong. Anything this cannot account for keeps its brackets,
 * which is the safe direction: the worst case is the gate refusing a conversion
 * it already refuses today.
 */
function withoutRedundantBrackets(tokens: readonly Token[]): readonly Token[] {
  let out = tokens
  // One pass can expose another — `((a * b)) / c` — and a bound rather than a
  // `while (true)` because this runs on every line of every conversion.
  for (let round = 0; round < 4; round++) {
    const next = dropOneBracket(out)
    if (!next) return out
    out = next
  }
  return out
}

/** `tokens` without the first redundant bracket pair, or null when there is none. */
function dropOneBracket(tokens: readonly Token[]): Token[] | null {
  for (let open = 0; open < tokens.length; open++) {
    if (tokens[open].text !== '(') continue
    // A CALL'S ARGUMENTS ARE NOT A GROUPING. `f(x)` and `xs[0](y)` end in a
    // value, and dropping those brackets would not be tidying — it would be
    // deleting the call.
    const before = tokens[open - 1]
    if (before && (before.kind === 'name' || before.kind === 'close' || before.kind === 'string' ||
        before.kind === 'number')) continue
    const close = matching(tokens, open)
    if (close < 0) return null
    const inner = tokens.slice(open + 1, close)
    const prec = groupedPrecedence(inner)
    if (prec === null) continue
    if (!redundant(prec, before, tokens[close + 1])) continue
    return [...tokens.slice(0, open), ...inner, ...tokens.slice(close + 1)]
  }
  return null
}

/** The index of the bracket closing the one at `open`, or -1 if it is unclosed. */
function matching(tokens: readonly Token[], open: number): number {
  let depth = 0
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].kind === 'open') depth++
    else if (tokens[i].kind === 'close' && --depth === 0) return i
  }
  return -1
}

/**
 * How tightly the contents of a bracket bind, or null for contents this will not
 * reason about.
 *
 * `ATOM` for something with no operator in it at all (`(x)`, `(f(a))`), which is
 * the tightest thing there is and so always droppable.
 */
function groupedPrecedence(inner: readonly Token[]): number | null {
  if (inner.length === 0) return null
  let depth = 0
  let loosest = ATOM
  for (let i = 0; i < inner.length; i++) {
    const token = inner[i]
    if (token.kind === 'open') { depth++; continue }
    if (token.kind === 'close') { depth--; continue }
    if (depth > 0) continue
    // A tuple, a keyword argument, a slice, a comprehension, a lambda, a
    // ternary. Each is a shape where a bracket may be load-bearing in a way the
    // neighbour test below does not model, so none of them is touched.
    if (OPAQUE.has(token.text)) return null
    const prec = binary(inner, i)
    if (prec !== null) loosest = Math.min(loosest, prec)
  }
  return loosest
}

/**
 * Whether a bracket holding something of `prec` can go, given its neighbours.
 *
 * `before` is the token the bracket follows and `after` the one it precedes —
 * that is, the operator it is the RIGHT operand of and the one it is the LEFT
 * operand of. Both have to be happy.
 */
function redundant(prec: number, before: Token | undefined, after: Token | undefined): boolean {
  return fitsBefore(prec, before) && fitsAfter(prec, after)
}

/** As the right operand of whatever precedes it. */
function fitsBefore(prec: number, neighbour: Token | undefined): boolean {
  if (!neighbour) return true
  const outer = PRECEDENCE[neighbour.text]
  // NOT AN OPERATOR AT ALL, and the two answers are not the same. `= ( a + b )`
  // and `return ( a + b )` hold a whole operand, so the bracket is decoration;
  // `await ( a + b )` and `not ( a and b )` bind tighter than what is inside
  // them, so it is not. Anything unlisted keeps its brackets.
  if (outer === undefined) return FREE_BEFORE.has(neighbour.text)
  if (prec !== outer) return prec > outer
  // Equal precedence, and the bracket is the RIGHT operand — which only
  // associates for `**`, the one right-associative operator Python has.
  // `a - (b - c)` is not `a - b - c`, and that is the whole reason for the test.
  return neighbour.text === '**'
}

/** As the left operand of whatever follows it. */
function fitsAfter(prec: number, neighbour: Token | undefined): boolean {
  if (!neighbour) return true
  const outer = PRECEDENCE[neighbour.text]
  // `( a + b ) . real`, `( a + b ) [ 0 ]` and `( a + b ) ( x )` all bind to the
  // bracket as a whole, so the bracket is holding the thing being reached into
  // and cannot go. Only a closer, a separator or an assignment is free.
  if (outer === undefined) return FREE_AFTER.has(neighbour.text)
  if (prec !== outer) return prec > outer
  // Equal precedence on the LEFT, which is the associating side for everything
  // except `**`: `(a * b) / c` is `a * b / c`, `(a ** b) ** c` is not
  // `a ** b ** c`.
  return neighbour.text !== '**'
}

/** Tightest, for contents with no operator in them. Above every entry below. */
const ATOM = 99

/**
 * Python's binary operator precedence, loosest first. Unary `not`, `-` and `~`
 * are absent on purpose: a bracket after one of them is left alone, because
 * `-(a + b)` and `-a + b` differ and this is not the place to be clever.
 */
const PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, in: 3, is: 3,
  '|': 4,
  '^': 5,
  '&': 6,
  '<<': 7, '>>': 7,
  '+': 8, '-': 8,
  '*': 9, '/': 9, '//': 9, '%': 9, '@': 9,
  '**': 11
}

/**
 * Tokens that end an operand, so a `+` or `-` after one is BINARY rather than a
 * sign. `- 5` at the start of a bracket is a negative number; `n - 5` is a
 * subtraction, and only the second constrains anything.
 */
const ENDS_OPERAND = new Set(['name', 'number', 'string', 'close'])

/** The precedence of `inner[i]` used as a binary operator, or null if it is not one. */
function binary(inner: readonly Token[], i: number): number | null {
  const prec = PRECEDENCE[inner[i].text]
  if (prec === undefined) return null
  const previous = inner[i - 1]
  return previous && ENDS_OPERAND.has(previous.kind) ? prec : null
}

/** Assignment, including every augmented form. `x += ( a * b )` constrains nothing. */
const ASSIGN = ['=', '+=', '-=', '*=', '/=', '//=', '%=', '**=', '&=', '|=', '^=', '>>=', '<<=']

/**
 * Tokens a bracket may FOLLOW while still being a whole operand.
 *
 * Openers are here because `f( ( a + b ) )` and `[ ( a + b ) ]` put the bracket
 * inside something else's brackets rather than beside an operator. They are
 * pointedly NOT in {@link FREE_AFTER}, where the same characters mean a call or
 * a subscript ON the bracket.
 */
const FREE_BEFORE = new Set([
  ...ASSIGN, ',', ':', ';', '(', '[', '{',
  'return', 'yield', 'assert', 'del', 'raise', 'if', 'elif', 'while', 'else'
])

/** Tokens a bracket may PRECEDE while still being a whole operand. */
const FREE_AFTER = new Set([...ASSIGN, ',', ':', ';', ')', ']', '}'])

/**
 * Shapes inside a bracket that this refuses to reason about — see
 * {@link groupedPrecedence}. A comma makes it a tuple rather than a grouping; an
 * `=` a keyword argument; a `:` a slice, a lambda or a dict; `for` a
 * comprehension; `if` a ternary, whose arms are not operands of the neighbours.
 */
const OPAQUE = new Set([',', '=', ':', ';', 'for', 'lambda', 'yield', 'if', 'else', 'await'])

/** Are these the same program, allowing for the rewrites the generator owns? */
export function sameProgram(before: string, after: string): boolean {
  // Sorted, so the generator's hoisting is not mistaken for a rewrite — see the
  // header. Still a multiset and not a set: a line that appears twice has to
  // appear twice on both sides, or something was dropped.
  const a = conversionShape(before).sort()
  const b = conversionShape(after).sort()
  return a.length === b.length && a.every((line, i) => line === b[i])
}

/**
 * Why a conversion was held back — for the note the split shows, and for tests.
 *
 * `lossy`: it converted, and regenerating it does not give the program back.
 * `unloadable`: Blockly would not take the workspace, or generating from it
 * threw. Different causes, the same answer, but worth telling apart in a log.
 */
export type ConversionHold = 'lossy' | 'unloadable'

export type ConversionVerdict =
  /** The blocks regenerate the program they were made from. Commit them. */
  | { ok: true }
  /** They do not, or they could not be loaded at all. Leave the blocks alone. */
  | { ok: false; reason: ConversionHold }

/**
 * Would committing this conversion keep the learner's program intact?
 *
 * Loads the candidate workspace into a headless Blockly workspace and generates
 * from it — the same generator the canvas runs, so the answer is about what will
 * actually be written and not about a model of it.
 *
 * `unloadable` is the belt to #1068's braces: a workspace Blockly refuses to
 * deserialise used to reach the canvas, throw there, and leave an empty canvas
 * with writes blocked and nothing said. Catching it here means it never gets
 * that far.
 */
export async function verifyConversion(
  code: string,
  workspace: BlocksWorkspace
): Promise<ConversionVerdict> {
  try {
    // Deferred so the split does not pull Blockly into its own chunk — see the
    // header. Both of these are module-cached after the first check.
    const [Blockly, { generateProgram }, { installBlockDefinitions }, { installCorePalette }] =
      await Promise.all([
        import('blockly/core'),
        import('./generator'),
        import('./registry'),
        import('./palette')
      ])
    // The canvas installs these at ITS module load, and the check can run before
    // the canvas chunk has arrived. Both are idempotent.
    installCorePalette()
    installBlockDefinitions()

    const ws = new Blockly.Workspace()
    try {
      Blockly.serialization.workspaces.load(workspace as never, ws)
      const program = generateProgram(ws)
      // A block with no emitter contributes nothing, so the program is already
      // short of a step whatever the text comparison says.
      if (program.missing.length > 0) return { ok: false, reason: 'lossy' }
      return sameProgram(code, program.code) ? { ok: true } : { ok: false, reason: 'lossy' }
    } finally {
      ws.dispose()
    }
  } catch {
    // A load that threw, a generator that threw, a chunk that failed to arrive:
    // all of them mean we cannot show that this conversion is safe, and the
    // answer to that is always the same one.
    return { ok: false, reason: 'unloadable' }
  }
}
