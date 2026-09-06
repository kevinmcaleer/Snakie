/**
 * THE STATUS BAR'S HISTORY, AS PURE DATA (#953).
 * =============================================================================
 *
 * The bar shows one line at a time and each message wipes the one before it, so
 * anything you did not happen to be looking at is simply gone — including the
 * ones that matter afterwards, like which file failed to sync and why.
 *
 * This module is the rules, DOM-free: what gets recorded, how the ring buffer
 * behaves at its limit, and how the log reads when copied out. The React store
 * and the panels sit on top in the renderer.
 */

/** One recorded message. */
export interface StatusEntry {
  /** Monotonic within a session; the React key, and the sort order. */
  id: number
  text: string
  /** `Date.now()` when it was recorded. */
  at: number
  /** What the sender claimed — kept so the log can show why one message won. */
  priority: number
}

/** How many lines are kept when nobody has chosen. */
export const HISTORY_LIMIT_DEFAULT = 200

/**
 * The bounds a stored or typed limit is held to.
 *
 * The floor is not zero: "keep none" is the `enabled` switch, and a limit of
 * zero would be a second, silent way to express it that the UI could not show.
 */
export const HISTORY_LIMIT_MIN = 10
export const HISTORY_LIMIT_MAX = 5000

/** Hold a limit inside its bounds, whatever arrived. */
export function clampHistoryLimit(value: unknown): number {
  // `null` and `undefined` mean "nothing stored", which is the DEFAULT — not the
  // minimum. Left to `Number()` they part company: `Number(undefined)` is NaN
  // and lands on the default, but `Number(null)` is 0 and clamps to the floor,
  // so an absent setting would silently become "keep 10".
  if (value === null || value === undefined || value === '') return HISTORY_LIMIT_DEFAULT
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return HISTORY_LIMIT_DEFAULT
  return Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.floor(n)))
}

/**
 * Is this message worth recording?
 *
 * An EMPTY text is how the bar is cleared, not something that was said — and a
 * history full of blank lines would bury the messages it exists to keep.
 */
export function isRecordable(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0
}

/**
 * Append one entry, dropping the oldest past `limit`.
 *
 * NEWEST LAST, which is how a log reads and how it is written to a file. The
 * popup reverses it for display; storing it reversed instead would mean every
 * append rewrites the array's front.
 */
export function appendEntry(
  entries: readonly StatusEntry[],
  entry: StatusEntry,
  limit: number
): StatusEntry[] {
  const next = [...entries, entry]
  const cap = clampHistoryLimit(limit)
  return next.length <= cap ? next : next.slice(next.length - cap)
}

/**
 * Re-apply a limit to what is already stored.
 *
 * Lowering the limit in Settings has to take effect on the existing log, not
 * just on what arrives next — otherwise the number in the box and the number of
 * lines on screen disagree until enough new messages arrive to reconcile them.
 */
export function trimToLimit(entries: readonly StatusEntry[], limit: number): StatusEntry[] {
  const cap = clampHistoryLimit(limit)
  return entries.length <= cap ? [...entries] : entries.slice(entries.length - cap)
}

/** A local `HH:MM:SS` for one entry. */
export function formatTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * The log as text, for the clipboard and for a saved file.
 *
 * One line per message, timestamp first, oldest first — the shape anything else
 * that reads logs expects, and the shape that diffs and greps usefully.
 */
export function formatHistoryText(entries: readonly StatusEntry[]): string {
  return entries.map((e) => `${formatTime(e.at)}  ${e.text}`).join('\n')
}

/** What a saved log is called: unambiguous, sortable, no spaces. */
export function historyFileName(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `snakie-status-${stamp}.txt`
}

/** Validate a stored log, dropping anything malformed rather than rendering it. */
export function parseHistory(raw: unknown): StatusEntry[] {
  if (!Array.isArray(raw)) return []
  const out: StatusEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (!isRecordable(e.text)) continue
    out.push({
      id: typeof e.id === 'number' ? e.id : out.length,
      text: e.text,
      at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0,
      priority: typeof e.priority === 'number' ? e.priority : 0
    })
  }
  return out
}
