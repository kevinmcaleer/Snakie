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
 * The `snakie.py` hardware umbrella is installed beside `instruments.py` (it
 * re-exports its hardware classes), so `from snakie import Servo, …` resolves on
 * the board and can't be shadowed by a vendor `servo` module.
 */
export const SNAKIE_LIB_PATH = '/lib/snakie.py'
export const SNAKIE_ROOT_PATH = '/snakie.py'

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
 * throwing. (Version freshness is a SEPARATE step — see {@link classifyPresentCopy}.)
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
  // Anchor to the start of a LINE (allowing indentation) so the real assignment
  // is matched — NOT the `__version__ = "X.Y.Z"` example inside the doc comment
  // above it, which would otherwise be the first match and make every copy read as
  // "X.Y.Z" (equal → never outdated). The comment line starts with `#`, so `^\s*`
  // never reaches its `__version__`.
  const m = source.match(/^\s*__version__\s*=\s*['"]([^'"]+)['"]/m)
  return m ? m[1] : null
}

/**
 * Classify a board that already HAS a library copy into a settled
 * {@link InstallState}, or `null` when we could NOT determine it and must not
 * settle (leave the probe `'unknown'` so it retries on the next dock re-open /
 * reconnect instead of silently claiming the board is current).
 *
 * `boardSource` / `bundledSource` are the RAW library file contents, or `null`
 * (or `''`) when the read failed. Rules:
 *  - Can't read our OWN bundled library (`bundledSource` unreadable → parses to
 *    `null`) → `null` (INDETERMINATE). Previously this silently returned
 *    `'present'`, which HID a genuinely out-of-date board (it also can't offer a
 *    real install — there's no source to write), so the caller now logs it and
 *    retries rather than sticking on a wrong result.
 *  - Board version equals the bundled version → `'present'`.
 *  - Otherwise → `'outdated'`: a differing version, a legacy copy with no
 *    `__version__` (parses to `null`), OR an unreadable board copy (board busy)
 *    all DIFFER from the known bundled version, so we OFFER the update rather
 *    than miss a stale copy (the install just rewrites the file — a needless
 *    offer is harmless).
 */
export function classifyPresentCopy(
  boardSource: string | null,
  bundledSource: string | null
): InstallState | null {
  const bundledVersion = parseLibVersion(bundledSource)
  if (bundledVersion === null) return null // can't read our own lib → indeterminate
  return parseLibVersion(boardSource) === bundledVersion ? 'present' : 'outdated'
}

/** Inputs that decide whether the manila banner should be on screen. */
export interface BannerVisibilityInput {
  /** Is a device connected? (Nothing to install onto otherwise.) */
  connected: boolean
  /** The cached per-connection install state. */
  installState: InstallState
  /** Has the user dismissed it this connection (reset on reconnect)? */
  dismissed: boolean
}

/**
 * The banner shows when a device is connected, its instrument library is ABSENT
 * or OUTDATED, and the user hasn't dismissed it this connection. It is NOT tied
 * to the instrument dock being open — the library backs ANY program that
 * `import`s `instruments`, so a stale board must be flagged whether or not the
 * dock is on screen (issue: boards not prompted to update off the dock).
 *
 * `'unknown'` (not yet probed) does NOT show — we wait for the probe so we never
 * flash the banner at a board that already has the library. `'present'` never
 * shows. Dismissing hides it until the board reconnects; a successful install
 * flips the state to `'present'`.
 */
export function shouldShowBanner(input: BannerVisibilityInput): boolean {
  return (
    input.connected &&
    (input.installState === 'absent' || input.installState === 'outdated') &&
    !input.dismissed
  )
}
