/**
 * Pure line parser for the Serial Plotter (issue #21), extracted from
 * `Plotter.tsx` so it can be unit-tested without React/canvas (issue #45).
 *
 * The component imports {@link parseLine} from here; behaviour is unchanged.
 *
 * Supported line formats (the caller trims the line first):
 *  - single number:                "12.5"
 *  - comma / space / tab separated: "1, 2, 3"  ·  "1 2 3"  ·  "1\t2\t3"
 *  - labelled pairs:                "temp:21.4, humidity:48"  ·  "x=1 y=2"
 * Tokens with no parsable finite number are ignored.
 */

/** Parse one already-trimmed line into `[label|null, value]` token pairs. */
export function parseLine(line: string): Array<{ label: string | null; value: number }> {
  if (!line) return []
  // Split on commas, tabs and runs of spaces — the common delimiters emitted by
  // `print(a, b, c)` / CSV-style logging on a MicroPython board.
  const tokens = line.split(/[,\t]|\s+/).filter((t) => t.length > 0)
  const out: Array<{ label: string | null; value: number }> = []
  for (const token of tokens) {
    // "label:value" or "label=value" pairs.
    const pair = token.match(/^(.+?)\s*[:=]\s*(-?\d.*)$/)
    if (pair) {
      const value = Number(pair[2])
      if (Number.isFinite(value)) out.push({ label: pair[1].trim(), value })
      continue
    }
    const value = Number(token)
    if (Number.isFinite(value)) out.push({ label: null, value })
  }
  return out
}
