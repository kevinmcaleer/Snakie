import { dialog, ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { IpcResult } from '../device/types'
import type { FsEntry, FsStat } from './types'

/**
 * Wrap an async filesystem operation so any thrown error crosses IPC as a
 * plain, serializable {@link IpcResult} rather than relying on Electron's lossy
 * error propagation. Mirrors the device layer's `wrap` helper exactly.
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Read a directory and return its entries, directories first then files. */
async function readDir(path: string): Promise<FsEntry[]> {
  const dirents = await fs.readdir(path, { withFileTypes: true })
  const entries: FsEntry[] = dirents.map((d) => ({
    name: d.name,
    path: join(path, d.name),
    isDir: d.isDirectory()
  }))
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

async function stat(path: string): Promise<FsStat> {
  const s = await fs.stat(path)
  return { isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs }
}

/**
 * Register all `fs:*` IPC handlers for the local filesystem layer. Call once
 * from the main process after the app is ready.
 *
 * @param getWindow resolver for the window used to parent the folder dialog.
 */
export function registerFsIpc(getWindow: () => BrowserWindow | undefined): void {
  ipcMain.handle('fs:openFolderDialog', () =>
    wrap(async () => {
      const win = getWindow()
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
  )

  ipcMain.handle('fs:readDir', (_e, path: string) => wrap(() => readDir(path)))

  ipcMain.handle('fs:readFile', (_e, path: string) => wrap(() => fs.readFile(path, 'utf-8')))

  ipcMain.handle('fs:writeFile', (_e, path: string, contents: string) =>
    wrap(async () => {
      await fs.writeFile(path, contents, 'utf-8')
    })
  )

  ipcMain.handle('fs:mkdir', (_e, path: string) =>
    wrap(async () => {
      await fs.mkdir(path, { recursive: true })
    })
  )

  ipcMain.handle('fs:rename', (_e, from: string, to: string) =>
    wrap(async () => {
      await fs.rename(from, to)
    })
  )

  ipcMain.handle('fs:remove', (_e, path: string) =>
    wrap(async () => {
      await fs.rm(path, { recursive: true, force: true })
    })
  )

  ipcMain.handle('fs:stat', (_e, path: string) => wrap(() => stat(path)))
}
