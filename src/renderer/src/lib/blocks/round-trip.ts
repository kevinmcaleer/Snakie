import type { BlocksWorkspace } from '../../../../shared/blocks-doc'
import { logicalLines, tokenize, trailingCommentAt } from './python-tokens'

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
  const shape = tokens
    .map((t) =>
      t.kind === 'name' ? 'n' : t.kind === 'number' ? '#' : t.kind === 'string' ? 's' : t.text
    )
    .join(' ')
  return `${shape}${comment}`
}

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
