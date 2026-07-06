/**
 * reportError — surface failures that were previously swallowed (#225).
 * =============================================================================
 *
 * A code review found many `.catch(() => {})` sites where a device send / file
 * op / install could fail and the user just saw "nothing happened". This tiny
 * helper is the shared replacement:
 *
 *   - it ALWAYS logs to the console with a `[context]` tag, so a failure is at
 *     least visible to anyone with the devtools open;
 *   - when `notify` is set — for USER-VISIBLE operations (Run, an instrument
 *     send, an install) — it also posts a short message into the status bar via
 *     the existing `snakie:status` seam (see {@link ./components/StatusBar}), so
 *     the board never merely *appears* unresponsive.
 *
 * No new global state — it reuses the same window event the plugin `status`
 * action already drives.
 */

// The status-bar event contract (kept in sync with StatusBar's
// PLUGIN_STATUS_EVENT / PluginStatusMessage — hardcoded here so this stays a
// dependency-free, unit-testable module).
const STATUS_EVENT = 'snakie:status'

/** Best-effort message string for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return String(err)
  } catch {
    return 'unknown error'
  }
}

export interface ReportOptions {
  /**
   * Surface this to the user in the status bar. `true` posts a generic
   * `"<context>: <error>"`, a string posts that exact text. Omit for
   * console-only (background / high-frequency failures).
   */
  notify?: boolean | string
}

/** Log a swallowed error (and optionally surface it to the status bar). */
export function reportError(context: string, err: unknown, opts: ReportOptions = {}): void {
  // eslint-disable-next-line no-console
  console.warn(`[${context}]`, err)
  if (!opts.notify) return
  const msg = errorMessage(err)
  const text = typeof opts.notify === 'string' ? opts.notify : `${context}: ${msg}`
  try {
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { text, tooltip: msg, priority: 5 } }))
  } catch {
    // No window (tests) — the console.warn above already recorded it.
  }
}

/**
 * Curried reporter for fire-and-forget sites: `p.catch(reporter('servo send'))`.
 * Returns a `(err) => void` so it drops straight into `.catch(...)`.
 */
export function reporter(context: string, opts?: ReportOptions): (err: unknown) => void {
  return (err) => reportError(context, err, opts)
}
