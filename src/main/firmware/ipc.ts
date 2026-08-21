/**
 * IPC wiring for the firmware-flashing layer (issue #14).
 *
 * Mirrors the device / fs layers: request channels are `firmware:*` and return
 * a serializable {@link IpcResult}; progress is delivered as `firmware:progress`
 * push events to the live renderer. Detection and flashing live in `detect.ts`
 * / `flasher.ts`, keeping this file to thin glue.
 */
import { dialog, ipcMain, BrowserWindow, type WebContents } from 'electron'
import type { FlashMethod } from '../../shared/board-profiles'
import type { FirmwareRuntime } from '../../shared/firmware-runtime'
import type { IpcResult } from '../device/types'
import { detectBoards } from './detect'
import { detectEsptool, flash } from './flasher'
import { fetchFirmwareCatalog } from './catalog'
import { downloadAndFlash } from './download'
import type {
  BoardCandidate,
  DownloadAndFlashOptions,
  EsptoolInfo,
  FirmwareCatalog,
  FlashOptions,
  FlashProgress,
  FlashResult
} from './types'

/** Renderer-facing channel names for the firmware layer. */
export const FIRMWARE_CHANNELS = {
  progress: 'firmware:progress',
  detect: 'firmware:detect',
  esptool: 'firmware:esptool',
  pickFile: 'firmware:pickFile',
  flash: 'firmware:flash',
  fetchCatalog: 'firmware:fetchCatalog',
  downloadAndFlash: 'firmware:downloadAndFlash'
} as const

/**
 * Wrap an async operation so any thrown error crosses IPC as a plain,
 * serializable {@link IpcResult}. Mirrors the device / fs layers' `wrap`.
 */
async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Register all `firmware:*` IPC handlers. Progress events are forwarded to
 * whichever renderer is currently live.
 *
 * @param getWindow resolver for the window (used to parent the file dialog and
 *   to route progress push-events), so we never capture a destroyed window.
 */
export function registerFirmwareIpc(getWindow: () => BrowserWindow | undefined): void {
  const sendProgress = (p: FlashProgress): void => {
    const wc: WebContents | undefined = getWindow()?.webContents
    if (wc && !wc.isDestroyed()) wc.send(FIRMWARE_CHANNELS.progress, p)
  }

  ipcMain.handle(FIRMWARE_CHANNELS.detect, () =>
    wrap<BoardCandidate[]>(() => detectBoards())
  )

  ipcMain.handle(FIRMWARE_CHANNELS.esptool, () => wrap<EsptoolInfo>(() => detectEsptool()))

  ipcMain.handle(FIRMWARE_CHANNELS.pickFile, (_e, method?: FlashMethod) =>
    wrap<string | null>(async () => {
      const win = getWindow()
      // Offer only what THIS board can actually be flashed with (#686). Showing
      // every firmware extension to everyone is how a `.uf2` got picked for an
      // ESP32-S3 — esptool wrote the container, reported success, and the board
      // boot-looped. The renderer still validates, but the dialog should not
      // present a file that cannot work in the first place.
      const forMethod: Record<FlashMethod, { name: string; ext: string }> = {
        esptool: { name: 'ESP firmware', ext: 'bin' },
        uf2: { name: 'UF2 firmware', ext: 'uf2' },
        daplink: { name: 'micro:bit firmware', ext: 'hex' }
      }
      const pick = method ? forMethod[method] : null
      const options: Electron.OpenDialogOptions = {
        title: 'Choose firmware file',
        properties: ['openFile'],
        filters: pick
          ? [{ name: pick.name, extensions: [pick.ext] }, { name: 'All files', extensions: ['*'] }]
          : [
              { name: 'Firmware', extensions: ['bin', 'uf2', 'hex'] },
              { name: 'All files', extensions: ['*'] }
            ]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })
  )

  ipcMain.handle(FIRMWARE_CHANNELS.flash, (_e, opts: FlashOptions) =>
    wrap<FlashResult>(() => flash(opts, sendProgress))
  )

  // `runtime` picks which set of catalogs to fetch — MicroPython's or
  // CircuitPython's (#756). Absent ⇒ MicroPython, so nothing that predates the
  // runtime choice changes behaviour.
  ipcMain.handle(FIRMWARE_CHANNELS.fetchCatalog, (_e, runtime?: FirmwareRuntime) =>
    wrap<FirmwareCatalog>(() => fetchFirmwareCatalog(runtime))
  )

  ipcMain.handle(FIRMWARE_CHANNELS.downloadAndFlash, (_e, opts: DownloadAndFlashOptions) =>
    wrap<FlashResult>(() => downloadAndFlash(opts, sendProgress))
  )
}
