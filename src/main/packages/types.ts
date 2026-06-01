/**
 * Shared types for the MicroPython package installer layer (issue #20).
 *
 * These types are intentionally plain (no class instances, no Buffers) so they
 * serialize cleanly across the Electron IPC boundary and can be re-used by the
 * preload typings and the renderer.
 */

/** A package surfaced by search or discovery. */
export interface PackageInfo {
  /** Canonical install name (what `mip.install` / `mip` receives). */
  name: string
  /** Short, human-readable summary. May be empty when unknown. */
  description: string
  /** Latest known version, when the index reports one. */
  version?: string
  /** Where this record came from, for UI hinting. */
  source: 'pypi' | 'curated'
}

/** Advanced/optional toggles for an install request. */
export interface InstallOptions {
  /**
   * Overwrite files that already exist on the device. Maps to `mip.install`'s
   * keyword behaviour where supported; otherwise surfaced as a note.
   */
  overwrite?: boolean
  /**
   * Custom package index URL (advanced). Passed to `mip.install(..., index=)`.
   * When omitted, the device's default index (micropython-lib) is used.
   */
  index?: string
  /**
   * Request `.mpy` cross-compilation to optimise size/speed. The first version
   * cannot perform this host-side (no bundled `mpy-cross`), so when set we
   * surface a graceful note rather than failing the install.
   */
  mpy?: boolean
  /** Optional install target directory on the device (e.g. `/lib`). */
  target?: string
}

/** A single install request. */
export interface InstallRequest {
  name: string
  options?: InstallOptions
}

/**
 * A progress / lifecycle event pushed on the `packages:progress` channel while
 * an install runs. `state` drives the UI; `message` carries human-readable
 * detail (log line, error text, or a graceful note such as the `.mpy` caveat).
 */
export interface InstallProgress {
  /** The package this event concerns. */
  name: string
  state: 'started' | 'running' | 'note' | 'done' | 'error'
  /** Human-readable detail for the current state. */
  message?: string
}

/** Result of an install attempt, returned from the `packages:install` call. */
export interface InstallResult {
  name: string
  /** True when the device reported a successful install. */
  ok: boolean
  /** Combined stdout/stderr or summary text for display. */
  log: string
  /**
   * Non-fatal notes gathered during the install (e.g. ".mpy conversion is not
   * available in this build", or "overwrite is best-effort on this firmware").
   */
  notes: string[]
}
