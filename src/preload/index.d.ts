import { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from './index'

// Re-export the device layer types so the renderer can import them from a
// single, UI-facing module without reaching into `src/main`.
export type {
  PortInfo,
  ConnectOptions,
  ConnectionState,
  DeviceStatus,
  ExecResult,
  DirEntry,
  StatResult,
  IpcResult
} from '../main/device/types'

// Re-export the local filesystem types so the renderer can import them from a
// single, UI-facing module without reaching into `src/main`.
export type { FsEntry, FsStat } from '../main/fs/types'

// Re-export the update-status type so the renderer's notifier can import it
// from the UI-facing preload module rather than reaching into `src/main`.
export type { UpdateStatus } from '../main/updater'

// Re-export the package-installer types (issue #20) so the Packages panel can
// import them from this single UI-facing module.
export type {
  PackageInfo,
  InstallOptions,
  InstallProgress,
  InstallResult
} from '../main/packages/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
