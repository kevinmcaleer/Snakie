/**
 * SIGNATURES, SPLIT (#1063 → #1134 → B2, #1221).
 * =============================================================================
 *
 * Pure text, and deliberately in a file of its own: the reader
 * (`python-to-blocks.ts`) splits a parameter list too, and it takes nothing
 * from Blockly but a type — the property its own header records. `params.ts`
 * re-exports these beside the block-side machinery that uses them.
 */

/**
 * A parameter list, split into the part a mutator can hold and the rest
 * (#1063, widened by #1134).
 *
 * Blockly's parameters are bare NAMES — they become workspace variables — so a
 * default (`flip_x=None`), a type annotation, `*args` or `**kwargs` has nowhere
 * to live in the mutator. This used to be a boolean, and a `def` carrying any
 * of them went to a raw suite whole: correct, and it meant
 * `def blink(times=3):` — a beginner-friendly helper, and nearly every driver's
 * `__init__` — came back as a grey wall.
 *
 * #1134 gave the block a FIELD for the rest, appended after the declared ones,
 * so the split is what this returns. Everything from the first parameter
 * Blockly cannot hold onwards goes into the field VERBATIM, which keeps
 * keyword-only parameters after a `*args` in the order Python needs and never
 * reorders anybody's signature.
 *
 * Null for a list that cannot be split at all — an empty piece, which means a
 * trailing comma the block has nowhere to record.
 */
export function splitSignature(params: string): { declared: string[]; extra: string } | null {
  const pieces = params.split(',').map((p) => p.trim())
  if (pieces.length === 1 && pieces[0] === '') return { declared: [], extra: '' }
  if (pieces.some((p) => p === '')) return null
  const plain = (p: string): boolean => /^[A-Za-z_]\w*$/.test(p)
  let at = 0
  while (at < pieces.length && plain(pieces[at])) at += 1
  return { declared: pieces.slice(0, at), extra: pieces.slice(at).join(', ') }
}

/** What a method's first parameter is: itself, its class, or nothing at all. */
export type MethodLead = 'self' | 'cls' | 'none'

/** A method signature, as the method block holds it. */
export interface MethodSignature {
  /** The fixed lead parameter, shown on the block and never editable. */
  lead: MethodLead
  /** The plain names, one editable field each. */
  params: string[]
  /** Everything the name fields cannot hold, verbatim. */
  extras: string
}

/**
 * A method's parameter list, split the way the method block holds it (#1221).
 *
 * The same rule {@link splitSignature} follows — plain names while they last,
 * then the remainder verbatim — with the one addition the method block needs:
 * a LEADING `self` or `cls` is the block's fixed lead rather than a parameter
 * a learner can rename. Renaming `self` in one method and not in its eleven
 * siblings is the mistake the fixed lead exists to make impossible.
 *
 * NEVER NULL, unlike `splitSignature`. A list that cannot be split — the
 * trailing comma in `def load(path,):` — is not something to refuse here: the
 * whole of it goes in the extras verbatim, and comes back out exactly as
 * written.
 */
export function splitMethodSignature(text: string): MethodSignature {
  let rest = String(text ?? '').trim()
  const names: string[] = []
  for (;;) {
    const piece = /^([A-Za-z_]\w*)\s*(,\s*|$)/.exec(rest)
    if (!piece) break
    const after = rest.slice(piece[0].length)
    // A TRAILING COMMA IS THE LEARNER'S TEXT and no name field records it, so
    // the name in front of it goes to the extras with it rather than being
    // silently tidied away.
    if (piece[2].trim() === ',' && after.trim() === '') break
    names.push(piece[1])
    rest = after
    if (piece[2].trim() === '') break
  }
  const lead: MethodLead = names[0] === 'self' || names[0] === 'cls' ? names[0] : 'none'
  return { lead, params: lead === 'none' ? names : names.slice(1), extras: rest.trim() }
}

/** The lead a method takes when nothing but its decorator says which it is. */
export function defaultLead(decorator: string): MethodLead {
  if (decorator === 'staticmethod') return 'none'
  if (decorator === 'classmethod') return 'cls'
  return 'self'
}

/**
 * The lead a method really writes — the one the decorator insists on (#1221).
 *
 * `@staticmethod` takes no lead at all and `@classmethod` takes `cls`, so a
 * learner who picks one off the dropdown should not then have to know to go and
 * edit the first parameter by hand: the block follows the setting. THE ONE
 * THING IT NEVER DOES IS INVENT A LEAD — a method whose signature has none
 * (`def go():`, read out of somebody's file) keeps none, whatever the dropdown
 * says, because putting a `self` into a call somebody wrote without one changes
 * what their program does.
 */
export function methodLead(lead: MethodLead, decorator: string): MethodLead {
  if (lead === 'none') return 'none'
  if (decorator === 'staticmethod') return 'none'
  if (decorator === 'classmethod') return 'cls'
  return lead
}
