import { ipcMain } from 'electron'
import type { IpcResult } from '../device/types'
import { CURATED_PACKAGES } from './registry'
import { searchPackages } from './search'
import { buildInstallSnippet, installNotes } from './install'
import type { InstallOptions, PackageInfo } from './types'

/**
 * IPC for the MicroPython package installer (issue #20).
 *
 * All NETWORK access (PyPI search) happens here in the main process because the
 * renderer's CSP forbids outbound requests. The actual install runs `mip` ON
 * THE DEVICE, which is only reachable through the serial layer the renderer
 * drives via `window.api.device.exec`. So `packages:install` does the
 * privileged/offline-reasoning part — composing the `mip` snippet and computing
 * non-fatal NOTES — and returns both for the renderer to run over the existing
 * serialized device channel. Keeping it this way means we don't reach into the
 * device singleton from here and don't touch the device IPC module.
 */

/** Payload returned by `packages:install` for the renderer to execute. */
export interface InstallPlan {
  /** Python snippet to run on the device via `device.exec`. */
  snippet: string
  /** Non-fatal notes (e.g. the `.mpy` caveat) to surface in the UI. */
  notes: string[]
}

/**
 * Wrap an async operation so any thrown error crosses IPC as a plain,
 * serializable {@link IpcResult}. Mirrors the device/fs layers' `wrap` helper.
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Register all `packages:*` IPC handlers. Call once from the main process after
 * the app is ready. There are no push events to route, so unlike the device
 * layer this takes no window resolver.
 */
export function registerPackagesIpc(): void {
  // Discovery: the curated starter set (offline-safe). Returned as-is.
  ipcMain.handle('packages:topPackages', () =>
    wrap<PackageInfo[]>(async () => CURATED_PACKAGES)
  )

  // Search: PyPI JSON API + curated matches, brokered here past the CSP.
  ipcMain.handle('packages:search', (_e, query: string) =>
    wrap<PackageInfo[]>(() => searchPackages(query ?? ''))
  )

  // Install: build the device snippet + notes for the renderer to execute.
  ipcMain.handle('packages:install', (_e, name: string, options?: InstallOptions) =>
    wrap<InstallPlan>(async () => ({
      snippet: buildInstallSnippet(name, options ?? {}),
      notes: installNotes(options ?? {})
    }))
  )
}
