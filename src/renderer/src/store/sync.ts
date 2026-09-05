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
 * Tags are SCOPED TO THE FOLDER THE LOCAL TREE IS SHOWING (#881). A tagged path
 * is an absolute one, and it used to outlive the folder it was made in: open a
 * different project and yesterday's tags were still there, invisible, still
 * pushing files to the board. So the store reads `currentFolder` from the
 * workspace store — which is why {@link SyncProvider} must sit inside
 * `<WorkspaceProvider>` — and everything it exposes is filtered to that folder.
 * Tags left outside it are dropped for good when the folder changes.
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
import { baseName, FILE_SAVED_EVENT, useWorkspace, type FileSavedDetail } from './workspace'
import { useFileSelection } from './file-selection'
import { planUploadOf, runFolderUpload } from '../lib/folder-transfer'
import { deviceJoin } from '../../../shared/transfer-plan'

/**
 * Is this local path a directory? (#848)
 *
 * Asked at SYNC time rather than remembered at tag time: a path tagged as a
 * file could have been replaced by a folder since, and the tag list is
 * persisted across sessions where anything may have happened to the disk.
 * Anything unreadable answers "not a directory", so it takes the plain
 * single-file route and fails there with a real message.
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await window.api.fs.stat(path)).isDir
  } catch {
    return false
  }
}

/** localStorage keys for the tagged paths + the sync-on-save flag. */
const SYNCED_KEY = 'snakie.sync.paths'
const ON_SAVE_KEY = 'snakie.sync.onSave'

/** How long the "done"/"error" indicator lingers before reverting to idle (ms). */
const DONE_LINGER_MS = 2000
const ERROR_LINGER_MS = 4000

/**
 * Surface a short, transient SYNC message in the status bar so the user can see
 * what file syncing is doing (tagging, the sync toggle, and each automatic push)
 * — not just the small toolbar glyph. We reuse the shared status-bar slot driven
 * by the `snakie:status` window event (StatusBar's `PLUGIN_STATUS_EVENT`): the
 * detail carries `{ text, priority }`, and an empty `text` clears the slot.
 * In-progress messages (`Syncing …`) are dispatched with no linger so the next
 * message replaces them; terminal messages auto-clear after `lingerMs`.
 */
const SYNC_STATUS_EVENT = 'snakie:status'
let syncStatusClearTimer: ReturnType<typeof setTimeout> | null = null

function emitSyncStatus(text: string, lingerMs?: number): void {
  try {
    window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: { text, priority: 2 } }))
  } catch {
    return
  }
  if (syncStatusClearTimer) {
    clearTimeout(syncStatusClearTimer)
    syncStatusClearTimer = null
  }
  if (lingerMs && text) {
    syncStatusClearTimer = setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: { text: '' } }))
      } catch {
        // ignore — the slot will be overwritten by the next message anyway
      }
    }, lingerMs)
  }
}

/** Coarse status backing the toolbar indicator. */
export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error'

export interface SyncStore {
  /**
   * Local paths currently tagged to keep in sync — always within the folder the
   * local tree is showing (#881). Nothing outside it is ever handed out, so a
   * count taken from here is a count of tags the user can actually see.
   */
  syncedPaths: string[]
  /** Whether saving a tagged file auto-uploads it. */
  syncOnSave: boolean
  status: SyncStatus
  /** Last error message when `status === 'error'`. */
  error: string | null
  /**
   * One row per tagged path, in tag order, with its own state — what the
   * status-bar sync popup lists (#863). `status` above says whether a sync is
   * running; this says which files have actually reached the board.
   */
  syncedFiles: SyncedFile[]
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

// ---------------------------------------------------------------------------
// Tag scope (#881)
// ---------------------------------------------------------------------------

/**
 * Is `path` inside the folder the local tree is rooted at?
 *
 * "Inside" means REACHABLE in that tree, not literally on screen: a file in a
 * collapsed subfolder is one click from being seen, and folding a folder away
 * must not quietly stop its files syncing. A path that IS the root is not under
 * it — the tree lists the root's children, so the root never has a tick box of
 * its own.
 *
 * Compared segment by segment so `/a/b` doesn't swallow `/a/bb`, and so a
 * Windows path (`C:\kev\lib`) answers the same as a POSIX one. Case is compared
 * exactly, for the same reason `deviceDestFor` does it: both sides come from the
 * same `fs.readDir` listing, so a difference in case means two different trees
 * rather than two spellings of one.
 */
export function isUnderFolder(folder: string | null, path: string): boolean {
  if (!folder) return false
  const root = folder.split(/[/\\]+/).filter(Boolean)
  const parts = path.split(/[/\\]+/).filter(Boolean)
  if (root.length === 0 || parts.length <= root.length) return false
  return root.every((seg, i) => seg === parts[i])
}

/**
 * The tags that belong to `folder`, in tag order.
 *
 * This is the SAFETY half of #881, and it deliberately doesn't lean on the
 * forgetting half: a list persisted by an older version, or one that survived a
 * crash midway through a folder change, is still filtered through here before
 * anything is pushed. A file the user cannot see never reaches their board,
 * whatever state storage is in.
 */
export function pathsInFolder(paths: string[], folder: string | null): string[] {
  return paths.filter((p) => isUnderFolder(folder, p))
}

/**
 * What to ask before the folder picker opens (#881) — or null when there is
 * nothing to lose by opening it.
 *
 * Asked BEFORE the native dialog because that is the last moment we can offer a
 * way out: once a folder has been chosen, the tags outside it are already gone.
 * The wording hedges on purpose. The picker may yet land on a folder that still
 * contains the tagged files (their parent, say), and those tags are kept —
 * promising they will all be forgotten would be a lie half the time.
 */
export function forgetTagsPrompt(tagged: number): string | null {
  if (tagged <= 0) return null
  const one = tagged === 1
  return (
    `${tagged} file${one ? ' is' : 's are'} tagged to keep in sync with the board.\n\n` +
    `Opening a different folder forgets ${one ? 'that tag' : 'those tags'}, unless ` +
    `${one ? 'the file is' : 'the files are'} inside the folder you pick.\n\n` +
    `Open a different folder?`
  )
}

/** The status-bar line for tags dropped by a folder change (#881). */
export function forgotTagsMessage(dropped: number): string {
  const one = dropped === 1
  return `Forgot ${dropped} sync tag${one ? '' : 's'} — ${
    one ? "that file isn't" : "those files aren't"
  } in this folder`
}

// ---------------------------------------------------------------------------
// Per-file sync state (#863)
// ---------------------------------------------------------------------------
//
// The coarse {@link SyncStatus} answers "is a sync happening", which is all the
// toolbar glyph needed. The status-bar popup asks a different question — "which
// of my tagged files have actually reached this board?" — so each tagged path
// carries its own state. Kept as plain data with pure transitions so the whole
// thing unit-tests in node, like the rest of this store's helpers.

/** What has happened to ONE tagged path, on the currently-connected board. */
export type FileSyncState = 'pending' | 'syncing' | 'done' | 'error'

/** The store's record for one tagged path. */
export interface FileSyncRecord {
  state: FileSyncState
  /** Failure message when `state === 'error'`. */
  error?: string
  /**
   * Whether the path turned out to be a directory. Undefined until a sync has
   * actually looked (`isDirectory` is asked at sync time, not tag time), which
   * is why the popup shows no destination for a path it has never pushed —
   * a folder and a file land in different places, so guessing would mislead.
   */
  dir?: boolean
}

export type FileSyncMap = Readonly<Record<string, FileSyncRecord>>

/** One row of the status-bar popup. */
export interface SyncedFile {
  path: string
  name: string
  state: FileSyncState
  /** Where it lands on the device — absent until a sync has established it. */
  dest?: string
  error?: string
}

/** Set `state` on each of `paths`, leaving every other record untouched. */
export function markFiles(
  map: FileSyncMap,
  paths: string[],
  state: FileSyncState,
  error?: string
): FileSyncMap {
  if (paths.length === 0) return map
  const next: Record<string, FileSyncRecord> = { ...map }
  for (const path of paths) {
    const prev = next[path]
    const rec: FileSyncRecord = { state }
    if (state === 'error' && error) rec.error = error
    if (prev?.dir !== undefined) rec.dir = prev.dir
    next[path] = rec
  }
  return next
}

/** Record what a sync discovered about `path`: a directory, or a plain file. */
export function markKind(map: FileSyncMap, path: string, dir: boolean): FileSyncMap {
  const prev = map[path] ?? { state: 'pending' as FileSyncState }
  if (prev.dir === dir) return map
  return { ...map, [path]: { ...prev, dir } }
}

/**
 * Bring the record map in line with the tagged list: newly tagged paths start
 * `pending` (tagged but not yet on the board), untagged ones are forgotten.
 */
export function reconcileFiles(map: FileSyncMap, tagged: string[]): FileSyncMap {
  const next: Record<string, FileSyncRecord> = {}
  for (const path of tagged) next[path] = map[path] ?? { state: 'pending' }
  return next
}

/**
 * Forget what was synced. Called when the board goes away: the next board to
 * arrive may be a different one, and a green tick that means "synced to some
 * board I saw earlier" is worse than no tick at all.
 */
export function clearSyncMarks(map: FileSyncMap): FileSyncMap {
  const next: Record<string, FileSyncRecord> = {}
  for (const [path, rec] of Object.entries(map)) {
    next[path] = rec.dir === undefined ? { state: 'pending' } : { state: 'pending', dir: rec.dir }
  }
  return next
}

/**
 * The popup's rows, in tag order. `folderDest` is where a tagged FOLDER lands
 * (the highlighted device folder, #848); files keep `/<basename>`.
 */
export function syncedFileList(
  tagged: string[],
  map: FileSyncMap,
  folderDest: string
): SyncedFile[] {
  return tagged.map((path) => {
    const rec = map[path] ?? { state: 'pending' as FileSyncState }
    const name = baseName(path)
    const row: SyncedFile = { path, name, state: rec.state }
    if (rec.dir === true) row.dest = deviceJoin(folderDest, name)
    else if (rec.dir === false) row.dest = deviceDestForLocal(path)
    if (rec.error) row.error = rec.error
    return row
  })
}

/** How many tagged paths have reached the board, for the popup's summary. */
export function syncedCount(files: SyncedFile[]): number {
  return files.filter((f) => f.state === 'done').length
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
  // Where a tagged FOLDER lands. Held in a ref so the push loop reads the
  // highlight as it is when the sync runs, not as it was when the callback was
  // created — the user picks the destination by clicking it, and a stale
  // closure would send the folder to wherever they had clicked previously.
  const { deviceTargetDir } = useFileSelection()
  const deviceTargetDirRef = useRef(deviceTargetDir)
  deviceTargetDirRef.current = deviceTargetDir

  // The folder the local tree is showing. Every tag is scoped to it (#881).
  const { currentFolder } = useWorkspace()

  const [syncedPaths, setSyncedPaths] = useState<string[]>(() => loadSyncedPaths())
  const [syncOnSave, setSyncOnSaveState] = useState<boolean>(() => loadSyncOnSave())
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  // Per-path state behind the status-bar popup (#863).
  const [fileStates, setFileStates] = useState<FileSyncMap>({})

  // Latest values for use inside event handlers without re-subscribing.
  const connectedRef = useRef(false)
  const syncedRef = useRef(syncedPaths)
  const onSaveRef = useRef(syncOnSave)
  const folderRef = useRef(currentFolder)
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  syncedRef.current = syncedPaths
  onSaveRef.current = syncOnSave
  folderRef.current = currentFolder

  /**
   * The tags that belong to the folder on screen — the store's whole public
   * surface is built from this rather than from the raw list (#881), so a tag
   * the user cannot see is invisible to the tick boxes, to the status-bar popup
   * and to every push, even in the moment before the prune below removes it.
   */
  const scopedPaths = useMemo(
    () => pathsInFolder(syncedPaths, currentFolder),
    [syncedPaths, currentFolder]
  )

  /**
   * Changing the working folder forgets the tags that folder can't show (#881).
   *
   * Pruning rather than clearing outright: what makes a tag a problem is being
   * invisible, so a tag that is still in the tree is still honest. That is what
   * makes the breadcrumb's `..` safe to leave unguarded — it can only widen the
   * tree, so nothing that was visible stops being visible, and nothing is lost.
   *
   * This also runs on the FIRST folder of the session, which is where a list
   * persisted by an older version gets cleaned up rather than merely hidden.
   * A null folder prunes nothing: at launch the tree is briefly rootless while
   * the last folder is restored, and wiping the tags in that gap would mean
   * they never survived a restart at all.
   */
  useEffect(() => {
    if (!currentFolder) return
    const kept = pathsInFolder(syncedRef.current, currentFolder)
    const dropped = syncedRef.current.length - kept.length
    if (dropped === 0) return
    syncedRef.current = kept
    saveSyncedPaths(kept)
    setSyncedPaths(kept)
    emitSyncStatus(forgotTagsMessage(dropped), DONE_LINGER_MS)
  }, [currentFolder])

  // Track the live device connection so we only auto-push when a board is there.
  useEffect(() => {
    window.api.device
      .getStatus()
      .then((s) => {
        connectedRef.current = s.state === 'connected'
      })
      .catch(() => undefined)
    return window.api.device.onStatus((s) => {
      const wasConnected = connectedRef.current
      connectedRef.current = s.state === 'connected'
      // The board went away. Forget which files were synced: the next board to
      // arrive may be a different one, and a tick meaning "synced to a board I
      // saw earlier" is worse than no tick at all (#863).
      if (wasConnected && !connectedRef.current) setFileStates(clearSyncMarks)
    })
  }, [])

  // Keep the per-path records in step with the tagged list: a newly tagged path
  // starts `pending`, an untagged one is forgotten. Reconciled against the
  // SCOPED list so the popup's rows and the store's tags stay the same set
  // (#863 + #881) — a path out of scope has no row, so it needs no record.
  useEffect(() => {
    setFileStates((prev) => reconcileFiles(prev, scopedPaths))
  }, [scopedPaths])

  useEffect(() => {
    return () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
    }
  }, [])

  /** Set a terminal status, surface a status-bar message, and auto-revert to idle. */
  const settle = useCallback((next: 'done' | 'error', err: string | null, label?: string): void => {
    setStatus(next)
    setError(err)
    if (next === 'done') {
      emitSyncStatus(label ? `${label} synced to the board` : 'Synced to the board', DONE_LINGER_MS)
    } else {
      emitSyncStatus(
        label ? `Couldn't sync ${label}: ${err ?? 'failed'}` : `Sync failed: ${err ?? ''}`,
        ERROR_LINGER_MS
      )
    }
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
      const label =
        paths.length === 1 ? baseName(paths[0]) : `${paths.length} files`
      if (lingerTimer.current) clearTimeout(lingerTimer.current)
      setStatus('syncing')
      setError(null)
      emitSyncStatus(`Syncing ${label}…`)
      // Each path reports its own outcome as the loop reaches it, so the popup
      // ticks off files one by one instead of flipping all of them at the end
      // (#863). A path the loop never reaches keeps whatever it had, which is
      // right: it genuinely has not been pushed.
      try {
        for (const path of paths) {
          setFileStates((prev) => markFiles(prev, [path], 'syncing'))
          try {
            // A tagged FOLDER syncs itself and everything under it, into whichever
            // device folder is highlighted right now (#848). Tagging a folder is
            // what people actually mean — tagging its files one at a time both
            // misses newly added ones and is tedious.
            //
            // Files keep their existing destination (`/<basename>`) rather than
            // following the highlight: changing that would silently relocate
            // every file anyone already had tagged.
            const dir = await isDirectory(path)
            setFileStates((prev) => markKind(prev, path, dir))
            if (dir) {
              const plan = await planUploadOf(path, deviceTargetDirRef.current)
              const result = await runFolderUpload(plan, () => undefined)
              if (!result.ok) throw new Error(result.error ?? `Could not sync ${baseName(path)}`)
            } else {
              const content = await window.api.fs.readFile(path)
              await window.api.device.writeFile(deviceDestForLocal(path), content)
            }
            setFileStates((prev) => markFiles(prev, [path], 'done'))
          } catch (err) {
            // Record which file failed before letting the run end — the popup's
            // job is to name the one that went wrong, not just that one did.
            const message = err instanceof Error ? err.message : String(err)
            setFileStates((prev) => markFiles(prev, [path], 'error', message))
            throw err
          }
        }
        settle('done', null, label)
      } catch (err) {
        settle('error', err instanceof Error ? err.message : String(err), label)
      }
    },
    [settle]
  )

  // "Sync now" pushes what is in the tree, not what storage happens to hold
  // (#881) — the filter is repeated here rather than trusted from the prune
  // effect, so a stale list can't be pushed in the render before it runs.
  const syncNow = useCallback(async (): Promise<void> => {
    await pushPaths(pathsInFolder(syncedRef.current, folderRef.current))
  }, [pushPaths])

  const isSynced = useCallback((path: string): boolean => scopedPaths.includes(path), [scopedPaths])

  const toggleSync = useCallback(
    (path: string): void => {
      setSyncedPaths((prev) => {
        const has = prev.includes(path)
        const next = has ? prev.filter((p) => p !== path) : [...prev, path]
        saveSyncedPaths(next)
        const name = baseName(path)
        if (has) {
          emitSyncStatus(`Stopped syncing ${name}`, DONE_LINGER_MS)
        } else if (connectedRef.current) {
          // Newly tagged + a board is connected → push it once (this emits its
          // own "Syncing …" → "… synced" messages).
          void pushPaths([path])
        } else {
          emitSyncStatus(`${name} tagged — will sync when a board connects`, DONE_LINGER_MS)
        }
        return next
      })
    },
    [pushPaths]
  )

  const setSyncOnSave = useCallback((on: boolean): void => {
    setSyncOnSaveState(on)
    saveSyncOnSave(on)
    if (on) {
      const n = syncedRef.current.length
      emitSyncStatus(
        `File sync on — ${n} file${n === 1 ? '' : 's'} kept in sync on save`,
        DONE_LINGER_MS
      )
    } else {
      emitSyncStatus('File sync off', DONE_LINGER_MS)
    }
  }, [])

  // Auto-sync on save: when enabled + connected, a saved tagged local file is
  // pushed using the content carried by the event (no re-read needed).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<FileSavedDetail>).detail
      if (!detail || detail.source !== 'local') return
      if (!onSaveRef.current || !connectedRef.current) return
      if (!syncedRef.current.includes(detail.path)) return
      // A buffer can be open from anywhere — including a file left over from a
      // folder the tree is no longer showing. Saving it must not push it (#881).
      if (!isUnderFolder(folderRef.current, detail.path)) return
      const label = baseName(detail.path)
      void (async (): Promise<void> => {
        if (lingerTimer.current) clearTimeout(lingerTimer.current)
        setStatus('syncing')
        setError(null)
        emitSyncStatus(`Syncing ${label}…`)
        // Only a FILE can be saved from an editor buffer, so this path knows the
        // kind without asking the disk (#863).
        setFileStates((prev) => markFiles(markKind(prev, detail.path, false), [detail.path], 'syncing'))
        try {
          await window.api.device.writeFile(deviceDestForLocal(detail.path), detail.content)
          setFileStates((prev) => markFiles(prev, [detail.path], 'done'))
          settle('done', null, label)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          setFileStates((prev) => markFiles(prev, [detail.path], 'error', message))
          settle('error', message, label)
        }
      })()
    }
    window.addEventListener(FILE_SAVED_EVENT, handler)
    return () => window.removeEventListener(FILE_SAVED_EVENT, handler)
  }, [settle])

  const syncedFiles = useMemo(
    () => syncedFileList(scopedPaths, fileStates, deviceTargetDir),
    [scopedPaths, fileStates, deviceTargetDir]
  )

  const store = useMemo<SyncStore>(
    () => ({
      syncedPaths: scopedPaths,
      syncOnSave,
      status,
      error,
      syncedFiles,
      isSynced,
      toggleSync,
      setSyncOnSave,
      syncNow
    }),
    [
      scopedPaths,
      syncOnSave,
      status,
      error,
      syncedFiles,
      isSynced,
      toggleSync,
      setSyncOnSave,
      syncNow
    ]
  )

  return createElement(SyncContext.Provider, { value: store }, children)
}

/** Access the file-sync store. Must be used within <SyncProvider>. */
export function useSync(): SyncStore {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used within a SyncProvider')
  return ctx
}
