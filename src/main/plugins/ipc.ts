import { ipcMain } from 'electron'
import type { IpcResult } from '../device/types'
import { PluginHost } from './PluginHost'
import type {
  LintResult,
  MotionCheckResult,
  MotionReadResult,
  PluginContext,
  PluginListing,
  PluginStatus,
  RunCommandResult
} from './types'

/**
 * IPC for the Python plugin system (issue #61).
 *
 * A single {@link PluginHost} is kept for the process lifetime; it spawns the
 * user's `python3` running `snakie.host` and speaks newline-delimited JSON-RPC.
 * Handlers mirror the device/git/packages convention: each returns a
 * serializable {@link IpcResult} the preload unwraps into a value or thrown
 * Error.
 *
 * The no-Python case is NOT an error: `plugins:status` resolves with
 * `{ pythonFound:false, error }` so the panel can render a clear install
 * prompt. The host spawns lazily, so registering this layer never blocks app
 * startup or fails when Python is absent.
 */

/** Wrap an async op so errors cross IPC as serializable {@link IpcResult}. */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

let host: PluginHost | null = null

function getHost(): PluginHost {
  if (!host) host = new PluginHost()
  return host
}

/**
 * Register all `plugins:*` IPC handlers. Call once after the app is ready. The
 * host is created here but only spawns Python on first use.
 */
export function registerPluginsIpc(): void {
  const h = getHost()

  ipcMain.handle('plugins:status', () => wrap<PluginStatus>(() => h.status()))
  ipcMain.handle('plugins:list', () => wrap<PluginListing>(() => h.list()))
  ipcMain.handle('plugins:runCommand', (_e, commandId: string, context: PluginContext) =>
    wrap<RunCommandResult>(() => h.runCommand(commandId, context))
  )
  ipcMain.handle('plugins:lint', (_e, context: PluginContext) =>
    wrap<LintResult>(() => h.lint(context))
  )
  ipcMain.handle('plugins:reload', () => wrap<PluginStatus>(() => h.reload()))
  ipcMain.handle('plugins:motionRead', (_e, source: string) =>
    wrap<MotionReadResult>(() => h.motionRead(source))
  )
  ipcMain.handle('plugins:motionCheck', (_e, source: string) =>
    wrap<MotionCheckResult>(() => h.motionCheck(source))
  )
}

/** Dispose the shared plugin host (call on app quit). */
export async function disposePlugins(): Promise<void> {
  if (host) {
    await host.dispose()
    host = null
  }
}
