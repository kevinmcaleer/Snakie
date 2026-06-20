import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'
import { is } from '@electron-toolkit/utils'
import type { BoardDefinition } from '../shared/board'

/**
 * Board View window + IPC layer.
 *
 * The Board View is a separate frameless, always-on-top OS `BrowserWindow` (not
 * an in-app modal). The main editor renderer relays the active file to it over
 * IPC so it updates live:
 *
 *   board:open          (renderer → main, invoke)  open/focus the window
 *   board:close         (renderer → main, send)    close the window
 *   board:update        (renderer → main, send)    relay {source,fileName,...}
 *   board:source        (main → board window, send) the relayed payload
 *   board:closed        (main → main window, send)  window was closed
 *   board:listUserBoards(renderer → main, invoke)  user JSON board defs
 *   board:openBoardsFolder (renderer → main, invoke) reveal the boards folder
 *
 * User-authored boards live as JSON at `<userData>/boards/*.json` (same shape
 * as {@link BoardDefinition}); they are read HERE (the renderer has no fs) and
 * merged with the compiled-in built-ins by the board window.
 */

/** The live Board View window, or null when closed. One at a time. */
let boardWindow: BrowserWindow | null = null

/** Absolute path to the user's boards folder (`<userData>/boards`). */
function boardsDir(): string {
  return join(app.getPath('userData'), 'boards')
}

/** Read + parse every `*.json` in the boards folder, skipping bad files. */
async function readUserBoards(): Promise<BoardDefinition[]> {
  const dir = boardsDir()
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    // Folder doesn't exist yet → no user boards.
    return []
  }
  const out: BoardDefinition[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue
    try {
      const raw = await fsp.readFile(join(dir, name), 'utf-8')
      const def = JSON.parse(raw) as BoardDefinition
      // Minimal validation: needs an id + headers array to draw anything.
      if (def && typeof def.id === 'string' && Array.isArray(def.headers)) {
        out.push(def)
      } else {
        console.warn(`[board] skipping ${name}: missing id/headers`)
      }
    } catch (err) {
      console.warn(`[board] skipping ${name}: ${(err as Error).message}`)
    }
  }
  return out
}

/** Create (or focus) the floating Board View window. */
function openBoardWindow(getMainWindow: () => BrowserWindow | null): void {
  if (boardWindow && !boardWindow.isDestroyed()) {
    boardWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 760,
    height: 680,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    title: 'Board View',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // Same rationale as the main window: the preload uses CommonJS require(),
      // which a sandboxed preload cannot load.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  boardWindow = window

  window.on('ready-to-show', () => window.show())

  window.on('closed', () => {
    if (boardWindow === window) boardWindow = null
    // Tell the main renderer so it can reset its "board open" state.
    getMainWindow()?.webContents.send('board:closed')
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/board.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/board.html'))
  }
}

/**
 * Register the Board View IPC handlers. `getMainWindow` resolves the live
 * editor window (used to notify it when the board window closes).
 */
export function registerBoardIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('board:open', () => {
    openBoardWindow(getMainWindow)
  })

  // Close the window from the renderer (its own ✕/Esc, or the toolbar toggle).
  // The window's own `closed` handler resets state + notifies the main renderer.
  ipcMain.on('board:close', () => {
    if (boardWindow && !boardWindow.isDestroyed()) boardWindow.close()
  })

  // Relay the active-file snapshot from the main renderer to the board window.
  ipcMain.on('board:update', (_e, payload) => {
    if (boardWindow && !boardWindow.isDestroyed()) {
      boardWindow.webContents.send('board:source', payload)
    }
  })

  ipcMain.handle('board:listUserBoards', () => readUserBoards())

  ipcMain.handle('board:openBoardsFolder', async () => {
    const dir = boardsDir()
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch {
      // Best effort — still try to reveal it.
    }
    await shell.openPath(dir)
  })
}

/** Close the Board View window (called on quit). */
export function disposeBoard(): void {
  if (boardWindow && !boardWindow.isDestroyed()) boardWindow.close()
  boardWindow = null
}
