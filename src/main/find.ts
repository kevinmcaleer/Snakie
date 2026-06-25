import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * Find & Replace window + IPC layer (issue #146).
 *
 * Find & Replace is a separate frameless, always-on-top OS `BrowserWindow` (not
 * an in-editor panel). It cannot reach the Monaco editor — that lives in the
 * MAIN window's renderer — so it drives find/replace over IPC, and the main
 * window replies with the match status:
 *
 *   find:open     (renderer → main, invoke)      open/focus the window
 *   find:close    (renderer → main, send)        close the window
 *   find:closed   (main → main window, send)      window was closed
 *   find:command  (find window → main → MAIN)     a find/replace request, relayed
 *   find:status   (MAIN → main → find window)     {matchIndex, matchCount}, relayed
 *
 * Mirrors the Board View window precedent (`src/main/board.ts`): a `send` from one
 * window is relayed by the main process to the OTHER window's webContents.
 */

/** The live Find & Replace window, or null when closed. One at a time. */
let findWindow: BrowserWindow | null = null

/** Create (or focus) the floating Find & Replace window. */
function openFindWindow(getMainWindow: () => BrowserWindow | null): void {
  if (findWindow && !findWindow.isDestroyed()) {
    findWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 520,
    height: 188,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    title: 'Find & Replace',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // Same rationale as the main window: the preload uses CommonJS require(),
      // which a sandboxed preload cannot load.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  findWindow = window

  window.on('ready-to-show', () => window.show())

  window.on('closed', () => {
    if (findWindow === window) findWindow = null
    // Tell the main renderer so it can reset its "find open" state.
    getMainWindow()?.webContents.send('find:closed')
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/find.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/find.html'))
  }
}

/**
 * Register the Find & Replace IPC handlers. `getMainWindow` resolves the live
 * editor window — both the relay target for find commands and the recipient of
 * the close notification.
 */
export function registerFindIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('find:open', () => {
    openFindWindow(getMainWindow)
  })

  ipcMain.on('find:close', () => {
    if (findWindow && !findWindow.isDestroyed()) findWindow.close()
  })

  // find window → MAIN window: relay a find/replace command to the editor.
  ipcMain.on('find:command', (_e, payload) => {
    getMainWindow()?.webContents.send('find:command', payload)
  })

  // MAIN window → find window: relay the resulting match status.
  ipcMain.on('find:status', (_e, payload) => {
    if (findWindow && !findWindow.isDestroyed()) {
      findWindow.webContents.send('find:status', payload)
    }
  })
}

/** Close the Find & Replace window (called on quit). */
export function disposeFind(): void {
  if (findWindow && !findWindow.isDestroyed()) findWindow.close()
  findWindow = null
}
