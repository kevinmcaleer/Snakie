import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { InstrumentWindowPayload } from '../shared/instrument-window'

/**
 * Detached instrument windows + IPC layer (issue #205).
 *
 * Undocking an instrument opens it as a TRUE, natively-resizable OS
 * `BrowserWindow` (the board.ts / find.ts precedent) instead of an in-renderer
 * floating overlay. One window per instrument, keyed by the payload `key`:
 *
 *   instruments:openWindow    (renderer → main, invoke)  open/focus + buffer payload
 *   instruments:closeWindow   (renderer → main, send)    close one window by key
 *   instruments:requestPayload(window → main, invoke)    pull this window's payload
 *   instruments:windowClosed  (main → main window, send)  {key} — window was closed
 *
 * The detached instrument renders from its buffered payload and reads the LIVE
 * device stream, which `device/ipc.ts` relays to every instrument window (see
 * {@link instrumentWindowWebContents}). The window's drag/resize is native; the
 * instrument fills it (see the `.instr-window` CSS), so the Plotter and scope
 * reflow via their existing ResizeObserver.
 */

/** Live instrument windows, keyed by payload.key. One per instrument. */
const windows = new Map<string, BrowserWindow>()
/** The latest payload per key, buffered so a freshly-opened window can pull it
 *  on mount (covers the open-time race, mirroring board.ts). */
const payloads = new Map<string, InstrumentWindowPayload>()
/** webContents.id → key, so `requestPayload` resolves which payload to return. */
const keyByWc = new Map<number, string>()

/** Create (or focus) the detached window for `payload.key`. */
function openInstrumentWindow(
  payload: InstrumentWindowPayload,
  getMainWindow: () => BrowserWindow | null
): void {
  payloads.set(payload.key, payload)

  const existing = windows.get(payload.key)
  if (existing && !existing.isDestroyed()) {
    // Already open → refresh its payload and focus it.
    existing.webContents.send('instruments:payload', payload)
    existing.focus()
    return
  }

  const window = new BrowserWindow({
    width: 460,
    height: 430,
    minWidth: 300,
    minHeight: 240,
    show: false,
    // Native OS chrome (#185 pattern) so the window is resizable and shows in the
    // OS Window menu.
    frame: true,
    alwaysOnTop: false,
    resizable: true,
    title: payload.title,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // Same rationale as the main window: the preload uses CommonJS require(),
      // which a sandboxed preload cannot load.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  windows.set(payload.key, window)
  // Capture the webContents id NOW: after the `closed` event the window's
  // `webContents` is destroyed, so reading `window.webContents.id` inside the
  // handler throws ("Object has been destroyed") — which previously killed the
  // handler before it could send the re-dock notification (the window closed but
  // never came back). Keep the id in a local instead.
  const wcId = window.webContents.id
  keyByWc.set(wcId, payload.key)

  window.on('ready-to-show', () => window.show())

  window.on('closed', () => {
    if (windows.get(payload.key) === window) windows.delete(payload.key)
    keyByWc.delete(wcId)
    payloads.delete(payload.key)
    // Tell the main renderer so it can re-dock the instrument.
    const mw = getMainWindow()
    if (mw && !mw.isDestroyed()) mw.webContents.send('instruments:windowClosed', { key: payload.key })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/instrument.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/instrument.html'))
  }
}

/** Every live instrument window's webContents (for the device-stream relay). */
export function instrumentWindowWebContents(): WebContents[] {
  const out: WebContents[] = []
  for (const w of windows.values()) {
    if (!w.isDestroyed()) out.push(w.webContents)
  }
  return out
}

/** Register the instrument-window IPC handlers. `getMainWindow` resolves the live
 *  editor window (the recipient of `instruments:windowClosed`). */
export function registerInstrumentWindowsIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('instruments:openWindow', (_e, payload: InstrumentWindowPayload) => {
    openInstrumentWindow(payload, getMainWindow)
  })

  ipcMain.on('instruments:closeWindow', (_e, key: string) => {
    const w = windows.get(key)
    // close() (not destroy()): graceful, non-blocking, and runs the renderer's
    // cleanup — matches the Board View / Find window precedent. The `closed`
    // handler then sends the re-dock notification.
    if (w && !w.isDestroyed()) w.close()
  })

  // A detached window pulls its payload on mount (covers the open-time race where
  // the initial push could land before the window's listener exists).
  ipcMain.handle('instruments:requestPayload', (e) => {
    const key = keyByWc.get(e.sender.id)
    return key ? (payloads.get(key) ?? null) : null
  })
}

/** Close every instrument window (called on quit). */
export function disposeInstrumentWindows(): void {
  for (const w of windows.values()) {
    if (!w.isDestroyed()) w.close()
  }
  windows.clear()
  payloads.clear()
  keyByWc.clear()
}
