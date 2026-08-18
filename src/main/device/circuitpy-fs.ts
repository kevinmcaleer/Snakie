/**
 * FILE I/O ON A CIRCUITPYTHON BOARD (#754, epic #209).
 * =============================================================================
 *
 * Every file operation in Snakie goes over the REPL: `writeFile` opens the path
 * with `open(path,'wb')` and streams hex chunks through `ubinascii.unhexlify`.
 * That is the only way to reach a MicroPython board, and it is the wrong way to
 * reach a CircuitPython one.
 *
 * **CircuitPython's filesystem is read-only to the board while the host has
 * CIRCUITPY mounted**, which is the default. So the REPL write raises
 * `OSError: 30`, and every feature built on it — the Files panel, driver
 * installs, the instrument library, the Modules manager — fails.
 *
 * The drive is the answer, and it is a better answer than a workaround:
 *
 *  - **It works.** The host mounts CIRCUITPY writable; that IS the supported
 *    way to put files on a CircuitPython board.
 *  - **It doesn't stop the program.** Entering the raw REPL sends Ctrl-C, which
 *    interrupts whatever `code.py` is doing. Listing a directory should not
 *    stop the user's robot. So READS go to the drive too, not just writes —
 *    the reason the scope left that choice open.
 *  - **It is enormously faster.** The REPL path hex-encodes every byte and
 *    round-trips per 256-byte chunk; the drive is a file copy.
 *
 * When there is NO drive, the REPL path is still correct and is left alone: a
 * user who puts `storage.remount("/", readonly=False)` in `boot.py` hands the
 * filesystem to the board and hides it from the host, and for them the REPL
 * write genuinely works. That is why nothing here refuses up front — it routes
 * when a drive is there, and {@link readOnlyFsError} explains the failure when
 * one is needed and missing.
 */
import { promises as fs } from 'fs'
import { dirname, isAbsolute, join, normalize, relative } from 'path'
import type { DirEntry, StatResult } from './types'

/**
 * Shown when a write fails because the board's filesystem is read-only to
 * itself — the CircuitPython default, whenever a host has the drive mounted.
 *
 * In the house style of `RAW_REPL_NO_RESPONSE`: name what happened, then the
 * ways out in likelihood order. The first is the one that applies to somebody
 * whose drive simply wasn't found; the second is for a board deliberately set
 * up the other way round.
 */
export const CIRCUITPY_READ_ONLY =
  "The board's filesystem is read-only to CircuitPython while its CIRCUITPY drive is mounted on this computer, so Snakie couldn't write the file. Snakie normally writes to that drive instead — check it is mounted and not ejected, then reconnect. (If you have made the board's filesystem writable with `storage.remount` in boot.py, the drive is hidden from this computer on purpose and this error means the remount did not take effect.)"

/** Does a device error say the filesystem was read-only? */
export function isReadOnlyFsError(raw: string): boolean {
  // Errno 30 is EROFS. MicroPython/CircuitPython render it variously — with the
  // name, with the number, or (on a minimal build) with neither, so match any.
  return /OSError:\s*(?:\[Errno\s*)?30\b|EROFS|read[- ]only\s+filesystem/i.test(raw)
}

/**
 * Rewrite a read-only filesystem failure into something a user can act on,
 * leaving every other error alone. The same shape as the `OSError: 28` → "the
 * board is full" translation in `driver-install.ts`.
 */
export function readOnlyFsError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err)
  return isReadOnlyFsError(message) ? new Error(CIRCUITPY_READ_ONLY) : err
}

/**
 * Map a DEVICE path (`/lib/foo.py`, always POSIX-ish, always rooted at the
 * board) onto the mounted drive.
 *
 * Throws rather than clamping when the result would escape the mount. Device
 * paths are not all typed by the user — a part's driver declares its own
 * `target` (#184) — so `../../` in one must not be able to write outside the
 * board's filesystem and onto the user's computer.
 */
export function resolveOnDrive(mount: string, devicePath: string): string {
  const cleaned = devicePath.replace(/^[/\\]+/, '')
  const full = normalize(join(mount, cleaned))
  const rel = relative(mount, full)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to use a path outside the board's drive: ${devicePath}`)
  }
  return full
}

/** List a directory on the drive, matching the REPL `listDir` shape. */
export async function driveListDir(mount: string, devicePath = '/'): Promise<DirEntry[]> {
  const dir = resolveOnDrive(mount, devicePath)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: DirEntry[] = []
  for (const e of entries) {
    // CircuitPython does not show these to the board, and they are noise in a
    // file tree: the FAT volume carries macOS/Windows indexing droppings.
    if (isHostDropping(e.name)) continue
    const isDir = e.isDirectory()
    let size = 0
    if (!isDir) {
      try {
        size = (await fs.stat(join(dir, e.name))).size
      } catch {
        size = 0 // a file that vanished between readdir and stat
      }
    }
    out.push({ name: e.name, isDir, size })
  }
  return out
}

/**
 * Files the HOST puts on the drive that the board itself never sees. Hiding
 * them keeps the Files panel showing the board's contents rather than macOS's
 * and Windows's bookkeeping.
 */
function isHostDropping(name: string): boolean {
  return (
    name === '.metadata_never_index' ||
    name === '.Trashes' ||
    name === '.fseventsd' ||
    name === 'System Volume Information' ||
    name.startsWith('._')
  )
}

/** Read a file from the drive as bytes. */
export async function driveReadFileBytes(mount: string, devicePath: string): Promise<Buffer> {
  return fs.readFile(resolveOnDrive(mount, devicePath))
}

/** The first line of a file starting with `prefix` — the drive twin of the
 *  on-board search in `readFileLine` (#700). No wire, so no need to be clever. */
export async function driveReadFileLine(
  mount: string,
  devicePath: string,
  prefix: string
): Promise<string> {
  let text: string
  try {
    text = await fs.readFile(resolveOnDrive(mount, devicePath), 'utf8')
  } catch {
    return '' // matches the REPL version, which swallows OSError
  }
  return text.split(/\r?\n/).find((l) => l.startsWith(prefix))?.trim() ?? ''
}

/**
 * Write a file to the drive, creating parent folders, and **flush it to the
 * device before returning**.
 *
 * The flush is load-bearing rather than cautious. CircuitPython watches the
 * filesystem and re-runs `code.py` the moment it changes, so a buffered write
 * can be picked up half-written — the board restarts into a syntax error from a
 * file that is fine on disk a millisecond later. `fsync` before close means the
 * board never sees a partial file.
 *
 * **Auto-reload is deliberately NOT suppressed** for a multi-file write (#755).
 * Suppressing it means setting `supervisor.runtime.autoreload = False` over the
 * raw REPL, and entering the raw REPL sends Ctrl-C — so the board's program gets
 * interrupted to spare it from being restarted, which is self-defeating.
 * CircuitPython already waits for the filesystem to settle before reloading, and
 * Snakie's multi-file writes are consecutive awaits against a local mount with
 * sub-millisecond gaps, so a batch lands inside one settle window and costs one
 * reload rather than one per file. If a real board ever shows otherwise, this is
 * the decision to revisit — and #751 is where the evidence would come from.
 */
export async function driveWriteFile(
  mount: string,
  devicePath: string,
  contents: string | Buffer
): Promise<void> {
  const full = resolveOnDrive(mount, devicePath)
  const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
  // `dirname`, not a separator search: on Windows the mount IS a drive root
  // (`E:\\`), and slicing at the last separator would yield `E:` — a different
  // path entirely. `recursive` makes the already-exists case a no-op.
  await fs.mkdir(dirname(full), { recursive: true })
  const handle = await fs.open(full, 'w')
  try {
    await handle.write(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Remove a file or a directory tree from the drive. */
export async function driveRemove(mount: string, devicePath: string): Promise<void> {
  await fs.rm(resolveOnDrive(mount, devicePath), { recursive: true, force: true })
}

/** Create a directory on the drive. */
export async function driveMkdir(mount: string, devicePath: string): Promise<void> {
  await fs.mkdir(resolveOnDrive(mount, devicePath))
}

/** Rename / move a path on the drive. */
export async function driveRename(mount: string, from: string, to: string): Promise<void> {
  await fs.rename(resolveOnDrive(mount, from), resolveOnDrive(mount, to))
}

/** Stat a path on the drive, matching the REPL `stat` shape. */
export async function driveStat(mount: string, devicePath: string): Promise<StatResult> {
  const st = await fs.stat(resolveOnDrive(mount, devicePath))
  return {
    isDir: st.isDirectory(),
    size: st.size,
    // Seconds since the epoch, as the board reports it — not milliseconds.
    mtime: Math.floor(st.mtimeMs / 1000)
  }
}

/**
 * Free/total bytes of the mounted drive, for the flash gauge (#211).
 *
 * Asked of the HOST rather than the board: `os.statvfs` on a CircuitPython board
 * reports a filesystem the board cannot write to, and the number a user wants
 * is how much room is left for the files Snakie is about to put there.
 */
export async function driveUsage(
  mount: string
): Promise<{ total: number; free: number; used: number } | null> {
  try {
    const st = await fs.statfs(mount)
    const total = Number(st.blocks) * Number(st.bsize)
    const free = Number(st.bavail) * Number(st.bsize)
    if (!Number.isFinite(total) || total <= 0) return null
    const clamped = Math.max(0, Math.min(free, total))
    return { total, free: clamped, used: total - clamped }
  } catch {
    return null // statfs is unavailable on some platforms/older Node
  }
}
