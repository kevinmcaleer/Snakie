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
 * # --- snakie:poses:end ---
 * # --- snakie:sequences v1 --- managed by Snakie Motion Studio
 * SNAKIE_SEQUENCES = { "hello": [ ["wave", 500], ["rest", 500] ] }
 * # --- snakie:sequences:end ---
 * # --- snakie:servos v1 --- managed by Snakie Motion Studio
 * SNAKIE_SERVOS = [ { "pin": "GP0", "joint": "shoulder", "jointMin": 0.0, "jointMax": 180.0 } ]
 * # --- snakie:servos:end ---
 * ```
 *
 * Each dataset is its OWN block, so a caller can rewrite the blocks it manages
 * (poses, servos) while a block it does NOT yet manage (sequences, until the
 * sequence editor lands in #415) is left byte-for-byte alone rather than wiped.
 * {@link writeManagedBlocks} rewrites ONLY the bytes between a marker pair, and
 * only for the datasets it is given. The companion reader is the Python host's
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

/**
 * The managed datasets. Every field is OPTIONAL: an absent field means "I don't
 * manage this — leave any existing block untouched and don't create one." A
 * present field (even `{}`/`[]`) is written. Mirrors the app's `NamedPose` /
 * `ServoJointBinding` shapes so the round-trip is loss-free.
 */
export interface ManagedMotion {
  /** Pose library: pose name → { joint → value }. */
  poses?: Record<string, ManagedPose>
  /** Sequences: name → ordered [poseName, durationMs] steps. */
  sequences?: Record<string, ManagedSequenceStep[]>
  /** Servo map: one entry per bound pin (camelCase, matching `ServoJointBinding`). */
  servos?: ManagedServo[]
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

/** The managed blocks, in the order they are inserted into a fresh file. */
const BLOCKS = ['poses', 'sequences', 'servos'] as const
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
 *  Non-finite values collapse to `0` so the output always `literal_eval`s. An
 *  integer-valued float prints without a fractional part (`45`, not `45.0`);
 *  the value is identical through `literal_eval` (`45 == 45.0`). */
function pyNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
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
 * number / str / bool / None only — never a call or a bare name). Arrays become
 * Python lists (the reader accepts a list or a tuple); object keys are emitted in
 * insertion order.
 */
export function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return pyNumber(value)
  if (typeof value === 'string') return pyString(value)
  if (Array.isArray(value)) {
    return `[${value.map(pyLiteral).join(', ')}]`
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
  sequences: 'managed by Snakie Motion Studio',
  servos: 'managed by Snakie Motion Studio'
}

/** The single assignment each block carries. */
const ASSIGNMENT: Record<ManagedBlockName, string> = {
  poses: 'SNAKIE_POSES',
  sequences: 'SNAKIE_SEQUENCES',
  servos: 'SNAKIE_SERVOS'
}

/** The current dataset value for a block (defaults so a provided-but-empty
 *  field still emits a valid literal). */
function blockValue(name: ManagedBlockName, motion: ManagedMotion): unknown {
  if (name === 'poses') return motion.poses ?? {}
  if (name === 'sequences') return motion.sequences ?? {}
  return motion.servos ?? []
}

/** Whether the caller supplied this block's dataset (present ⇒ write it). */
function isProvided(name: ManagedBlockName, motion: ManagedMotion): boolean {
  if (name === 'poses') return motion.poses !== undefined
  if (name === 'sequences') return motion.sequences !== undefined
  return motion.servos !== undefined
}

/** The opening-marker line for a block at the current schema version. */
function openMarker(name: ManagedBlockName): string {
  return `# --- snakie:${name} v${MANAGED_SCHEMA_VERSION} --- ${OPEN_NOTE[name]}`
}

/** The closing-marker line for a block. */
function endMarker(name: ManagedBlockName): string {
  return `# --- snakie:${name}:end ---`
}

/** A full managed block (markers + assignment) as lines. */
function blockLines(name: ManagedBlockName, motion: ManagedMotion): string[] {
  return [openMarker(name), `${ASSIGNMENT[name]} = ${pyLiteral(blockValue(name, motion))}`, endMarker(name)]
}

/**
 * Render the provided managed blocks as a standalone text fragment (in canonical
 * poses → sequences → servos order), e.g. to seed a brand-new file. Only datasets
 * present on `motion` are emitted. Ends without a trailing newline.
 */
export function serializeManagedBlocks(motion: ManagedMotion): string {
  return BLOCKS.filter((name) => isProvided(name, motion))
    .flatMap((name) => blockLines(name, motion))
    .join('\n')
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

/** Whether `source` carries any Snakie-managed marker (gates the reader). */
export function hasManagedBlocks(source: string): boolean {
  return source.split('\n').some((l) => OPEN_RE.test(l))
}

// ── Insertion point for a missing block ─────────────────────────────────────

/** Is this line a top-of-module `import …` / `from … import …`? */
function isImportLine(line: string): boolean {
  return /^\s*(import\s|from\s+\S+\s+import\s)/.test(line)
}

/**
 * The line index at which to insert a first managed block: after a shebang, an
 * encoding line, a module docstring, and the leading import run — i.e. "near the
 * top, below the header" per the spec. If there is no import header but the file
 * opens with a leading comment/blank run (e.g. a title comment), the block lands
 * after that run; a file that starts straight into code gets the block at index 0.
 */
export function headerInsertIndex(lines: string[]): number {
  let i = 0
  if (lines[i]?.startsWith('#!')) i++
  if (/^#.*coding[:=]/.test(lines[i] ?? '')) i++
  // A module docstring: a line that opens with a triple quote.
  const ds = /^\s*(?:[rRbBuUfF]*)("""|''')/.exec(lines[i] ?? '')
  if (ds) {
    const quote = ds[1]
    const rest = (lines[i] ?? '').slice((lines[i]!.indexOf(quote) ?? 0) + quote.length)
    if (rest.includes(quote)) {
      i++ // single-line docstring
    } else {
      i++
      while (i < lines.length && !lines[i].includes(quote)) i++
      if (i < lines.length) i++ // consume the closing line
    }
  }
  // Leading run of imports / blanks / comments. Prefer the point AFTER the last
  // import; failing any import, the point after a leading comment/blank run.
  let afterImports = -1
  let afterLeading = i
  let k = i
  while (k < lines.length) {
    const line = lines[k]
    if (isImportLine(line)) {
      afterImports = k + 1
      k++
    } else if (line.trim() === '' || line.trimStart().startsWith('#')) {
      if (afterImports === -1) afterLeading = k + 1
      k++
    } else {
      break
    }
  }
  return afterImports !== -1 ? afterImports : afterLeading
}

// ── Writing (rewrite-only-our-block) ────────────────────────────────────────

/** The file's dominant line ending (a true count, not "any CRLF wins"). */
function dominantEol(source: string): string {
  const crlf = (source.match(/\r\n/g) || []).length
  const lf = (source.match(/(^|[^\r])\n/g) || []).length
  return crlf > lf ? '\r\n' : '\n'
}

/**
 * Splice the provided managed blocks into `source`, rewriting ONLY the bytes
 * between each marker pair. A dataset NOT provided on `motion` (an absent field)
 * is left completely alone — its existing block is byte-preserved and no block is
 * created. A provided dataset that is absent from the file is inserted once after
 * the header (see {@link headerInsertIndex}); a block whose on-disk version is
 * NEWER than {@link MANAGED_SCHEMA_VERSION} is left untouched.
 *
 * Line endings: a UNIFORM-ending file is preserved exactly; a mixed-ending file
 * is normalised to its dominant ending (rare for a Python file, and cosmetic).
 * A trailing newline is preserved.
 */
export function writeManagedBlocks(source: string, motion: ManagedMotion): WriteResult {
  const eol = dominantEol(source)
  const hadTrailingNewline = /\r?\n$/.test(source)
  const wasEmpty = source.length === 0
  const lines = source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')

  const provided = BLOCKS.filter((name) => isProvided(name, motion))
  const existing = findManagedBlocks(source)
  const replaced: ManagedBlockName[] = []
  const inserted: ManagedBlockName[] = []
  const skipped: string[] = []

  // Replace existing blocks IN PLACE — only for datasets we were given, and only
  // the FIRST pair per name (a hand-duplicated block is left as-is, not doubled).
  // Bottom-up so earlier line indices stay valid as spliced blocks change length.
  const seenName = new Set<string>()
  const toReplace = existing
    .filter((b) => {
      if (seenName.has(b.name)) return false
      seenName.add(b.name)
      return (provided as readonly string[]).includes(b.name)
    })
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

  // Insert any PROVIDED block that wasn't present (and wasn't a skipped future
  // version). Datasets we don't manage are never inserted.
  const present = new Set(existing.map((b) => b.name))
  const missing = provided.filter((name) => !present.has(name))
  if (missing.length) {
    const at = wasEmpty ? 0 : headerInsertIndex(lines)
    const fresh: string[] = []
    for (const name of missing) {
      if (fresh.length) fresh.push('')
      fresh.push(...blockLines(name, motion))
      inserted.push(name)
    }
    const above = at > 0 && lines[at - 1]?.trim() !== '' ? [''] : []
    const below = at < lines.length && lines[at]?.trim() !== '' ? [''] : []
    lines.splice(at, 0, ...above, ...fresh, ...below)
  }

  let text = lines.join(eol)
  if (hadTrailingNewline || (wasEmpty && text.length > 0)) text += eol
  return { text, replaced: replaced.reverse(), inserted, skipped }
}

// ── Selecting the project's motion file (round-trip source) ─────────────────

/** The minimal open-file shape {@link selectManagedMotionFile} needs. */
export interface OpenFileLike {
  source: string
  name: string
  path: string
  content: string
}

/** Directory of a path (handles `/` and `\`); `''` for a bare/relative name. */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i <= 0 ? '' : p.slice(0, i)
}

/**
 * Pick the exported `motion.py` to round-trip FROM, scoped to the current
 * project so a stale tab from another project can never bleed in (#413 review).
 * A local `motion.py` that carries managed blocks and either is an unsaved
 * in-session buffer (`path === ''`) or lives directly in `folder`. Returns the
 * first match, or `undefined`.
 *
 * This is the reachable driver for the round-trip: the full Robot View is only
 * mounted for a `.urdf` active file, so the motion source is a SEPARATE open
 * buffer, not the active file — keying off `activeFile` would never fire.
 */
export function selectManagedMotionFile<T extends OpenFileLike>(
  files: T[],
  folder: string | null
): T | undefined {
  return files.find(
    (f) =>
      f.source === 'local' &&
      f.name === 'motion.py' &&
      hasManagedBlocks(f.content) &&
      (f.path === '' || dirOf(f.path) === (folder ?? ''))
  )
}
