import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerDeviceIpc, disposeDevice } from './device/ipc'
import { registerFsIpc } from './fs/ipc'
import { registerPackagesIpc } from './packages/ipc'
import { registerModulesIpc } from './modules/ipc'
import { registerLlmIpc } from './llm/ipc'
import { registerFirmwareIpc } from './firmware/ipc'
import { registerGitIpc } from './git/ipc'
import { registerPluginsIpc, disposePlugins } from './plugins/ipc'
import { registerUpdater, checkForUpdatesManual } from './updater'
import { registerBoardIpc, openBoardView, disposeBoard } from './board'
import { registerFindIpc, disposeFind } from './find'
import { registerInstrumentWindowsIpc, disposeInstrumentWindows } from './instrumentWindows'
import { registerConsoleWindowIpc, disposeConsoleWindow } from './consoleWindow'
import { registerPartsIpc } from './parts/ipc'
import { registerRobotIpc } from './robot/ipc'
import { registerFeedbackIpc } from './feedback/ipc'
import { setupAppMenu } from './menu'

// Disable GPU / hardware-accelerated rendering on the Raspberry Pi build (Linux
// arm64). The Pi's GL stack can't report VSync timing to Chromium, which floods
// the console with harmless `ERROR:gl_surface_presentation_helper.cc …
// GetVSyncParametersIfAvailable() failed` lines and can make GPU compositing
// unreliable; software rendering is steadier for this UI on a Pi 4/5. Set
// SNAKIE_ENABLE_GPU=1 to keep hardware acceleration. Must run before app `ready`
// (before the GPU process spawns).
if (process.platform === 'linux' && process.arch === 'arm64' && !process.env.SNAKIE_ENABLE_GPU) {
  app.disableHardwareAcceleration()
}

/** The single application window, used to route device push-events. */
let mainWindow: BrowserWindow | null = null

/**
 * Resolve the bundled MicroPython instrument library (`micropython/instruments.py`,
 * issue #107) and return its source text. Mirrors the PluginHost path resolution:
 * packaged builds read it from `process.resourcesPath` (shipped via the
 * electron-builder `extraResources` entry); in dev `__dirname` is `out/main`, so
 * the repo root is two levels up. Never throws — returns `''` on any failure so
 * the renderer's "offer to install" flow degrades gracefully (issue #108).
 */
function readInstrumentsLibrarySource(): string {
  try {
    const packaged = join(process.resourcesPath, 'micropython', 'instruments.py')
    const path =
      app.isPackaged && existsSync(packaged)
        ? packaged
        : join(__dirname, '..', '..', 'micropython', 'instruments.py')
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function createWindow(): void {
  // Create the browser window with secure defaults.
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'Snakie',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // sandbox MUST be false: the preload uses CommonJS require() for
      // @electron-toolkit/preload, which a sandboxed preload cannot load — that
      // would silently break the entire window.api bridge. Security is kept via
      // contextIsolation + nodeIntegration:false (the electron-vite default).
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished initialization.
app.whenReady().then(() => {
  // Set app user model id for windows.
  electronApp.setAppUserModelId('com.kevinmcaleer.snakie')

  // Default open or close DevTools by F12 in development and
  // ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Example IPC handler establishing the pattern later agents will extend.
  ipcMain.handle('ping', () => 'pong')

  // App version, surfaced in the status bar.
  ipcMain.handle('app:version', () => app.getVersion())

  // Environment diagnostics for a bug report (#206): platform / OS version /
  // arch / Snakie + Electron versions. Only the main process can read these.
  ipcMain.handle('app:diagnostics', () => {
    let osVersion = ''
    try {
      osVersion = (process as { getSystemVersion?: () => string }).getSystemVersion?.() ?? ''
    } catch {
      osVersion = ''
    }
    return {
      platform: process.platform,
      arch: process.arch,
      osVersion,
      electron: process.versions.electron,
      snakieVersion: app.getVersion()
    }
  })

  // Return the bundled MicroPython instrument library source (issue #108), so the
  // renderer can offer a one-click "install onto the board" of `instruments.py`
  // (issue #107). Reads from resources when packaged, the repo in dev; never
  // throws (returns '' on failure — the renderer treats that as "unavailable").
  ipcMain.handle('instruments:librarySource', () => readInstrumentsLibrarySource())

  // Open an external URL in the user's default browser (used by clickable
  // plugin status-bar links). Only http(s) URLs are honoured.
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
  })

  // Capture a PNG of EVERY open Snakie window (issue #206: attach to a bug
  // report) — the main window plus the Board View and any undocked instrument
  // windows — so a bug that only shows in a detached window is still captured.
  // The main window is first; each entry is labelled by its window title. The
  // renderer composites them into one image (the feedback API takes one file).
  // Runs in main because only it can reach webContents.capturePage().
  ipcMain.handle(
    'app:captureScreenshot',
    async (): Promise<{ title: string; dataUrl: string }[]> => {
      const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
      // Main window first, then the rest (Board View, instrument windows, Find)
      // in creation order.
      const ordered =
        mainWindow && !mainWindow.isDestroyed()
          ? [mainWindow, ...all.filter((w) => w !== mainWindow)]
          : all
      const shots: { title: string; dataUrl: string }[] = []
      for (const w of ordered) {
        try {
          const image = await w.webContents.capturePage()
          if (!image.isEmpty()) {
            shots.push({ title: w.getTitle() || 'Snakie', dataUrl: image.toDataURL() })
          }
        } catch {
          // Skip a window that can't be captured; keep the others.
        }
      }
      return shots
    }
  )

  // Register the serial device layer. Push events are routed to whichever
  // window is currently live.
  registerDeviceIpc(() => mainWindow?.webContents)

  // Register the local filesystem layer. The folder dialog is parented to the
  // live window when one exists.
  registerFsIpc(() => mainWindow ?? undefined)

  // Register the MicroPython package installer layer (issue #20). PyPI search
  // runs here (main) to satisfy the renderer CSP; installs run `mip` on the
  // device via the renderer's existing device.exec channel.
  registerPackagesIpc()

  // Bug-report submission (issue #206): forwards the Report Bug form to the
  // kevsrobots.com feedback API from the main process (past the renderer CSP).
  registerFeedbackIpc()

  // Register the per-module installer layer (issue #120). Generalises the #108
  // instrument-library install to ANY catalog driver: it enumerates the module
  // catalog and composes a per-module install plan (bundled `.py` contents or a
  // `mip` snippet) for the renderer's Modules manager to run over the existing
  // device channel — so only the drivers a robot uses get written to the board.
  registerModulesIpc()

  // Register the firmware-flashing layer (ESP via esptool, RP2040 via UF2 copy).
  // The file dialog is parented to the live window and progress is routed to it.
  registerFirmwareIpc(() => mainWindow ?? undefined)

  // Register the built-in version-control (Git) layer (issue #15). All git
  // operations run here via simple-git, scoped to a folder the renderer picks.
  registerGitIpc()

  // Register the Python plugin system (issue #61). Spawns the user's python3
  // running snakie.host lazily on first use and speaks JSON-RPC over stdio.
  // Absent Python is reported via status() rather than crashing.
  registerPluginsIpc()

  // Register the auto-update layer. No-ops cleanly in dev (unpackaged); when
  // packaged it checks GitHub Releases and pushes status to the live window. The
  // window resolver also parents the manual-check dialogs (issue #89).
  registerUpdater(() => mainWindow ?? undefined)

  // Build the application menu (issue #89). Its "Check for Updates…" item and
  // the clickable status-bar version both invoke the same user-initiated check.
  // Installed after `registerUpdater` so `checkForUpdatesManual` is assigned.
  setupAppMenu(() => void checkForUpdatesManual(), openBoardView)

  // Register the LLM (Claude) chat layer. All Anthropic API calls happen in the
  // main process; deltas stream back to whichever window is currently live.
  registerLlmIpc(() => mainWindow?.webContents)

  // Register the Board View layer: a separate frameless, always-on-top window
  // that visualises the active file's pin wiring, fed live over IPC. The
  // resolver lets it notify the main window when it closes.
  registerBoardIpc(() => mainWindow)

  // Register the Find & Replace layer (issue #146): a separate frameless,
  // always-on-top window that drives the main editor's find/replace over IPC.
  registerFindIpc(() => mainWindow)

  // Register detached instrument windows (#205): undocking an instrument opens it
  // as a true resizable OS window; the main window is told when one closes so it
  // can re-dock the instrument.
  registerInstrumentWindowsIpc(() => mainWindow)

  // Register the detached console window: the bottom REPL can pop out into its
  // own resizable OS window; the main window is told when it closes so it re-docks.
  registerConsoleWindowIpc(() => mainWindow)

  // Register the Parts Library + Part Editor layer (#129 / #130): portable,
  // community-authored parts on disk (<userData>/parts/<lib>/<part>/parts.yml)
  // plus the master community registry (fetch + install + update checks).
  registerPartsIpc()

  // Register the Robot Definition layer (#128): read/write robot.yml (the
  // project's parts + pin-to-pin wiring) for the Board Viewer's Wiring mode.
  registerRobotIpc()

  createWindow()

  app.on('activate', () => {
    // On macOS re-create a window when the dock icon is clicked and there
    // are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Ensure the serial port is released and the plugin host is killed before the
// process exits.
app.on('before-quit', () => {
  void disposeDevice()
  void disposePlugins()
  disposeBoard()
  disposeFind()
  disposeInstrumentWindows()
  disposeConsoleWindow()
})
