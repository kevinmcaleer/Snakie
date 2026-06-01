import { ipcMain, type WebContents } from 'electron'
import { MicroPythonDevice } from './MicroPythonDevice'
import type { ConnectOptions, DeviceStatus, IpcResult } from './types'

/**
 * IPC channel names for the device layer. Renderer-facing channels are prefixed
 * `device:` for the push events the renderer subscribes to.
 */
export const DEVICE_CHANNELS = {
  data: 'device:data',
  status: 'device:status'
} as const

/**
 * A single shared {@link MicroPythonDevice} instance. The app talks to one
 * board at a time; later issues can extend this to a registry keyed by path.
 */
let device: MicroPythonDevice | null = null

function getDevice(): MicroPythonDevice {
  if (!device) device = new MicroPythonDevice()
  return device
}

/**
 * Wrap an async operation so any thrown error crosses IPC as a plain,
 * serializable {@link IpcResult} rather than relying on Electron's lossy error
 * propagation.
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Register all `device:*` IPC handlers and begin forwarding device events to
 * the given renderer. Call once from the main process after the window exists.
 *
 * @param getWebContents resolver for the target renderer (so we don't capture a
 *   destroyed window after reloads).
 */
export function registerDeviceIpc(getWebContents: () => WebContents | undefined): void {
  const dev = getDevice()

  // Forward raw serial output and status changes to the renderer.
  dev.on('data', (chunk) => {
    const wc = getWebContents()
    if (wc && !wc.isDestroyed()) {
      // Send as a Uint8Array; it survives structured clone across IPC.
      wc.send(DEVICE_CHANNELS.data, new Uint8Array(chunk))
    }
  })
  dev.on('status', (status: DeviceStatus) => {
    const wc = getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send(DEVICE_CHANNELS.status, status)
    }
  })

  ipcMain.handle('device:listPorts', () => wrap(() => MicroPythonDevice.listPorts()))

  ipcMain.handle('device:connect', (_e, path: string, opts?: ConnectOptions) =>
    wrap(() => dev.connect(path, opts ?? {}))
  )

  ipcMain.handle('device:disconnect', () => wrap(() => dev.disconnect()))

  ipcMain.handle('device:getStatus', () => wrap(async () => dev.getStatus()))

  ipcMain.handle('device:exec', (_e, code: string) => wrap(() => dev.exec(code)))

  ipcMain.handle('device:eval', (_e, code: string) => wrap(() => dev.eval(code)))

  ipcMain.handle('device:interrupt', () => wrap(() => dev.interrupt()))

  ipcMain.handle('device:softReset', () => wrap(() => dev.softReset()))

  // Filesystem helpers.
  ipcMain.handle('device:listDir', (_e, path?: string) => wrap(() => dev.listDir(path ?? '/')))

  ipcMain.handle('device:readFile', (_e, path: string) => wrap(() => dev.readFile(path)))

  ipcMain.handle('device:writeFile', (_e, path: string, contents: string) =>
    wrap(() => dev.writeFile(path, contents))
  )

  ipcMain.handle('device:remove', (_e, path: string) => wrap(() => dev.remove(path)))

  ipcMain.handle('device:mkdir', (_e, path: string) => wrap(() => dev.mkdir(path)))

  ipcMain.handle('device:rename', (_e, from: string, to: string) =>
    wrap(() => dev.rename(from, to))
  )

  ipcMain.handle('device:stat', (_e, path: string) => wrap(() => dev.stat(path)))
}

/** Dispose the shared device (call on app quit). */
export async function disposeDevice(): Promise<void> {
  if (device) {
    await device.dispose()
    device = null
  }
}
