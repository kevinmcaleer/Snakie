/**
 * FILE SIZES, AS PEOPLE READ THEM (#955).
 * =============================================================================
 *
 * The file trees show a name and nothing else, which hides the one case worth
 * seeing: a 0-byte file looks exactly like a good one. This repo has met that —
 * a truncated `lsm6dsox.py` on a board threw a `SyntaxError` at line 159 and
 * cost real diagnosis time, which is what #864's atomic writes exist to stop
 * happening again. A size column turns that into something you can see.
 *
 * PLAIN BYTES BELOW 1 KB, deliberately. `formatBytes` in `board-finder.ts` is
 * the other formatter here and it is tuned for flash and RAM: it renders a
 * 213-byte file as `0.2 KB` and a zero as `0 KB`, which is exactly the reading
 * this column exists to prevent. Nothing under a kilobyte is rounded here.
 *
 * BINARY UNITS, labelled KB/MB/GB/TB, matching how the rest of the app counts.
 */

/** Units above bytes, each 1024 of the last. */
const UNITS = ['KB', 'MB', 'GB', 'TB'] as const

/**
 * A byte count as a short, readable string: `0 B`, `847 B`, `2 KB`, `1.4 MB`.
 *
 * One decimal only where it says something — `2 KB` rather than `2.0 KB` — since
 * a column of sizes is scanned, not compared digit by digit.
 *
 * Returns null for anything that is not a real, non-negative size. That is not
 * the same as zero, and the difference matters more here than anywhere: a `stat`
 * that failed must render as NOTHING, never as `0 B`, or the column invents the
 * very problem it was added to reveal.
 */
export function formatFileSize(bytes: unknown): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null

  // Below a kilobyte, say the number. This is the whole point of the column.
  if (bytes < 1024) return `${Math.round(bytes)} B`

  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  // `.toFixed(1)` then trimming a trailing `.0` keeps 1023.6 KB from rounding up
  // into a unit it has not reached.
  const shown = value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '')
  return `${shown} ${UNITS[unit]}`
}

/**
 * What a tree row shows for an entry.
 *
 * Directories get nothing rather than `0 B` — a folder is not an empty file, and
 * saying so in the column that means "this file is empty" would be a lie in the
 * one place it is expensive.
 */
export function rowSize(entry: { isDir?: boolean; size?: number | null }): string | null {
  if (entry.isDir) return null
  return formatFileSize(entry.size ?? undefined)
}
