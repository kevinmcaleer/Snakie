import { ipcMain } from 'electron'
import { compileFile, mpyCrossAvailable, mpyCrossVersion } from './compile'

/**
 * The `.py` → `.mpy` channel (#949).
 *
 * Two calls only: ask whether this build can compile at all, and compile one
 * file. `available` exists so the UI can say WHY the item is greyed rather than
 * offering something that fails when pressed — the web build has no main
 * process and therefore no compiler.
 */
export function registerMpyIpc(): void {
  ipcMain.handle('mpy:available', () => ({
    available: mpyCrossAvailable(),
    micropython: mpyCrossVersion()
  }))

  ipcMain.handle('mpy:compile', (_e, path: string) => compileFile(path))
}
