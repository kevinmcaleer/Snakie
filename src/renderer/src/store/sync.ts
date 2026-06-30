/**
 * FILE SYNC STORE (issue #178)
 * ============================================================================
 *
 * Lets the user TAG local files to keep in sync with the connected device, so
 * editing on the computer doesn't mean re-uploading by hand each time. A tagged
 * file is pushed to the board:
 *
 *   - immediately when you tag it (if a board is connected),
 *   - on every save when "sync on save" is enabled, and
 *   - all at once via "Sync now".
 *
 * Each tagged local file maps to `/<basename>` on the device (mirroring the
 * existing "Upload to board" default). The set of tagged paths and the
 * sync-on-save flag persist in localStorage so they survive a reload.
 *
 * Auto-sync-on-save is wired through the `FILE_SAVED_EVENT` window event the
 * workspace store dispatches, so this store stays decoupled from save plumbing.
 *
 * A coarse {@link SyncStatus} drives the device-files toolbar indicator (a green
 * tick replaces the sync icon briefly when a sync completes).
 *
 * Implemented as a React context + `createElement` (JSX-free) so it can live
 * under `store/` as a `.ts` file, mirroring {@link ./workspace}.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { baseName, FILE_SAVED_EVENT, type FileSavedDetail } from './workspace'

/** localStorage keys for the tagged paths + the sync-on-save flag. */
const SYNCED_KEY = 'snakie.sync.paths'
const ON_SAVE_KEY = 'snakie.sync.onSave'

/** How long the "done"/"error" indicator lingers before reverting to idle (ms). */
const DONE_LINGER_MS = 2000
const ERROR_LINGER_MS = 4000

/** Coarse status backing the toolbar indicator. */
export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error'

export interface SyncStore {
  /** Local paths currently tagged to keep in sync. */
  syncedPaths: string[]
  /** Whether saving a tagged file auto-uploads it. */
  syncOnSave: boolean
  status: SyncStatus
  /** Last error message when `status === 'error'`. */
  error: string | null
  isSynced: (path: string) => boolean
  /** Tag / untag a local path (tagging pushes it once if a board is connected). */
  toggleSync: (path: string) => void
  setSyncOnSave: (on: boolean) => void
  /** Push every tagged file to the device now. */
  syncNow: () => Promise<void>
}

/** Device destination for a synced local file: `/<basename>` (mirrors upload). */
export function deviceDestForLocal(localPath: string): string {
  return `/${baseName(localPath)}`
}

/** Parse the persisted tagged-paths list, tolerating missing / corrupt storage. */
export function parseSyncedPaths(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function loadSyncedPaths(): string[] {
  try {
    return parseSyncedPaths(window.localStorage.getItem(SYNCED_KEY))
  } catch {
    return []
  }
}

function saveSyncedPaths(paths: string[]): void {
  try {
    window.localStorage.setItem(SYNCED_KEY, JSON.stringify(paths))
  } catch {
    // ignore storage failures
  }
}

function loadSyncOnSave(): boolean {
  try {
    return window.localStorage.getItem(ON_SAVE_KEY) === '1'
  } catch {
    return false
  }
}

function saveSyncOnSave(on: boolean): void {
  try {
    window.localStorage.setItem(ON_SAVE_KEY, on ? '1' : '0')
  } catch {
    // ignore storage failures
  }
}

const SyncContext = createContext<SyncStore | null>(null)

export function SyncProvider({ children }: { children: ReactNode }): JSX.Element {
  const [syncedPaths, setSyncedPaths] = useState<string[]>(() => loadSyncedPaths())
  const [syncOnSave, setSyncOnSaveState] = useState<boolean>(() => loadSyncOnSave())
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Latest values for use inside event handlers without re-subscribing.
  const connectedRef = useRef(false)
  const syncedRef = useRef(syncedPaths)
  const onSaveRef = useRef(syncOnSave)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  syncedRef.current = syncedPaths
  onSaveRef.current = syncOnSave

  // Track the live device connection so we only auto-push when a board is there.
  useEffect(() => {
    window.api.device
      .getStatus()
      .then((s) => {
        connectedRef.current = s.state === 'connected'
      })
      .catch(() => undefined)
    return window.api.device.onStatus((s) => {
      connectedRef.current = s.state === 'connected'
    })
  }, [])

  useEffect(() => {
    return () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
    }
  }, [])

  /** Set a terminal status and auto-revert it to idle after a short linger. */
  const settle = useCallback((next: 'done' | 'error', err: string | null): void => {
    setStatus(next)
    setError(err)
    if (lingerTimer.current) clearTimeout(lingerTimer.current)
    lingerTimer.current = setTimeout(
      () => setStatus('idle'),
      next === 'done' ? DONE_LINGER_MS : ERROR_LINGER_MS
    )
  }, [])

  /** Read each local path and write it to its device destination. */
  const pushPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
      setStatus('syncing')
      setError(null)
      try {
        for (const path of paths) {
          const content = await window.api.fs.readFile(path)
          await window.api.device.writeFile(deviceDestForLocal(path), content)
        }
        settle('done', null)
      } catch (err) {
        settle('error', err instanceof Error ? err.message : String(err))
      }
    },
    [settle]
  )

  const syncNow = useCallback(async (): Promise<void> => {
    await pushPaths(syncedRef.current)
  }, [pushPaths])

  const isSynced = useCallback((path: string): boolean => syncedPaths.includes(path), [syncedPaths])

  const toggleSync = useCallback(
    (path: string): void => {
      setSyncedPaths((prev) => {
        const has = prev.includes(path)
        const next = has ? prev.filter((p) => p !== path) : [...prev, path]
        saveSyncedPaths(next)
        // Newly tagged + a board is connected → push it once so it's in sync now.
        if (!has && connectedRef.current) void pushPaths([path])
        return next
      })
    },
    [pushPaths]
  )

  const setSyncOnSave = useCallback((on: boolean): void => {
    setSyncOnSaveState(on)
    saveSyncOnSave(on)
  }, [])

  // Auto-sync on save: when enabled + connected, a saved tagged local file is
  // pushed using the content carried by the event (no re-read needed).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<FileSavedDetail>).detail
      if (!detail || detail.source !== 'local') return
      if (!onSaveRef.current || !connectedRef.current) return
      if (!syncedRef.current.includes(detail.path)) return
      void (async (): Promise<void> => {
        if (lingerTimer.current) clearTimeout(lingerTimer.current)
        setStatus('syncing')
        setError(null)
        try {
          await window.api.device.writeFile(deviceDestForLocal(detail.path), detail.content)
          settle('done', null)
        } catch (err) {
          settle('error', err instanceof Error ? err.message : String(err))
        }
      })()
    }
    window.addEventListener(FILE_SAVED_EVENT, handler)
    return () => window.removeEventListener(FILE_SAVED_EVENT, handler)
  }, [settle])

  const store = useMemo<SyncStore>(
    () => ({
      syncedPaths,
      syncOnSave,
      status,
      error,
      isSynced,
      toggleSync,
      setSyncOnSave,
      syncNow
    }),
    [syncedPaths, syncOnSave, status, error, isSynced, toggleSync, setSyncOnSave, syncNow]
  )

  return createElement(SyncContext.Provider, { value: store }, children)
}

/** Access the file-sync store. Must be used within <SyncProvider>. */
export function useSync(): SyncStore {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used within a SyncProvider')
  return ctx
}
