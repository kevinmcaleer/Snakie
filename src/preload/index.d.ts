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

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
