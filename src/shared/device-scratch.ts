/**
 * SCRATCH GLOBALS — the names Snakie itself binds on the board (#798).
 * =============================================================================
 *
 * Almost everything Snakie asks a board to do is a snippet run in the raw REPL,
 * and a raw-REPL snippet executes in the board's `__main__` namespace — the SAME
 * namespace the user's program runs in. So every temporary a snippet binds
 * (`_f` for a file handle, `_s` for a `statvfs` tuple, `_d` for a transfer
 * chunk) stays bound on the board after the snippet ends. That had two costs:
 *
 *  1. The Inspect panel listed them as the user's variables, and counted them —
 *     "3 variables" for a program that had none of them (#798).
 *  2. They pin memory that matters on a Pico: a `_d` left over from an upload
 *     holds the whole chunk, and a `_f` holds an open file object.
 *
 * The rule, written once, here:
 *
 *  - Every global Snakie creates is named with the {@link SCRATCH_PREFIX} — so
 *    ONE test says whether a name is ours, and no single letter of the user's
 *    (their own `_s`) can be mistaken for it.
 *  - A snippet unbinds what it bound before it ends, via {@link delScratch}.
 *    Anything that must outlive one snippet (the file handle a chunked upload
 *    carries between `exec` calls) keeps the prefix, so the inspector's one
 *    rule still hides it.
 *
 * Dependency-free — the same discipline as `control.ts` and `dialect.ts` — so
 * main, preload and renderer can all import it, and so the rule is unit-testable
 * without a board.
 */

/**
 * The prefix on every global Snakie binds on a board.
 *
 * Distinctive on purpose. The temporaries used to be single letters (`_s`, `_d`,
 * `_f`), which a user could plausibly pick themselves — so no filter could tell
 * ours from theirs without hiding one of theirs.
 */
export const SCRATCH_PREFIX = '_snk_'

/**
 * A scratch global's full name: `scratchName('f')` → `'_snk_f'`.
 *
 * Snippets may spell the name out literally (it reads better inside generated
 * Python), but they must spell it with this prefix — {@link delScratch} rejects
 * anything else, so a name that would escape the filter can't be shipped.
 */
export function scratchName(base: string): string {
  return `${SCRATCH_PREFIX}${base}`
}

/**
 * Is `name` one of Snakie's own globals rather than something the user made?
 *
 * The single rule the Inspect panel filters by. Deliberately prefix-based: a
 * list of names would drift the moment a snippet added one.
 */
export function isScratchName(name: string): boolean {
  return name.startsWith(SCRATCH_PREFIX)
}

/**
 * Python that unbinds `names` at the end of a snippet.
 *
 * Guarded, because a snippet can end before it binds everything — an `open()`
 * that raised never reached the read loop — and cleanup must never turn a
 * working snippet into a failing one.
 *
 * `(NameError, KeyError)` rather than just `NameError`: **MicroPython raises
 * `KeyError` for `del <missing global>`** where CPython raises `NameError`
 * (verified against the real interpreter in `deviceScratch.test.ts` — the
 * NameError-only guard blew up the whole snippet on the board). Both are named
 * so this reads the same on either runtime.
 *
 * `del` unbinds LEFT TO RIGHT and stops at the first name that isn't there, so
 * pass the names a snippet always binds before the conditional ones.
 *
 * Throws if given a name that isn't a scratch name: every name a snippet deletes
 * must be one the inspector would also hide, and that agreement is what keeps
 * the two halves of this module from drifting apart.
 */
export function delScratch(...names: string[]): string {
  const bad = names.filter((n) => !isScratchName(n))
  if (bad.length > 0) {
    throw new Error(
      `delScratch: not scratch names (must start with ${SCRATCH_PREFIX}): ${bad.join(', ')}`
    )
  }
  if (names.length === 0) return ''
  return [`try: del ${names.join(', ')}`, 'except (NameError, KeyError): pass'].join('\n')
}

/**
 * A snippet whose scratch globals are unbound even if it RAISES.
 *
 * {@link delScratch} on its own only runs when the snippet reaches the end, and
 * a snippet that died half way is precisely when someone opens the inspector to
 * find out what happened. So the body goes in a `try:` and the cleanup in a
 * `finally:` — the error still propagates to the caller (a failed `remove` must
 * still reject), it just doesn't leave our names on the board.
 *
 * `body` lines are indented by four, so they must not contain a multi-line
 * string literal. Every caller injects strings via a `pyStr`-style escaper,
 * which renders newlines as `\n` inside a single-line literal, so this holds.
 */
export function scratchBlock(body: string[], ...names: string[]): string {
  const cleanup = delScratch(...names)
  if (cleanup === '') return body.join('\n')
  const indent = (text: string): string =>
    text
      .split('\n')
      .map((line) => (line.length > 0 ? `    ${line}` : line))
      .join('\n')
  return ['try:', indent(body.join('\n')), 'finally:', indent(cleanup)].join('\n')
}
