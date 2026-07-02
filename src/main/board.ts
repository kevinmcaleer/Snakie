import { app, shell, BrowserWindow, ipcMain, type WebContents } from 'electron'
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
 *   board:requestSource (board window → main, invoke) pull the buffered payload
 *   board:closed        (main → main window, send)  window was closed
 *   board:listUserBoards(renderer → main, invoke)  user JSON board defs
 *   board:openBoardsFolder (renderer → main, invoke) reveal the boards folder
 *   board:saveUserBoard (renderer → main, invoke)  write a board def to disk
 *   board:deleteUserBoard(renderer → main, invoke) delete a user board file
 *   instruments:open    (board window → main, send) relayed verbatim ↓
 *   instruments:open    (main → MAIN window, send)  open/reveal a scope/meter
 *
 * INSTRUMENT LAUNCH RELAY (#101 / #102): the Oscilloscope + Multimeter are now
 * hosted in the MAIN editor window (above the code), but their launch buttons
 * live on the board-view window's nodes. The board window `send`s an
 * `instruments:open` payload (`{kind, conn}` — the FULL parsed connection); the
 * main process relays it verbatim to the MAIN window, which renders the
 * instrument straight from `conn` (self-contained, no re-parse of its own active
 * file) and mounts/reveals it. It rides this module because `getMainWindow` (the
 * relay target) is already wired here.
 *
 * User-authored boards live as JSON at `<userData>/boards/*.json` (same shape
 * as {@link BoardDefinition}); they are read HERE (the renderer has no fs) and
 * merged with the compiled-in built-ins by the board window. The Board Creator
 * (issue #94) authors them visually and persists via the save/delete handlers.
 */

/** The live Board View window, or null when closed. One at a time. */
let boardWindow: BrowserWindow | null = null

/**
 * The most recent active-file snapshot relayed via `board:update`. Buffered so a
 * freshly-opened window can PULL it on mount (`board:requestSource`): the initial
 * push from `board:open` can arrive before the board renderer has registered its
 * `board:source` listener, so without this the window would sit blank until the
 * next edit.
 */
let lastBoardPayload: unknown = null

/** Absolute path to the user's boards folder (`<userData>/boards`). */
function boardsDir(): string {
  return join(app.getPath('userData'), 'boards')
}

/**
 * Sanitise a board id into a safe filename stem: lower-case, keep only
 * `[a-z0-9-_]`, collapse the rest to `-`. Prevents path traversal / odd
 * filenames when writing `<userData>/boards/<id>.json`.
 */
function sanitiseId(id: string): string {
  return String(id)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
    width: 980,
    height: 720,
    // A floor so the header's non-shrinkable budget (grip + view tabs +
    // picker-min + actions, ~680px with the Node graph/Life-like/Schematic tabs)
    // never overflows.
    minWidth: 720,
    minHeight: 440,
    show: false,
    // Native window chrome (#185): a standard OS title bar with close/min/max so
    // the window shows in the OS Window menu and is accessible (the in-app close
    // ✕ was removed in favour of the native one). The styled header sits below it.
    frame: true,
    alwaysOnTop: false,
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

/** Resolver for the main editor window, captured at IPC registration so the
 *  app menu's "Board View" item can open/focus the board window too (#185). */
let resolveMainWindow: () => BrowserWindow | null = () => null

/**
 * Open (or focus) the Board View window and tell the main renderer it's open.
 * Shared by the `board:open` IPC and the application menu's Window item so any
 * entry point streams the active file (mini-board open used to leave it blank).
 */
export function openBoardView(): void {
  openBoardWindow(resolveMainWindow)
  resolveMainWindow()?.webContents.send('board:opened')
}

/**
 * The Board View window's webContents (for the device-stream relay), or `[]`.
 * The board view is a separate OS window, so it must be added to the device
 * broadcast — otherwise components there (e.g. the Driver Install banner's
 * connection gate, `useDeviceStatus`) only see the status snapshot from mount
 * and miss a board connected/disconnected AFTER the window opened.
 */
export function boardWindowWebContents(): WebContents[] {
  return boardWindow && !boardWindow.isDestroyed() ? [boardWindow.webContents] : []
}

/**
 * Register the Board View IPC handlers. `getMainWindow` resolves the live
 * editor window (used to notify it when the board window closes).
 */
export function registerBoardIpc(getMainWindow: () => BrowserWindow | null): void {
  resolveMainWindow = getMainWindow
  ipcMain.handle('board:open', () => openBoardView())

  // Close the window from the renderer (its own ✕/Esc, or the toolbar toggle).
  // The window's own `closed` handler resets state + notifies the main renderer.
  ipcMain.on('board:close', () => {
    if (boardWindow && !boardWindow.isDestroyed()) boardWindow.close()
  })

  // Relay the active-file snapshot from the main renderer to the board window,
  // and buffer it so a freshly-opened window can pull the latest on mount.
  ipcMain.on('board:update', (_e, payload) => {
    lastBoardPayload = payload
    if (boardWindow && !boardWindow.isDestroyed()) {
      boardWindow.webContents.send('board:source', payload)
    }
  })

  // The board window pulls the latest snapshot on mount (covers the open-time
  // race where the first push lands before its `board:source` listener exists).
  ipcMain.handle('board:requestSource', () => lastBoardPayload)

  // Relay a board-window instrument launch to the MAIN window, which hosts the
  // scope/meter and resolves the variable against its own active file (#101/#102).
  ipcMain.on('instruments:open', (_e, payload) => {
    getMainWindow()?.webContents.send('instruments:open', payload)
  })

  // Relay a board selection to every OTHER window so the full Board Viewer and the
  // main window's mini board view agree on the chosen board. Echo is skipped (the
  // sender already updated its own state).
  ipcMain.on('board:select', (e, id: string) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && w.webContents.id !== e.sender.id) {
        w.webContents.send('board:select', id)
      }
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

  // Save a board definition (from the Board Creator) to disk as pretty JSON.
  // Returns a serializable {ok,error} result and NEVER throws across IPC.
  ipcMain.handle('board:saveUserBoard', async (_e, def: BoardDefinition) => {
    try {
      // Minimal validation (mirrors readUserBoards' load-time check).
      if (!def || typeof def.id !== 'string' || !Array.isArray(def.headers)) {
        return { ok: false, error: 'A board needs a string id and a headers array.' }
      }
      const id = sanitiseId(def.id)
      if (!id) return { ok: false, error: 'Board id is empty after sanitising.' }
      const dir = boardsDir()
      await fsp.mkdir(dir, { recursive: true })
      // Persist the sanitised id so the file name and the def agree.
      const toWrite: BoardDefinition = { ...def, id }
      await fsp.writeFile(join(dir, `${id}.json`), JSON.stringify(toWrite, null, 2), 'utf-8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // Delete a user board file if present (used by the creator's delete action).
  // Never throws — a missing file is treated as already-deleted.
  ipcMain.handle('board:deleteUserBoard', async (_e, id: string) => {
    try {
      const safe = sanitiseId(id)
      if (!safe) return
      await fsp.unlink(join(boardsDir(), `${safe}.json`))
    } catch {
      // No such file / already gone → success.
    }
  })
}

/** Close the Board View window (called on quit). */
export function disposeBoard(): void {
  if (boardWindow && !boardWindow.isDestroyed()) boardWindow.close()
  boardWindow = null
}
