/**
 * WEB local-filesystem backend — epic #267, Phase W1.
 * =============================================================================
 *
 * Implements `window.api.fs` in the browser with the **File System Access API**
 * (`showDirectoryPicker`), so a student can Open a real folder on their
 * Chromebook, edit files, and save straight back to disk — genuine persistence,
 * no server. Paths are the POSIX-ish strings the renderer already uses
 * (`<rootName>/sub/file.py`), resolved against the picked directory handle. Loose
 * files opened via `openFileDialog` / `saveFileDialog` are tracked by name.
 *
 * The picker needs a user gesture, so `openFolderDialog` must be called from a
 * click (it is — the "Open Folder" button). The pure path helpers are exported
 * for unit tests (the interactive picker itself can't be automated).
 *
 * **No picker (iPadOS Safari — #525): fall back to OPFS.** WebKit ships no
 * `showDirectoryPicker`, which used to leave this whole backend uninstalled and
 * made "Open Folder" / "New robot" silently do nothing. Where the pickers are
 * missing but the origin-private file system is available (and its file handles
 * support `createWritable`), we back the SAME api with an OPFS `Projects/`
 * directory instead: `openFolderDialog` adopts it without any dialog, and it is
 * silently re-adopted on every visit so the file tree survives reloads. Files
 * then live in browser storage rather than on disk — real persistence on an
 * iPad, same path/token semantics everywhere else. Loose-file pickers
 * (`openFileDialog`/`saveFileDialog`) still return null there.
 */
import { splitRelSegments, childPath } from './web-fs-paths'
import { saveFolderHandle, loadFolderHandle, clearFolderHandle } from './web-idb'

interface FsEntry {
  name: string
  path: string
  isDir: boolean
}
interface FsStat {
  isDir: boolean
  size: number
  mtimeMs: number
}

// The File System Access types aren't in every TS DOM lib version, so treat the
// handles structurally.
type PermState = 'granted' | 'denied' | 'prompt'
type DirHandle = {
  name: string
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, DirHandle | FileHandleLike]>
  queryPermission?(opts?: { mode?: string }): Promise<PermState>
  requestPermission?(opts?: { mode?: string }): Promise<PermState>
  kind: 'directory'
}
type FileHandleLike = {
  name: string
  kind: 'file'
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Uint8Array | string): Promise<void>; close(): Promise<void> }>
}

/** The OPFS folder that plays the role of the picked project folder. Its name
 *  is what users see as the file-tree root (and what path tokens start with). */
const OPFS_PROJECTS_DIR = 'Projects'

/**
 * True when the OPFS fallback can back the fs api: no folder picker (so there
 * is nothing better), but `navigator.storage.getDirectory` exists AND file
 * handles support `createWritable` (WebKit gained it well after OPFS itself —
 * without it every save would fail).
 */
export function opfsFallbackAvailable(): boolean {
  if ('showDirectoryPicker' in window) return false // real folders win
  const FileHandle = (globalThis as { FileSystemFileHandle?: { prototype: object } })
    .FileSystemFileHandle
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    !!FileHandle &&
    'createWritable' in FileHandle.prototype
  )
}

export function createWebFsApi(): Record<string, unknown> {
  const w = window as unknown as {
    showDirectoryPicker?: (o?: unknown) => Promise<DirHandle>
    showOpenFilePicker?: (o?: unknown) => Promise<FileHandleLike[]>
    showSaveFilePicker?: (o?: unknown) => Promise<FileHandleLike>
  }

  /** Get (create) the OPFS projects directory. Only called when
   *  {@link opfsFallbackAvailable} said the pieces exist. */
  const opfsProjects = async (): Promise<DirHandle> => {
    const opfsRoot = (await navigator.storage.getDirectory()) as unknown as DirHandle
    // Ask the browser to exempt this origin from storage eviction (Safari can
    // otherwise clear it after periods of disuse). Best-effort, no gesture needed.
    void navigator.storage.persist?.().catch(() => undefined)
    return opfsRoot.getDirectoryHandle(OPFS_PROJECTS_DIR, { create: true })
  }

  let root: DirHandle | null = null
  let rootPath = ''
  // Files picked OUTSIDE the open folder, keyed by a unique `loose://<n>/<name>`
  // token (the token IS the tab's path). Keying by bare basename let a second
  // same-named pick silently redirect the first tab's saves into the wrong
  // file (#511); the trailing real name keeps baseName()/tab titles correct.
  const loose = new Map<string, FileHandleLike>()
  let looseSeq = 0
  const adoptLoose = (fh: FileHandleLike): string => {
    const token = `loose://${++looseSeq}/${fh.name}`
    loose.set(token, fh)
    return token
  }
  // A folder handle rehydrated from IndexedDB (#476) that still needs a user
  // gesture to re-grant permission. Held here so the empty-state "Reopen" button
  // can promote it to `root` without re-navigating the picker.
  let pending: DirHandle | null = null

  const adopt = (handle: DirHandle): string => {
    root = handle
    rootPath = handle.name
    pending = null
    // Loose handles survive Open Folder — clearing them silently re-pointed
    // open tabs' saves at `<newRoot>/<name>` instead of the picked file (#511).
    void saveFolderHandle(handle) // persist for next visit
    return rootPath
  }

  // Kick off silent restore immediately (before render). fs ops await this so the
  // first stat/readDir sees a rehydrated root when permission was already granted.
  const ready = (async () => {
    // OPFS mode: the projects folder needs no picker and no permission, so
    // re-adopt it on every visit — the file tree and the persisted open-folder
    // token ('Projects') work from the first frame.
    if (opfsFallbackAvailable()) {
      try {
        root = await opfsProjects()
        rootPath = root.name
      } catch {
        /* storage blocked (e.g. private mode with OPFS disabled) — stay degraded */
      }
      return
    }
    try {
      const handle = (await loadFolderHandle()) as DirHandle | null
      if (!handle) return
      // No queryPermission (e.g. always-usable handles) → treat as granted.
      const perm = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted'
      if (perm === 'granted') {
        root = handle
        rootPath = handle.name
      } else {
        pending = handle // needs a gesture — offered via reopenFolderName/reopenFolder
      }
    } catch {
      /* nothing persisted / IDB blocked */
    }
  })()

  const dirAt = async (path: string, create = false): Promise<DirHandle> => {
    await ready
    if (!root) throw new Error('No folder is open')
    let h = root
    for (const seg of splitRelSegments(rootPath, path)) h = await h.getDirectoryHandle(seg, { create })
    return h
  }
  const fileAt = async (path: string, create = false): Promise<FileHandleLike> => {
    if (loose.has(path)) return loose.get(path)!
    // A loose token that misses the map (page reload dropped the handle) must
    // NOT navigate the root — that would create `loose:` folders in the project.
    if (path.startsWith('loose://')) throw new Error('That file is no longer available — open it again.')
    await ready
    if (!root) throw new Error('No folder is open')
    const segs = splitRelSegments(rootPath, path)
    const name = segs.pop()
    if (name === undefined) throw new Error(`Not a file path: ${path}`)
    let h = root
    for (const seg of segs) h = await h.getDirectoryHandle(seg, { create })
    return h.getFileHandle(name, { create })
  }
  const readBytes = async (h: FileHandleLike): Promise<Uint8Array> => {
    const file = await h.getFile()
    const buf: ArrayBuffer = await file.arrayBuffer()
    return new Uint8Array(buf)
  }
  const removePath = async (path: string): Promise<void> => {
    if (loose.delete(path)) return
    if (!root) return
    const segs = splitRelSegments(rootPath, path)
    const name = segs.pop()
    if (name === undefined) return
    let h = root
    for (const seg of segs) h = await h.getDirectoryHandle(seg)
    await h.removeEntry(name, { recursive: true })
  }
  const copyPath = async (from: string, to: string): Promise<void> => {
    let isFile = true
    try {
      await fileAt(from)
    } catch {
      isFile = false
    }
    if (isFile) {
      const bytes = await readBytes(await fileAt(from))
      const dst = await fileAt(to, true)
      const ws = await dst.createWritable()
      await ws.write(bytes)
      await ws.close()
      return
    }
    const src = await dirAt(from)
    await dirAt(to, true)
    for await (const [name] of src.entries()) await copyPath(childPath(from, name), childPath(to, name))
  }

  return {
    openFolderDialog: async (): Promise<string | null> => {
      if (!w.showDirectoryPicker) {
        // No picker (iPad) → "open" the OPFS projects folder instead. No dialog
        // to cancel; null only when OPFS is unusable too (stay degraded).
        if (!opfsFallbackAvailable()) return null
        try {
          await ready // don't race the silent re-adopt above
          root = await opfsProjects()
          rootPath = root.name
          return rootPath
        } catch {
          return null
        }
      }
      try {
        return adopt(await w.showDirectoryPicker({ mode: 'readwrite' }))
      } catch {
        return null // user cancelled / denied
      }
    },
    // #476: the name of a folder rehydrated from IndexedDB that needs a click to
    // re-grant permission (null when none pending or already restored). The file
    // tree's empty state uses this to offer a one-click "Reopen <name>".
    reopenFolderName: async (): Promise<string | null> => {
      await ready
      return pending?.name ?? null
    },
    // #476: promote the pending handle to the open root, requesting permission.
    // MUST be called from a user gesture (button click) — Chromium requires one
    // to re-grant a persisted directory handle. Returns the root path or null.
    reopenFolder: async (): Promise<string | null> => {
      await ready
      if (!pending) return null
      try {
        const perm = (await pending.requestPermission?.({ mode: 'readwrite' })) ?? 'granted'
        if (perm !== 'granted') {
          if (perm === 'denied') {
            pending = null
            void clearFolderHandle() // stop offering a folder the user won't grant
          }
          return null
        }
        return adopt(pending)
      } catch {
        return null
      }
    },
    openFileDialog: async (): Promise<string | null> => {
      if (!w.showOpenFilePicker) return null
      try {
        const [fh] = await w.showOpenFilePicker()
        return adoptLoose(fh)
      } catch {
        return null
      }
    },
    saveFileDialog: async (defaultName?: string): Promise<string | null> => {
      if (!w.showSaveFilePicker) return null
      try {
        const fh = await w.showSaveFilePicker({ suggestedName: defaultName })
        return adoptLoose(fh)
      } catch {
        return null
      }
    },
    readDir: async (path: string): Promise<FsEntry[]> => {
      const dir = await dirAt(path)
      const out: FsEntry[] = []
      for await (const [name, handle] of dir.entries()) {
        out.push({ name, path: childPath(path, name), isDir: handle.kind === 'directory' })
      }
      // Folders first, then alphabetical — matches the desktop tree.
      return out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    },
    readFile: async (path: string): Promise<string> => (await fileAt(path)).getFile().then((f) => f.text()),
    readFileBytes: async (path: string): Promise<Uint8Array> => readBytes(await fileAt(path)),
    writeFile: async (path: string, contents: string): Promise<void> => {
      const fh = await fileAt(path, true)
      const ws = await fh.createWritable()
      await ws.write(contents)
      await ws.close()
    },
    // Not part of the preload `fs` namespace — a web-only extra the web robot
    // backend uses to copy binary meshes (STL) without UTF-8 mangling.
    writeFileBytes: async (path: string, bytes: Uint8Array): Promise<void> => {
      const fh = await fileAt(path, true)
      const ws = await fh.createWritable()
      await ws.write(bytes)
      await ws.close()
    },
    mkdir: async (path: string): Promise<void> => {
      await dirAt(path, true)
    },
    rename: async (from: string, to: string): Promise<void> => {
      // Refuse to overwrite an existing destination (#504) — mirrors the
      // desktop guard; copyPath would silently truncate the sibling file.
      // isSameEntry keeps case-only renames working on case-insensitive disks.
      if (from !== to) {
        let clash = false
        try {
          const dest = (await fileAt(to)) as FileHandleLike & {
            isSameEntry?: (o: unknown) => Promise<boolean>
          }
          const src = await fileAt(from)
          clash = !(await dest.isSameEntry?.(src))
        } catch {
          try {
            await dirAt(to)
            clash = true
          } catch {
            clash = false
          }
        }
        if (clash) throw new Error(`"${to.split('/').pop()}" already exists.`)
      }
      await copyPath(from, to)
      await removePath(from)
    },
    remove: async (path: string): Promise<void> => removePath(path),
    stat: async (path: string): Promise<FsStat> => {
      try {
        const f = await (await fileAt(path)).getFile()
        return { isDir: false, size: f.size, mtimeMs: f.lastModified }
      } catch {
        await dirAt(path)
        return { isDir: true, size: 0, mtimeMs: 0 }
      }
    }
  }
}
