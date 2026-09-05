import { BrowserWindow, ipcMain } from 'electron'

/**
 * Workspace relay + the session's project folder (#775).
 *
 * Two facts belong to the SESSION rather than to any one window, and until now
 * both were only reachable through the pop-out Board View window:
 *
 *   workspace:show       (any window → main → MAIN window)  switch workspace
 *   workspace:setFolder  (main window → main, send)         publish the folder
 *   workspace:folder     (any window → main, invoke)        read it back
 *   workspace:openFolder (app menu → MAIN window)           run Open Folder
 *
 * WHY A RELAY. The workspace switcher lives inside `AppShell`, in the main
 * window. A detached instrument (`instrumentWindows.ts`) or the board window has
 * no way to call it, so "take me to the Electronics workspace" has to cross the
 * process the way `board:open` already does. Every window sends the same
 * message; the main process forwards it to the main window, which owns the
 * switch. The main window hears its own message too, so there is one code path
 * whether the sender is docked or detached.
 *
 * WHY THE FOLDER LIVES HERE. Anything that writes `robot.yml` has to write the
 * SAME one the Board View edits, and `robot:load()` with no folder silently
 * falls back to `<userData>/robot.yml` — a different project. The I²C scanner
 * used to get the folder by opening the board window and polling
 * `board:requestSource` for the payload that streams once it is open: the folder
 * was a side effect of a window existing. It is a property of the session, so it
 * is published here whenever the main window's project changes and can be read
 * by any window at any time, with no window opened to fetch it.
 */

/** The open project folder, as last published by the main editor window.
 *  `undefined` = no folder open (the userData fallback, same as before). */
let projectFolder: string | undefined

/** Resolver for the main editor window, captured at IPC registration so the app
 *  menu can reach the renderer that owns the folder picker (#882). */
let resolveMainWindow: () => BrowserWindow | null = () => null

/**
 * Ask the main window to run its Open Folder action — the File menu item and its
 * Cmd/Ctrl-O accelerator (#882).
 *
 * The picker itself belongs to the renderer: `fs.openFolderDialog` is what turns
 * a chosen directory into the workspace's `currentFolder` (and remembers it for
 * the next launch), so raising a dialog from here would open a folder nothing was
 * listening for. The menu only pulls the trigger.
 */
export function requestOpenFolder(): void {
  const mw = resolveMainWindow()
  if (mw && !mw.isDestroyed()) mw.webContents.send('workspace:openFolder')
}

/** Register the workspace IPC. `getMainWindow` resolves the live editor window —
 *  the one that owns the workspace switcher. */
export function registerWorkspaceIpc(getMainWindow: () => BrowserWindow | null): void {
  resolveMainWindow = getMainWindow
  // Any window asks the MAIN window to show a workspace. Fire-and-forget: the
  // sender doesn't wait, and a request made while no main window exists is
  // simply dropped (there is nothing to switch).
  ipcMain.on('workspace:show', (_e, id: string) => {
    const mw = getMainWindow()
    if (mw && !mw.isDestroyed()) mw.webContents.send('workspace:show', id)
  })

  // The main window publishes its current project folder whenever it changes.
  ipcMain.on('workspace:setFolder', (_e, folder?: string) => {
    projectFolder = folder && folder.trim() ? folder : undefined
  })

  ipcMain.handle('workspace:folder', () => projectFolder ?? null)
}

/** Forget the published folder (used on quit / in tests). */
export function disposeWorkspace(): void {
  projectFolder = undefined
  resolveMainWindow = () => null
}
