/**
 * Planning a folder → board transfer (#848).
 *
 * Uploading a folder is not "upload, but more times". It has to decide where
 * every file LANDS, and getting that wrong writes someone's project into the
 * wrong place on a board they then have to clean up by hand. So the mapping is
 * worked out here — as pure functions over a walked list — and the part that
 * actually touches the device just executes the plan.
 *
 * Dependency-free (no Electron, no `fs`, no React) for the usual reason: this is
 * the half worth unit-testing, and it is testable only if a board and a disk are
 * not required to ask it a question.
 *
 * ## Host paths in, device paths out
 *
 * Host paths arrive in whatever the platform uses — `C:\Users\kev\lib` on
 * Windows, `/Users/kev/lib` elsewhere. Device paths are ALWAYS POSIX, absolute,
 * and `/`-separated, because that is what MicroPython's filesystem is. Every
 * function here takes the former and returns the latter; nothing round-trips a
 * device path back into a host one.
 */

/** One entry from a walked local folder. Absolute host path. */
export interface LocalEntry {
  /** Absolute path on the host. */
  path: string
  /** True for a directory. */
  isDir: boolean
  /** Size in bytes; used only for the progress bar's denominator. */
  size?: number
}

/** One file to copy, resolved to both ends. */
export interface TransferFile {
  /** Absolute host path to read. */
  local: string
  /** Absolute device path to write. */
  device: string
  /** Path shown in the progress dialog — relative to the folder being sent. */
  label: string
  /** Size in bytes, when the walk reported one. */
  size: number
}

/** Everything a folder upload needs to do, in the order it must be done. */
export interface TransferPlan {
  /** The device folder the upload creates, e.g. `/lib/mylib`. */
  root: string
  /** Directories to create, PARENTS FIRST. */
  dirs: string[]
  /** Files to write, in walk order. */
  files: TransferFile[]
  /** Sum of `size` across `files`, for a byte-accurate progress bar. */
  totalBytes: number
}

/** Split a host path on either separator, dropping empty segments. */
function hostSegments(path: string): string[] {
  return path.split(/[/\\]+/).filter(Boolean)
}

/**
 * The last segment of a host path — the folder or file name.
 *
 * Trailing separators are ignored, so `/a/b/` and `/a/b` both name `b`. A path
 * that is nothing but separators has no name and returns `''`, which callers
 * treat as "not a usable source".
 */
export function hostBaseName(path: string): string {
  const parts = hostSegments(path)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/**
 * Normalise a device path: absolute, `/`-separated, no trailing slash.
 *
 * `''` and `'/'` both mean the root, which is the one path allowed to end in a
 * slash — because it is nothing but one.
 */
export function normaliseDevicePath(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean)
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

/** Join device path segments into one absolute, normalised device path. */
export function deviceJoin(...parts: string[]): string {
  return normaliseDevicePath(parts.join('/'))
}

/**
 * Where `localPath` lands, given the folder being sent and the device folder it
 * is being sent into.
 *
 * `localRoot` is the folder the user picked; its own NAME is part of the
 * destination, so sending `~/code/mylib` into `/lib` produces `/lib/mylib/...`
 * rather than scattering `mylib`'s contents directly into `/lib`. That is what
 * "copy the folder into that folder" means everywhere else a file manager does
 * it, and the alternative silently merges two trees.
 *
 * Returns `null` when `localPath` is not inside `localRoot` — a caller that
 * walked a different tree than it planned would otherwise write files to
 * confidently wrong places.
 */
export function deviceDestFor(
  localRoot: string,
  localPath: string,
  deviceDir: string
): string | null {
  const rootParts = hostSegments(localRoot)
  const pathParts = hostSegments(localPath)
  const folderName = rootParts[rootParts.length - 1]
  if (!folderName) return null
  if (pathParts.length < rootParts.length) return null

  // Compare case-sensitively: macOS and Windows are usually case-insensitive,
  // but a mismatch here means the caller mixed up two trees, and quietly
  // accepting it is how files land somewhere nobody chose.
  for (let i = 0; i < rootParts.length; i++) {
    if (rootParts[i] !== pathParts[i]) return null
  }

  const relative = pathParts.slice(rootParts.length)
  return deviceJoin(deviceDir, folderName, ...relative)
}

/**
 * Turn a walked folder into an ordered plan.
 *
 * `entries` is the flattened walk of `localRoot` (absolute host paths, dirs
 * included). Order in, order out — except that directories are collected
 * separately and sorted SHORTEST FIRST, because `mkdir` cannot create `/a/b`
 * before `/a` and a walk is not obliged to hand them over in that order.
 *
 * The folder's own directory is always the first entry of `dirs`, even when the
 * folder is empty: uploading an empty folder should still produce that folder.
 */
export function planFolderUpload(
  localRoot: string,
  entries: readonly LocalEntry[],
  deviceDir: string
): TransferPlan {
  const folderName = hostBaseName(localRoot)
  const root = deviceJoin(deviceDir, folderName)

  const dirs = new Set<string>([root])
  const files: TransferFile[] = []
  const rootPrefixLen = hostSegments(localRoot).length

  for (const entry of entries) {
    const dest = deviceDestFor(localRoot, entry.path, deviceDir)
    if (!dest) continue
    if (entry.isDir) {
      dirs.add(dest)
      continue
    }
    files.push({
      local: entry.path,
      device: dest,
      label: hostSegments(entry.path).slice(rootPrefixLen).join('/'),
      size: entry.size ?? 0
    })
    // Every ancestor up to the root must exist before the file is written. A
    // walk that lists files without their parent directories (or that we
    // filtered) would otherwise fail on the first nested write.
    const parts = dest.split('/').filter(Boolean)
    for (let i = 1; i < parts.length; i++) {
      const ancestor = `/${parts.slice(0, i).join('/')}`
      // At or BELOW the upload root only. The target folder and everything
      // above it is what the user selected — it already exists, and proposing
      // to create it would have the transfer try to mkdir `/lib` on the way in.
      if (ancestor === root || ancestor.startsWith(`${root}/`)) dirs.add(ancestor)
    }
  }

  return {
    root,
    dirs: [...dirs]
      // Parents first. Depth is the only thing that matters; the alphabetical
      // tiebreak just makes the order deterministic for the tests.
      .filter((d) => d !== '/')
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)),
    files,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0)
  }
}

/**
 * Should this file be sent to a board at all?
 *
 * A source folder on a developer's machine is full of things a microcontroller
 * has no use for and no room for — a `.git` directory alone would exhaust a
 * Pico's filesystem. Skipping them is not a preference, it is what makes
 * "upload this folder" a safe thing to click.
 *
 * Deliberately a small, boring list of things that are never board files. It is
 * NOT a general ignore mechanism: anything the user actually wrote gets sent.
 */
const SKIP_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  'node_modules',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
  '.idea',
  '.vscode'
])

/** Files that are host bookkeeping and never belong on a board. */
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitignore', '.gitattributes'])

/** True when a walked name should be left on the host. */
export function shouldSkip(name: string, isDir: boolean): boolean {
  if (isDir) return SKIP_DIRS.has(name)
  if (SKIP_FILES.has(name)) return true
  // Editor droppings and compiled Python: never useful on the board.
  return name.endsWith('.pyc') || name.endsWith('~')
}
