import { ipcMain, type WebContents } from 'electron'
import { isVirtualPort, VIRTUAL_PORT_PATH, VIRTUAL_PORT_LABEL } from '../../shared/virtual-device'
import { MicroPythonDevice } from './MicroPythonDevice'
import { SimulatedDevice } from './SimulatedDevice'
import { instrumentWindowWebContents } from '../instrumentWindows'
import type { ConnectOptions, DeviceStatus, IpcResult, PortInfo, SnakieDevice } from './types'

/**
 * IPC channel names for the device layer. Renderer-facing channels are prefixed
 * `device:` for the push events the renderer subscribes to.
 */
export const DEVICE_CHANNELS = {
  data: 'device:data',
  status: 'device:status'
} as const

/**
 * The device layer routes between two backends (issue #135):
 *  - {@link MicroPythonDevice} — a real board over serial,
 *  - {@link SimulatedDevice}   — the offline/virtual board.
 *
 * Both implement {@link SnakieDevice} and emit the same `data` / `status`
 * events. `active` is whichever the user last connected to (default: the real
 * device, so a fresh launch behaves exactly as before). `device:connect` picks
 * the backend from the selected port and disconnects the other first, so the two
 * never run at once.
 */
let real: MicroPythonDevice | null = null
let sim: SimulatedDevice | null = null
let active: SnakieDevice | null = null

function getReal(): MicroPythonDevice {
  if (!real) real = new MicroPythonDevice()
  return real
}

function getSim(): SimulatedDevice {
  if (!sim) sim = new SimulatedDevice()
  return sim
}

/** The currently-targeted backend (defaults to the real serial device). */
function getActive(): SnakieDevice {
  if (!active) active = getReal()
  return active
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
  const realDev = getReal()
  const simDev = getSim()

  // Forward raw output and status from BOTH backends; only the connected one
  // ever emits, so there is no cross-talk between real and simulated devices.
  // Detached instrument windows (#205) also receive the stream so a floated
  // scope/plotter/robotics panel stays live in its own OS window.
  const broadcast = (channel: string, payload: unknown): void => {
    const main = getWebContents()
    if (main && !main.isDestroyed()) main.send(channel, payload)
    for (const wc of instrumentWindowWebContents()) wc.send(channel, payload)
  }
  const forward = (dev: SnakieDevice): void => {
    // Send as a Uint8Array; it survives structured clone across IPC.
    dev.on('data', (chunk) => broadcast(DEVICE_CHANNELS.data, new Uint8Array(chunk)))
    dev.on('status', (status: DeviceStatus) => broadcast(DEVICE_CHANNELS.status, status))
  }
  forward(realDev)
  forward(simDev)

  // Real serial ports, plus the built-in simulated device so users can work
  // offline (#135). The virtual port is appended so real hardware lists first.
  ipcMain.handle('device:listPorts', () =>
    wrap(async () => {
      const ports = await MicroPythonDevice.listPorts()
      const virtual: PortInfo = { path: VIRTUAL_PORT_PATH, friendlyName: VIRTUAL_PORT_LABEL }
      return [...ports, virtual]
    })
  )

  ipcMain.handle('device:connect', (_e, path: string, opts?: ConnectOptions) =>
    wrap(async () => {
      if (isVirtualPort(path)) {
        // Switch to the simulated board, disconnecting any real one first.
        if (realDev.isConnected()) await realDev.disconnect()
        active = simDev
        await simDev.connect()
      } else {
        // Switch to the real board, stopping the simulator first.
        if (simDev.isConnected()) await simDev.disconnect()
        active = realDev
        await realDev.connect(path, opts ?? {})
      }
    })
  )

  ipcMain.handle('device:disconnect', () => wrap(() => getActive().disconnect()))

  ipcMain.handle('device:getStatus', () => wrap(async () => getActive().getStatus()))

  ipcMain.handle('device:exec', (_e, code: string) => wrap(() => getActive().exec(code)))

  ipcMain.handle('device:eval', (_e, code: string) => wrap(() => getActive().eval(code)))

  ipcMain.handle('device:sendData', (_e, data: string) => wrap(() => getActive().sendData(data)))

  // IDE→board control line (issue #115): `SNKCMD <target> <payload>\n`.
  ipcMain.handle('device:sendControl', (_e, target: string, payload?: string) =>
    wrap(() => getActive().sendControl(target, payload ?? ''))
  )

  ipcMain.handle('device:interrupt', () => wrap(() => getActive().interrupt()))

  ipcMain.handle('device:softReset', () => wrap(() => getActive().softReset()))

  // Filesystem helpers.
  ipcMain.handle('device:listDir', (_e, path?: string) => wrap(() => getActive().listDir(path ?? '/')))

  ipcMain.handle('device:readFile', (_e, path: string) => wrap(() => getActive().readFile(path)))

  ipcMain.handle('device:writeFile', (_e, path: string, contents: string) =>
    wrap(() => getActive().writeFile(path, contents))
  )

  ipcMain.handle('device:remove', (_e, path: string) => wrap(() => getActive().remove(path)))

  ipcMain.handle('device:mkdir', (_e, path: string) => wrap(() => getActive().mkdir(path)))

  ipcMain.handle('device:rename', (_e, from: string, to: string) =>
    wrap(() => getActive().rename(from, to))
  )

  ipcMain.handle('device:stat', (_e, path: string) => wrap(() => getActive().stat(path)))
}

/** Dispose both device backends (call on app quit). */
export async function disposeDevice(): Promise<void> {
  if (real) {
    await real.dispose()
    real = null
  }
  if (sim) {
    await sim.dispose()
    sim = null
  }
  active = null
}
