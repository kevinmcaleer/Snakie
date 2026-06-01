import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  ConnectOptions,
  DeviceStatus,
  DirEntry,
  ExecResult,
  IpcResult,
  PortInfo,
  StatResult
} from '../main/device/types'
import type { FsEntry, FsStat } from '../main/fs/types'
import type { UpdateStatus } from '../main/updater'

/**
 * Unwrap an {@link IpcResult} into a resolved value or a thrown Error, so the
 * renderer can use ordinary `try/catch` / promise rejection semantics.
 */
async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p
  if (!res.ok) throw new Error(res.error)
  return res.value
}

/**
 * Serial device API. Mirrors the main-process `device:*` IPC handlers and
 * unwraps their typed results. `onData` / `onStatus` subscribe to push events
 * and return an unsubscribe function.
 */
const device = {
  /** Enumerate available serial ports. */
  listPorts: (): Promise<PortInfo[]> => unwrap(ipcRenderer.invoke('device:listPorts')),
  /** Open a connection to `path` at `opts.baudRate` (default 115200). */
  connect: (path: string, opts?: ConnectOptions): Promise<void> =>
    unwrap(ipcRenderer.invoke('device:connect', path, opts)),
  /** Close the active connection. */
  disconnect: (): Promise<void> => unwrap(ipcRenderer.invoke('device:disconnect')),
  /** Current connection status snapshot. */
  getStatus: (): Promise<DeviceStatus> => unwrap(ipcRenderer.invoke('device:getStatus')),
  /** Run code in the raw REPL, returning captured stdout/stderr. */
  exec: (code: string): Promise<ExecResult> => unwrap(ipcRenderer.invoke('device:exec', code)),
  /** Run code and return stdout, throwing on a device traceback. */
  eval: (code: string): Promise<string> => unwrap(ipcRenderer.invoke('device:eval', code)),
  /** Send raw keystrokes to the friendly REPL (interactive terminal input). */
  sendData: (data: string): Promise<void> => unwrap(ipcRenderer.invoke('device:sendData', data)),
  /** Send Ctrl-C to interrupt the running program. */
  interrupt: (): Promise<void> => unwrap(ipcRenderer.invoke('device:interrupt')),
  /** Send Ctrl-D to soft-reset the device. */
  softReset: (): Promise<void> => unwrap(ipcRenderer.invoke('device:softReset')),
  /** List a directory on the device filesystem. */
  listDir: (path?: string): Promise<DirEntry[]> =>
    unwrap(ipcRenderer.invoke('device:listDir', path)),
  /** Read a file's contents (UTF-8). */
  readFile: (path: string): Promise<string> => unwrap(ipcRenderer.invoke('device:readFile', path)),
  /** Write contents to a file (created/overwritten), chunked. */
  writeFile: (path: string, contents: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('device:writeFile', path, contents)),
  /** Remove a file. */
  remove: (path: string): Promise<void> => unwrap(ipcRenderer.invoke('device:remove', path)),
  /** Create a directory. */
  mkdir: (path: string): Promise<void> => unwrap(ipcRenderer.invoke('device:mkdir', path)),
  /** Rename / move a path. */
  rename: (from: string, to: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('device:rename', from, to)),
  /** Stat a path. */
  stat: (path: string): Promise<StatResult> => unwrap(ipcRenderer.invoke('device:stat', path)),
  /**
   * Subscribe to raw serial output. The callback receives the bytes as a
   * `Uint8Array`. Returns an unsubscribe function.
   */
  onData: (cb: (chunk: Uint8Array) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, chunk: Uint8Array): void => cb(chunk)
    ipcRenderer.on('device:data', listener)
    return () => ipcRenderer.removeListener('device:data', listener)
  },
  /**
   * Subscribe to connection status changes. Returns an unsubscribe function.
   */
  onStatus: (cb: (status: DeviceStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, status: DeviceStatus): void => cb(status)
    ipcRenderer.on('device:status', listener)
    return () => ipcRenderer.removeListener('device:status', listener)
  }
}

/**
 * Local (host) filesystem API. Mirrors the main-process `fs:*` IPC handlers
 * and unwraps their typed results. Used by the local file browser and the
 * workspace store for `source: 'local'` documents.
 */
const fs = {
  /** Show the native "open folder" dialog. Resolves to the path or null. */
  openFolderDialog: (): Promise<string | null> =>
    unwrap(ipcRenderer.invoke('fs:openFolderDialog')),
  /** List a directory's entries (directories first, then alphabetical). */
  readDir: (path: string): Promise<FsEntry[]> => unwrap(ipcRenderer.invoke('fs:readDir', path)),
  /** Read a file's contents (UTF-8). */
  readFile: (path: string): Promise<string> => unwrap(ipcRenderer.invoke('fs:readFile', path)),
  /** Write contents to a file (created/overwritten). */
  writeFile: (path: string, contents: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('fs:writeFile', path, contents)),
  /** Create a directory (recursive). */
  mkdir: (path: string): Promise<void> => unwrap(ipcRenderer.invoke('fs:mkdir', path)),
  /** Rename / move a path. */
  rename: (from: string, to: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('fs:rename', from, to)),
  /** Remove a file or directory (recursive). */
  remove: (path: string): Promise<void> => unwrap(ipcRenderer.invoke('fs:remove', path)),
  /** Stat a path. */
  stat: (path: string): Promise<FsStat> => unwrap(ipcRenderer.invoke('fs:stat', path))
}

/**
 * Auto-update API. Mirrors the main-process `updates:*` IPC handlers. `check`
 * triggers an update check, `quitAndInstall` restarts into a downloaded update,
 * and `onStatus` subscribes to lifecycle push events (returns an unsubscribe
 * function). In dev / unpackaged runs the main side no-ops, so nothing is ever
 * pushed.
 */
const updates = {
  /** Trigger an update check (no-op when unpackaged). */
  check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
  /** Restart the app and install a downloaded update. */
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke('updates:quitAndInstall'),
  /** Subscribe to update lifecycle status. Returns an unsubscribe function. */
  onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  }
}

// Minimal, typed API exposed to the renderer. This establishes the IPC
// pattern that later feature work will extend.
const api = {
  /** Example round-trip channel used to prove the bridge works. */
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  /** Snapshot of the runtime versions for display in the UI. */
  versions: process.versions,
  /** Serial device connection + MicroPython REPL/filesystem layer. */
  device,
  /** Local host filesystem layer. */
  fs,
  /** Auto-update check + status + restart layer. */
  updates
}

// Use `contextBridge` APIs to expose Electron APIs to the renderer only if
// context isolation is enabled, otherwise just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type Api = typeof api
