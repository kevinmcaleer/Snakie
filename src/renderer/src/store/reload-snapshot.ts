/**
 * KEEPING YOUR WORK ACROSS AN UPDATE RELOAD
 * =============================================================================
 *
 * When a new version of Snakie is ready we offer to reload (web) or restart
 * (desktop) into it. Session restore (#266) already reopens the clean LOCAL files
 * you had open, but on its own a reload would still lose:
 *
 *  - unsaved edits (the buffer, not the file on disk),
 *  - untitled buffers that were never saved anywhere,
 *  - files open from the board, which session restore deliberately skips.
 *
 * So immediately before the reload we write a one-shot SNAPSHOT of every open
 * tab — content, dirty flag and all — and the next boot rebuilds the tabs from
 * it. It is the same idea BetterCad uses (autosave first, then reload): the
 * reload is only offered, never forced mid-session, and taking it costs nothing.
 *
 * STORAGE. The web build writes to `sessionStorage`: it is per-tab and survives
 * a reload, which is exactly the lifetime wanted, and two open tabs can't swap
 * each other's work. The desktop app relaunches the whole process, which
 * clears `sessionStorage`, so it writes to `localStorage` instead. The reader
 * looks in both.
 *
 * ONE-SHOT + SHORT-LIVED. The snapshot is cleared once the restore has proven
 * stable, and ignored if it is older than `SNAPSHOT_MAX_AGE_MS`: if the restart
 * never happened (the install failed, the user carried on and saved), bringing
 * back old "unsaved" buffers a day later would undo work rather than keep it.
 *
 * Pure + storage-injected (no direct `window`) so it unit-tests in node.
 */
import type { SessionStorage } from './session-restore'

export const SNAPSHOT_KEY = 'snakie.reload-snapshot.v1'

/** A reload or restart takes seconds; anything older is not this reload's. */
export const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000

/** One open tab, as much of it as a reload has to carry. */
export interface SnapshotFile {
  id: string
  source: 'local' | 'device'
  path: string
  name: string
  content: string
  dirty: boolean
  binary?: boolean
  isBlocks?: boolean
  blocksConflict?: boolean
}

export interface ReloadSnapshot {
  savedAt: number
  activeId: string | null
  files: SnapshotFile[]
}

/** Build a snapshot from the open files (pure). */
export function buildSnapshot(
  files: readonly SnapshotFile[],
  activeId: string | null,
  now: number
): ReloadSnapshot {
  return {
    savedAt: now,
    activeId,
    files: files.map((f) => ({
      id: f.id,
      source: f.source,
      path: f.path,
      name: f.name,
      // A `.mpy`'s buffer is a placeholder, not the file (#964) — there is
      // nothing to carry, and it is reopened from disk by path instead.
      content: f.binary ? '' : f.content,
      dirty: f.binary ? false : f.dirty,
      ...(f.binary ? { binary: true } : {}),
      ...(f.isBlocks !== undefined ? { isBlocks: f.isBlocks } : {}),
      ...(f.blocksConflict !== undefined ? { blocksConflict: f.blocksConflict } : {})
    }))
  }
}

/**
 * Write the snapshot. Returns false when it could not be written (storage full
 * or blocked) — the caller must then NOT reload silently over unsaved work.
 */
export function writeSnapshot(storage: SessionStorage, snapshot: ReloadSnapshot): boolean {
  try {
    storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
    // Read it back: some browsers accept a write in a "storage disabled" mode
    // and then return nothing.
    return storage.getItem(SNAPSHOT_KEY) !== null
  } catch {
    return false
  }
}

function isSnapshotFile(v: unknown): v is SnapshotFile {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  return (
    typeof f.id === 'string' &&
    (f.source === 'local' || f.source === 'device') &&
    typeof f.path === 'string' &&
    typeof f.name === 'string' &&
    typeof f.content === 'string' &&
    typeof f.dirty === 'boolean'
  )
}

/** Read a snapshot from one storage, or null when absent, corrupt or stale. */
export function readSnapshot(storage: SessionStorage, now: number): ReloadSnapshot | null {
  try {
    const raw = storage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ReloadSnapshot>
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.files)) return null
    const age = now - parsed.savedAt
    if (age < 0 || age > SNAPSHOT_MAX_AGE_MS) return null
    return {
      savedAt: parsed.savedAt,
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
      files: parsed.files.filter(isSnapshotFile)
    }
  } catch {
    return null
  }
}

/** Find this boot's snapshot in the first storage that has a usable one. */
export function findSnapshot(
  storages: readonly (SessionStorage | null)[],
  now: number
): ReloadSnapshot | null {
  for (const s of storages) {
    if (!s) continue
    const snap = readSnapshot(s, now)
    if (snap) return snap
  }
  return null
}

/** Forget the snapshot everywhere (best-effort). */
export function clearSnapshot(storages: readonly (SessionStorage | null)[]): void {
  for (const s of storages) {
    try {
      s?.removeItem(SNAPSHOT_KEY)
    } catch {
      // ignore
    }
  }
}

/** The highest `untitled-N` in the snapshot, so new buffers don't reuse an id. */
export function maxUntitledNumber(files: readonly SnapshotFile[]): number {
  let max = 0
  for (const f of files) {
    const m = /untitled-(\d+)$/.exec(f.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * How each snapshot tab comes back (pure):
 *  - `'reopen'` — a clean local file, or any `.mpy`: read it from disk again,
 *    which is fresher than the copy and is what session restore would do.
 *  - `'buffer'` — anything else (unsaved edits, untitled buffers, board files):
 *    rebuild the tab from the snapshot's own content.
 */
export function restorePlan(f: SnapshotFile): 'reopen' | 'buffer' {
  if (f.source === 'local' && f.path && (f.binary || !f.dirty)) return 'reopen'
  return 'buffer'
}
