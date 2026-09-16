/**
 * PYTHON LITERALS, WRITTEN ONE WAY (#1014, epic #1007).
 * =============================================================================
 *
 * A string a block puts in the generated program goes through here, so the whole
 * file agrees with itself. Before this there were two conventions in the same
 * output — #1011's text blocks emitted `'hello'` and #1012/#1013's fields
 * emitted `"LED"` — which is invisible in a test and obvious in a file:
 *
 *     turtle.pencolor("hotpink")
 *     print('hello')
 *
 * Three strings, two styles, in a program whose entire purpose is to be read by
 * someone learning what Python looks like.
 *
 * SINGLE QUOTES, because that is what the palette that had the most strings in
 * it already emitted and the choice between the two is arbitrary — what matters
 * is that there is one. (Snakie's own `micropython/*.py` use double quotes; a
 * learner meets both eventually, and neither is wrong. Changing the generator to
 * match the library would rewrite every existing golden test for no gain a
 * reader could see.)
 */

/**
 * `value` as a Python string literal.
 *
 * Escapes the backslash FIRST — escaping the quote first would then double the
 * backslash it just added, turning `it's` into `'it\\'s'`, which is a syntax
 * error rather than an apostrophe.
 */
export function pyString(value: string): string {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}
