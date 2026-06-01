import { app, ipcMain, type WebContents } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * IPC channel names for the auto-update layer. The renderer subscribes to
 * `updates:status` push events and invokes the `updates:*` request channels.
 */
export const UPDATE_CHANNELS = {
  status: 'updates:status',
  check: 'updates:check',
  quitAndInstall: 'updates:quitAndInstall'
} as const

/**
 * A single update-lifecycle status, pushed to the renderer on the
 * `updates:status` channel. `state` drives what (if anything) the in-app
 * notifier shows; the optional fields carry context for the matching state.
 */
export interface UpdateStatus {
  state: 'available' | 'downloading' | 'downloaded' | 'error'
  /** Version of the available/downloaded update, when known. */
  version?: string
  /** Download progress 0–100, present while `state === 'downloading'`. */
  percent?: number
  /** Human-readable message, present when `state === 'error'`. */
  message?: string
}

/**
 * Wire up `electron-updater` and forward its lifecycle events to the renderer
 * as {@link UpdateStatus} pushes. Updates are distributed via GitHub Releases
 * (see `electron-builder.yml` `publish` / the packaged `app-update.yml`), so no
 * feed URL is configured here — the GitHub provider is read from that config.
 *
 * In development (or any unpackaged run) there is no `app-update.yml`, so the
 * updater would throw on `checkForUpdates()`. We guard the whole flow on
 * {@link Electron.App.isPackaged} and no-op cleanly otherwise: the IPC handlers
 * are still registered (so the preload bridge never sees a missing channel),
 * but they do nothing.
 *
 * @param getWebContents resolver for the target renderer, so we never capture a
 *   destroyed window after a reload.
 */
export function registerUpdater(getWebContents: () => WebContents | undefined): void {
  const send = (status: UpdateStatus): void => {
    const wc = getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send(UPDATE_CHANNELS.status, status)
    }
  }

  // In dev / unpackaged runs there is no update feed. Register inert handlers
  // so the renderer API exists, then bail before touching `autoUpdater`.
  if (!app.isPackaged) {
    ipcMain.handle(UPDATE_CHANNELS.check, () => undefined)
    ipcMain.handle(UPDATE_CHANNELS.quitAndInstall, () => undefined)
    return
  }

  // We surface our own restart affordance in the UI, so don't auto-install on
  // quit or auto-download silently before telling the user.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    send({ state: 'available', version: info?.version })
  })
  autoUpdater.on('download-progress', (progress) => {
    send({ state: 'downloading', percent: Math.round(progress?.percent ?? 0) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send({ state: 'downloaded', version: info?.version })
  })
  autoUpdater.on('error', (err) => {
    send({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  })

  ipcMain.handle(UPDATE_CHANNELS.check, async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      send({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  ipcMain.handle(UPDATE_CHANNELS.quitAndInstall, () => {
    // `isSilent: false`, `isForceRunAfter: true` — show the installer UI where
    // applicable and relaunch the app after updating.
    autoUpdater.quitAndInstall(false, true)
  })

  // Kick off an initial check shortly after startup. Swallow failures so a
  // transient network/feed error never crashes the main process.
  void autoUpdater.checkForUpdates().catch((err) => {
    send({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  })
}
