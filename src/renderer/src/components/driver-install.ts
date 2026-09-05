/**
 * SHARED PART-DRIVER INSTALLER — the one sequence that puts a part's declared
 * {@link DriverFile} onto the connected board, used by BOTH the Board View's
 * Driver Install banner (#184) and the main editor's missing-library banner
 * (#166).
 *
 * Every route ends in the same place — files written to the board — because the
 * board has no internet connection of its own (#776). A `mip` spec is
 * downloaded by the package installer; a catalog `module:` id goes through the
 * module installer; anything else (a bundled filename or an http(s) URL) is
 * read via `parts.readDriverSource` in main (past the renderer CSP) and copied
 * to its target path, creating each ancestor folder first (MicroPython has no
 * recursive mkdir).
 *
 * Every route is QUEUED (#837). Two banners can be on screen at once for a fresh
 * board — the Board View's driver banner and the editor's missing-library banner
 * — and accepting both used to start both, each fighting the other for the port.
 * Wrapping the sequence here rather than at each banner means both callers (and
 * any future one) get the queue for free, and the board-is-busy modal names the
 * driver it is on.
 */
import { driverDeviceDirs, driverInstallMethod, driverModuleId } from './part-editor.util'
import { DeviceOperationCancelled, enqueueDeviceTask } from '../lib/device-queue'
import { moduleById } from '../../../shared/modules-catalog'
import {
  parsePurgeCount,
  purgeModuleSnippet,
  purgeNote,
  topLevelModuleName
} from '../../../shared/module-cache'
import type { DriverFile } from '../../../preload/index.d'

export interface DriverInstallResult {
  ok: boolean
  /** A short failure reason for the banner copy (undefined on success). */
  message?: string
  /**
   * Set when the board was still holding a stale copy of the module we just
   * installed, and we dropped it (#784). The banner shows this so a cache the
   * user never asked about is not cleared behind their back — and so the one
   * case that used to cost an hour of debugging now explains itself.
   */
  note?: string
  /**
   * The user cancelled the device queue while this driver was queued or running
   * (#837). A caller installing a LIST of drivers must stop on it: cancelling
   * and then watching the next install start is not a cancel.
   */
  cancelled?: boolean
}

/**
 * Drop the just-installed module from the board's `sys.modules` (#784).
 *
 * Runs after a SUCCESSFUL install, and is strictly best-effort: the files are
 * already written and correct, so nothing here may turn success into failure.
 * A board that cannot run the snippet simply gets the old behaviour, which is
 * why every failure path returns `undefined` rather than propagating.
 */
async function clearStaleModule(target: string): Promise<string | undefined> {
  const name = topLevelModuleName(target)
  if (!name) return undefined
  try {
    const out = await window.api.device.exec(purgeModuleSnippet(name))
    const text = typeof out === 'string' ? out : ((out as { output?: string })?.output ?? '')
    return purgeNote([name], parsePurgeCount(text))
  } catch {
    // No board, a busy REPL, a runtime without `sys.modules` — the install
    // still stands, and the user is no worse off than before this existed.
    return undefined
  }
}

/** Install ONE driver file onto the connected board. Never throws. */
export async function installPartDriver(
  libraryId: string,
  partId: string,
  d: DriverFile
): Promise<DriverInstallResult> {
  // Queued, and keyed by what it PUTS on the board rather than by which part
  // asked for it: two parts needing the same driver is the common case, and
  // installing it twice in a row is a round trip nobody benefits from.
  return enqueueDeviceTask({
    key: `driver:${d.source}->${d.target}`,
    label: `Installing ${d.label?.trim() || d.source}`,
    run: () => runDriverInstall(libraryId, partId, d)
  }).catch((err) => ({
    ok: false,
    message: err instanceof Error ? err.message : String(err),
    cancelled: err instanceof DeviceOperationCancelled
  }))
}

/** The install sequence itself — always run through the device queue above. */
async function runDriverInstall(
  libraryId: string,
  partId: string,
  d: DriverFile
): Promise<DriverInstallResult> {
  try {
    const method = driverInstallMethod(d.source)
    if (method === 'module') {
      // A catalog module (#638) — install it exactly as the Modules panel does,
      // so "already installed" and the install log mean the same thing whichever
      // route the user took.
      const id = driverModuleId(d.source)
      if (!moduleById(id)) {
        return { ok: false, message: `Unknown module "${id}" — it is not in the catalog.` }
      }
      const res = await window.api.modules.install(id)
      if (!res.ok) {
        return {
          ok: false,
          message: res.log?.split('\n').filter(Boolean).pop() || `Could not install ${id}.`
        }
      }
      return { ok: true, note: await clearStaleModule(d.target || id) }
    }
    if (method === 'mip') {
      const target = d.target.trim()
      const res = await window.api.packages.install(d.source, target ? { target } : undefined)
      if (!res.ok) {
        return {
          ok: false,
          message: res.log.split('\n').filter(Boolean).pop() || `Could not install ${d.source}.`
        }
      }
      return { ok: true, note: await clearStaleModule(target || d.source) }
    }
    // copy: read the file (bundled file or URL, via main) then write to target.
    const read = await window.api.parts.readDriverSource(libraryId, partId, d.source)
    if (!read.ok || read.contents == null) {
      return { ok: false, message: read.error || 'Could not read driver file.' }
    }
    // Pre-flight space check: if the file clearly won't fit, say so UP FRONT with the
    // exact numbers, rather than failing mid-write with a raw OSError 28. (Skipped when
    // the board can't report free space; the write's own catch still handles it.)
    const size = new TextEncoder().encode(read.contents).length
    const space = await window.api.device.df().catch(() => null)
    if (space && size > space.free) {
      const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))} KB`
      return {
        ok: false,
        message: `Not enough space on the board — ${d.target.trim()} needs ${kb(size)} but only ${kb(space.free)} is free. Free up space (delete files in the Files panel) or use a board with more flash storage.`
      }
    }
    // MicroPython has no recursive mkdir — create each ancestor folder in turn
    // (an "already exists" error is fine, so we swallow it).
    for (const dir of driverDeviceDirs(d.target)) {
      await window.api.device.mkdir(dir).catch(() => undefined)
    }
    await window.api.device.writeFile(d.target.trim(), read.contents)
    return { ok: true, note: await clearStaleModule(d.target) }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    // The board's MicroPython filesystem is full — OSError 28 (ENOSPC). Small boards
    // (e.g. the SAMD21 XIAO) have very little flash for the /lib filesystem. Surface
    // a clear reason instead of the raw device traceback.
    if (/OSError:\s*28\b|ENOSPC|No space left/i.test(raw)) {
      return {
        ok: false,
        message: `No space left on the board — its filesystem is full, so ${d.target.trim()} won't fit. Free up space (delete files in the Files panel) or use a board with more flash storage.`
      }
    }
    return { ok: false, message: raw }
  }
}
