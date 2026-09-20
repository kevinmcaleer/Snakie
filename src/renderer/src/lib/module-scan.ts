import { readModuleApi, type ModuleApi } from './blocks/module-api'
import { joinPath } from './blocks/module-source'

/**
 * WHAT IS ACTUALLY THERE — the Modules shelf's "detected" section.
 * =============================================================================
 *
 * The Modules shelf has always described the CATALOG: the drivers Snakie can
 * install. This is the other half of the picture — the `.py` files that are
 * already on the board or beside the program, whoever put them there. Each one
 * is read and parsed by `readModuleApi` (the #1048 text-only reader), so the
 * shelf can say what a file holds — its classes, functions, constants and
 * variables — without ever executing it.
 *
 * TWO PLACES. The open project folder (top level only: that is where a program
 * looks for a bare `import foo`) and the board's `/` and `/lib`, which is where
 * `mip` and Snakie's own installer put things.
 *
 * WHAT THIS SCAN CANNOT SEE, and why it is not the whole story (#1254). It
 * lists `.py` FILES in two fixed directories, so three kinds of real module are
 * invisible to it: a PACKAGE (`/lib/arduino_alvik/__init__.py` — a directory,
 * which the filter skips), a precompiled `.mpy`, and anything on a `sys.path`
 * entry that is not `/` or `/lib`. All three are ordinary ways for a vendor
 * library to arrive, and an Alvik's `arduino_alvik` is all three at once.
 * Widening the filter is not the fix: reading and parsing a package tree over a
 * serial link, file by file, is exactly the cost this scan is shaped to avoid.
 * Instead the discovery probe (`module-discovery`) already enumerates every
 * importable name on `sys.path` in ONE round-trip, and
 * {@link unscannedDeviceNames} says which of those this scan could not account
 * for, so the panel can list them by name rather than pretend they do not
 * exist.
 *
 * PURE AND INJECTED. Listing and reading are passed in, so the scanner is a
 * unit test rather than something that needs a board and a folder; the panel
 * wires the real `window.api.fs` / `window.api.device` in.
 *
 * EVERY READ MAY FAIL AND THAT IS NORMAL. A file that vanishes between the
 * listing and the read, a board that drops mid-scan, a folder without
 * permission: each yields a row that says so, or nothing at all, and the rest
 * of the scan carries on. Nothing here throws.
 */

/** A directory entry as either side of the bridge reports it. */
export interface ScanEntry {
  name: string
  isDir: boolean
  /** Size in bytes, when the lister knows it. */
  size?: number
}

/** Where a detected module was found. */
export type DetectedOrigin = 'project' | 'device'

/** One `.py` file, and what reading it found. */
export interface DetectedModule {
  /** The importable name — `ssd1306` for `ssd1306.py`. */
  name: string
  origin: DetectedOrigin
  /** The full path it was read from (`/lib/ssd1306.py`, `/home/kev/robot/servo.py`). */
  path: string
  /** Size in bytes, when known. */
  size?: number
  /** The parsed API. Absent when the file was skipped or could not be read. */
  api?: ModuleApi
  /** Why there is no `api`: the file was too big to read, or the read failed. */
  skipped?: 'too-large' | 'unreadable'
}

/** Listing + reading for one place. */
export interface ScanReaders {
  list: (path: string) => Promise<readonly ScanEntry[]>
  read: (path: string) => Promise<string>
}

/**
 * Files above this are not read. Over a serial link a 300 KB file takes the
 * best part of a minute, and a driver that size is not a driver, it is data
 * (a font, a sprite sheet) that happens to be a `.py`.
 */
export const MAX_SCAN_BYTES = 128 * 1024

/** Where the board's importable modules live, in `sys.path` order. */
export const DEVICE_MODULE_DIRS = ['/', '/lib'] as const

/** `ssd1306.py` → `ssd1306`; `foo-bar.py` → null (not importable, still listed). */
export function moduleNameOf(file: string): string {
  return file.replace(/\.py$/, '')
}

function isPythonFile(entry: ScanEntry): boolean {
  return !entry.isDir && /\.py$/i.test(entry.name)
}

/** Read and parse one file into a row. Never throws. */
async function detect(
  origin: DetectedOrigin,
  name: string,
  path: string,
  size: number | undefined,
  read: ScanReaders['read']
): Promise<DetectedModule> {
  const row: DetectedModule = { name, origin, path }
  if (size !== undefined) row.size = size
  if (size !== undefined && size > MAX_SCAN_BYTES) {
    row.skipped = 'too-large'
    return row
  }
  try {
    const text = await read(path)
    row.api = readModuleApi(name, text)
  } catch {
    row.skipped = 'unreadable'
  }
  return row
}

/** Order rows by name so a re-scan never shuffles the list. */
function byName(a: DetectedModule, b: DetectedModule): number {
  return a.name.localeCompare(b.name)
}

/**
 * The `.py` files at the top of `folder`, parsed.
 *
 * The top level only: a package (`foo/__init__.py`) and a nested folder are
 * not what `import foo` finds beside the program, and walking a tree of
 * unknown size on every save is not a cost the panel should carry.
 *
 * An empty list when there is no folder, or it cannot be listed.
 */
export async function scanProjectModules(
  folder: string | null | undefined,
  readers: ScanReaders
): Promise<DetectedModule[]> {
  if (!folder) return []
  let entries: readonly ScanEntry[]
  try {
    entries = await readers.list(folder)
  } catch {
    return []
  }
  const rows: DetectedModule[] = []
  for (const entry of entries.filter(isPythonFile)) {
    rows.push(
      await detect(
        'project',
        moduleNameOf(entry.name),
        joinPath(folder, entry.name),
        entry.size,
        readers.read
      )
    )
  }
  return rows.sort(byName)
}

/**
 * The `.py` files on the board, in `/` and `/lib`, parsed.
 *
 * A name present in both is listed ONCE, from `/` — that is the copy
 * MicroPython imports, since `''` precedes `/lib` on `sys.path`. Reads are
 * sequential on purpose: the device channel is one serial port, and a burst of
 * parallel reads only queues behind itself.
 *
 * An empty list when there is no board, or nothing can be listed.
 */
export async function scanDeviceModules(readers: ScanReaders): Promise<DetectedModule[]> {
  const rows: DetectedModule[] = []
  const seen = new Set<string>()
  for (const dir of DEVICE_MODULE_DIRS) {
    let entries: readonly ScanEntry[]
    try {
      entries = await readers.list(dir)
    } catch {
      continue
    }
    for (const entry of entries.filter(isPythonFile)) {
      const name = moduleNameOf(entry.name)
      if (seen.has(name)) continue
      seen.add(name)
      const path = dir === '/' ? `/${entry.name}` : `${dir}/${entry.name}`
      rows.push(await detect('device', name, path, entry.size, readers.read))
    }
  }
  return rows.sort(byName)
}

/**
 * The importable names the discovery probe found on `sys.path` that
 * {@link scanDeviceModules} did not account for (#1254).
 *
 * These are the packages, the `.mpy`s and the modules outside `/` and `/lib` —
 * real, importable, and previously invisible in the panel, which is how a board
 * whose whole vendor library is a `/lib` package appeared to have nothing on it.
 * They come back as bare names because that is honestly all that is known
 * without reading a tree of files: the panel offers `dir()` for the rest.
 *
 * Sorted and de-duplicated. Pure.
 */
export function unscannedDeviceNames(
  filesystemNames: readonly string[],
  scanned: readonly DetectedModule[]
): string[] {
  const covered = new Set(scanned.map((r) => r.name))
  return [...new Set(filesystemNames.filter((n) => !covered.has(n)))].sort()
}

/** How many named things a parsed module offers — the row's badge. */
export function memberCount(api: ModuleApi | undefined): number {
  if (!api) return 0
  return api.classes.length + api.functions.length + api.constants.length + api.variables.length
}
