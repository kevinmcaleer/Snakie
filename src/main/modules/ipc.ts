import { ipcMain, BrowserWindow } from 'electron'
import type { IpcResult } from '../device/types'
import { MODULES, type ModuleDef } from '../../shared/modules-catalog'
import { planForId, type ModulePlanRequest, type ModuleInstallPlan } from './resolve'

/**
 * IPC for the per-module installer (issue #120).
 * =============================================================================
 *
 * The "modular installs" subsystem: install ONLY the driver behind the
 * instrument a robot uses, instead of every driver. Like the packages layer
 * (#20), the privileged / offline-reasoning part runs HERE in main —
 * enumerating the catalog and composing a per-module {@link ModuleInstallPlan}
 * (reading a bundled `.py` off disk, or building a `mip` snippet) — and the
 * renderer performs the actual device write/exec over its existing serialized
 * `device:*` channel. So this module never reaches into the device singleton.
 *
 * Mirrors `registerPackagesIpc`: no push events ⇒ no window resolver.
 */

/**
 * Wrap an async operation so any thrown error crosses IPC as a plain,
 * serializable {@link IpcResult}. Mirrors the device/fs/packages `wrap` helper.
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Register all `modules:*` IPC handlers. Call once from the main process after
 * the app is ready.
 */
export function registerModulesIpc(): void {
  // Catalog discovery: the full module registry (offline-safe). The renderer
  // groups it by instrument for the Modules manager.
  ipcMain.handle('modules:catalog', () => wrap<ModuleDef[]>(async () => MODULES))

  // Resolve a single module to its install plan (bundled file contents, a mip
  // snippet, or — when the board has no `mip` (#776) — the package's files,
  // downloaded HERE because the renderer's CSP forbids outbound requests) for
  // the renderer to execute over the device channel.
  //
  // The capabilities come IN rather than being read from the device: this layer
  // still never touches the device singleton (see the header), and the preload
  // already holds the probed status it needs to answer.
  ipcMain.handle('modules:installPlan', (_e, id: string, request?: ModulePlanRequest) =>
    wrap<ModuleInstallPlan>(async () =>
      // `fetchText` can only ever be injected in-process (a function does not
      // cross IPC); drop whatever arrived so the handler always uses the real one.
      planForId(id, { caps: request?.caps, runtime: request?.runtime })
    )
  )

  // A driver/library was installed onto the board from SOME window (e.g. the Board
  // View's Driver Install banner copies a file; the main window's Parts banner
  // mip-installs). Fan the event to EVERY window so their "needs a driver" /
  // "missing library" banners re-probe the board and clear once it's present —
  // otherwise a driver installed in the board window leaves the main window's
  // probe stale (it only re-probes on connect / its own install).
  ipcMain.on('modules:changed', () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('modules:didChange')
    }
  })
}
