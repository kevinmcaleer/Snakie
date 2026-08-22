/**
 * SPRITE REFERENCES — the single, pure rule for "which text in a source file
 * names a sprite, and which file on disk does that name mean".
 * =============================================================================
 *
 * This is the rule epic #789 asked to be settled ONCE: the inline thumbnail
 * (#790), the filename autocomplete (#791) and the sprite editor's "used in"
 * back-link (#792) all answer the same question, and a repo that has been bitten
 * by `connectorFit`/`pairContacts` and `validatePart`/`writePart` disagreeing
 * does not get to answer it twice. Nothing here imports React, Monaco or touches
 * the DOM, so the whole rule is unit-testable in plain node.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A sprite reference is a **single-quoted Python string literal whose text names
 * a `.spr` file**. Nothing else. Concretely:
 *
 *   frames = Spr("eyes.spr")          ✓ decorated
 *   SPR_FILE = "sprites/eyes.spr"     ✓ decorated (this is what the bundled
 *                                       `examples/sprites/play_spr.py` writes —
 *                                       the reference is an assignment, not a
 *                                       call argument, which is exactly why the
 *                                       rule keys off the LITERAL and not off
 *                                       any particular function name)
 *   open(name + ".spr")               ✗ ignored — the name is in a variable
 *   f"{stem}.spr"                     ✗ ignored — an f-string placeholder
 *   "%s.spr" % stem                   ✗ ignored — a printf template
 *   "frames/*.spr"                    ✗ ignored — a glob, not one file
 *   # eyes.spr                        ✗ ignored — a comment, not a literal
 *   """…eyes.spr…"""                  ✗ ignored — a docstring, not a reference
 *
 * Everything on the ✗ side is deliberately DO NOTHING rather than guess: a
 * thumbnail beside the wrong sprite is worse than no thumbnail at all.
 *
 * ── Where the file is looked for ────────────────────────────────────────────
 * An absolute literal resolves to itself. A relative one is resolved against the
 * **file's own folder first, then the project root** — in that order, and only
 * those two. Both are lexical, pure joins ({@link resolveSpriteRef} returns
 * CANDIDATES; deciding which one exists is the caller's I/O, not ours).
 *
 * ── Why a scanner and not one regex ─────────────────────────────────────────
 * `/"([^"]*\.spr)"/` matches inside comments and docstrings, and mis-pairs
 * quotes after an apostrophe in a comment. The scanner below walks the source
 * once tracking code / comment / string state, which costs one pass and removes
 * a whole family of "why is there a thumbnail there" reports.
 */

/** The file extension a sprite reference must end with (case-insensitive). */
export const SPRITE_EXT = '.spr'

/** One recognised sprite reference, with the position of its string literal. */
export interface SpriteRef {
  /** The literal's text, as the program will see it (escapes resolved). */
  text: string
  /** 1-based line the literal sits on. */
  line: number
  /** 1-based column of the opening quote. */
  startColumn: number
  /** 1-based column just past the closing quote. */
  endColumn: number
}

/** Characters that mean "this literal is a template or a pattern, not a file". */
const NOT_A_FILENAME = /[{}*?%]/

/**
 * True when the text holds a control character — never part of a real file name,
 * and a sign the literal carries an escape we deliberately did not interpret.
 * Scanned rather than matched: a control-character regex class is a lint error,
 * and rightly so.
 */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * True when `text` names exactly one `.spr` file.
 *
 * Rejects templates (`{}`/`%`), globs (`*`/`?`), control characters, padded
 * names (` eyes.spr`), a bare extension (`.spr`), and a name whose last segment
 * has no stem (`sprites/.spr`).
 */
export function isSpriteRefText(text: string): boolean {
  if (!text || text !== text.trim()) return false
  if (NOT_A_FILENAME.test(text) || hasControlChar(text)) return false
  if (!text.toLowerCase().endsWith(SPRITE_EXT)) return false
  const base = text.split(/[/\\]/).pop() ?? ''
  return base.length > SPRITE_EXT.length
}

/** True for `/x`, `C:\x`, `C:/x` and UNC `\\host\share` — a path that stands alone. */
export function isAbsolutePath(path: string): boolean {
  return /^[/\\]/.test(path) || /^[A-Za-z]:[/\\]/.test(path)
}

/**
 * Lexically normalise a path: collapse repeated separators, drop `.` segments,
 * and pop a segment for each `..` that has one to pop. Purely textual — it never
 * touches the filesystem, so it is safe on paths that do not exist and on the
 * other platform's separators. The separator of the INPUT is preserved (a
 * Windows path stays backslashed, a POSIX one stays forward-slashed).
 */
export function normalisePath(path: string): string {
  const sep = path.includes('\\') && !path.startsWith('/') ? '\\' : '/'
  const unc = /^\\\\/.test(path)
  const drive = /^([A-Za-z]:)[/\\]/.exec(path)
  const rooted = unc || !!drive || /^[/\\]/.test(path)
  const body = drive ? path.slice(drive[1].length) : unc ? path.slice(2) : path
  const out: string[] = []
  for (const part of body.split(/[/\\]+/)) {
    if (!part || part === '.') continue
    if (part === '..' && out.length && out[out.length - 1] !== '..') {
      out.pop()
      continue
    }
    if (part === '..' && rooted) continue // `/..` is `/`
    out.push(part)
  }
  const joined = out.join(sep)
  if (unc) return `\\\\${joined}`
  if (drive) return `${drive[1]}${sep}${joined}`
  if (rooted) return `${sep}${joined}`
  return joined || '.'
}

/** Join a relative path onto a directory, keeping the directory's separator. */
export function joinPath(dir: string, rel: string): string {
  const sep = dir.includes('\\') && !dir.startsWith('/') ? '\\' : '/'
  return normalisePath(`${dir.replace(/[/\\]+$/, '')}${sep}${rel}`)
}

/** Where a relative sprite name is looked for: the file's folder, then the root. */
export interface SpriteRefScope {
  /** Folder of the file doing the referencing (null for an unsaved buffer). */
  fileDir?: string | null
  /** The open project folder (null when no folder is open). */
  projectRoot?: string | null
}

/** The search folders, in order, deduped — the file's own folder, then the root. */
export function spriteSearchDirs(scope: SpriteRefScope): string[] {
  const dirs: string[] = []
  for (const dir of [scope.fileDir, scope.projectRoot]) {
    if (!dir) continue
    const norm = normalisePath(dir)
    if (!dirs.includes(norm)) dirs.push(norm)
  }
  return dirs
}

/**
 * The candidate files a reference could mean, most-likely first. Empty when the
 * text is not a sprite reference, or when there is nowhere to resolve it against
 * (an unsaved buffer with no project folder open) — in which case the caller
 * should show NOTHING, because "unknown" is not the same as "broken".
 */
export function resolveSpriteRef(text: string, scope: SpriteRefScope): string[] {
  if (!isSpriteRefText(text)) return []
  if (isAbsolutePath(text)) return [normalisePath(text)]
  const out: string[] = []
  for (const dir of spriteSearchDirs(scope)) {
    const candidate = joinPath(dir, text)
    if (!out.includes(candidate)) out.push(candidate)
  }
  return out
}

// ── The scanner ─────────────────────────────────────────────────────────────

/** Python string prefixes we understand (`r`, `b`, `u`, `f`, and pairs of them). */
const STRING_PREFIX = /^[rRbBuUfF]{0,2}$/

/**
 * Resolve the escapes inside a non-raw literal, or return null when it contains
 * an escape we will not guess at. Only `\\` and `\'`/`\"`/`\/` appear in real
 * file names; `\n`, `\t`, `\x41` and friends mean this literal is not a plain
 * path, so the whole reference is dropped rather than half-decoded.
 */
function unescapeLiteral(raw: string): string | null {
  if (!raw.includes('\\')) return raw
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') {
      out += raw[i]
      continue
    }
    const next = raw[++i]
    if (next === '\\' || next === '/' || next === "'" || next === '"') out += next
    else return null
  }
  return out
}

/**
 * Every sprite reference in a Python source, in document order.
 *
 * One pass, no allocation per character: comments and triple-quoted strings are
 * skipped wholesale, and only single-quoted literals are tested against
 * {@link isSpriteRefText}. Cheap enough to run on every edit — the expensive
 * part of a thumbnail is reading and rendering the `.spr`, which is cached
 * elsewhere by path.
 */
export function findSpriteRefs(source: string): SpriteRef[] {
  const refs: SpriteRef[] = []
  let i = 0
  let line = 1
  let col = 1
  const n = source.length

  while (i < n) {
    const c = source[i]
    if (c === '\n') {
      line++
      col = 1
      i++
      continue
    }
    if (c === '\r') {
      i++ // CRLF: the LF does the line break; a lone CR is not a column either
      continue
    }
    if (c === '#') {
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (c !== '"' && c !== "'") {
      i++
      col++
      continue
    }

    // A quote. Look back over the letters immediately before it: a valid string
    // prefix (`r"…"`, `rb'…'`) belongs to this literal — anything else means the
    // quote opens a plain literal.
    let p = i
    while (p > 0 && /[A-Za-z]/.test(source[p - 1])) p--
    const letters = source.slice(p, i)
    const standalone = p === 0 || !/[A-Za-z0-9_]/.test(source[p - 1])
    const prefix = standalone && STRING_PREFIX.test(letters) ? letters : ''
    const raw = /[rR]/.test(prefix)

    const quote = c
    const triple = source.startsWith(quote.repeat(3), i)
    const close = triple ? quote.repeat(3) : quote
    const openCol = col
    i += close.length
    col += close.length

    // Consume the body. A triple-quoted string spans lines and is never a
    // reference (a docstring that mentions a sprite is not a use of it); a
    // single-quoted one ends at its quote, or at the line end if unterminated.
    const bodyStart = i
    let closed = false
    while (i < n) {
      const ch = source[i]
      if (ch === '\\' && !raw && i + 1 < n) {
        if (source[i + 1] === '\n') {
          line++
          col = 1
          i += 2
        } else {
          i += 2
          col += 2
        }
        continue
      }
      if (ch === '\n') {
        if (!triple) break // unterminated single-quoted literal — bail to code
        line++
        col = 1
        i++
        continue
      }
      if (ch === '\r') {
        i++
        continue
      }
      if (source.startsWith(close, i)) {
        closed = true
        break
      }
      i++
      col++
    }

    const body = source.slice(bodyStart, i)
    if (closed) {
      i += close.length
      col += close.length
    }
    if (!triple && closed) {
      const text = raw ? body : unescapeLiteral(body)
      if (text !== null && isSpriteRefText(text)) {
        refs.push({ text, line, startColumn: openCol, endColumn: col })
      }
    }
  }
  return refs
}
