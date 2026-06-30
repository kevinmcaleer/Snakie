/**
 * Workspace store — the editor's document model and the shared integration
 * seam between the file browsers, the editor, and save/run actions.
 *
 * CONTRACT (later agents depend on this EXACT shape):
 *
 *   interface OpenFile {
 *     id: string                    // stable: `${source}:${path}`
 *     source: 'local' | 'device'
 *     path: string
 *     name: string                  // base name for tab labels
 *     content: string
 *     dirty: boolean                // unsaved edits pending
 *   }
 *
 *   openFiles: OpenFile[]
 *   activeId: string | null
 *   currentFolder: string | null            // working folder for the local tree
 *
 *   openFile(source, path): Promise<void>   // reads via window.api.fs (local)
 *                                           // or window.api.device (device);
 *                                           // dedupes by source+path; sets active
 *   setActive(id): void
 *   closeFile(id): void
 *   updateContent(id, content): void        // marks dirty=true
 *   saveFile(id): Promise<void>             // writes back (fs/device); clears dirty.
 *                                           // untitled local buffer -> Save As dialog
 *   newFile(): void                          // untitled local buffer
 *   openFolder(): Promise<void>              // native folder picker -> currentFolder
 *   openFolderPath(path): void               // re-root the local tree to `path`
 *                                           // (e.g. a breadcrumb ancestor)
 *
 * Implemented as a React context + reducer (no external state dep). Consume via
 * the `useWorkspace()` hook below; wrap the app in <WorkspaceProvider>.
 *
 * Note: this file is `.ts` but contains JSX-free React via `createElement`, so
 * it can live under `store/` without a `.tsx` extension.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode
} from 'react'

export type FileSource = 'local' | 'device'

/**
 * Window event dispatched after a file is successfully saved (#178). The sync
 * store listens for this to auto-upload tagged local files on save — a decoupled
 * seam so the workspace store doesn't depend on the sync store.
 */
export const FILE_SAVED_EVENT = 'snakie:file-saved'

/** Detail payload of {@link FILE_SAVED_EVENT}. */
export interface FileSavedDetail {
  source: FileSource
  path: string
  content: string
}

/** Announce a successful save so listeners (e.g. file sync, #178) can react. */
function announceSaved(source: FileSource, path: string, content: string): void {
  window.dispatchEvent(
    new CustomEvent<FileSavedDetail>(FILE_SAVED_EVENT, { detail: { source, path, content } })
  )
}

/** localStorage key for the last opened working folder (#177), restored on launch. */
const LAST_FOLDER_KEY = 'snakie.lastFolder'

/** Persist (or clear) the last opened folder. Best-effort — storage may be off. */
function rememberFolder(folder: string | null): void {
  try {
    if (folder) window.localStorage.setItem(LAST_FOLDER_KEY, folder)
    else window.localStorage.removeItem(LAST_FOLDER_KEY)
  } catch {
    // ignore storage failures
  }
}

export interface OpenFile {
  /** Stable id derived from source+path (`${source}:${path}`). */
  id: string
  source: FileSource
  /** Absolute (local) or device path. Empty for unsaved untitled buffers. */
  path: string
  /** Base name shown in tab labels. */
  name: string
  content: string
  /** True when the buffer has unsaved edits. */
  dirty: boolean
}

/**
 * A request to reveal (scroll to + place the cursor on) a 1-based line in the
 * active editor. `seq` bumps on every request so the editor re-reveals the same
 * line on repeated clicks; consumers should react to `seq` changes, not just
 * `line`. Used by the Outline panel to navigate without cross-component refs.
 */
export interface RevealRequest {
  /** 1-based line number to reveal. */
  line: number
  /** Monotonic counter so identical lines still trigger a fresh reveal. */
  seq: number
}

export interface WorkspaceStore {
  openFiles: OpenFile[]
  activeId: string | null
  /** Latest editor reveal request, or null if none has been made yet. */
  revealRequest: RevealRequest | null
  /** The current working folder for the local file browser, or null. */
  currentFolder: string | null
  openFile: (source: FileSource, path: string) => Promise<void>
  setActive: (id: string) => void
  closeFile: (id: string) => void
  updateContent: (id: string, content: string) => void
  saveFile: (id: string) => Promise<void>
  newFile: () => void
  /**
   * Open a NEW untitled tab pre-filled with `content` (named `name`) and make it
   * active. Used to drop a generated program — e.g. the Wi-Fi scan demo — into
   * the editor ready to run. The buffer is unsaved (Save prompts for a path).
   */
  openBuffer: (name: string, content: string) => void
  /**
   * Open the native folder picker and, on a non-null result, set it as the
   * current working folder (the local file browser lists it).
   */
  openFolder: () => Promise<void>
  /**
   * Re-root the local file browser to an existing folder `path` (no native
   * dialog). Used by the breadcrumb to open an ancestor of the current folder.
   */
  openFolderPath: (path: string) => void
  /** Ask the editor to scroll to and place the cursor on a 1-based `line`. */
  revealLine: (line: number) => void
}

interface State {
  openFiles: OpenFile[]
  activeId: string | null
  revealRequest: RevealRequest | null
  currentFolder: string | null
}

type Action =
  | { type: 'open'; file: OpenFile }
  | { type: 'setActive'; id: string }
  | { type: 'close'; id: string }
  | { type: 'updateContent'; id: string; content: string }
  | { type: 'markSaved'; id: string }
  | { type: 'savedAs'; id: string; path: string; name: string }
  | { type: 'add'; file: OpenFile }
  | { type: 'revealLine'; line: number }
  | { type: 'setFolder'; folder: string | null }

/** Derive a stable document id from its source and path. */
function makeId(source: FileSource, path: string): string {
  return `${source}:${path}`
}

/** Base name of a path, handling both `/` and `\` separators. */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'open': {
      // Dedupe by id: if already open, just re-activate (don't clobber edits).
      const existing = state.openFiles.find((f) => f.id === action.file.id)
      if (existing) return { ...state, activeId: existing.id }
      return {
        ...state,
        openFiles: [...state.openFiles, action.file],
        activeId: action.file.id
      }
    }
    case 'add':
      return {
        ...state,
        openFiles: [...state.openFiles, action.file],
        activeId: action.file.id
      }
    case 'setActive':
      return { ...state, activeId: action.id }
    case 'close': {
      const idx = state.openFiles.findIndex((f) => f.id === action.id)
      if (idx === -1) return state
      const openFiles = state.openFiles.filter((f) => f.id !== action.id)
      let activeId = state.activeId
      if (activeId === action.id) {
        // Activate the neighbour (prefer the previous tab, else the next).
        const next = openFiles[idx] ?? openFiles[idx - 1]
        activeId = next ? next.id : null
      }
      return { ...state, openFiles, activeId }
    }
    case 'updateContent':
      return {
        ...state,
        openFiles: state.openFiles.map((f) =>
          f.id === action.id ? { ...f, content: action.content, dirty: true } : f
        )
      }
    case 'markSaved':
      return {
        ...state,
        openFiles: state.openFiles.map((f) =>
          f.id === action.id ? { ...f, dirty: false } : f
        )
      }
    case 'savedAs':
      // An untitled buffer was saved to a real path: it becomes a saved file.
      // Keep the buffer's stable id so its open tab/editor stays mounted.
      return {
        ...state,
        openFiles: state.openFiles.map((f) =>
          f.id === action.id
            ? { ...f, path: action.path, name: action.name, dirty: false }
            : f
        )
      }
    case 'setFolder':
      return { ...state, currentFolder: action.folder }
    case 'revealLine':
      return {
        ...state,
        revealRequest: { line: action.line, seq: (state.revealRequest?.seq ?? 0) + 1 }
      }
    default:
      return state
  }
}

const WorkspaceContext = createContext<WorkspaceStore | null>(null)

let untitledCounter = 0

/**
 * Provides the workspace store to the React tree. Wrap the app once near the
 * root (e.g. in App.tsx).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, {
    openFiles: [],
    activeId: null,
    revealRequest: null,
    currentFolder: null
  })

  const openFile = useCallback(
    async (source: FileSource, path: string): Promise<void> => {
      const id = makeId(source, path)
      const content =
        source === 'local'
          ? await window.api.fs.readFile(path)
          : await window.api.device.readFile(path)
      dispatch({
        type: 'open',
        file: { id, source, path, name: baseName(path), content, dirty: false }
      })
    },
    []
  )

  const setActive = useCallback((id: string): void => {
    dispatch({ type: 'setActive', id })
  }, [])

  const closeFile = useCallback((id: string): void => {
    dispatch({ type: 'close', id })
  }, [])

  const updateContent = useCallback((id: string, content: string): void => {
    dispatch({ type: 'updateContent', id, content })
  }, [])

  // `saveFile` needs the current file list; read it from a ref-like closure via
  // the latest state captured in a callback that depends on openFiles.
  const saveFile = useCallback(
    async (id: string): Promise<void> => {
      const file = state.openFiles.find((f) => f.id === id)
      if (!file) return
      if (file.source === 'local' && !file.path) {
        // Untitled local buffer: "Save As" — pick a destination, write it, and
        // promote the buffer to a real saved file (path/name updated, dirty
        // cleared). Cancelling the dialog leaves the buffer untouched.
        const chosen = await window.api.fs.saveFileDialog(file.name)
        if (!chosen) return
        await window.api.fs.writeFile(chosen, file.content)
        dispatch({ type: 'savedAs', id, path: chosen, name: baseName(chosen) })
        announceSaved('local', chosen, file.content)
        return
      }
      if (!file.path) return
      if (file.source === 'local') {
        await window.api.fs.writeFile(file.path, file.content)
      } else {
        await window.api.device.writeFile(file.path, file.content)
      }
      dispatch({ type: 'markSaved', id })
      announceSaved(file.source, file.path, file.content)
    },
    [state.openFiles]
  )

  const openFolder = useCallback(async (): Promise<void> => {
    const folder = await window.api.fs.openFolderDialog()
    if (folder) {
      dispatch({ type: 'setFolder', folder })
      rememberFolder(folder) // restore it on next launch (#177)
    }
  }, [])

  const openFolderPath = useCallback((path: string): void => {
    if (path) {
      dispatch({ type: 'setFolder', folder: path })
      rememberFolder(path)
    }
  }, [])

  // Restore the last opened folder on launch (#177) — but only if it still exists,
  // so a moved/deleted folder doesn't leave the file tree pointing at nothing.
  useEffect(() => {
    let cancelled = false
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem(LAST_FOLDER_KEY)
    } catch {
      saved = null
    }
    if (!saved) return
    const dir = saved
    void window.api.fs
      .stat(dir)
      .then((s) => {
        if (cancelled) return
        if (s.isDir) dispatch({ type: 'setFolder', folder: dir })
        else rememberFolder(null)
      })
      .catch(() => {
        if (!cancelled) rememberFolder(null) // gone — forget it
      })
    return () => {
      cancelled = true
    }
  }, [])

  const revealLine = useCallback((line: number): void => {
    dispatch({ type: 'revealLine', line })
  }, [])

  const newFile = useCallback((): void => {
    untitledCounter += 1
    const id = `local:untitled-${untitledCounter}`
    dispatch({
      type: 'add',
      file: {
        id,
        source: 'local',
        path: '',
        name: `untitled-${untitledCounter}.py`,
        content: '',
        dirty: false
      }
    })
  }, [])

  const openBuffer = useCallback((name: string, content: string): void => {
    untitledCounter += 1
    const id = `local:untitled-${untitledCounter}`
    dispatch({
      type: 'add',
      file: { id, source: 'local', path: '', name, content, dirty: false }
    })
  }, [])

  const store = useMemo<WorkspaceStore>(
    () => ({
      openFiles: state.openFiles,
      activeId: state.activeId,
      revealRequest: state.revealRequest,
      currentFolder: state.currentFolder,
      openFile,
      setActive,
      closeFile,
      updateContent,
      saveFile,
      newFile,
      openBuffer,
      openFolder,
      openFolderPath,
      revealLine
    }),
    [
      state.openFiles,
      state.activeId,
      state.revealRequest,
      state.currentFolder,
      openFile,
      setActive,
      closeFile,
      updateContent,
      saveFile,
      newFile,
      openBuffer,
      openFolder,
      openFolderPath,
      revealLine
    ]
  )

  return createElement(WorkspaceContext.Provider, { value: store }, children)
}

/** Access the workspace store. Must be used within <WorkspaceProvider>. */
export function useWorkspace(): WorkspaceStore {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return ctx
}
