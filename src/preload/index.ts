import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Broadcast channels (`device:data`, `device:status`) are legitimately observed
// by many components at once — the Terminal, status bar, board views and every
// open instrument. Each subscribes/unsubscribes correctly (no leak), but with a
// bench of instruments open the count can exceed Node's default 10-listener
// ceiling and log a spurious MaxListenersExceededWarning. `device:status` is
// additionally de-duplicated to a single shared listener (see useDeviceStatus),
// and this raises the ceiling so the per-channel fan-out never warns.
ipcRenderer.setMaxListeners(40)
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
import type {
  BoardCandidate,
  DownloadAndFlashOptions,
  EsptoolInfo,
  FirmwareCatalog,
  FlashOptions,
  FlashProgress,
  FlashResult
} from '../main/firmware/types'
import type { UpdateStatus } from '../main/updater'
import type { InstallPlan } from '../main/packages/ipc'
import type {
  InstallOptions,
  InstallProgress,
  InstallResult,
  PackageInfo
} from '../main/packages/types'
import type { ModuleInstallPlan } from '../main/modules/resolve'
import {
  importProbeSnippet,
  MODULE_PRESENT,
  MODULES_LIB_DIR,
  type ModuleDef
} from '../shared/modules-catalog'
import type {
  CopilotDeviceCode,
  CopilotPollResult
} from '../main/llm/providers/copilotAuth'
import type {
  LlmCompleteRequest,
  LlmKeyStatus,
  LlmProviderInfo,
  LlmSendRequest,
  LlmStreamEvent
} from '../main/llm/types'
import type {
  GitBranchList,
  GitDiff,
  GitRemoteResult,
  GitStatus
} from '../main/git/types'
import type {
  LintResult,
  PluginContext,
  PluginListing,
  PluginStatus,
  RunCommandResult
} from '../main/plugins/types'
import type { BoardDefinition } from '../shared/board'
import type {
  LibraryUpdate,
  PartDefinition,
  PartLibrary,
  PartLibraryWithParts,
  PartRegistry,
  RegistryEntry
} from '../shared/part'
import type { RobotDefinition } from '../shared/robot'
import type { InstrumentWindowPayload } from '../shared/instrument-window'
import type { BugReportPayload, BugReportResult } from '../main/feedback/ipc'

/** The active-file snapshot the main renderer streams to the Board View window. */
export interface BoardSourcePayload {
  source: string
  fileName?: string
  isPython: boolean
  theme: string
  /** The Board View breadboard background ('dark' | 'blueprint'); default dark. */
  breadboardBg?: string
  /** The open project folder, so the board window can read/write its robot.yml. */
  folder?: string
}

/**
 * One parsed board connection carried in an {@link InstrumentOpenPayload}.
 *
 * A STRUCTURAL mirror of the renderer's `UsedPins` (`parse-pins.ts`). The preload
 * never imports from the renderer (it only depends on `main`/`shared` types), so
 * we restate the shape here; the renderer's `UsedPins` is assignable to it. This
 * is the FULL connection the board node already parsed, so the main window can
 * render the instrument from the payload alone — without re-parsing (and possibly
 * not finding) the pin in its own active file. `type` is left as a `string` (the
 * renderer's `PinType` union) so the preload needn't restate that union too.
 */
export interface InstrumentConn {
  /** Connection type: 'output' | 'input' | 'pwm' | 'adc' | 'i2c' | 'spi' | 'pio'. */
  type: string
  /** The pin labels/numbers used, in source order (e.g. `['2']`). */
  pins: string[]
  /** The assigned variable name (e.g. `led`), or `''` if not an assignment. */
  variable: string
  /** The trimmed constructor source, e.g. `PWM(Pin(2), freq=1000)`. */
  constructor: string
}

/**
 * A cross-window "open an instrument" request. Sent from the board-view window
 * (its PWM scope / ADC meter node launchers) and relayed by the main process to
 * the MAIN editor window, where the instruments are hosted (#101 / #102).
 *
 * The board node already has the FULL parsed connection in scope, so we carry it
 * verbatim (`conn`). The main window renders the instrument straight from `conn`
 * — it does NOT re-resolve against its own active file (which may be a different,
 * empty, or non-`.py` file). This is the fix for the scope/meter never appearing
 * in the dock when the main editor isn't showing the file that declares the pin.
 */
export interface InstrumentOpenPayload {
  /** Which instrument to open: an oscilloscope (PWM) or a multimeter (ADC). */
  kind: 'scope' | 'meter'
  /** The full parsed connection the instrument renders from (self-contained). */
  conn: InstrumentConn
}

/**
 * A find/replace request sent from the Find & Replace window to the MAIN editor
 * window (issue #146). The find window has no editor access, so it ships the full
 * query + options; the main window runs it against Monaco. `action` is the
 * renderer's `FindAction` union, left as a string so the preload needn't restate it.
 */
export interface FindCommandPayload {
  /** 'count' | 'next' | 'prev' | 'replace' | 'replaceFind' | 'replaceAll'. */
  action: string
  query: string
  replacement: string
  matchCase: boolean
  wholeWord: boolean
}

/** The match status the MAIN window pushes back to the find window (#146). */
export interface FindStatusPayload {
  /** 1-based index of the current selection among the matches, or 0. */
  matchIndex: number
  /** Total matches in the active model. */
  matchCount: number
}

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
  /**
   * Write an IDE→board control line (issue #115): `SNKCMD <target> <payload>\n`.
   * The WRITE counterpart of the `SNK …` telemetry — the on-device `control`
   * helper polls stdin and applies the latest value per target. Does not
   * interrupt a running program (no raw-REPL handshake; sent like `sendData`).
   */
  sendControl: (target: string, payload?: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('device:sendControl', target, payload ?? '')),
  /** Send Ctrl-C to interrupt the running program. */
  interrupt: (): Promise<void> => unwrap(ipcRenderer.invoke('device:interrupt')),
  /** Send Ctrl-D to soft-reset the device. */
  softReset: (): Promise<void> => unwrap(ipcRenderer.invoke('device:softReset')),
  /** List a directory on the device filesystem. */
  listDir: (path?: string): Promise<DirEntry[]> =>
    unwrap(ipcRenderer.invoke('device:listDir', path)),
  /** Flash usage (`os.statvfs`) in bytes, or `null` when unavailable (#211). */
  df: (): Promise<{ total: number; free: number; used: number } | null> =>
    unwrap(ipcRenderer.invoke('device:df')),
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
  /**
   * Show the native "save file" dialog (used for the untitled "Save As" flow).
   * `defaultName` seeds the dialog's default path. Resolves to the chosen path,
   * or null if the user cancels.
   */
  saveFileDialog: (defaultName?: string): Promise<string | null> =>
    unwrap(ipcRenderer.invoke('fs:saveFileDialog', defaultName)),
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
 * triggers a user-initiated update check (the same one the "Check for Updates…"
 * menu item runs — see issue #89), `download` pulls an available update
 * (downloads run only on explicit user request — see issue #74), `quitAndInstall`
 * restarts into a downloaded update, and `onStatus` subscribes to lifecycle push
 * events (returns an unsubscribe function). In dev / unpackaged runs the silent
 * background flow no-ops; a `check` still shows a friendly "installed builds
 * only" dialog rather than nothing.
 */
const updates = {
  /**
   * Run a user-initiated update check. In packaged builds it queries GitHub and
   * prompts to download if newer, or reports "up to date"; unpackaged it shows a
   * friendly note that updates only work in installed builds.
   */
  check: (): Promise<void> => ipcRenderer.invoke('updates:check'),
  /** Download an available update (the user explicitly opts in). */
  download: (): Promise<void> => ipcRenderer.invoke('updates:download'),
  /** Restart the app and install a downloaded update. */
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke('updates:quitAndInstall'),
  /** Subscribe to update lifecycle status. Returns an unsubscribe function. */
  onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, status: UpdateStatus): void => cb(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  }
}

// Sentinel markers emitted by the device install snippet (kept in sync with
// src/main/packages/install.ts). Used to classify success vs device traceback.
const INSTALL_START = '<<SNAKIE_MIP_START>>'
const INSTALL_OK = '<<SNAKIE_MIP_OK>>'
const INSTALL_ERR = '<<SNAKIE_MIP_ERR>>'

/**
 * MicroPython package installer API (issue #20).
 *
 * `search` / `topPackages` are pure main-process calls (PyPI lives past the
 * CSP). `install` is orchestrated here in the preload: it asks main to build
 * the `mip` snippet + notes, then runs the snippet on the connected device via
 * the SAME serialized `device:exec` channel the rest of the app uses, parsing
 * the sentinel markers to decide success. Progress is reported through an
 * optional callback (purely renderer-side; no main push channel needed).
 */
const packages = {
  /** Curated discovery list of popular MicroPython libraries (offline-safe). */
  topPackages: (): Promise<PackageInfo[]> =>
    unwrap(ipcRenderer.invoke('packages:topPackages')),
  /** Search PyPI + the curated set for `query`. Degrades to curated offline. */
  search: (query: string): Promise<PackageInfo[]> =>
    unwrap(ipcRenderer.invoke('packages:search', query)),
  /**
   * Install `name` onto the connected device by running `mip`. Requires an
   * active connection (the device.exec call rejects otherwise). `onProgress`
   * receives lifecycle events; the resolved {@link InstallResult} also carries
   * the full log + any non-fatal notes.
   */
  install: async (
    name: string,
    options?: InstallOptions,
    onProgress?: (p: InstallProgress) => void
  ): Promise<InstallResult> => {
    const emit = (p: InstallProgress): void => onProgress?.(p)
    emit({ name, state: 'started' })

    const plan = await unwrap<InstallPlan>(
      ipcRenderer.invoke('packages:install', name, options ?? {})
    )
    for (const note of plan.notes) emit({ name, state: 'note', message: note })

    emit({ name, state: 'running', message: `Installing ${name} with mip…` })
    const exec = await unwrap<{ stdout: string; stderr: string }>(
      ipcRenderer.invoke('device:exec', plan.snippet)
    )

    const out = `${exec.stdout ?? ''}\n${exec.stderr ?? ''}`.trim()
    const failed =
      out.includes(INSTALL_ERR) ||
      (exec.stderr != null && exec.stderr.includes('Traceback'))
    const ok = out.includes(INSTALL_OK) && !failed

    // Strip our sentinel markers from the log shown to the user, keeping any
    // human-readable text (e.g. the error repr printed after INSTALL_ERR).
    const log = out
      .split(/\r?\n/)
      .filter((l) => !l.includes(INSTALL_START) && !l.includes(INSTALL_OK))
      .map((l) => l.replace(INSTALL_ERR, '').trim())
      .filter((l) => l.length > 0)
      .join('\n')
      .trim()

    emit({
      name,
      state: ok ? 'done' : 'error',
      message: ok ? `Installed ${name}` : `Failed to install ${name}`
    })

    return { name, ok, log: log || out, notes: plan.notes }
  }
}

/** Lifecycle event for a per-module install (#120). Mirrors `InstallProgress`. */
export interface ModuleInstallProgress {
  /** The catalog module id being installed. */
  id: string
  /** Lifecycle state. */
  state: 'started' | 'running' | 'note' | 'done' | 'error'
  /** A human-readable message for `note` / status states. */
  message?: string
}

/** The resolved outcome of a per-module install (#120). Mirrors `InstallResult`. */
export interface ModuleInstallResult {
  /** The catalog module id. */
  id: string
  /** Did the install succeed? */
  ok: boolean
  /** Combined device log (cleaned of sentinel markers) or the error text. */
  log: string
  /** Non-fatal notes surfaced during the install (provenance / mip hints). */
  notes: string[]
}

/**
 * Per-module installer API (issue #120) — the renderer-facing half of the
 * "modular installs" subsystem.
 *
 * `catalog` is a pure main-process call (the static module registry). `install`
 * is orchestrated HERE in the preload (exactly like `packages.install`): it asks
 * main for the {@link ModuleInstallPlan}, then runs the privileged-free device
 * step over the SAME serialized `device:*` channel the rest of the app uses —
 * for a `bundled` module that's `device.mkdir('/lib')` + `device.writeFile`
 * (the #108 path, generalised); for a `mip` module it's `device.exec(snippet)`
 * with the same sentinel parsing as `packages.install`. `probeInstalled` runs a
 * cheap `import <name>` probe per module so the manager can show installed-vs-
 * available without a "list packages" API the firmware doesn't provide.
 */
const modules = {
  /** The full installable-module catalog (offline-safe), grouped by the UI. */
  catalog: (): Promise<ModuleDef[]> => unwrap(ipcRenderer.invoke('modules:catalog')),
  /** Resolve one module id to its install plan (bundled contents or mip snippet). */
  installPlan: (id: string): Promise<ModuleInstallPlan> =>
    unwrap(ipcRenderer.invoke('modules:installPlan', id)),
  /**
   * Install module `id` onto the connected device. Requires an active
   * connection. `onProgress` receives lifecycle events; the resolved
   * {@link ModuleInstallResult} also carries the log + notes.
   */
  install: async (
    id: string,
    onProgress?: (p: ModuleInstallProgress) => void
  ): Promise<ModuleInstallResult> => {
    const emit = (p: ModuleInstallProgress): void => onProgress?.(p)
    emit({ id, state: 'started' })

    const plan = await unwrap<ModuleInstallPlan>(
      ipcRenderer.invoke('modules:installPlan', id)
    )
    for (const note of plan.notes) emit({ id, state: 'note', message: note })

    if (plan.mechanism === 'writeFile' && plan.writeFile) {
      // Bundled stub: ensure /lib then write the file (the #108 path).
      emit({ id, state: 'running', message: `Writing ${plan.writeFile.path}…` })
      try {
        await unwrap<void>(ipcRenderer.invoke('device:mkdir', MODULES_LIB_DIR)).catch(
          () => undefined
        )
        await unwrap<void>(
          ipcRenderer.invoke('device:writeFile', plan.writeFile.path, plan.writeFile.contents)
        )
        emit({ id, state: 'done', message: `Installed ${id}` })
        return { id, ok: true, log: `Wrote ${plan.writeFile.path}`, notes: plan.notes }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        emit({ id, state: 'error', message: `Failed to install ${id}` })
        return { id, ok: false, log: msg, notes: plan.notes }
      }
    }

    // mip mechanism: run the snippet over device.exec, parse the sentinels (same
    // markers + cleaning as packages.install).
    emit({ id, state: 'running', message: `Installing ${id} with mip…` })
    const exec = await unwrap<{ stdout: string; stderr: string }>(
      ipcRenderer.invoke('device:exec', plan.snippet ?? '')
    )
    const out = `${exec.stdout ?? ''}\n${exec.stderr ?? ''}`.trim()
    const failed =
      out.includes(INSTALL_ERR) ||
      (exec.stderr != null && exec.stderr.includes('Traceback'))
    const ok = out.includes(INSTALL_OK) && !failed
    const log = out
      .split(/\r?\n/)
      .filter((l) => !l.includes(INSTALL_START) && !l.includes(INSTALL_OK))
      .map((l) => l.replace(INSTALL_ERR, '').trim())
      .filter((l) => l.length > 0)
      .join('\n')
      .trim()
    emit({
      id,
      state: ok ? 'done' : 'error',
      message: ok ? `Installed ${id}` : `Failed to install ${id}`
    })
    return { id, ok, log: log || out, notes: plan.notes }
  },
  /**
   * Probe which of `importNames` are importable on the connected board. Runs one
   * batched `import` probe per name over `device.exec` and returns the SUBSET
   * that printed the {@link MODULE_PRESENT} sentinel. Tolerant of any device
   * error (resolves to an empty array) so the manager degrades gracefully when a
   * board is busy / disconnected mid-probe.
   */
  probeInstalled: async (importNames: string[]): Promise<string[]> => {
    if (importNames.length === 0) return []
    // Build one snippet that probes each name and prints `<sentinel> <name>` for
    // the ones that import — a single raw-REPL round-trip for the whole catalog.
    const lines: string[] = []
    for (const name of importNames) {
      const safe = name.replace(/[^A-Za-z0-9_]/g, '')
      lines.push(importProbeSnippet(safe).replace(MODULE_PRESENT, `${MODULE_PRESENT} ${safe}`))
    }
    try {
      const exec = await unwrap<{ stdout: string; stderr: string }>(
        ipcRenderer.invoke('device:exec', lines.join('\n'))
      )
      const out = `${exec.stdout ?? ''}`
      const present = new Set<string>()
      for (const line of out.split(/\r?\n/)) {
        const m = line.trim()
        if (m.startsWith(`${MODULE_PRESENT} `)) {
          present.add(m.slice(MODULE_PRESENT.length + 1).trim())
        }
      }
      return importNames.filter((n) => present.has(n.replace(/[^A-Za-z0-9_]/g, '')))
    } catch {
      return []
    }
  },
  /** Tell every window a driver/library was just installed onto the board, so the
   *  "needs a driver" / "missing library" banners re-probe and clear. */
  notifyChanged: (): void => ipcRenderer.send('modules:changed'),
  /** Subscribe to install-changed broadcasts (from any window). Returns an
   *  unsubscribe. */
  onChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('modules:didChange', listener)
    return () => ipcRenderer.removeListener('modules:didChange', listener)
  }
}

/**
 * LLM chat API (issue #77). Mirrors the main-process `llm:*` IPC handlers and
 * unwraps their typed results. All provider API calls run in the main process
 * (the renderer CSP blocks external requests), so the renderer never sees the
 * API key. The layer is a provider registry: `listProviders` enumerates the
 * available backends, key status/save is per-provider, and `sendMessage` names
 * the `providerId` it targets. `onStream` subscribes to streamed completion
 * chunks and returns an unsubscribe function.
 */
const llm = {
  /** The available LLM providers (metadata for the chat footer + key settings). */
  listProviders: (): Promise<LlmProviderInfo[]> =>
    unwrap(ipcRenderer.invoke('llm:listProviders')),
  /** Whether a key is stored for `providerId`, and whether storage is OS-encrypted. */
  getKeyStatus: (providerId: string): Promise<LlmKeyStatus> =>
    unwrap(ipcRenderer.invoke('llm:getKeyStatus', providerId)),
  /** Store (or, with an empty string, clear) `providerId`'s API key. */
  setKey: (providerId: string, key: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('llm:setKey', providerId, key)),
  /**
   * Run a streaming chat completion against `req.providerId`. Deltas arrive via
   * `onStream`; this resolves with the full assembled assistant reply once the
   * stream ends.
   */
  sendMessage: (req: LlmSendRequest): Promise<string> =>
    unwrap(ipcRenderer.invoke('llm:sendMessage', req)),
  /**
   * One-shot inline completion (issue #82). Non-streaming: resolves with the raw
   * text to insert at the cursor (empty string when there's no suggestion). The
   * editor's inline-completion provider calls this on a debounce and cancels
   * stale calls via Monaco's cancellation token.
   */
  complete: (req: LlmCompleteRequest): Promise<string> =>
    unwrap(ipcRenderer.invoke('llm:complete', req)),
  /** Begin the GitHub Copilot device-flow sign-in (returns the user code + URL). */
  copilotDeviceStart: (): Promise<CopilotDeviceCode> =>
    unwrap(ipcRenderer.invoke('llm:copilotDeviceStart')),
  /**
   * Poll the Copilot device flow. The `gho_` token never reaches the renderer —
   * on `authorized` the main process has already stored it as Copilot's key.
   */
  copilotDevicePoll: (deviceCode: string): Promise<CopilotPollResult> =>
    unwrap(ipcRenderer.invoke('llm:copilotDevicePoll', deviceCode)),
  /** Subscribe to streamed completion chunks. Returns an unsubscribe function. */
  onStream: (cb: (event: LlmStreamEvent) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, event: LlmStreamEvent): void => cb(event)
    ipcRenderer.on('llm:stream', listener)
    return () => ipcRenderer.removeListener('llm:stream', listener)
  }
}

/**
 * Firmware-flashing API (issue #14). Mirrors the main-process `firmware:*` IPC
 * handlers and unwraps their typed results. `flash` shells out to esptool (ESP)
 * or copies a `.uf2` (RP2040) in the main process; `onProgress` subscribes to
 * the live log/progress stream and returns an unsubscribe function.
 */
const firmware = {
  /** Best-effort board detection from serial VID/PID and UF2 boot drives. */
  detectBoards: (): Promise<BoardCandidate[]> =>
    unwrap(ipcRenderer.invoke('firmware:detect')),
  /** Probe for the external esptool prerequisite (presence + version). */
  checkEsptool: (): Promise<EsptoolInfo> => unwrap(ipcRenderer.invoke('firmware:esptool')),
  /** Show the native firmware (`.bin`/`.uf2`) file picker. Resolves path or null. */
  pickFirmwareFile: (): Promise<string | null> =>
    unwrap(ipcRenderer.invoke('firmware:pickFile')),
  /** Flash the given firmware; progress streams via {@link firmware.onProgress}. */
  flash: (opts: FlashOptions): Promise<FlashResult> =>
    unwrap(ipcRenderer.invoke('firmware:flash', opts)),
  /**
   * Fetch the MicroPython UF2 firmware catalog (Family → Model → Variant →
   * Version cascade) from Thonny's curated list. Throws when offline.
   */
  fetchCatalog: (): Promise<FirmwareCatalog> =>
    unwrap(ipcRenderer.invoke('firmware:fetchCatalog')),
  /**
   * Download a catalog `.uf2` to a temp file then flash it onto the boot drive.
   * Emits one combined progress stream (download %, copy %, then `done`) via
   * {@link firmware.onProgress}.
   */
  downloadAndFlash: (opts: DownloadAndFlashOptions): Promise<FlashResult> =>
    unwrap(ipcRenderer.invoke('firmware:downloadAndFlash', opts)),
  /** Subscribe to flash progress/log lines. Returns an unsubscribe function. */
  onProgress: (cb: (progress: FlashProgress) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, progress: FlashProgress): void => cb(progress)
    ipcRenderer.on('firmware:progress', listener)
    return () => ipcRenderer.removeListener('firmware:progress', listener)
  }
}

/**
 * Built-in version-control (Git) API (issue #15). Mirrors the main-process
 * `git:*` IPC handlers and unwraps their typed results. All git work runs in
 * the main process via simple-git, scoped to a folder the renderer picks with
 * `fs.openFolderDialog`. The not-a-repo case is reported via `status().isRepo`
 * rather than thrown, so the panel can show a clear empty state.
 */
const git = {
  /** Point git at `path`. Resolves to the repo root, or null if not a repo. */
  openRepo: (path: string): Promise<string | null> =>
    unwrap(ipcRenderer.invoke('git:openRepo', path)),
  /** Working-tree status: branch, ahead/behind, staged/changed/untracked. */
  status: (): Promise<GitStatus> => unwrap(ipcRenderer.invoke('git:status')),
  /** Stage a single file. */
  stage: (file: string): Promise<void> => unwrap(ipcRenderer.invoke('git:stage', file)),
  /** Unstage a single file. */
  unstage: (file: string): Promise<void> => unwrap(ipcRenderer.invoke('git:unstage', file)),
  /** Discard working-tree changes for a file (or delete it, if untracked). */
  discard: (file: string): Promise<void> => unwrap(ipcRenderer.invoke('git:discard', file)),
  /** Commit; stages all tracked changes first unless `stageAll` is false. */
  commit: (message: string, stageAll?: boolean): Promise<void> =>
    unwrap(ipcRenderer.invoke('git:commit', message, stageAll)),
  /** Unified diff for a file; `staged` selects index-vs-HEAD over working-vs-index. */
  diff: (file: string, staged?: boolean): Promise<GitDiff> =>
    unwrap(ipcRenderer.invoke('git:diff', file, staged)),
  /** Current branch name (undefined when detached / no commits). */
  currentBranch: (): Promise<string | undefined> =>
    unwrap(ipcRenderer.invoke('git:currentBranch')),
  /** List local branches plus the current one. */
  listBranches: (): Promise<GitBranchList> => unwrap(ipcRenderer.invoke('git:listBranches')),
  /** Check out an existing branch. */
  checkout: (branch: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('git:checkout', branch)),
  /** Push the current branch to its upstream. */
  push: (): Promise<GitRemoteResult> => unwrap(ipcRenderer.invoke('git:push')),
  /** Pull from the upstream of the current branch. */
  pull: (): Promise<GitRemoteResult> => unwrap(ipcRenderer.invoke('git:pull'))
}

/**
 * Python plugin system API (issue #61). Mirrors the main-process `plugins:*`
 * IPC handlers and unwraps their typed results. Snakie's main process spawns
 * the user's `python3` running `snakie.host`, which discovers + loads Python
 * plugins and speaks JSON-RPC over stdio.
 *
 * The no-Python case is reported via `status().pythonFound === false` (with a
 * human-readable `error`) rather than thrown, so the Plugins panel can show a
 * clear "install Python 3 and `pip install snakie`" empty state.
 */
const plugins = {
  /** Whether a Python interpreter + host were found (and which interpreter). */
  status: (): Promise<PluginStatus> => unwrap(ipcRenderer.invoke('plugins:status')),
  /** Discovered plugins + their registered commands. */
  list: (): Promise<PluginListing> => unwrap(ipcRenderer.invoke('plugins:list')),
  /** Run a command against the active editor context; returns its actions. */
  runCommand: (commandId: string, context: PluginContext): Promise<RunCommandResult> =>
    unwrap(ipcRenderer.invoke('plugins:runCommand', commandId, context)),
  /**
   * Run all registered linters against the active editor context, returning
   * the concatenated diagnostics (with optional quick-fixes). Used by the
   * editor for reactive squiggles + lightbulbs.
   */
  lint: (context: PluginContext): Promise<LintResult> =>
    unwrap(ipcRenderer.invoke('plugins:lint', context)),
  /** Kill + re-spawn the host, picking up newly added plugins. */
  reload: (): Promise<PluginStatus> => unwrap(ipcRenderer.invoke('plugins:reload'))
}

/**
 * Board View API. `open` launches/focuses the separate floating Board View
 * window; `close` closes it; `update` relays the active-file snapshot to it (it
 * streams in via `onSource`); `onClosed` fires when the user closes the window;
 * `listUserBoards` returns user-authored board definitions read off disk in the
 * main process; `openBoardsFolder` reveals `<userData>/boards`;
 * `saveUserBoard`/`deleteUserBoard` persist boards authored in the Board Creator
 * (issue #94).
 */
const board = {
  /** Open (or focus) the floating Board View window. */
  open: (): Promise<void> => ipcRenderer.invoke('board:open'),
  /** Close the floating Board View window (no-op if not open). Fire-and-forget. */
  close: (): void => ipcRenderer.send('board:close'),
  /** Relay the active-file snapshot to the board window. Fire-and-forget. */
  update: (payload: BoardSourcePayload): void => ipcRenderer.send('board:update', payload),
  /** Pull the latest buffered snapshot on mount (covers the open-time race). */
  requestSource: (): Promise<BoardSourcePayload | null> => ipcRenderer.invoke('board:requestSource'),
  /** Subscribe to the streamed active-file payload. Returns an unsubscribe fn. */
  onSource: (cb: (payload: BoardSourcePayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: BoardSourcePayload): void => cb(payload)
    ipcRenderer.on('board:source', listener)
    return () => ipcRenderer.removeListener('board:source', listener)
  },
  /** Subscribe to the board window closing. Returns an unsubscribe function. */
  onClosed: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('board:closed', listener)
    return () => ipcRenderer.removeListener('board:closed', listener)
  },
  /** Subscribe to the board window OPENING (via any path, e.g. the mini board's
   *  open button) so the main window can start streaming it the active file.
   *  Returns an unsubscribe function. */
  onOpened: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('board:opened', listener)
    return () => ipcRenderer.removeListener('board:opened', listener)
  },
  /** Broadcast the chosen board id to the app's other window(s) so the full Board
   *  Viewer and the mini board view stay in sync. Fire-and-forget. */
  selectBoard: (id: string): void => ipcRenderer.send('board:select', id),
  /** Subscribe to a board-selection broadcast made in another window. Returns an
   *  unsubscribe function. */
  onSelectBoard: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('board:select', listener)
    return () => ipcRenderer.removeListener('board:select', listener)
  },
  /** User-authored board definitions read from `<userData>/boards/*.json`. */
  listUserBoards: (): Promise<BoardDefinition[]> => ipcRenderer.invoke('board:listUserBoards'),
  /** Reveal the boards folder in the OS file manager (creates it if missing). */
  openBoardsFolder: (): Promise<void> => ipcRenderer.invoke('board:openBoardsFolder'),
  /**
   * Persist a board definition (from the Board Creator) to
   * `<userData>/boards/<id>.json`. Resolves to `{ok,error}` — never rejects, so
   * the creator can show a friendly error inline.
   */
  saveUserBoard: (def: BoardDefinition): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('board:saveUserBoard', def),
  /** Delete a user board file by id (no-op if it doesn't exist). */
  deleteUserBoard: (id: string): Promise<void> =>
    ipcRenderer.invoke('board:deleteUserBoard', id)
}

/**
 * Instruments API (#101 / #102). The Oscilloscope + Multimeter are HOSTED in the
 * main editor window (above the code editor), but their node launchers live in
 * the separate board-view window. `open` fires a fire-and-forget request from the
 * board window; the main process relays it to the main window, where `onOpen`
 * receives it and mounts/reveals the instrument. Mirrors the `board.onSource`
 * relay pattern (a `send` one way, an `on` subscription the other).
 */
const instruments = {
  /**
   * Ask the MAIN window to open an instrument (fire-and-forget). Called from the
   * board-view window's PWM scope / ADC meter launchers; the main process relays
   * it to the main window's {@link instruments.onOpen}.
   */
  open: (payload: InstrumentOpenPayload): void =>
    ipcRenderer.send('instruments:open', payload),
  /**
   * Subscribe (in the MAIN window) to relayed "open instrument" requests.
   * Returns an unsubscribe function. Mirrors `board.onSource`.
   */
  onOpen: (cb: (payload: InstrumentOpenPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: InstrumentOpenPayload): void => cb(payload)
    ipcRenderer.on('instruments:open', listener)
    return () => ipcRenderer.removeListener('instruments:open', listener)
  },
  /**
   * Return the bundled MicroPython instrument library source (`instruments.py`,
   * issue #107). Used by the "offer to install it onto the board" banner (issue
   * #108) to write the file to `/lib/instruments.py`. Resolves to `''` when the
   * library can't be read (the main handler never throws), which the banner
   * treats as "unavailable".
   */
  librarySource: (): Promise<string> => ipcRenderer.invoke('instruments:librarySource'),

  // --- Detached instrument OS windows (#205) ---
  /** Open (or focus) a true OS window rendering one undocked instrument. */
  openWindow: (payload: InstrumentWindowPayload): Promise<void> =>
    ipcRenderer.invoke('instruments:openWindow', payload),
  /** Close the detached window for `key` (re-docks via `onWindowClosed`). */
  closeWindow: (key: string): void => ipcRenderer.send('instruments:closeWindow', key),
  /** (In a detached window) pull this window's payload on mount. */
  requestWindowPayload: (): Promise<InstrumentWindowPayload | null> =>
    ipcRenderer.invoke('instruments:requestPayload'),
  /** (In a detached window) the main process refreshed this window's payload. */
  onWindowPayload: (cb: (payload: InstrumentWindowPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: InstrumentWindowPayload): void => cb(payload)
    ipcRenderer.on('instruments:payload', listener)
    return () => ipcRenderer.removeListener('instruments:payload', listener)
  },
  /** (In the MAIN window) a detached instrument window was closed → re-dock it. */
  onWindowClosed: (cb: (e: { key: string }) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: { key: string }): void => cb(payload)
    ipcRenderer.on('instruments:windowClosed', listener)
    return () => ipcRenderer.removeListener('instruments:windowClosed', listener)
  }
}

/**
 * Find & Replace API (issue #146). The dialog is HOSTED in its own native window
 * (`find.html`), which can't reach the Monaco editor (a main-window singleton).
 * So the find window `sendCommand`s; the main process relays it to the MAIN
 * window, which runs it and `sendStatus`es the result back (relayed here as
 * `onStatus`). Mirrors the `board`/`instruments` relay pattern.
 */
const find = {
  /** Open (or focus) the Find & Replace window. */
  open: (): Promise<void> => ipcRenderer.invoke('find:open'),
  /** Close the Find & Replace window (no-op if not open). Fire-and-forget. */
  close: (): void => ipcRenderer.send('find:close'),
  /** Subscribe (in the MAIN window) to the find window closing. Returns unsubscribe. */
  onClosed: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('find:closed', listener)
    return () => ipcRenderer.removeListener('find:closed', listener)
  },
  /** Send a find/replace command (from the find window) to the editor. */
  sendCommand: (payload: FindCommandPayload): void => ipcRenderer.send('find:command', payload),
  /** Subscribe (in the MAIN window) to relayed find/replace commands. Returns unsubscribe. */
  onCommand: (cb: (payload: FindCommandPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: FindCommandPayload): void => cb(payload)
    ipcRenderer.on('find:command', listener)
    return () => ipcRenderer.removeListener('find:command', listener)
  },
  /** Push the match status (from the MAIN window) back to the find window. */
  sendStatus: (payload: FindStatusPayload): void => ipcRenderer.send('find:status', payload),
  /** Subscribe (in the find window) to the relayed match status. Returns unsubscribe. */
  onStatus: (cb: (payload: FindStatusPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: FindStatusPayload): void => cb(payload)
    ipcRenderer.on('find:status', listener)
    return () => ipcRenderer.removeListener('find:status', listener)
  }
}

/**
 * Detached CONSOLE API. The bottom REPL can pop out into its own native window
 * (`console.html`); the docked terminal stays mounted (hidden) so its scrollback
 * survives a re-dock. The popped-out window renders a fresh terminal fed by the
 * relayed device stream. Mirrors the `find` window relay: `open`/`close` drive the
 * OS window; `onClosed` (in the MAIN window) fires when it closes so the UI
 * re-docks. Named `consoleApi` to avoid shadowing the global `console`.
 */
const consoleApi = {
  /**
   * Open (or focus) the detached console window. `seed` is the docked console's
   * current scrollback, which the popped-out window redraws so it isn't blank.
   */
  open: (seed?: string): Promise<void> => ipcRenderer.invoke('console:open', seed),
  /** Fetch the prior scrollback to redraw (called by the console window on mount). */
  requestSeed: (): Promise<string> => ipcRenderer.invoke('console:requestSeed'),
  /** Close the console window (Redock; no-op if not open). Fire-and-forget. */
  close: (): void => ipcRenderer.send('console:close'),
  /** Subscribe (in the MAIN window) to the console window closing. Returns unsubscribe. */
  onClosed: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('console:closed', listener)
    return () => ipcRenderer.removeListener('console:closed', listener)
  }
}

/**
 * Result of a parts write (save/delete/install/createLibrary). Mirrors the
 * main process `WriteResult` — never rejects, so the UI shows errors inline.
 */
export interface PartsWriteResult {
  ok: boolean
  error?: string
  id?: string
  libraryId?: string
}

/**
 * Result of reading a part driver file's source (#184). Mirrors the main-process
 * `DriverSourceResult` — never rejects, so the install banner shows errors inline.
 */
export interface DriverSourceResult {
  ok: boolean
  /** The driver file's UTF-8 contents, when `ok`. */
  contents?: string
  error?: string
}

/**
 * Parts Library + Part Editor API (#129 / #130). All filesystem + network
 * access lives in the main process; the renderer drives it through these
 * invokes. `listLibraries` returns every installed library (image assets inlined
 * as data URLs); `savePart`/`deletePart` author parts on disk; the registry
 * calls (`fetchRegistry`/`installLibrary`/`checkUpdates`) speak to the master
 * community index. Write-style calls resolve to {@link PartsWriteResult}.
 */
const parts = {
  /** Installed libraries + their parts (image assets inlined as data URLs). */
  listLibraries: (): Promise<PartLibraryWithParts[]> =>
    ipcRenderer.invoke('parts:listLibraries'),
  /** Reveal `<userData>/parts` in the OS file manager (creates it if missing). */
  openPartsFolder: (): Promise<void> => ipcRenderer.invoke('parts:openPartsFolder'),
  /**
   * Persist a part to `<parts>/<libraryId>/<part.id>/parts.yml` (+ image asset).
   * Defaults to the auto-created local "my-parts" library when `libraryId` is
   * omitted. Resolves to {@link PartsWriteResult} — never rejects.
   */
  savePart: (libraryId: string | undefined, part: PartDefinition): Promise<PartsWriteResult> =>
    ipcRenderer.invoke('parts:savePart', { libraryId, part }),
  /** Delete a part folder (no-op if it doesn't exist). */
  deletePart: (libraryId: string, partId: string): Promise<PartsWriteResult> =>
    ipcRenderer.invoke('parts:deletePart', { libraryId, partId }),
  /** DEV: promote a microcontroller board part into the Standard Boards library
   *  (and, when unpackaged, mirror it into the bundled repo copy so it ships). */
  promoteToStandard: (libraryId: string, partId: string): Promise<PartsWriteResult & { shipped?: boolean }> =>
    ipcRenderer.invoke('parts:promoteToStandard', { libraryId, partId }),
  /** DEV: publish the Standard library to GitHub (bump version + commit + push). */
  publishStandard: (message?: string): Promise<PartsWriteResult & { version?: string }> =>
    ipcRenderer.invoke('parts:publishStandard', message),
  /** Create a new (empty) library from its manifest. */
  createLibrary: (meta: PartLibrary): Promise<PartsWriteResult> =>
    ipcRenderer.invoke('parts:createLibrary', meta),
  /** Delete a whole library folder (no-op if it doesn't exist). */
  deleteLibrary: (libraryId: string): Promise<PartsWriteResult> =>
    ipcRenderer.invoke('parts:deleteLibrary', libraryId),
  /**
   * Read a part driver file's contents so the renderer can copy it onto the
   * board (#184). The `source` is a bundled filename inside the part folder or an
   * `http(s)://` URL (fetched in main). Resolves to {@link DriverSourceResult}.
   */
  readDriverSource: (
    libraryId: string,
    partId: string,
    source: string
  ): Promise<DriverSourceResult> =>
    ipcRenderer.invoke('parts:readDriverSource', { libraryId, partId, source }),
  /** Fetch the master community registry (optionally from a custom URL). */
  fetchRegistry: (url?: string): Promise<PartRegistry> =>
    ipcRenderer.invoke('parts:fetchRegistry', url),
  /** Install (clone) a registry library into the parts folder. */
  installLibrary: (entry: RegistryEntry): Promise<PartsWriteResult> =>
    ipcRenderer.invoke('parts:installLibrary', entry),
  /** Which installed libraries have a newer version available in the registry. */
  checkUpdates: (url?: string): Promise<LibraryUpdate[]> =>
    ipcRenderer.invoke('parts:checkUpdates', url),
  /** The result of the on-startup update check (cached in main), for an instant
   *  indicator without re-hitting the network (#194). */
  cachedUpdates: (): Promise<LibraryUpdate[]> => ipcRenderer.invoke('parts:cachedUpdates')
}

/**
 * Robot definition layer (#128): the project's `robot.yml` (parts + pin-to-pin
 * wiring) that the Board Viewer's Wiring mode reads/writes. `folder` is the open
 * project folder (so the file sits with the user's code); omit it to use the
 * app-data fallback.
 */
const robot = {
  /** Load the project's robot.yml (empty definition if none exists). */
  load: (folder?: string): Promise<RobotDefinition> => ipcRenderer.invoke('robot:load', folder),
  /** Save the robot definition. Resolves to {ok,error} — never rejects. */
  save: (folder: string | undefined, def: RobotDefinition): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('robot:save', { folder, def }),
  /** Subscribe to robot.yml changes from ANOTHER window (e.g. the Board View
   *  adding/removing a part). Returns an unsubscribe. */
  onChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('robot:didChange', listener)
    return () => ipcRenderer.removeListener('robot:didChange', listener)
  }
}

// Minimal, typed API exposed to the renderer. This establishes the IPC
// pattern that later feature work will extend.
/** In-app bug reporting (#206): submit the Report Bug form to the feedback API. */
const feedback = {
  submitBugReport: (payload: BugReportPayload): Promise<BugReportResult> =>
    ipcRenderer.invoke('feedback:submitBugReport', payload)
}

const api = {
  /** Example round-trip channel used to prove the bridge works. */
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  /** The application version (from package.json), shown in the status bar. */
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /** Environment diagnostics (platform / OS / versions) for a bug report (#206). */
  diagnostics: (): Promise<{
    platform: string
    arch: string
    osVersion: string
    electron: string
    snakieVersion: string
  }> => ipcRenderer.invoke('app:diagnostics'),
  /** Capture every open Snakie window (main + Board View + undocked instrument
   *  windows) as labelled data URLs, for a bug report (#206). */
  captureScreenshot: (): Promise<{ title: string; dataUrl: string }[]> =>
    ipcRenderer.invoke('app:captureScreenshot'),
  /** In-app bug reporting (#206). */
  feedback,
  /** Open an http(s) URL externally in the default browser. */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('app:openExternal', url),
  /** Snapshot of the runtime versions for display in the UI. */
  versions: process.versions,
  /** Serial device connection + MicroPython REPL/filesystem layer. */
  device,
  /** Local host filesystem layer. */
  fs,
  /** MicroPython package installer (mip/PyPI) + discovery layer. */
  packages,
  /** Per-component module installer + catalog (issue #120). */
  modules,
  /** In-app MicroPython firmware flashing layer (ESP via esptool, RP2040 via UF2). */
  firmware,
  /** Auto-update check + status + restart layer. */
  updates,
  /** LLM chat layer (multi-provider registry: Claude, OpenAI, Gemini, Grok, Copilot). */
  llm,
  /** Built-in version-control (Git) layer. */
  git,
  /** Python plugin system layer (spawns snakie.host over JSON-RPC). */
  plugins,
  /** Board View layer: floating window + live active-file relay + user boards. */
  board,
  /** Instrument launch relay: board window → main window scope/meter hosting. */
  instruments,
  /** Find & Replace window: native window ↔ main editor find/replace relay. */
  find,
  /** Detached console window: pop the bottom REPL out into its own OS window. */
  console: consoleApi,
  /** Parts Library + Part Editor layer: on-disk parts + community registry. */
  parts,
  /** Robot definition layer: the project's robot.yml (parts + wiring). */
  robot
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
