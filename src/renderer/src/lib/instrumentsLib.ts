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
 * Install detection, cached per connection so we don't re-poll the raw REPL on
 * every dock open:
 *  - `'unknown'`   — not probed yet (or reset on disconnect); a probe is due.
 *  - `'present'`   — the library is on the board and up to date; no banner.
 *  - `'outdated'`  — the library is on the board but an OLDER version than the one
 *                    Snakie bundles; the banner offers a one-click UPDATE.
 *  - `'absent'`    — the library is NOT on the board; the banner offers Install.
 */
export type InstallState = 'unknown' | 'present' | 'outdated' | 'absent'

/**
 * Decide installed-ness from the outcome of probing the two candidate paths.
 *
 * A device `stat` RESOLVES when the path exists and REJECTS (OSError) when it
 * doesn't — so `true` for a probe means "found". The library counts as present
 * if EITHER candidate (`/lib/instruments.py` or `/instruments.py`) is found.
 * Any probe error is tolerated upstream by passing `false` for that path, so an
 * all-errors outcome reads as `'absent'` (offer the install) rather than
 * throwing. (Version freshness is a SEPARATE step — see {@link installStateFromVersions}.)
 */
export function installStateFromProbe(libFound: boolean, rootFound: boolean): InstallState {
  return libFound || rootFound ? 'present' : 'absent'
}

/**
 * Extract the `__version__ = "X.Y.Z"` literal from instrument-library source, or
 * `null` if absent (a legacy copy predating versioning). Pure + side-effect-free
 * so the freshness check can be unit-tested. Tolerates single or double quotes.
 */
export function parseLibVersion(source: string | null | undefined): string | null {
  if (!source) return null
  const m = source.match(/__version__\s*=\s*['"]([^'"]+)['"]/)
  return m ? m[1] : null
}

/**
 * Refine a `'present'` board into `'present'` vs `'outdated'` by comparing the
 * board's installed version against the bundled one. Outdated when we KNOW the
 * bundled version and the board's differs (including a legacy copy with no
 * `__version__` → `null`). When the bundled version is unknown (couldn't read the
 * bundled source), we can't judge — stay `'present'` so we never nag wrongly.
 */
export function installStateFromVersions(
  found: boolean,
  boardVersion: string | null,
  bundledVersion: string | null
): InstallState {
  if (!found) return 'absent'
  if (bundledVersion !== null && boardVersion !== bundledVersion) return 'outdated'
  return 'present'
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
    (input.installState === 'absent' || input.installState === 'outdated') &&
    !input.dismissed
  )
}
