import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Detached CONSOLE window (the bottom REPL, popped out).
 *
 * A single native-framed, resizable OS `BrowserWindow` that renders the same
 * xterm terminal as the docked console — bound to the device stream, which
 * `device/ipc.ts` relays to it (see {@link consoleWindowWebContents}). Input goes
 * back over the shared `device.sendData` channel, so the popped-out console is
 * fully interactive. Mirrors the Find / instrument window precedent:
 *
 *   console:open    (renderer → main, invoke)   open / focus the window
 *   console:close   (renderer → main, send)     close it (Redock)
 *   console:closed  (main → main window, send)   window closed → re-dock
 */

/** The live console window, or null when docked. One at a time. */
let consoleWindow: BrowserWindow | null = null

/** Create (or focus) the detached console window. */
function openConsoleWindow(getMainWindow: () => BrowserWindow | null): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 720,
    height: 420,
    minWidth: 360,
    minHeight: 180,
    show: false,
    // Native OS chrome (#185 pattern) so it's resizable + in the Window menu.
    frame: true,
    resizable: true,
    title: 'Console — Snakie',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // Same rationale as the main window: the preload uses CommonJS require(),
      // which a sandboxed preload cannot load.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  consoleWindow = window

  window.on('ready-to-show', () => window.show())

  window.on('closed', () => {
    if (consoleWindow === window) consoleWindow = null
    // Tell the main renderer so it re-docks the console.
    getMainWindow()?.webContents.send('console:closed')
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/console.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/console.html'))
  }
}

/** The console window's webContents (for the device-stream relay), or []. */
export function consoleWindowWebContents(): WebContents[] {
  return consoleWindow && !consoleWindow.isDestroyed() ? [consoleWindow.webContents] : []
}

/** Register the console-window IPC handlers. `getMainWindow` resolves the live
 *  editor window (the recipient of `console:closed`). */
export function registerConsoleWindowIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('console:open', () => {
    openConsoleWindow(getMainWindow)
  })

  ipcMain.on('console:close', () => {
    // close() (not destroy()): graceful; the `closed` handler re-docks.
    if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.close()
  })
}

/** Close the console window (called on quit). */
export function disposeConsoleWindow(): void {
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.close()
  consoleWindow = null
}
