/**
 * THE STATUS BAR'S TRANSIENT SLOT (#952).
 * =============================================================================
 *
 * One line at the bottom of the window for "that happened": a file synced, a
 * robot linked, a module compiled. `StatusBar` listens for `snakie:status` and
 * shows whatever arrives; an empty `text` clears it.
 *
 * THE SLOT IS STICKY, which is the part everybody has to remember: a message
 * stays until something replaces it, so whoever posts a terminal message must
 * also schedule its removal. Two callers had already written that dance by hand
 * with their own timers — `emitSyncStatus` in `store/sync.ts` and `notify` in
 * `RobotDockPanel` — and #949 was about to make it three, which is how three
 * implementations end up disagreeing about how long a message lives.
 *
 * ONE TIMER, deliberately shared. There is one slot, so a second message
 * genuinely does supersede the first, and its clear must supersede the first's
 * clear too. Separate timers would let an older message's countdown wipe a newer
 * message off the screen partway through.
 *
 * PRIORITY is passed through to the bar untouched; it decides what outranks what
 * when several things want to speak. Existing callers: sync is 2, the robot dock
 * is 4.
 */

/** The window event `StatusBar` listens on. */
export const STATUS_EVENT = 'snakie:status'

/** The one pending clear, shared because there is only one slot to clear. */
let clearTimer: ReturnType<typeof setTimeout> | null = null

export interface StatusOptions {
  /** What outranks what when several sources want the slot. */
  priority?: number
  /**
   * Remove it after this long.
   *
   * Omit for an IN-PROGRESS message ("Syncing…"), which should stay until the
   * message that replaces it says how it ended.
   */
  clearAfterMs?: number
}

/**
 * Put `text` in the status bar. Empty text clears it.
 *
 * Never throws: a status line is not worth failing an action over, and this runs
 * in contexts (tests, a window mid-teardown) where `window` may not oblige.
 */
export function showStatus(text: string, opts: StatusOptions = {}): void {
  try {
    window.dispatchEvent(
      new CustomEvent(STATUS_EVENT, { detail: { text, priority: opts.priority ?? 2 } })
    )
  } catch {
    return
  }
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  if (opts.clearAfterMs && text) {
    clearTimer = setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { text: '' } }))
      } catch {
        // The slot is overwritten by the next message anyway.
      }
    }, opts.clearAfterMs)
  }
}

/** Clear the slot now. */
export function clearStatus(): void {
  showStatus('')
}

/** Test seam: drop any pending clear so one test's timer cannot fire in another. */
export function resetStatusForTest(): void {
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = null
}
