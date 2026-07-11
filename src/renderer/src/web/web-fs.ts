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
 * click (it is — the "Open Folder" button). Where the API is unavailable the
 * methods return empty/null and the UI degrades. The pure path helpers are
 * exported for unit tests (the interactive picker itself can't be automated).
 */
import { splitRelSegments, childPath } from './web-fs-paths'

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
type DirHandle = {
  name: string
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, DirHandle | FileHandleLike]>
  kind: 'directory'
}
type FileHandleLike = {
  name: string
  kind: 'file'
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Uint8Array | string): Promise<void>; close(): Promise<void> }>
}

export function createWebFsApi(): Record<string, unknown> {
  const w = window as unknown as {
    showDirectoryPicker?: (o?: unknown) => Promise<DirHandle>
    showOpenFilePicker?: (o?: unknown) => Promise<FileHandleLike[]>
    showSaveFilePicker?: (o?: unknown) => Promise<FileHandleLike>
  }

  let root: DirHandle | null = null
  let rootPath = ''
  const loose = new Map<string, FileHandleLike>()

  const dirAt = async (path: string, create = false): Promise<DirHandle> => {
    if (!root) throw new Error('No folder is open')
    let h = root
    for (const seg of splitRelSegments(rootPath, path)) h = await h.getDirectoryHandle(seg, { create })
    return h
  }
  const fileAt = async (path: string, create = false): Promise<FileHandleLike> => {
    if (loose.has(path)) return loose.get(path)!
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
      if (!w.showDirectoryPicker) return null
      try {
        const handle = await w.showDirectoryPicker({ mode: 'readwrite' })
        root = handle
        rootPath = handle.name
        loose.clear()
        return rootPath
      } catch {
        return null // user cancelled / denied
      }
    },
    openFileDialog: async (): Promise<string | null> => {
      if (!w.showOpenFilePicker) return null
      try {
        const [fh] = await w.showOpenFilePicker()
        loose.set(fh.name, fh)
        return fh.name
      } catch {
        return null
      }
    },
    saveFileDialog: async (defaultName?: string): Promise<string | null> => {
      if (!w.showSaveFilePicker) return null
      try {
        const fh = await w.showSaveFilePicker({ suggestedName: defaultName })
        loose.set(fh.name, fh)
        return fh.name
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
    mkdir: async (path: string): Promise<void> => {
      await dirAt(path, true)
    },
    rename: async (from: string, to: string): Promise<void> => {
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
