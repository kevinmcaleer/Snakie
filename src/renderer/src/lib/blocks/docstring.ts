import { tokenize } from './python-tokens'

/**
 * DOCSTRINGS ARE THE FUNCTION BLOCK'S DESCRIPTION.
 * =============================================================================
 *
 * A `def` block can carry a comment — Blockly's own speech bubble, opened from
 * the `?` on the block — and a Python function says the same thing in a
 * docstring. They are one idea in two notations, so they are now one thing:
 *
 *     def distance():                          ┌─────────────────────────┐
 *         """Returns the distance."""    <->   │ Returns the distance.   │
 *         ...                                  └──────────┬──────────────┘
 *                                                  to ( distance )
 *
 * Type the docstring in the code pane and the bubble fills in; write the bubble
 * and the docstring appears. Before this the docstring came back as a raw Python
 * block sitting at the top of the function's body, which is a true rendering of
 * the line and a poor rendering of what the line is FOR.
 *
 * WHY IT IS ONLY EVER A COMMENT WHEN IT CAN BE PUT BACK EXACTLY, which is the
 * whole of the design and the reason this is its own module. Moving a line out
 * of a program and into a block's metadata is the most dangerous thing a
 * decompiler can do: get the re-rendering wrong by one space and the next block
 * the learner touches writes a different program over their file. So the
 * conversion is not "parse a docstring" but "parse it, write it back out, and
 * only accept it if the result is what was there" — {@link docstringComment}
 * does exactly that, and anything that does not survive the trip stays the raw
 * block it has always been.
 *
 * WHAT SURVIVES: the PEP 257 shapes, written with `"""` and indented with four
 * spaces, which is what this generator writes and what nearly every Python file
 * contains. A `'''` docstring, a 2-space file, a raw or byte prefix — all of
 * them fail the check and stay raw, which is worse-looking and cannot be wrong.
 */

/** The indent one level of Python is written with, everywhere in this app. */
const INDENT = '    '

/**
 * The docstring line for a block's comment text, or null when it has none.
 *
 * The returned string is the LOGICAL line — the first physical line carries no
 * indent, because the caller is writing it into an already-indented body, while
 * the continuation lines carry their own. That is the same shape
 * {@link docstringComment} reads back, so the two are inverses by construction
 * rather than by agreement.
 *
 * ONE LINE STAYS ON ONE LINE (`"""Returns the distance."""`), which is what PEP
 * 257 asks for and what a one-sentence description should look like. More than
 * one gets the summary on the opening line and the closing quotes on their own,
 * which is the other shape PEP 257 describes.
 */
export function commentDocstring(comment: string | null | undefined): string | null {
  const text = (comment ?? '').replace(/\r\n?/g, '\n').trimEnd()
  if (text.trim() === '') return null
  // A docstring cannot contain the quotes that close it, and a backslash at the
  // end would escape them. Neither can be written out safely, so a comment
  // holding either simply has no docstring — the bubble keeps it, the Python
  // does not, and nothing is mangled.
  if (text.includes('"""') || text.endsWith('\\')) return null
  const lines = text.split('\n')
  if (lines.length === 1) return `"""${lines[0]}"""`
  const rest = lines
    .slice(1)
    .map((line) => (line.trim() === '' ? '' : `${INDENT}${line}`))
    .join('\n')
  return `"""${lines[0]}\n${rest}\n${INDENT}"""`
}

/**
 * The comment text a docstring line holds, or null when this is not one we can
 * put back exactly.
 *
 * `line` is the logical line as `logicalLines` produced it: the leading indent
 * already stripped from the first physical line, everything after it verbatim.
 *
 * THE RE-RENDER IS THE TEST. Rather than enumerate the shapes a docstring may
 * take and hope the list is complete, this reads one, writes it back with
 * {@link commentDocstring}, and returns null unless the result is character for
 * character what came in. A shape nobody thought of cannot slip through, and the
 * cost of being wrong about one is a raw block rather than a rewritten program.
 */
export function docstringComment(line: string): string | null {
  const text = line.trim()
  // A LONE STRING LITERAL, and nothing else on the line. Asked of the tokenizer
  // rather than a regex: `"""a""" + x` starts and ends with the right quotes and
  // is not a docstring, and `"""a #"""` contains something a regex would take
  // for a comment.
  const tokens = tokenize(text)
  if (!tokens || tokens.length !== 1 || tokens[0].kind !== 'string') return null
  if (!text.startsWith('"""') || !text.endsWith('"""') || text.length < 6) return null
  const body = text.slice(3, -3)
  const lines = body.split('\n')
  const comment =
    lines.length === 1
      ? lines[0]
      : // Drop the indent this module writes, and the last line, which held only
        // the closing quotes' indent.
        [lines[0], ...lines.slice(1, -1).map((l) => (l.startsWith(INDENT) ? l.slice(INDENT.length) : l))]
          .join('\n')
          .trimEnd()
  return commentDocstring(comment) === text ? comment : null
}
