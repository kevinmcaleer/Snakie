/**
 * Virtual path ⇄ `FileSystemDirectoryHandle` resolution for the web `fs`/
 * `robot` Api (epic #267 Phase W1). Everything the app treats as a "folder
 * path" on the web build is a POSIX path rooted at {@link PROJECT_ROOT}
 * (`/project`), resolved against ONE active root handle:
 *
 *  - by default, the OPFS project directory (`navigator.storage.getDirectory()`
 *    → `project/`) — always available, no permission prompt, survives reloads
 *    natively. This is what makes a locked-down Chromebook usable with zero
 *    friction.
 *  - or, when the user picks a real folder via {@link pickProjectFolder}
 *    (File System Access API's `showDirectoryPicker`), that handle — persisted
 *    in IndexedDB so a reload can re-request permission and reattach to the
 *    SAME folder rather than silently reverting to OPFS.
 *
 * `fs.openFolderDialog()` always resolves — a picker cancel/failure falls back
 * to OPFS rather than leaving the app with no project (matches the "just
 * works" classroom bar).
 */
import { idbDelete, idbGet, idbSet } from './idb'

/** The single virtual root every `fs`/`robot` path is rooted at. */
export const PROJECT_ROOT = '/project'

const IDB_KEY = 'projectRoot'

let cachedRoot: FileSystemDirectoryHandle | null = null

/** True when the File System Access API's directory picker is available
 *  (desktop/ChromeOS Chrome; not Firefox/Safari as of writing). */
export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

async function opfsProjectHandle(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('project', { create: true })
}

/** Best-effort permission check/(re)request for a handle restored from
 *  IndexedDB. OPFS handles don't implement these methods (always granted). */
async function hasReadWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (!handle.queryPermission) return true
  try {
    const opts = { mode: 'readwrite' as const }
    if ((await handle.queryPermission(opts)) === 'granted') return true
    if (!handle.requestPermission) return false
    return (await handle.requestPermission(opts)) === 'granted'
  } catch {
    return false
  }
}

async function restoreRoot(): Promise<FileSystemDirectoryHandle> {
  try {
    const saved = await idbGet<FileSystemDirectoryHandle>(IDB_KEY)
    if (saved && (await hasReadWritePermission(saved))) return saved
  } catch {
    // IndexedDB unavailable/blocked — fall through to OPFS.
  }
  return opfsProjectHandle()
}

/** The active project root handle, resolving (and caching) it on first use. */
export async function getProjectRoot(): Promise<FileSystemDirectoryHandle> {
  if (!cachedRoot) cachedRoot = await restoreRoot()
  return cachedRoot
}

/**
 * Open the File System Access directory picker (if supported) and make the
 * chosen folder the active project root, persisted for reload. Falls back to
 * the OPFS project directory when unsupported or the user cancels — always
 * resolves to {@link PROJECT_ROOT}, never `null`, so "Open Folder" is a
 * zero-friction action on the web build.
 */
export async function pickProjectFolder(): Promise<string> {
  if (supportsDirectoryPicker()) {
    try {
      const handle = await window.showDirectoryPicker!({ mode: 'readwrite' })
      cachedRoot = handle
      await idbSet(IDB_KEY, handle).catch(() => undefined)
      return PROJECT_ROOT
    } catch (err) {
      // AbortError = user cancelled the picker; anything else is unexpected
      // but still non-fatal — fall back to OPFS either way.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.warn('[snakie/web] directory picker failed, falling back to OPFS', err)
      }
    }
  }
  cachedRoot = await opfsProjectHandle()
  await idbDelete(IDB_KEY).catch(() => undefined)
  return PROJECT_ROOT
}

/** Split a virtual path into segments relative to {@link PROJECT_ROOT},
 *  tolerating a missing/duplicated leading slash or root prefix. */
export function splitPath(path: string): string[] {
  const withoutRoot = path.startsWith(PROJECT_ROOT) ? path.slice(PROJECT_ROOT.length) : path
  return withoutRoot.split('/').filter((s) => s.length > 0)
}

/** Join path segments back into a virtual path under {@link PROJECT_ROOT}. */
export function toVirtualPath(segments: string[]): string {
  return segments.length === 0 ? PROJECT_ROOT : `${PROJECT_ROOT}/${segments.join('/')}`
}

export interface ResolveOptions {
  /** Create missing directories/the final entry instead of throwing. */
  create?: boolean
}

/** Resolve (optionally creating) the directory at virtual `path`. */
export async function resolveDirHandle(
  path: string,
  { create = false }: ResolveOptions = {}
): Promise<FileSystemDirectoryHandle> {
  let handle = await getProjectRoot()
  for (const segment of splitPath(path)) {
    handle = await handle.getDirectoryHandle(segment, { create })
  }
  return handle
}

/** Resolve (optionally creating, and creating parent directories) the file at
 *  virtual `path`. */
export async function resolveFileHandle(
  path: string,
  { create = false }: ResolveOptions = {}
): Promise<FileSystemFileHandle> {
  const segments = splitPath(path)
  const name = segments.pop()
  if (!name) throw new Error(`Not a file path: ${path}`)
  const dir = await resolveDirHandle(toVirtualPath(segments), { create })
  return dir.getFileHandle(name, { create })
}
