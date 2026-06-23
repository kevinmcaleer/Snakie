/**
 * Pure logic for the "offer to install the instrument library" banner (issue
 * #108) — kept free of React / Electron so it can be unit-tested in isolation.
 *
 * The banner offers a one-click install of the MicroPython instrument library
 * (`instruments.py`, issue #107) onto the connected board. The functions here
 * own (a) WHERE it installs, (b) HOW we decide it's already installed from a
 * device `stat` probe, and (c) WHEN the banner is actually shown.
 */

/**
 * The standard MicroPython import path the library installs to. A module on
 * `/lib` is importable as `import instruments` from anywhere, so this is the
 * canonical install location.
 */
export const INSTRUMENTS_LIB_PATH = '/lib/instruments.py'

/**
 * A legacy/fallback location: the filesystem root. Some boards put user modules
 * at `/` (it's also on `sys.path`); if the library is found there we treat it as
 * installed too, so we don't nag a user who copied it manually.
 */
export const INSTRUMENTS_ROOT_PATH = '/instruments.py'

/** The directory the install target lives in (created before writing). */
export const INSTRUMENTS_LIB_DIR = '/lib'

/**
 * Tri-state install detection, cached per connection so we don't re-poll the raw
 * REPL on every dock open:
 *  - `'unknown'`  — not probed yet (or reset on disconnect); a probe is due.
 *  - `'present'`  — the library is on the board; never show the banner.
 *  - `'absent'`   — the library is NOT on the board; the banner may show.
 */
export type InstallState = 'unknown' | 'present' | 'absent'

/**
 * Decide installed-ness from the outcome of probing the two candidate paths.
 *
 * A device `stat` RESOLVES when the path exists and REJECTS (OSError) when it
 * doesn't — so `true` for a probe means "found". The library counts as present
 * if EITHER candidate (`/lib/instruments.py` or `/instruments.py`) is found.
 * Any probe error is tolerated upstream by passing `false` for that path, so an
 * all-errors outcome reads as `'absent'` (offer the install) rather than
 * throwing.
 */
export function installStateFromProbe(libFound: boolean, rootFound: boolean): InstallState {
  return libFound || rootFound ? 'present' : 'absent'
}

/** Inputs that decide whether the manila banner should be on screen. */
export interface BannerVisibilityInput {
  /** Is the instrument dock open? (The banner only rides along with the dock.) */
  dockOpen: boolean
  /** Is a device connected? (Nothing to install onto otherwise.) */
  connected: boolean
  /** The cached per-connection install state. */
  installState: InstallState
  /** Has the user dismissed it this open-session (reset when the dock closes)? */
  dismissed: boolean
}

/**
 * The banner shows ONLY when: the dock is open, a device is connected, the
 * library is known to be ABSENT, and the user hasn't dismissed it this session.
 *
 * `'unknown'` (not yet probed) does NOT show — we wait for the probe so we never
 * flash the banner at a board that already has the library. `'present'` never
 * shows. Dismissing hides it until the dock is closed + reopened (which resets
 * `dismissed`), and a successful install flips the state to `'present'`.
 */
export function shouldShowBanner(input: BannerVisibilityInput): boolean {
  return (
    input.dockOpen &&
    input.connected &&
    input.installState === 'absent' &&
    !input.dismissed
  )
}
