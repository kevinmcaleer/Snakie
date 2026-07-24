/**
 * SHARED PART-DRIVER INSTALLER — the one sequence that puts a part's declared
 * {@link DriverFile} onto the connected board, used by BOTH the Board View's
 * Driver Install banner (#184) and the main editor's missing-library banner
 * (#166): a `mip` spec installs via the package manager; anything else (a
 * bundled filename or an http(s) URL) is read via `parts.readDriverSource` in
 * main (past the renderer CSP) and copied to its target path, creating each
 * ancestor folder first (MicroPython has no recursive mkdir).
 */
import { driverDeviceDirs, driverInstallMethod } from './part-editor.util'
import type { DriverFile } from '../../../preload/index.d'

export interface DriverInstallResult {
  ok: boolean
  /** A short failure reason for the banner copy (undefined on success). */
  message?: string
}

/** Install ONE driver file onto the connected board. Never throws. */
export async function installPartDriver(
  libraryId: string,
  partId: string,
  d: DriverFile
): Promise<DriverInstallResult> {
  try {
    if (driverInstallMethod(d.source) === 'mip') {
      const target = d.target.trim()
      const res = await window.api.packages.install(d.source, target ? { target } : undefined)
      return res.ok
        ? { ok: true }
        : { ok: false, message: res.log.split('\n').filter(Boolean).pop() || 'mip failed' }
    }
    // copy: read the file (bundled file or URL, via main) then write to target.
    const read = await window.api.parts.readDriverSource(libraryId, partId, d.source)
    if (!read.ok || read.contents == null) {
      return { ok: false, message: read.error || 'Could not read driver file.' }
    }
    // MicroPython has no recursive mkdir — create each ancestor folder in turn
    // (an "already exists" error is fine, so we swallow it).
    for (const dir of driverDeviceDirs(d.target)) {
      await window.api.device.mkdir(dir).catch(() => undefined)
    }
    await window.api.device.writeFile(d.target.trim(), read.contents)
    return { ok: true }
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
