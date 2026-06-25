import { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from './index'

// Re-export the Board View payload + shared board-definition types so the
// renderer can import them from this single UI-facing module.
export type { BoardSourcePayload, InstrumentOpenPayload, InstrumentConn } from './index'
export type { FindCommandPayload, FindStatusPayload } from './index'
export type { PartsWriteResult } from './index'

// Re-export the Parts Library + Part Editor types (#129 / #130) so the parts
// panel + editor can import them from this single UI-facing module.
export type {
  PartDefinition,
  PartSummary,
  PartLibrary,
  PartLibraryWithParts,
  PartPin,
  PartPinType,
  PartPinCapability,
  PartPackage,
  PartHeader,
  PartEdge,
  PartFeature,
  PartButton,
  MountingHole,
  PolygonPoint,
  PartSchematic,
  SchematicPin,
  RegistryEntry,
  PartRegistry,
  LibraryUpdate
} from '../shared/part'
export type {
  BoardDefinition,
  BoardPad,
  BoardPadType,
  BoardHeader,
  BoardFeature
} from '../shared/board'

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

// Re-export the firmware-flashing types so the renderer's flasher UI can import
// them from this UI-facing module rather than reaching into `src/main`.
export type {
  BoardType,
  BoardCandidate,
  FlashProgress,
  FlashOptions,
  FlashResult,
  EsptoolInfo,
  FirmwareCatalog,
  FirmwareFamily,
  FirmwareModel,
  FirmwareVariant,
  FirmwareVersion,
  DownloadAndFlashOptions
} from '../main/firmware/types'

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

// Re-export the per-module installer types (issue #120) so the Modules manager
// can import them from this single UI-facing module. The progress/result types
// are defined inline in the preload (`./index`); the catalog types come from the
// dependency-free shared catalog.
export type { ModuleInstallProgress, ModuleInstallResult } from './index'
export type { ModuleInstallPlan } from '../main/modules/resolve'
export type {
  ModuleDef,
  ModuleSource,
  ModuleGroup,
  ModuleStatus,
  InstrumentId
} from '../shared/modules-catalog'
// Re-export the LLM chat types so the renderer's chat panel can import them
// from the UI-facing preload module rather than reaching into `src/main`.
export type {
  LlmCompleteRequest,
  LlmKeyStatus,
  LlmMessage,
  LlmModelInfo,
  LlmProviderInfo,
  LlmSendRequest,
  LlmStreamEvent
} from '../main/llm/types'
export type { CopilotDeviceCode, CopilotPollResult } from '../main/llm/providers/copilotAuth'

// Re-export the Git (version-control) types (issue #15) so the Source Control
// panel can import them from this single UI-facing module.
export type {
  GitFileStatus,
  GitStatus,
  GitBranchList,
  GitDiff,
  GitRemoteResult
} from '../main/git/types'

// Re-export the Python plugin-system types (issue #61) so the Plugins panel can
// import them from this single UI-facing module.
export type {
  PluginInfo,
  CommandInfo,
  PluginContext,
  PluginFileContext,
  PluginSelection,
  PluginAction,
  MessageAction,
  EditAction,
  DiagnosticAction,
  StatusAction,
  Diagnostic,
  DiagnosticFix,
  LintResult,
  RunCommandResult,
  PluginListing,
  PluginStatus
} from '../main/plugins/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
