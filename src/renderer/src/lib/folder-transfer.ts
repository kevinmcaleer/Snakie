/**
 * Walking a local folder and copying it to the board (#848).
 *
 * The DECISIONS — where each file lands, what gets skipped, what order
 * directories are made in — live in `shared/transfer-plan.ts`, which is pure and
 * tested. This module is the part that has to touch the disk and the board, and
 * it is deliberately thin: walk, then execute a plan someone else worked out.
 *
 * Progress is reported per FILE rather than per byte. `FsEntry` carries no size,
 * so a byte-accurate bar would mean a `stat` round trip for every file in the
 * tree before a single one was copied — paying a real cost up front to make a
 * bar smoother. The tick list the user sees is per-file anyway, so the two agree.
 */
import {
  planFolderUpload,
  shouldSkip,
  type LocalEntry,
  type TransferPlan
} from '../../../shared/transfer-plan'
import { writeAtomically, type AtomicOps } from '../../../shared/atomic-write'

/** What the progress dialog is told as a transfer runs. */
export interface TransferEvent {
  /** Index of the file just acted on, 0-based. */
  index: number
  /** How many files the whole transfer covers. */
  total: number
  /** The file's path relative to the folder being sent. */
  label: string
  /** `copying` when it starts, then one of the terminal two. */
  state: 'copying' | 'done' | 'error'
  /** Set when `state` is `error`. */
  error?: string
}

export type TransferReporter = (event: TransferEvent) => void

/** How deep a walk will go before giving up. */
const MAX_DEPTH = 24

/**
 * Flatten a local folder into the entries a plan is built from.
 *
 * Skipped names (`.git`, `__pycache__`, …) are dropped WITH their contents — a
 * skipped directory is never descended into, which is the whole point: the cost
 * of `.git` is its thousands of objects, not its name.
 *
 * `MAX_DEPTH` is a loop guard, not a policy. A symlink cycle on the host would
 * otherwise walk until the renderer runs out of memory, and no real board
 * project is twenty-four directories deep.
 */
export async function walkLocalFolder(root: string): Promise<LocalEntry[]> {
  const out: LocalEntry[] = []

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    const entries = await window.api.fs.readDir(dir)
    for (const entry of entries) {
      if (shouldSkip(entry.name, entry.isDir)) continue
      out.push({ path: entry.path, isDir: entry.isDir })
      if (entry.isDir) await visit(entry.path, depth + 1)
    }
  }

  await visit(root, 0)
  return out
}

/** Walk `localRoot` and work out everything that copying it into `deviceDir` means. */
export async function planUploadOf(localRoot: string, deviceDir: string): Promise<TransferPlan> {
  return planFolderUpload(localRoot, await walkLocalFolder(localRoot), deviceDir)
}

/**
 * Execute a plan: make the directories, then copy the files.
 *
 * Every file goes over the BYTES channel. A folder is not a `.py` file — it can
 * hold a font, a `.mpy`, an image — and the text channel round-trips through
 * UTF-8, which corrupts all three silently. Sending everything as bytes costs
 * nothing extra and removes a whole class of "it uploaded fine but the board
 * can't read it".
 *
 * An existing directory is not an error: `mkdir` raises `EEXIST` for one, and a
 * second upload into the same place is a normal thing to do.
 *
 * Stops at the first FILE that fails. A half-copied folder is bad, but carrying
 * on after a failure and reporting success at the end is worse — the user would
 * have a folder that looks complete and is not.
 */
/** {@link writeAtomically} over the renderer's device bridge (#864). */
const deviceAtomicOps: AtomicOps = {
  stat: (path) => window.api.device.stat(path),
  rename: (from, to) => window.api.device.rename(from, to),
  remove: (path) => window.api.device.remove(path)
}

export async function runFolderUpload(
  plan: TransferPlan,
  report: TransferReporter,
  isCancelled: () => boolean = () => false
): Promise<{ ok: boolean; error?: string; copied: number }> {
  for (const dir of plan.dirs) {
    if (isCancelled()) return { ok: false, error: 'Cancelled.', copied: 0 }
    try {
      await window.api.device.mkdir(dir)
    } catch {
      // Already there — the only failure this is allowed to swallow. A dir that
      // genuinely cannot be made surfaces on the first write into it.
    }
  }

  let copied = 0
  for (let i = 0; i < plan.files.length; i++) {
    if (isCancelled()) return { ok: false, error: 'Cancelled.', copied }
    const file = plan.files[i]
    report({ index: i, total: plan.files.length, label: file.label, state: 'copying' })
    try {
      const bytes = await window.api.fs.readFileBytes(file.local)
      // All-or-nothing (#864): the same reason the driver installer does it.
      // Stopping mid-file used to leave a truncated file under its real name,
      // which for a .py is a SyntaxError somewhere nobody will think to look.
      await writeAtomically(deviceAtomicOps, file.device, bytes.length, (tmp) =>
        window.api.device.writeFileBytes(tmp, bytes)
      )
      copied++
      report({ index: i, total: plan.files.length, label: file.label, state: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      report({
        index: i,
        total: plan.files.length,
        label: file.label,
        state: 'error',
        error: message
      })
      return { ok: false, error: `${file.label}: ${message}`, copied }
    }
  }
  return { ok: true, copied }
}
