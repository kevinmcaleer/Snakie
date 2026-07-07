/**
 * SESSION RESTORE (#266) — reopen the previously-open files on launch, with a
 * crash-guard so a file that breaks startup can't wedge the app.
 * =============================================================================
 *
 * We persist the list of open LOCAL file paths + which was active, and reopen
 * them next launch. Device files are deliberately NOT persisted — they need a
 * connected board and a re-read would fail without one.
 *
 * CRASH-GUARD: before restoring we set a "restoring" marker and only clear it
 * once the app has been up and stable for a moment. If a launch finds the marker
 * still set, the previous restore never finished (a file crashed the renderer),
 * so we SKIP restore this time and clear the marker — the app opens clean and
 * the student does nothing. Self-healing, which matters in a locked-down
 * classroom where nobody knows a recovery keystroke.
 *
 * STORAGE: everything lives in `localStorage`, which Electron keeps in the app's
 * per-user `userData` partition — writable without admin rights and part of the
 * roaming profile, so it works on a locked-down school image with no elevation.
 *
 * Pure + storage-injected (no direct `window`) so it unit-tests in node.
 */

/** Minimal storage shape (mirrors the layout store's StorageLike). */
export interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** What we remember between launches. */
export interface PersistedSession {
  /** Absolute paths of the open LOCAL files, in tab order. */
  paths: string[]
  /** The active file's path, or null. */
  activePath: string | null
}

export const SESSION_KEY = 'snakie.session.v1'
/** The crash-guard marker: present while a restore is in-flight/unconfirmed. */
export const RESTORE_GUARD_KEY = 'snakie.session.restoring'

/** A file with the fields we serialise from (a subset of OpenFile). */
interface SerialisableFile {
  source: 'local' | 'device'
  path: string
  id: string
}

/** Build the persistable session from the open files + active id (pure). */
export function serialiseSession(
  files: readonly SerialisableFile[],
  activeId: string | null
): PersistedSession {
  const local = files.filter((f) => f.source === 'local' && f.path)
  const active = local.find((f) => f.id === activeId)
  return {
    paths: local.map((f) => f.path),
    activePath: active?.path ?? null
  }
}

/** Persist the session (best-effort — storage may be full/disabled). */
export function saveSession(
  storage: SessionStorage,
  files: readonly SerialisableFile[],
  activeId: string | null
): void {
  try {
    const session = serialiseSession(files, activeId)
    if (session.paths.length === 0) storage.removeItem(SESSION_KEY)
    else storage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // ignore
  }
}

/** Read the persisted session, or null when absent/corrupt. */
export function readSession(storage: SessionStorage): PersistedSession | null {
  try {
    const raw = storage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedSession>
    if (!parsed || !Array.isArray(parsed.paths)) return null
    const paths = parsed.paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    const activePath = typeof parsed.activePath === 'string' ? parsed.activePath : null
    return { paths, activePath }
  } catch {
    return null
  }
}

/**
 * The crash-guard decision for this launch (pure read):
 *  - `'recover'` — a marker from last time is still set ⇒ the previous restore
 *    crashed; SKIP restore this launch.
 *  - `'safe'` — no marker ⇒ it's safe to restore.
 */
export function restoreMode(storage: SessionStorage): 'safe' | 'recover' {
  try {
    return storage.getItem(RESTORE_GUARD_KEY) ? 'recover' : 'safe'
  } catch {
    return 'recover' // if we can't even read, don't risk a crash loop
  }
}

/** Arm the crash-guard immediately before restoring. */
export function markRestoreStart(storage: SessionStorage): void {
  try {
    storage.setItem(RESTORE_GUARD_KEY, '1')
  } catch {
    // ignore
  }
}

/** Clear the crash-guard once the app has proven stable. */
export function markRestoreDone(storage: SessionStorage): void {
  try {
    storage.removeItem(RESTORE_GUARD_KEY)
  } catch {
    // ignore
  }
}

/** How long the app must stay up (ms) before we trust the restore + clear the guard. */
export const RESTORE_STABLE_MS = 4000
