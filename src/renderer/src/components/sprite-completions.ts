/**
 * SPRITE NAME COMPLETIONS — the pure half of #791 (epic #789).
 * =============================================================================
 *
 * Typing a quote in a Python file offers the project's `.spr` files. A typo in a
 * sprite filename otherwise fails at runtime ON THE BOARD, which is the worst
 * possible place to learn about it; and the second benefit matters more — you
 * find out which sprites exist by typing, not by opening a file browser.
 *
 * Nothing here imports Monaco, React or touches the DOM: this module answers
 * "should something be offered here, what should it say, and what would it
 * replace", and `micropython-completions.ts` turns those answers into Monaco
 * items. That keeps the whole decision unit-testable in plain node.
 *
 * ── The rule is BORROWED, not restated ──────────────────────────────────────
 * What names a sprite, and where a name is looked for, is settled once in
 * `sprite-refs.ts` (#790) and imported here — `isSpriteRefText`,
 * `resolveSpriteRef`, `spriteSearchDirs`, `normalisePath`. Phase 2 inherits
 * phase 1's rule; this repo has been bitten enough times by one rule living in
 * two places (`connectorFit`/`pairContacts`, `validatePart`/`writePart`).
 *
 * That borrowing goes further than it looks. Two examples:
 *
 *  - {@link couldNameSprite} asks "could what has been typed so far still grow
 *    into a sprite name?" by handing the rule a HYPOTHETICAL completion of the
 *    body rather than re-listing which characters disqualify a literal. So
 *    `f"{stem}.spr"` stops offering the moment the `{` is typed, and it does so
 *    because `sprite-refs.ts` says braces are a template — not because there is
 *    a second brace check in here.
 *  - Every offered completion is VERIFIED by running the real resolver over it
 *    ({@link spriteCompletions}): the text is only offered if
 *    `resolveSpriteRef` points it back at the very file it stands for. A name
 *    that would be shadowed by a nearer file of the same name falls back to an
 *    absolute path instead of quietly naming the wrong sprite.
 *
 * ── What this module DOESN'T do ─────────────────────────────────────────────
 * It does not read the disk. The list of `.spr` files comes from
 * `sprite-index.ts` (a TTL'd snapshot, refreshed off the keystroke path) and
 * each sprite's `12×8 · 3 frames` line comes from the `sprite-thumb-cache.ts`
 * records #790 already built. Both are injected, so a completion request costs
 * a scan of the text before the cursor and nothing else.
 *
 * ── Where the cursor is ─────────────────────────────────────────────────────
 * {@link pythonLexState} answers a question the reference rule does not: not
 * "which literals in this file name a sprite" but "what is the lexical state at
 * the cursor" — `findSpriteRefs` only reports CLOSED literals that already name
 * a `.spr`, and a half-typed `"ey` is neither. Phase 2 shipped its own scanner
 * for it; #797 folded both onto the one tokeniser in `sprite-refs.ts`, so they
 * now share their treatment of prefixes, escapes and triple quotes by
 * construction rather than by two authors reading the same Python rules. It is
 * re-exported here because this is the module that asks the question.
 */
import {
  SPRITE_EXT,
  isSpriteRefText,
  normalisePath,
  pythonLexState,
  resolveSpriteRef,
  spriteSearchDirs,
  type PythonLexState,
  type Quote,
  type SpriteRefScope
} from './sprite-refs'

export { pythonLexState }
export type { PythonLexState, Quote }

/**
 * True when the text typed inside the quotes could still grow into a `.spr`
 * name. Asked by completing the body with a hypothetical stem and handing THAT
 * to the reference rule, so the disqualifying characters (`{}`, `%`, `*`, `?`,
 * control characters, a leading space) are listed in exactly one place —
 * `sprite-refs.ts` — and never drift out of step with it.
 */
export function couldNameSprite(body: string): boolean {
  return isSpriteRefText(`${body}x${SPRITE_EXT}`)
}

/** A cursor sitting somewhere a sprite name would be legal, and what it replaces. */
export interface SpriteCompletionContext {
  /** Offset (in the prefix handed to {@link spriteCompletionContext}) of the body. */
  bodyStart: number
  /** What has been typed inside the quotes, up to the cursor — the filter text. */
  body: string
  /** Characters AFTER the cursor still inside the literal; replaced along with it. */
  tailLength: number
  /** True when the literal already has its closing quote. */
  closed: boolean
  /** The quote in use, so an unterminated literal is closed with the same one. */
  quote: Quote
}

/** How much of the text after the cursor belongs to this literal. */
function literalTail(tail: string, quote: Quote, raw: boolean): { length: number; closed: boolean } {
  let i = 0
  while (i < tail.length) {
    const ch = tail[i]
    if (ch === '\\' && !raw && i + 1 < tail.length) {
      i += 2
      continue
    }
    if (ch === quote) return { length: i, closed: true }
    i++
  }
  return { length: i, closed: false }
}

/**
 * Decide whether a sprite name may be offered at the cursor, and what accepting
 * one would replace.
 *
 * `prefix` is the source up to (not including) the cursor; `lineTail` is the
 * rest of that line. Splitting it that way means the caller never copies the
 * whole buffer to ask, and a single-quoted literal cannot run past its own line.
 *
 * Returns null — offer NOTHING — when the cursor is:
 *
 *  - in code, so a bare `eyes.spr` is never suggested as an identifier;
 *  - in a `#` comment;
 *  - in a triple-quoted string (a docstring that mentions a sprite is not a use
 *    of one — the same call `sprite-refs.ts` makes);
 *  - in a literal that is already a template or a pattern (`f"{stem}.spr"`,
 *    `"%s.spr"`, `"frames/*.spr"`), which no completion could correct.
 *
 * Both halves of the literal are tested, so putting the cursor in front of an
 * existing `{stem}` does not offer to overwrite it.
 */
export function spriteCompletionContext(
  prefix: string,
  lineTail: string
): SpriteCompletionContext | null {
  const state = pythonLexState(prefix)
  if (state.kind !== 'string' || state.triple) return null

  const body = prefix.slice(state.bodyStart)
  if (!couldNameSprite(body)) return null

  const tail = literalTail(lineTail, state.quote, state.raw)
  if (!couldNameSprite(body + lineTail.slice(0, tail.length))) return null

  return {
    bodyStart: state.bodyStart,
    body,
    tailLength: tail.length,
    closed: tail.closed,
    quote: state.quote
  }
}

// ── Ranking the files ───────────────────────────────────────────────────────

/** One sprite offered at the cursor. */
export interface SpriteCompletion {
  /** The text to write between the quotes — what the resolver will resolve. */
  text: string
  /** The file it stands for, exactly as the index reported it. */
  path: string
  /** 0 = the file's own folder, 1 = the project folder, 2 = neither (absolute). */
  proximity: number
  /** Monaco sort key: proximity, then how deep, then the name. */
  sortText: string
  /** `12×8 · 3 frames`, when the sprite has been read; absent while unknown. */
  detail?: string
}

/** What {@link spriteCompletions} needs to rank the project's sprites. */
export interface SpriteCompletionInput {
  /** Absolute paths of every `.spr` the index knows about. */
  paths: Iterable<string>
  /** Where a relative name would be looked for — the file's folder, then the root. */
  scope: SpriteRefScope
  /** A sprite's size/frame summary, when it has already been read. */
  describe?: (path: string) => string | undefined
}

/** Compare paths without caring which separator the platform wrote them with. */
const canon = (path: string): string => normalisePath(path).replace(/\\/g, '/')

/** `path` expressed relative to `dir`, or null when it is not inside it. */
function relativeTo(dir: string, path: string): string | null {
  const d = canon(dir).replace(/\/+$/, '')
  const p = canon(path)
  if (!p.startsWith(`${d}/`)) return null
  return p.slice(d.length + 1)
}

/**
 * The project's sprites, ranked and named as they should be written.
 *
 * **Proximity first.** A sprite in the file's own folder is offered as
 * `eyes.spr`, ahead of one that is only reachable from the project root — the
 * order `spriteSearchDirs` already puts the folders in, so the ranking and the
 * resolution can never disagree about which is nearer.
 *
 * **Every name is checked against the resolver.** Where two folders hold a file
 * of the same name, the nearer one wins the short name and the other is offered
 * by absolute path rather than by a name that would silently open its rival.
 * That check runs the real {@link resolveSpriteRef}, so it stays true if the
 * search order ever changes.
 */
export function spriteCompletions(input: SpriteCompletionInput): SpriteCompletion[] {
  const dirs = spriteSearchDirs(input.scope)

  interface Row {
    path: string
    norm: string
    key: string
    text: string
    proximity: number
  }
  const rows: Row[] = []
  const known = new Set<string>()

  for (const path of input.paths) {
    const norm = normalisePath(path)
    const key = canon(norm)
    if (known.has(key)) continue
    known.add(key)

    let proximity = dirs.length
    let text = norm
    for (let i = 0; i < dirs.length; i++) {
      const rel = relativeTo(dirs[i], norm)
      if (rel !== null) {
        proximity = i
        text = rel
        break
      }
    }
    // A file whose own name could never be written as a reference (a brace, a
    // `%`) is not offerable at all — say nothing rather than offer a broken name.
    if (!isSpriteRefText(text)) continue
    rows.push({ path, norm, key, text, proximity })
  }

  const depth = (text: string): number => Math.min(9, canon(text).split('/').length - 1)
  rows.sort(
    (a, b) =>
      a.proximity - b.proximity ||
      depth(a.text) - depth(b.text) ||
      a.text.localeCompare(b.text)
  )

  /** Where the resolver would actually land, given the files that exist. */
  const resolvesTo = (text: string): string | undefined =>
    resolveSpriteRef(text, input.scope)
      .map(canon)
      .find((candidate) => known.has(candidate))

  const out: SpriteCompletion[] = []
  for (const row of rows) {
    let { text, proximity } = row
    if (resolvesTo(text) !== row.key) {
      // Shadowed by a nearer file of the same name: name it outright instead.
      text = row.norm
      proximity = dirs.length
      if (!isSpriteRefText(text) || resolvesTo(text) !== row.key) continue
    }
    out.push({
      text,
      path: row.path,
      proximity,
      sortText: `${proximity}${depth(text)}${text.toLowerCase()}`,
      detail: input.describe?.(row.path)
    })
  }
  return out
}
