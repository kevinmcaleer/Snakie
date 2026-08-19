import { ipcMain } from 'electron'
import type { IpcResult } from '../device/types'
import { CURATED_PACKAGES } from '../../shared/packages/registry'
import { searchPackages } from '../../shared/packages/search'
import { installNotes, installTarget } from '../../shared/packages/install'
import { resolveFailureMessage } from '../../shared/install-messages'
import { httpMipFetch, MipResolveError, resolveMipSpec } from '../../shared/mip-resolve'
import type { InstallOptions, PackageInfo } from '../../shared/packages/types'

/**
 * IPC for the MicroPython package installer (issue #20, reworked by #776).
 *
 * ALL network access happens here in the main process — PyPI search because the
 * renderer's CSP forbids outbound requests, and now the package download too,
 * for a blunter reason: **the board has no internet connection**. The install
 * used to run `mip` ON THE DEVICE, which only ever worked on a WiFi board whose
 * firmware happened to include `mip`; a Tiny 2350 or a non-W Pico could never
 * do it at all.
 *
 * So `packages:install` resolves the package here and returns its FILES, and
 * the renderer writes them over the existing serialized device channel — the
 * same path `modules:installPlan` uses. We still don't reach into the device
 * singleton from here or touch the device IPC module.
 */

/** Payload returned by `packages:install` for the renderer to write. */
export interface InstallPlan {
  /** Every file to write to the device, parents-before-children. */
  files: { path: string; contents: string }[]
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

  // Install: download the package HERE and return its files + notes for the
  // renderer to write. Throwing with an already-composed, human-readable
  // message is deliberate — an Error crosses IPC as a bare string.
  ipcMain.handle('packages:install', (_e, name: string, options?: InstallOptions) =>
    wrap<InstallPlan>(async () => {
      const opts = options ?? {}
      const target = installTarget(opts)
      try {
        const resolved = await resolveMipSpec(name, {
          fetchText: httpMipFetch(),
          target,
          index: opts.index?.trim() || undefined
        })
        return {
          files: resolved.files.map((f) => ({ path: f.path, contents: f.contents })),
          notes: installNotes(opts)
        }
      } catch (err) {
        throw new Error(
          resolveFailureMessage({
            name,
            spec: name,
            kind: err instanceof MipResolveError ? err.kind : 'network',
            detail: err instanceof Error ? err.message : String(err)
          })
        )
      }
    })
  )
}
