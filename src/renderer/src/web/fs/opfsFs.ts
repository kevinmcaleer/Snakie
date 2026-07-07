/**
 * Web implementation of the `fs` Api (local/project filesystem) — epic #267
 * Phase W1. Backed by OPFS/File System Access directory handles via
 * `handleResolver.ts` instead of Node's `fs` + native dialogs. Mirrors
 * `src/main/fs/ipc.ts`'s behaviour (same sort order, same error-as-rejection
 * semantics) so the existing renderer (`LocalFileTree`, `workspace.ts`) works
 * unmodified.
 */
import type { FsEntry, FsStat } from '../../../../main/fs/types'
import {
  PROJECT_ROOT,
  pickProjectFolder,
  resolveDirHandle,
  resolveFileHandle,
  splitPath,
  toVirtualPath
} from './handleResolver'

/**
 * Handles picked via `showSaveFilePicker` live OUTSIDE the project tree, so
 * they're tracked by a synthetic virtual path (`/external/<n>-<name>`) rather
 * than resolved through `handleResolver`. Session-only (not persisted across
 * reload) — documented as a current limitation in `docs/web-build.md`.
 */
const externalFiles = new Map<string, FileSystemFileHandle>()
let externalCounter = 0

function isExternalPath(path: string): boolean {
  return externalFiles.has(path)
}

/** Recursively copy a file or directory entry into `destParent` as `name`. */
async function copyEntry(
  source: FileSystemHandle,
  destParent: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  if (source.kind === 'file') {
    const file = await (source as FileSystemFileHandle).getFile()
    const dest = await destParent.getFileHandle(name, { create: true })
    const writable = await dest.createWritable()
    await writable.write(await file.arrayBuffer())
    await writable.close()
    return
  }
  const srcDir = source as FileSystemDirectoryHandle
  const destDir = await destParent.getDirectoryHandle(name, { create: true })
  for await (const [childName, childHandle] of srcDir.entries()) {
    await copyEntry(childHandle, destDir, childName)
  }
}

async function readDir(path: string): Promise<FsEntry[]> {
  const dir = await resolveDirHandle(path)
  const entries: FsEntry[] = []
  for await (const [name, handle] of dir.entries()) {
    entries.push({ name, path: toVirtualPath([...splitPath(path), name]), isDir: handle.kind === 'directory' })
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

async function readFile(path: string): Promise<string> {
  const handle = isExternalPath(path) ? externalFiles.get(path)! : await resolveFileHandle(path)
  const file = await handle.getFile()
  return file.text()
}

async function writeFile(path: string, contents: string): Promise<void> {
  const handle = isExternalPath(path)
    ? externalFiles.get(path)!
    : await resolveFileHandle(path, { create: true })
  const writable = await handle.createWritable()
  await writable.write(contents)
  await writable.close()
}

async function mkdir(path: string): Promise<void> {
  await resolveDirHandle(path, { create: true })
}

async function rename(from: string, to: string): Promise<void> {
  const fromSegments = splitPath(from)
  const name = fromSegments.pop()
  if (!name) throw new Error(`Not a file or folder: ${from}`)
  const sourceParent = await resolveDirHandle(toVirtualPath(fromSegments))

  const toSegments = splitPath(to)
  const toName = toSegments.pop()
  if (!toName) throw new Error(`Not a file or folder: ${to}`)
  const destParent = await resolveDirHandle(toVirtualPath(toSegments), { create: true })

  // Try file first, then directory — whichever `from` actually is.
  let source: FileSystemHandle
  try {
    source = await sourceParent.getFileHandle(name)
  } catch {
    source = await sourceParent.getDirectoryHandle(name)
  }
  await copyEntry(source, destParent, toName)
  await sourceParent.removeEntry(name, { recursive: true })
}

async function remove(path: string): Promise<void> {
  const segments = splitPath(path)
  const name = segments.pop()
  if (!name) throw new Error(`Cannot remove the project root`)
  const parent = await resolveDirHandle(toVirtualPath(segments))
  await parent.removeEntry(name, { recursive: true })
}

async function stat(path: string): Promise<FsStat> {
  const segments = splitPath(path)
  const name = segments.pop()
  if (!name) return { isDir: true, size: 0, mtimeMs: 0 }
  const parent = await resolveDirHandle(toVirtualPath(segments))
  try {
    const fileHandle = await parent.getFileHandle(name)
    const file = await fileHandle.getFile()
    return { isDir: false, size: file.size, mtimeMs: file.lastModified }
  } catch {
    // Not a file — must be a directory (or it doesn't exist, and this throws).
    await parent.getDirectoryHandle(name)
    return { isDir: true, size: 0, mtimeMs: 0 }
  }
}

/** The web build's `fs` Api implementation (see `src/preload/index.ts`'s
 *  `fs` object for the exact shape this mirrors). */
export const opfsFs = {
  openFolderDialog: (): Promise<string | null> => pickProjectFolder(),
  /**
   * `showSaveFilePicker` when available (a real native save dialog, per the
   * File System Access API); otherwise saves within the current project
   * root under `defaultName` with no dialog at all (zero-friction default —
   * see `docs/web-build.md`).
   */
  saveFileDialog: async (defaultName?: string): Promise<string | null> => {
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: defaultName })
        externalCounter += 1
        const path = `/external/${externalCounter}-${handle.name}`
        externalFiles.set(path, handle)
        return path
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return null
        // Unexpected failure — fall through to the zero-dialog default below.
      }
    }
    return toVirtualPath([defaultName ?? 'untitled.py'])
  },
  readDir,
  readFile,
  writeFile,
  mkdir,
  rename,
  remove,
  stat
}

export { PROJECT_ROOT }
