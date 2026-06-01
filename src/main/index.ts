import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerDeviceIpc, disposeDevice } from './device/ipc'
import { registerFsIpc } from './fs/ipc'

/** The single application window, used to route device push-events. */
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Create the browser window with secure defaults.
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    title: 'Snakie',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
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

  // Register the serial device layer. Push events are routed to whichever
  // window is currently live.
  registerDeviceIpc(() => mainWindow?.webContents)

  // Register the local filesystem layer. The folder dialog is parented to the
  // live window when one exists.
  registerFsIpc(() => mainWindow ?? undefined)

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

// Ensure the serial port is released before the process exits.
app.on('before-quit', () => {
  void disposeDevice()
})
