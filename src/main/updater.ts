import { app, dialog, ipcMain, BrowserWindow, type WebContents } from 'electron'
import { isNewerVersion } from '../shared/version-compare'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

/**
 * IPC channel names for the auto-update layer. The renderer subscribes to
 * `updates:status` push events and invokes the `updates:*` request channels.
 */
export const UPDATE_CHANNELS = {
  status: 'updates:status',
  check: 'updates:check',
  download: 'updates:download',
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
 * A user-initiated update check (the "Check for Updates…" menu item and the
 * clickable status-bar version both call this). Unlike the silent hourly check,
 * this one surfaces its result to the user directly:
 *
 *   - update available → a native dialog offering Download (drives the same
 *     `autoUpdater.downloadUpdate()` path the status bar / notifier use);
 *   - up to date       → a native "you're on the latest version" message box;
 *   - unpackaged / dev → a friendly note that updates only work in installed
 *     builds (electron-updater has no feed without a packaged `app-update.yml`);
 *   - error            → a low-key error message box.
 *
 * Assigned by {@link registerUpdater} at startup; before that it is a no-op.
 */
export let checkForUpdatesManual: () => Promise<void> = async () => undefined

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
 * but they do nothing — and {@link checkForUpdatesManual} explains the situation
 * with a friendly dialog rather than throwing.
 *
 * @param getWindow resolver for the target window, so we never capture a
 *   destroyed window after a reload. Its `webContents` receive the status
 *   pushes; the window itself parents the manual-check dialogs.
 */
export function registerUpdater(getWindow: () => BrowserWindow | undefined): void {
  const send = (status: UpdateStatus): void => {
    const wc: WebContents | undefined = getWindow()?.webContents
    if (wc && !wc.isDestroyed()) {
      wc.send(UPDATE_CHANNELS.status, status)
    }
  }

  // Show a native message box, parented to the live window when there is one.
  const showMessage = (
    options: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> => {
    const win = getWindow()
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  }

  // In dev / unpackaged runs there is no update feed. Register inert handlers
  // so the renderer API exists, then bail before touching `autoUpdater`.
  if (!app.isPackaged) {
    checkForUpdatesManual = async (): Promise<void> => {
      await showMessage({
        type: 'info',
        title: 'Check for Updates',
        message: 'Updates are only available in installed builds.',
        detail:
          "You're running Snakie from source / an unpackaged build, so there's " +
          'no update feed to check. Install a packaged release to get automatic updates.',
        buttons: ['OK']
      })
    }
    ipcMain.handle(UPDATE_CHANNELS.check, () => checkForUpdatesManual())
    ipcMain.handle(UPDATE_CHANNELS.download, () => undefined)
    ipcMain.handle(UPDATE_CHANNELS.quitAndInstall, () => undefined)
    return
  }

  // The user explicitly pulls the update from the status bar (issue #74), so
  // don't download silently. We also surface our own restart affordance, so
  // don't auto-install on quit.
  autoUpdater.autoDownload = false
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

  // Begin downloading an available update. With `autoDownload = false` nothing
  // is fetched until this fires; progress + completion flow back through the
  // `download-progress` / `update-downloaded` events above (so the status bar
  // and notifier track it). Errors are surfaced as an `error` status push.
  const startDownload = async (): Promise<void> => {
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      send({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // The user-initiated check (menu item + clickable status-bar version). Runs
  // the real GitHub check and reports the outcome with a native dialog, on top
  // of the usual `updates:status` push (so the in-app notifier still appears).
  checkForUpdatesManual = async (): Promise<void> => {
    try {
      const result = await autoUpdater.checkForUpdates()
      // `checkForUpdates()` resolves with the latest release info. It is "newer"
      // when electron-updater reports a version other than the running app's
      // (the `update-available` event has, in that case, already pushed an
      // `available` status). Decide what to tell the user from that comparison.
      const latest = result?.updateInfo?.version
      // Strict semver compare (#507): a plain != offered DOWNGRADES to anyone
      // running a build newer than the latest published release.
      const isNewer = latest != null && isNewerVersion(latest, app.getVersion())
      if (isNewer) {
        // Prompt the user to download. Choosing "Download" drives the same
        // `downloadUpdate()` path the status bar / notifier Download button use.
        const { response } = await showMessage({
          type: 'info',
          title: 'Update Available',
          message: `Snakie ${latest} is available.`,
          detail: `You're on ${app.getVersion()}. Download it now?`,
          buttons: ['Download', 'Later'],
          defaultId: 0,
          cancelId: 1
        })
        if (response === 0) void startDownload()
      } else {
        await showMessage({
          type: 'info',
          title: 'Check for Updates',
          message: "You're on the latest version.",
          detail: `Snakie ${app.getVersion()} is up to date.`,
          buttons: ['OK']
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      send({ state: 'error', message })
      await showMessage({
        type: 'warning',
        title: 'Check for Updates',
        message: 'Could not check for updates.',
        detail: message,
        buttons: ['OK']
      })
    }
  }

  ipcMain.handle(UPDATE_CHANNELS.check, () => checkForUpdatesManual())

  ipcMain.handle(UPDATE_CHANNELS.download, () => startDownload())

  ipcMain.handle(UPDATE_CHANNELS.quitAndInstall, () => {
    // `isSilent: false`, `isForceRunAfter: true` — show the installer UI where
    // applicable and relaunch the app after updating.
    autoUpdater.quitAndInstall(false, true)
  })

  // Kick off an initial check shortly after startup, then re-check hourly so a
  // long-running session still learns about new releases. Swallow failures so a
  // transient network/feed error never crashes the main process. Unlike the
  // manual check, this is silent: no dialogs, just the `updates:status` push.
  const checkQuietly = (): void => {
    void autoUpdater.checkForUpdates().catch((err) => {
      send({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    })
  }
  checkQuietly()
  const HOUR_MS = 60 * 60 * 1000
  const timer = setInterval(checkQuietly, HOUR_MS)
  app.on('before-quit', () => clearInterval(timer))
}
