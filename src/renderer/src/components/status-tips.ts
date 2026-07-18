import tipsYaml from './status-tips.yaml?raw'

/**
 * STATUS-BAR DISCOVERY TIPS (issue #434)
 * ======================================
 *
 * Pure logic behind the 💡 tips slot in {@link StatusBar}: the tip list
 * (maintained in `status-tips.yaml`, inlined at build time via Vite `?raw` so
 * nothing is baked into code), the random rotation scheduling, and the
 * "give way to real messages" gate. Everything here is side-effect free so it
 * can be unit-tested without a DOM (test/statusTips.test.ts).
 *
 * The YAML is deliberately a flat `- text:` / `href:` list. Mirroring the
 * Standard-parts pipeline, the renderer does zero real YAML work — a tiny
 * line parser reads exactly that shape (a parity test checks it against the
 * full `yaml` package on the shipped file), so the ~100 KB parser stays out
 * of the bundle.
 */

/** One tip: the sentence shown after the 💡, and an optional docs link. */
export interface StatusTip {
  text: string
  /** Optional article link (docs.snakie.org) — opened externally on click. */
  href?: string
}

/** How long the CSS opacity fade runs (keep in sync with StatusBar.css). */
export const TIP_FADE_MS = 1000
/** Rotation happens every 5–10 minutes (per the issue). */
export const TIP_MIN_INTERVAL_MS = 5 * 60_000
export const TIP_MAX_INTERVAL_MS = 10 * 60_000

/** Strip matching outer quotes from a YAML scalar (both styles), unescaping. */
function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'")
  }
  return v
}

/**
 * Parse the flat tips YAML: a list of `- text: …` items, each optionally
 * followed by an indented `href: …`. Blank lines and `#` comments are
 * skipped; unknown keys are ignored (forward-compatible); items without a
 * non-empty `text` are dropped.
 */
export function parseTipsYaml(src: string): StatusTip[] {
  const items: Partial<StatusTip>[] = []
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const isItem = line.startsWith('- ')
    const body = isItem ? line.slice(2).trim() : line
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(body)
    if (!m) continue
    if (isItem) items.push({})
    const target = items[items.length - 1]
    if (!target) continue // a stray `key:` line before any `- ` item
    const value = unquote(m[2].trim())
    if (m[1] === 'text') target.text = value
    else if (m[1] === 'href') target.href = value
  }
  return items.filter((t): t is StatusTip => typeof t.text === 'string' && t.text.length > 0)
}

/** The shipped tip list, parsed once at module load from the bundled YAML. */
export const STATUS_TIPS: StatusTip[] = parseTipsYaml(tipsYaml)

/**
 * Whether the tip slot may show at all. Tips ALWAYS give way to real content:
 * anything else occupying the message area of the bar — the instrument
 * live-poll warning or a plugin status message — suppresses them, as does the
 * Settings toggle.
 */
export function shouldShowTip(opts: {
  /** The Settings → Appearance "show tips" toggle. */
  enabled: boolean
  /** The live-poll warning is occupying the bar. */
  liveWarning: boolean
  /** A plugin status message is occupying the bar. */
  hasPluginMessage: boolean
}): boolean {
  return opts.enabled && !opts.liveWarning && !opts.hasPluginMessage
}

/** A random delay until the next tip: uniform in [5, 10] minutes. */
export function nextTipDelayMs(rand: () => number = Math.random): number {
  return Math.round(TIP_MIN_INTERVAL_MS + rand() * (TIP_MAX_INTERVAL_MS - TIP_MIN_INTERVAL_MS))
}

/**
 * Pick the next tip index at random, never repeating the previous one
 * (when more than one tip exists). Returns -1 for an empty list.
 */
export function pickTipIndex(
  count: number,
  prev: number | null,
  rand: () => number = Math.random
): number {
  if (count <= 0) return -1
  if (count === 1) return 0
  let i = Math.min(count - 1, Math.floor(rand() * count))
  if (i === prev) i = (i + 1) % count
  return i
}
