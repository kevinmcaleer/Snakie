/**
 * INSTRUMENT HOST — pure, DOM-free helpers for hosting the Oscilloscope (#101)
 * and Multimeter (#102) windows in the MAIN editor window.
 * =============================================================================
 *
 * The instruments used to live inside the board-view window; they now float
 * (draggable) or dock over the code editor in the MAIN window. These helpers are
 * the small bits of geometry that benefit from a unit test, kept React/DOM-free
 * (mirrors {@link ./instrument-data} / {@link ./board-values}):
 *
 *   - {@link initialOffset} — the staircase start position for the Nth floating
 *     window, so freshly-opened instruments don't perfectly overlap.
 *   - {@link clampOffset} — keep a dragged window's top-left inside the host so
 *     its title bar (and ✕) never leaves the screen.
 *
 * Nothing here throws.
 */

/** A floating-window top-left offset, in CSS px from the host's top-left. */
export interface Offset {
  x: number
  y: number
}

/** The starting top-left for a floating window (before any drag). */
const BASE_X = 28
const BASE_Y = 16
/** Each subsequent window is nudged down-right by this step so they cascade. */
const STEP = 30
/** How many distinct cascade slots before wrapping back to the first column. */
const CASCADE_SLOTS = 6

/**
 * The initial top-left offset for the `index`-th floating instrument. Windows
 * cascade down-right in a staircase so a stack of freshly-opened instruments is
 * readable (each title bar visible) instead of perfectly overlapping. Wraps after
 * {@link CASCADE_SLOTS} so a long stack doesn't march off the bottom-right.
 */
export function initialOffset(index: number): Offset {
  const slot = ((index % CASCADE_SLOTS) + CASCADE_SLOTS) % CASCADE_SLOTS
  return { x: BASE_X + slot * STEP, y: BASE_Y + slot * STEP }
}

/**
 * Clamp a floating window's top-left so it stays grabbable within the host box.
 *
 * Keeps the top-left at/after the host's top-left (≥ 0, so the grip never slides
 * off the left/top edge) and keeps at least `margin` px of the window's leading
 * edge inside the host's right/bottom — so the title bar (grip + ✕) is always on
 * screen after a drag. When the host is tiny the lower bound (0) wins, pinning
 * the top-left visible rather than forcing the window impossibly inside.
 */
export function clampOffset(off: Offset, hostW: number, hostH: number, margin = 24): Offset {
  const maxX = Math.max(0, hostW - margin)
  const maxY = Math.max(0, hostH - margin)
  return {
    x: clamp(off.x, 0, maxX),
    y: clamp(off.y, 0, maxY)
  }
}

/** Clamp `v` into [lo, hi]; tolerates hi < lo by snapping to lo. */
function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * A docked-state override map: `${kind}:${variable}` → docked? (absent = the
 * default, which IS docked). Owned by {@link useInstruments}; the helpers below
 * are the pure transitions the close/visibility wiring runs against it.
 */
export type DockedMap = Record<string, boolean>

/** The stable key for an open instrument in the {@link DockedMap}. */
export function instrumentKey(kind: string, variable: string): string {
  return `${kind}:${variable}`
}

/**
 * Re-dock a single instrument. Closing (✕) a scope/meter HIDES it (its kind's
 * visibility is turned off by the caller) but RETURNS it to the dock so the
 * SCOPE/METER/PLOT button can bring it back later — so we force its docked
 * override to `true`. Returns a fresh map (or the same reference when already
 * docked); never mutates the input.
 */
export function redockOne(docked: DockedMap, kind: string, variable: string): DockedMap {
  const key = instrumentKey(kind, variable)
  if (docked[key] === true) return docked
  return { ...docked, [key]: true }
}

/**
 * Re-dock EVERY open instrument of one kind. Turning a kind's dock-header
 * visibility ON re-docks all of that kind so a previously-undocked/closed
 * instrument reappears IN THE DOCK (not floating off-screen). `variables` is the
 * list of that kind's currently-open instrument variables. Returns a fresh map;
 * no-ops (returns the same reference) when nothing changes.
 */
export function redockKind(docked: DockedMap, kind: string, variables: string[]): DockedMap {
  let changed = false
  const next = { ...docked }
  for (const variable of variables) {
    const key = instrumentKey(kind, variable)
    if (next[key] !== true) {
      next[key] = true
      changed = true
    }
  }
  return changed ? next : docked
}

/**
 * Whether the status-bar "live polling is interrupting the board" warning (+
 * quick-stop link) should show.
 *
 * The main-window instrument poll (`useInstrumentValues`) enters the raw REPL and
 * INTERRUPTS a running program on every tick. The warning is the user's signal
 * that this is happening and how to stop it, so it must mirror the poll's own
 * `active` gate exactly: live polling is enabled (`live`) AND a board is
 * connected AND at least one scope/meter is open. With LIVE off (the default),
 * nothing is open, or nothing is connected, there is no poll → no interruption →
 * no warning. Pure so it can be unit-tested without rendering the status bar.
 */
export function liveWarningVisible(
  live: boolean,
  connected: boolean,
  openInstrumentCount: number
): boolean {
  return live && connected && openInstrumentCount > 0
}
