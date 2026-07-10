/**
 * Managed motion blocks (#413, epic #403) — the round-trip format that makes an
 * exported Motion Studio `.py` the *source of truth* for a robot's pose library,
 * sequences and servo map, while leaving the user's own code untouched.
 *
 * Snakie writes each dataset as a single `literal_eval`-safe assignment fenced by
 * a pair of **versioned guard comments**:
 *
 * ```python
 * # --- snakie:poses v1 --- managed by Snakie Motion Studio — edit in the Robot View, not here
 * SNAKIE_POSES = { "wave": { "shoulder": 45.0, "elbow": -20.0 } }
 * SNAKIE_SEQUENCES = { "hello": [ ["wave", 500], ["rest", 500] ] }
 * # --- snakie:poses:end ---
 * # --- snakie:servos v1 --- managed by Snakie Motion Studio
 * SNAKIE_SERVOS = [ { "pin": "GP0", "joint": "shoulder", "jointMin": 0.0, "jointMax": 180.0 } ]
 * # --- snakie:servos:end ---
 * ```
 *
 * {@link writeManagedBlocks} rewrites ONLY the bytes between a marker pair (every
 * other byte is preserved), inserting a missing block once after the module
 * docstring / import header. The companion reader is the Python host's
 * `motion.read` (AST + `ast.literal_eval`); this module is the pure-TS writer +
 * block locator, dependency-free so the renderer and any test can import it.
 */

/** Schema version this build of the app understands. A block tagged with a
 *  HIGHER version is left untouched (never clobbered) and surfaces a warning. */
export const MANAGED_SCHEMA_VERSION = 1

/** A saved pose in managed form: joint name → value (deg / mm), DISPLAY units. */
export type ManagedPose = Record<string, number>

/** A sequence step: a pose name held for a duration in milliseconds. */
export type ManagedSequenceStep = [pose: string, durationMs: number]

/** The three managed datasets. Mirrors the app's `NamedPose` /
 *  `ServoJointBinding` shapes so the round-trip is loss-free. */
export interface ManagedMotion {
  /** Pose library: pose name → { joint → value }. */
  poses: Record<string, ManagedPose>
  /** Sequences: name → ordered [poseName, durationMs] steps. */
  sequences: Record<string, ManagedSequenceStep[]>
  /** Servo map: one entry per bound pin (camelCase, matching `ServoJointBinding`). */
  servos: ManagedServo[]
}

/** A servo↔joint binding as stored in a managed block (matches `ServoJointBinding`). */
export interface ManagedServo {
  pin: string
  joint: string
  jointMin: number
  jointMax: number
  servoMin?: number
  servoMax?: number
  invert?: boolean
}

/** The two managed blocks and the assignments each carries. */
const BLOCKS = ['poses', 'servos'] as const
export type ManagedBlockName = (typeof BLOCKS)[number]

/** A located marker pair in some source. */
export interface FoundBlock {
  name: string
  version: number
  /** Line index (0-based) of the opening `# --- snakie:<name> vN ---` marker. */
  openLine: number
  /** Line index (0-based) of the closing `# --- snakie:<name>:end ---` marker. */
  endLine: number
}

/** Result of a {@link writeManagedBlocks} splice. */
export interface WriteResult {
  /** The rewritten source. */
  text: string
  /** Block names whose body was replaced in place. */
  replaced: ManagedBlockName[]
  /** Block names inserted because they were absent. */
  inserted: ManagedBlockName[]
  /** Block names left untouched because their on-disk version is newer than
   *  {@link MANAGED_SCHEMA_VERSION} (don't clobber a future-format block). */
  skipped: string[]
}

// ── Python-literal serialisation ────────────────────────────────────────────

/** Format a finite number the way Python would print the equivalent literal.
 *  Non-finite values collapse to `0` so the output always `literal_eval`s. */
function pyNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  // Integers print without a fractional part; everything else via the shortest
  // round-tripping JS repr, which `ast.literal_eval` reads back identically.
  return Object.is(n, -0) ? '0' : String(n)
}

/** Quote a string as a Python `str` literal (double-quoted, minimal escaping). */
function pyString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/**
 * Serialise a JS value to a `literal_eval`-safe Python literal (dict / list /
 * tuple / number / str / bool / None only — never a call or a bare name). Object
 * keys are emitted in insertion order; a 1-tuple gets its trailing comma.
 */
export function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return pyNumber(value)
  if (typeof value === 'string') return pyString(value)
  if (Array.isArray(value)) {
    const items = value.map(pyLiteral)
    return `[${items.join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // Drop `undefined` fields so optional binding props (servoMin, invert…)
      // don't serialise as `None` and flip a real value on the round-trip.
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${pyString(k)}: ${pyLiteral(v)}`)
    return `{ ${entries.join(', ')} }`
  }
  return 'None'
}

// ── Block text ──────────────────────────────────────────────────────────────

const OPEN_RE = /^# --- snakie:([a-z]+) v(\d+) ---/
const END_RE = /^# --- snakie:([a-z]+):end ---/

/** The trailing "managed by…" note on each opening marker. */
const OPEN_NOTE: Record<ManagedBlockName, string> = {
  poses: 'managed by Snakie Motion Studio — edit in the Robot View, not here',
  servos: 'managed by Snakie Motion Studio'
}

/** The opening-marker line for a block at the current schema version. */
function openMarker(name: ManagedBlockName): string {
  return `# --- snakie:${name} v${MANAGED_SCHEMA_VERSION} --- ${OPEN_NOTE[name]}`
}

/** The closing-marker line for a block. */
function endMarker(name: ManagedBlockName): string {
  return `# --- snakie:${name}:end ---`
}

/** The BODY lines (assignments) of a managed block — no markers. */
function blockBody(name: ManagedBlockName, motion: ManagedMotion): string[] {
  if (name === 'poses') {
    return [
      `SNAKIE_POSES = ${pyLiteral(motion.poses ?? {})}`,
      `SNAKIE_SEQUENCES = ${pyLiteral(motion.sequences ?? {})}`
    ]
  }
  return [`SNAKIE_SERVOS = ${pyLiteral(motion.servos ?? [])}`]
}

/** A full managed block (markers + body) as lines. */
function blockLines(name: ManagedBlockName, motion: ManagedMotion): string[] {
  return [openMarker(name), ...blockBody(name, motion), endMarker(name)]
}

/**
 * Render both managed blocks as a standalone text fragment (poses first, then
 * servos), e.g. to seed a brand-new file. Ends without a trailing newline.
 */
export function serializeManagedBlocks(motion: ManagedMotion): string {
  return BLOCKS.flatMap((name) => blockLines(name, motion)).join('\n')
}

// ── Locating blocks ─────────────────────────────────────────────────────────

/**
 * Find every managed marker pair in `source`. Only well-formed pairs (an opening
 * marker followed later by its matching `:end`) are returned; a dangling marker
 * is ignored. Used by the writer to splice, and by callers to detect a
 * newer-than-known schema version before touching a file.
 */
export function findManagedBlocks(source: string): FoundBlock[] {
  const lines = source.split('\n')
  const found: FoundBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN_RE.exec(lines[i])
    if (!m) continue
    const name = m[1]
    const version = Number(m[2])
    // Scan forward for this block's matching :end (nearest wins).
    for (let j = i + 1; j < lines.length; j++) {
      const e = END_RE.exec(lines[j])
      if (!e) continue
      if (e[1] === name) {
        found.push({ name, version, openLine: i, endLine: j })
        i = j // resume after the block
      }
      break // an :end for a different block breaks this pair (malformed) — skip
    }
  }
  return found
}

/** Whether `source` carries any Snakie-managed block (used to gate the reader). */
export function hasManagedBlocks(source: string): boolean {
  return OPEN_RE.test(source) || source.split('\n').some((l) => OPEN_RE.test(l))
}

// ── Insertion point for a missing block ─────────────────────────────────────

/** Is this line a top-of-module `import …` / `from … import …`? */
function isImportLine(line: string): boolean {
  return /^\s*(import\s|from\s+\S+\s+import\s)/.test(line)
}

/**
 * The line index at which to insert a first managed block: after a shebang, an
 * encoding line, a module docstring, and the leading import run (with their
 * trailing blank lines) — i.e. "near the top, below the header" per the spec.
 */
export function headerInsertIndex(lines: string[]): number {
  let i = 0
  if (lines[i]?.startsWith('#!')) i++
  if (/^#.*coding[:=]/.test(lines[i] ?? '')) i++
  // A module docstring: a line that opens with a triple quote.
  const ds = /^\s*(?:[rRbBuUfF]*)("""|''')/.exec(lines[i] ?? '')
  if (ds) {
    const quote = ds[1]
    // Single-line docstring (opens and closes on the same line)?
    const rest = (lines[i] ?? '').slice((ds.index ?? 0) + (lines[i]!.indexOf(quote) + quote.length))
    if (rest.includes(quote)) {
      i++
    } else {
      i++
      while (i < lines.length && !lines[i].includes(quote)) i++
      if (i < lines.length) i++ // consume the closing line
    }
  }
  // Leading run of imports / blanks / comments; remember the line AFTER the last
  // import so the block lands below the import group but above real code.
  let afterImports = i
  let k = i
  while (k < lines.length) {
    const line = lines[k]
    if (isImportLine(line)) {
      afterImports = k + 1
      k++
    } else if (line.trim() === '' || line.trimStart().startsWith('#')) {
      k++
    } else {
      break
    }
  }
  return afterImports
}

// ── Writing (rewrite-only-our-block) ────────────────────────────────────────

/**
 * Splice the managed blocks into `source`, rewriting ONLY the bytes between each
 * marker pair and byte-preserving everything else. A block that is absent is
 * inserted once after the header (see {@link headerInsertIndex}); a block whose
 * on-disk version is NEWER than {@link MANAGED_SCHEMA_VERSION} is left untouched.
 *
 * Newlines are preserved: the input's dominant line ending (`\r\n` vs `\n`) is
 * used for any inserted lines, and a trailing newline is kept if the source had
 * one.
 */
export function writeManagedBlocks(source: string, motion: ManagedMotion): WriteResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingNewline = /\r?\n$/.test(source)
  // Normalise to `\n` lines for splicing; re-join with the detected EOL.
  const lines = source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  const wasEmpty = source.length === 0

  const existing = findManagedBlocks(source)
  const replaced: ManagedBlockName[] = []
  const inserted: ManagedBlockName[] = []
  const skipped: string[] = []

  // Replace existing blocks in place. Process bottom-up so earlier line indices
  // stay valid as we splice blocks of a different length.
  const toReplace = existing
    .filter((b) => (BLOCKS as readonly string[]).includes(b.name))
    .sort((a, b) => b.openLine - a.openLine)
  for (const b of toReplace) {
    if (b.version > MANAGED_SCHEMA_VERSION) {
      skipped.push(b.name)
      continue
    }
    const name = b.name as ManagedBlockName
    lines.splice(b.openLine, b.endLine - b.openLine + 1, ...blockLines(name, motion))
    replaced.push(name)
  }

  // Insert any block that wasn't present (and wasn't a skipped future version).
  const present = new Set(existing.map((b) => b.name))
  const missing = BLOCKS.filter((name) => !present.has(name))
  if (missing.length) {
    const at = wasEmpty ? 0 : headerInsertIndex(lines)
    const fresh: string[] = []
    for (const name of missing) {
      if (fresh.length) fresh.push('') // blank line between inserted blocks
      fresh.push(...blockLines(name, motion))
      inserted.push(name)
    }
    // Frame the insertion with a blank line above (if not at the very top) and
    // below (if there's following content) so it reads cleanly.
    const above = at > 0 && lines[at - 1]?.trim() !== '' ? [''] : []
    const below = at < lines.length && lines[at]?.trim() !== '' ? [''] : []
    lines.splice(at, 0, ...above, ...fresh, ...below)
  }

  let text = lines.join(eol)
  if (hadTrailingNewline || (wasEmpty && text.length > 0)) text += eol
  return { text, replaced: replaced.reverse(), inserted, skipped }
}
