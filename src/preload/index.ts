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
import type { FlashMethod } from '../shared/board-profiles'
import type { FirmwareRuntime } from '../shared/firmware-runtime'
import type { BoardIdentity } from '../shared/esptool-identify'
import type {
  CircuitPyDrive,
  ConnectOptions,
  DeviceStatus,
  DirEntry,
  ExecResult,
  IpcResult,
  PortInfo,
  SimMemoryState,
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
} from '../shared/packages/types'
import type { ModuleInstallPlan, ModulePlanFile } from '../main/modules/resolve'
import {
  importProbeSnippet,
  MODULE_PRESENT,
  type ModuleDef
} from '../shared/modules-catalog'
import { writeFailureMessage } from '../shared/install-messages'
import type { RuntimeInfo } from '../shared/dialect'
import { deviceDirsFor } from '../shared/mip-resolve'
import { writeAtomically, type AtomicOps } from '../shared/atomic-write'
import {
  installPlanMessage,
  type InstallFileProgress
} from '../shared/install-file-progress'
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
  GitInitResult,
  GitRemoteResult,
  GitStageResult,
  GitStageScope,
  GitStatus,
  GitPublishOptions,
  GitPublishPreflight,
  GitPublishResult
} from '../main/git/types'
import type {
  LintResult,
  MotionCheckResult,
  MotionReadResult,
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
import type { BundledPartStatus } from '../shared/bundled-seed'
import type { RobotDefinition, RobotPart } from '../shared/robot'
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
  /** Enumerate available serial ports. A port whose CircuitPython board could be
   *  identified from its mounted CIRCUITPY drive carries a `circuitpy` block (#753). */
  listPorts: (): Promise<PortInfo[]> => unwrap(ipcRenderer.invoke('device:listPorts')),
  /** Every mounted CircuitPython filesystem, scanned fresh (#753). */
  circuitpyDrives: (): Promise<CircuitPyDrive[]> =>
    unwrap(ipcRenderer.invoke('device:circuitpyDrives')),
  /** Open a connection to `path` at `opts.baudRate` (default 115200). */
  connect: (path: string, opts?: ConnectOptions): Promise<void> =>
    unwrap(ipcRenderer.invoke('device:connect', path, opts)),
  /** Close the active connection. */
  disconnect: (): Promise<void> => unwrap(ipcRenderer.invoke('device:disconnect')),
  /** Set the GC heap the SIMULATED board boots with (#901). Returns the new
   *  state; `booted` still names the live interpreter's heap, so a caller can
   *  see that a restart is owed. */
  setSimMemory: (bytes: number): Promise<SimMemoryState> =>
    unwrap(ipcRenderer.invoke('device:setSimMemory', bytes)),
  /** The simulated board's configured vs actually-booted heap (#901). */
  getSimMemory: (): Promise<SimMemoryState> => unwrap(ipcRenderer.invoke('device:getSimMemory')),
  /** Current connection status snapshot. */
  getStatus: (): Promise<DeviceStatus> => unwrap(ipcRenderer.invoke('device:getStatus')),
  /** Run code in the raw REPL, returning captured stdout/stderr. */
  exec: (code: string): Promise<ExecResult> => unwrap(ipcRenderer.invoke('device:exec', code)),
  /** Run code and return stdout, throwing on a device traceback. */
  eval: (code: string): Promise<string> => unwrap(ipcRenderer.invoke('device:eval', code)),
  /** Send raw keystrokes to the friendly REPL (interactive terminal input). */
  sendData: (data: string): Promise<void> => unwrap(ipcRenderer.invoke('device:sendData', data)),
  /** Run a whole user PROGRAM, streaming only its output — no source echo / paste
   *  `===` framing (#612). Output arrives via the device data stream. */
  runProgram: (code: string): Promise<void> => unwrap(ipcRenderer.invoke('device:runProgram', code)),
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
  /**
   * Read a file's raw BYTES off the board (#875).
   *
   * `readFile` above decodes as UTF-8, which is the right default for the source
   * files this app mostly moves around and the wrong one for everything else: a
   * `.mpy` read that way comes back as replacement characters, unrecoverably.
   * The `.mpy` viewer needs the real bytes, so it asks for them here — the read
   * mirror of `writeFileBytes` below.
   */
  readFileBytes: (path: string): Promise<Uint8Array> =>
    unwrap<Uint8Array>(ipcRenderer.invoke('device:readFileBytes', path)).then(
      (bytes) => new Uint8Array(bytes)
    ),
  readFileLine: (path: string, prefix: string): Promise<string> =>
    unwrap(ipcRenderer.invoke('device:readFileLine', path, prefix)),
  /** Write contents to a file (created/overwritten), chunked. */
  writeFile: (path: string, contents: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('device:writeFile', path, contents)),
  /**
   * Write raw BYTES to a file on the board (#848).
   *
   * The text `writeFile` above round-trips through UTF-8, which silently
   * mangles anything that is not text — a `.mpy`, a font, an image in an
   * uploaded folder. The module installer has always used this channel for
   * exactly that reason; a folder upload needs it for the same one, so it is
   * exposed here rather than reached for through a private path.
   */
  writeFileBytes: (path: string, bytes: Uint8Array): Promise<void> =>
    unwrap(ipcRenderer.invoke('device:writeFileBytes', path, Buffer.from(bytes))),
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
  /** Show the native "open file" dialog (optionally filtered). Resolves to the
   *  chosen path, or null if cancelled. */
  openFileDialog: (opts?: {
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null> => unwrap(ipcRenderer.invoke('fs:openFileDialog', opts)),
  /**
   * Show the native "save file" dialog (used for the untitled "Save As" flow).
   * `defaultName` seeds the dialog's default path. Resolves to the chosen path,
   * or null if the user cancels.
   */
  saveFileDialog: (
    defaultName?: string,
    opts?: { filters?: { name: string; extensions: string[] }[] }
  ): Promise<string | null> => unwrap(ipcRenderer.invoke('fs:saveFileDialog', defaultName, opts)),
  /** List a directory's entries (directories first, then alphabetical). */
  readDir: (path: string): Promise<FsEntry[]> => unwrap(ipcRenderer.invoke('fs:readDir', path)),
  /** Read a file's contents (UTF-8). */
  readFile: (path: string): Promise<string> => unwrap(ipcRenderer.invoke('fs:readFile', path)),
  /** Read a file's raw bytes (for binary meshes — #319). */
  readFileBytes: (path: string): Promise<Uint8Array> =>
    unwrap<string>(ipcRenderer.invoke('fs:readFileBase64', path)).then((b64) =>
      Uint8Array.from(Buffer.from(b64, 'base64'))
    ),
  /** Write contents to a file (created/overwritten). */
  writeFile: (path: string, contents: string): Promise<void> =>
    unwrap(ipcRenderer.invoke('fs:writeFile', path, contents)),
  /** Write raw bytes to a file (binary PBM / `.spr` sprite exports). */
  writeFileBytes: (path: string, bytes: Uint8Array): Promise<void> =>
    unwrap(
      ipcRenderer.invoke('fs:writeFileBase64', path, Buffer.from(bytes).toString('base64'))
    ),
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

/**
 * Put a resolved package's files on the connected board (#776).
 *
 * THE install step, shared by `packages.install` and `modules.install`: create
 * every ancestor directory (MicroPython has no recursive `mkdir`), then write
 * the files in order. Never throws — a failure comes back as `ok:false` with a
 * message that says the download succeeded and the BOARD refused, because that
 * is a completely different problem from not being able to fetch the package.
 *
 * `onStep` reports per-file progress: this is the slow leg — a package like the
 * Modulino range is 25 files, and over the raw REPL each is a run of hex-chunk
 * round-trips — and silence here reads as a hang.
 */
/** {@link writeAtomically} over the device IPC channels (#864). */
const deviceAtomicOps: AtomicOps = {
  stat: (path) => unwrap<{ size: number }>(ipcRenderer.invoke('device:stat', path)),
  rename: (from, to) => unwrap<void>(ipcRenderer.invoke('device:rename', from, to)),
  remove: (path) => unwrap<void>(ipcRenderer.invoke('device:remove', path))
}

async function writeFilesToBoard(
  name: string,
  files: ModulePlanFile[],
  onStep: (message: string, detail?: InstallFileProgress) => void
): Promise<{ ok: boolean; log: string }> {
  if (files.length === 0) {
    return { ok: false, log: `Couldn't install ${name}: nothing was resolved to write.` }
  }
  let current = ''
  try {
    for (const dir of deviceDirsFor(files.map((f) => f.path))) {
      // An existing directory is fine — MicroPython raises EEXIST for it.
      await unwrap<void>(ipcRenderer.invoke('device:mkdir', dir)).catch(() => undefined)
    }
    // Declare the whole list BEFORE the first write (#895). A progress list that
    // grows as it goes cannot say how much is left, which is the question a user
    // watching a 22-file install is actually asking.
    onStep(installPlanMessage(files), {
      files: files.map((f) => ({ path: f.path, dependency: f.dependency }))
    })
    let done = 0
    for (const [index, file] of files.entries()) {
      current = file.path
      onStep(`Writing ${++done}/${files.length} — ${file.path}…`, {
        fileIndex: index,
        fileState: 'running'
      })
      // A base64 file is BINARY — an Adafruit `.mpy` (#758). It goes down the
      // bytes channel, never the text one: a `.mpy` that took the string route
      // would be silently corrupted by the UTF-8 round-trip and land as a file
      // that imports as garbage.
      const bytes =
        file.encoding === 'base64' ? Buffer.from(file.contents, 'base64') : null
      // All-or-nothing (#864): the file arrives under a temporary name and is
      // moved into place once it is whole, so an interrupted install leaves
      // debris rather than a truncated module that imports as a SyntaxError.
      await writeAtomically(
        deviceAtomicOps,
        file.path,
        bytes ? bytes.length : Buffer.byteLength(file.contents, 'utf8'),
        (tmp) =>
          bytes
            ? unwrap<void>(ipcRenderer.invoke('device:writeFileBytes', tmp, bytes))
            : unwrap<void>(ipcRenderer.invoke('device:writeFile', tmp, file.contents))
      )
      onStep(`Wrote ${done}/${files.length} — ${file.path}`, {
        fileIndex: index,
        fileState: 'done'
      })
    }
    return { ok: true, log: `Wrote ${files.map((f) => f.path).join(', ')}` }
  } catch (err) {
    return {
      ok: false,
      log: writeFailureMessage({
        name,
        path: current || undefined,
        detail: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

/**
 * MicroPython package installer API (issue #20, reworked by #776).
 *
 * `search` / `topPackages` are pure main-process calls (PyPI lives past the
 * CSP). `install` is orchestrated here in the preload: it asks main to DOWNLOAD
 * the package — main has the internet connection, and so does the user's
 * machine generally; the board does not — then writes the files it gets back
 * over the SAME serialized `device:*` channel the rest of the app uses.
 *
 * This used to run `mip.install()` on the board, which needed the BOARD to be
 * online. Boards without WiFi could never install anything, and `mip` is absent
 * from CircuitPython and many vendor builds even when they are online. Progress
 * is reported through an optional callback (purely renderer-side; no main push
 * channel needed).
 */
const packages = {
  /** Curated discovery list of popular MicroPython libraries (offline-safe). */
  topPackages: (): Promise<PackageInfo[]> =>
    unwrap(ipcRenderer.invoke('packages:topPackages')),
  /** Search PyPI + the curated set for `query`. Degrades to curated offline. */
  search: (query: string): Promise<PackageInfo[]> =>
    unwrap(ipcRenderer.invoke('packages:search', query)),
  /**
   * Install `name` onto the connected device: resolve it on this machine, then
   * write its files. Requires an active connection (the device calls reject
   * otherwise). `onProgress` receives lifecycle events; the resolved
   * {@link InstallResult} also carries the full log + any non-fatal notes.
   */
  install: async (
    name: string,
    options?: InstallOptions,
    onProgress?: (p: InstallProgress) => void
  ): Promise<InstallResult> => {
    const emit = (p: InstallProgress): void => onProgress?.(p)
    emit({ name, state: 'started' })

    emit({ name, state: 'running', message: `Downloading ${name}…` })
    let plan: InstallPlan
    try {
      plan = await unwrap<InstallPlan>(
        ipcRenderer.invoke('packages:install', name, options ?? {})
      )
    } catch (err) {
      // Main already composed the explanation (it knows WHY the download
      // failed); pass it through rather than restating it as "install failed".
      const log = err instanceof Error ? err.message : String(err)
      emit({ name, state: 'error', message: `Failed to install ${name}` })
      return { name, ok: false, log, notes: [] }
    }
    for (const note of plan.notes) emit({ name, state: 'note', message: note })

    const written = await writeFilesToBoard(name, plan.files, (message, detail) =>
      emit({ name, state: 'running', message, ...detail })
    )
    emit({
      name,
      state: written.ok ? 'done' : 'error',
      message: written.ok ? `Installed ${name}` : `Failed to install ${name}`
    })
    return { name, ok: written.ok, log: written.log, notes: plan.notes }
  }
}

/** Lifecycle event for a per-module install (#120). Mirrors `InstallProgress`. */
export interface ModuleInstallProgress extends InstallFileProgress {
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
  /** What was written, or why it couldn't be. */
  log: string
  /** Non-fatal notes surfaced during the install (provenance / source hints). */
  notes: string[]
}

/**
 * What the board says it is, or `null` if nothing is connected.
 *
 * An install plan needs this for one source only — the Adafruit CircuitPython
 * bundle, which publishes `.mpy` per CircuitPython MAJOR version (#758). Read
 * here, at the moment of the install, rather than passed in by each caller: the
 * runtime is a fact about the session, not about the click, and every caller
 * remembering to forward it is a caller that can forget. Never throws — a
 * disconnected board yields `null`, and the plan refuses with a reason.
 */
async function connectedRuntime(): Promise<RuntimeInfo | null> {
  try {
    const status = await unwrap<DeviceStatus>(ipcRenderer.invoke('device:getStatus'))
    return status?.runtime ?? null
  } catch {
    return null
  }
}

/**
 * Per-module installer API (issue #120, reworked by #776) — the renderer-facing
 * half of the "modular installs" subsystem.
 *
 * `catalog` is a pure main-process call (the static module registry). `install`
 * is orchestrated HERE in the preload (exactly like `packages.install`): it asks
 * main for the {@link ModuleInstallPlan} — which for an upstream driver means
 * main DOWNLOADS it, because this machine has the internet connection and the
 * board does not — then writes the files over the SAME serialized `device:*`
 * channel the rest of the app uses. That is the #108 path, generalised: one
 * mechanism for a bundled stub and a 25-file package alike.
 *
 * It used to run `mip.install()` on the board for upstream drivers, which asked
 * a board with no radio to fetch from the internet, and asked every board for a
 * `mip` that CircuitPython and many vendor builds don't ship (#769, #776).
 *
 * `probeInstalled` runs a cheap `import <name>` probe per module so the manager
 * can show installed-vs-available without a "list packages" API the firmware
 * doesn't provide.
 */
const modules = {
  /** The full installable-module catalog (offline-safe), grouped by the UI. */
  catalog: (): Promise<ModuleDef[]> => unwrap(ipcRenderer.invoke('modules:catalog')),
  /** Resolve one module id to the files that install it (a bundled stub, an
   *  upstream `mip` spec, or an Adafruit bundle library for the CircuitPython
   *  version this board is running). */
  installPlan: async (id: string): Promise<ModuleInstallPlan> =>
    unwrap(ipcRenderer.invoke('modules:installPlan', id, await connectedRuntime())),
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
    emit({ id, state: 'running', message: `Resolving ${id}…` })

    let plan: ModuleInstallPlan
    try {
      plan = await unwrap<ModuleInstallPlan>(
        ipcRenderer.invoke('modules:installPlan', id, await connectedRuntime())
      )
    } catch (err) {
      // Main already composed the explanation (it knows WHY the download
      // failed); pass it through rather than restating it as "install failed".
      const log = err instanceof Error ? err.message : String(err)
      emit({ id, state: 'error', message: `Failed to install ${id}` })
      return { id, ok: false, log, notes: [] }
    }
    for (const note of plan.notes) emit({ id, state: 'note', message: note })

    const written = await writeFilesToBoard(id, plan.files, (message, detail) =>
      emit({ id, state: 'running', message, ...detail })
    )
    emit({
      id,
      state: written.ok ? 'done' : 'error',
      message: written.ok ? `Installed ${id}` : `Failed to install ${id}`
    })
    return { id, ok: written.ok, log: written.log, notes: plan.notes }
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

  /**
   * Ask the board on `port` what it is — chip, PSRAM, flash size — before
   * anything is written to it. Resolves with an EMPTY identity when the board
   * cannot be reached, so "could not ask" never reads as "has no PSRAM".
   */
  identifyBoard: (port: string): Promise<BoardIdentity> =>
    unwrap(ipcRenderer.invoke('firmware:identify', port)),

  /** Does a firmware URL resolve? Used to confirm a DERIVED address before the
   *  dialog offers it — a composed URL is a guess about a naming convention. */
  firmwareUrlExists: (url: string): Promise<boolean> =>
    unwrap(ipcRenderer.invoke('firmware:urlExists', url)),
  /** Show the native firmware file picker, offering only the extension the given
   *  flash method can use (#686). Resolves the path, or null if cancelled. */
  pickFirmwareFile: (method?: FlashMethod): Promise<string | null> =>
    unwrap(ipcRenderer.invoke('firmware:pickFile', method)),
  /** Flash the given firmware; progress streams via {@link firmware.onProgress}. */
  flash: (opts: FlashOptions): Promise<FlashResult> =>
    unwrap(ipcRenderer.invoke('firmware:flash', opts)),
  /**
   * Fetch a runtime's firmware catalog (Family → Model → Variant → Version
   * cascade) from Thonny's curated lists. `runtime` chooses MicroPython
   * (micropython.org) or CircuitPython (downloads.circuitpython.org) and
   * defaults to MicroPython (#756). Throws when offline.
   */
  fetchCatalog: (runtime?: FirmwareRuntime): Promise<FirmwareCatalog> =>
    unwrap(ipcRenderer.invoke('firmware:fetchCatalog', runtime)),
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
  /**
   * Create a repository in the open folder (#783). Writes `.git` and — only
   * when the folder has none — a starter `.gitignore`; never commits. Rejects
   * with a readable message when git is missing or the folder is already inside
   * a repository, so a failure is never silent.
   */
  init: (): Promise<GitInitResult> => unwrap(ipcRenderer.invoke('git:init')),
  /** Stage a single file. */
  stage: (file: string): Promise<void> => unwrap(ipcRenderer.invoke('git:stage', file)),
  /**
   * Stage a whole group at once (#794) — `untracked`, `changed`, or `all`.
   * Only files git already reports in that group are staged, so `.gitignore` is
   * honoured by construction and conflicted files are left alone. Resolves with
   * a receipt (count + paths + summary); rejects with a readable message when
   * git fails, rather than resolving silently.
   */
  stageAll: (scope?: GitStageScope): Promise<GitStageResult> =>
    unwrap(ipcRenderer.invoke('git:stageAll', scope)),
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
  pull: (): Promise<GitRemoteResult> => unwrap(ipcRenderer.invoke('git:pull')),

  /**
   * What the publish dialog needs before it opens (#795): whether `gh` is
   * installed and signed in, a suggested name, and any tracked files that would
   * be a bad thing to make public. Resolves even when publishing is impossible —
   * the reasons come back in `blockers` for the dialog to render.
   */
  publishPreflight: (): Promise<GitPublishPreflight> =>
    unwrap(ipcRenderer.invoke('git:publishPreflight')),

  /**
   * Create a GitHub repository from the open folder and push to it (#795). Runs
   * `gh repo create --source … --push`, so Snakie never handles a GitHub
   * credential itself. Rejects with a readable message when gh is missing,
   * signed out, or GitHub refuses the name.
   */
  publish: (options: GitPublishOptions): Promise<GitPublishResult> =>
    unwrap(ipcRenderer.invoke('git:publish', options))
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
  reload: (): Promise<PluginStatus> => unwrap(ipcRenderer.invoke('plugins:reload')),
  /**
   * Read a `.py`'s managed Motion Studio blocks (#413) — poses, sequences and
   * servo map — via the host's AST reader. `ok:false` with `pythonFound:false`
   * means no interpreter (skip the round-trip); `ok:false` with an `error` means
   * a broken/hand-edited block (suspend managed rewrite for the file).
   */
  motionRead: (source: string): Promise<MotionReadResult> =>
    unwrap(ipcRenderer.invoke('plugins:motionRead', source)),
  /** Probe whether a `.py`'s managed blocks still parse (validity + schema). */
  motionCheck: (source: string): Promise<MotionCheckResult> =>
    unwrap(ipcRenderer.invoke('plugins:motionCheck', source))
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
  /** The bundled `snakie.py` hardware-umbrella source, installed to `/lib/snakie.py`
   *  alongside `instruments.py` so `from snakie import Servo, …` works on the board. */
  umbrellaSource: (): Promise<string> => ipcRenderer.invoke('instruments:umbrellaSource'),

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
  /** The save was REFUSED because `parts.yml` changed on disk since it was read
   *  (#750) — the UI asks for a reload rather than reporting a broken save. */
  conflict?: boolean
  /** The part was written, but the model its `mesh:` names is not in the folder
   *  it was written to (#787) — the filename, so the UI can say which. */
  missingMesh?: string
  /** The stamp of the file as just written: the caller's new baseline, so the
   *  next save in the same session isn't mistaken for a stale one (#750). */
  sourceHash?: string
}

/**
 * Result of linking a 3-D model to a part (#741). Mirrors the main-process
 * `MeshImportResult`, plus the picker's `cancelled` — never rejects, so the
 * Part Editor's 3-D view shows failures in its own status line.
 */
export interface PartMeshImportResult {
  ok: boolean
  /** The bare filename to record as the part's `mesh`, when `ok`. */
  filename?: string
  /** A byte-identical file was already in the folder; nothing was copied. */
  reused?: boolean
  /** For an STL: its largest bounding-box span in its own units (#787), so the
   *  caller can record `meshUnits` at link time — the only moment it is
   *  knowable, since an `.stl` states no units. Undefined for a `.dae`. */
  maxDim?: number
  /** The user dismissed the file picker — not an error, and not a link. */
  cancelled?: boolean
  error?: string
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
  /** The absolute path of `<userData>/parts` — shown in the Part Editor so a saved
   *  part lands somewhere the user can actually find (#633). */
  partsFolder: (): Promise<string> => ipcRenderer.invoke('parts:partsFolder'),
  /**
   * Persist a part to `<parts>/<libraryId>/<part.id>/parts.yml` (+ image asset).
   * Defaults to the auto-created local "my-parts" library when `libraryId` is
   * omitted. Resolves to {@link PartsWriteResult} — never rejects.
   *
   * `opts.assetsFrom` names the folder the part was OPENED from (library + id).
   * When the save lands somewhere else — a different library, or a renamed id —
   * a linked model sitting in the old folder is copied across with it (#787):
   * the image and help ride in memory and move for free; the mesh only exists on
   * disk.
   */
  savePart: (
    libraryId: string | undefined,
    part: PartDefinition,
    opts?: { assetsFrom?: { libraryId?: string; partId?: string } }
  ): Promise<PartsWriteResult> =>
    ipcRenderer.invoke('parts:savePart', { libraryId, part, assetsFrom: opts?.assetsFrom }),
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
  /**
   * The `.py`/`.mpy` files shipped beside a part's `parts.yml` (#655) — what the
   * Part Editor's Drivers section offers as copy sources, and checks bundled
   * driver filenames against. Resolves to `[]` when the folder doesn't exist.
   */
  listPartFiles: (libraryId: string, partId: string): Promise<string[]> =>
    ipcRenderer.invoke('parts:listPartFiles', { libraryId, partId }),
  /**
   * Link a 3-D model to a part (#741): pick an STL/DAE (or pass `source` to skip
   * the picker) and COPY it into `<parts>/<lib>/<part>/`, so the model travels
   * with the part folder. `replaces` names the mesh the part currently
   * references — the one file this import is allowed to overwrite (#750).
   * Resolves to {@link PartMeshImportResult}; never rejects.
   */
  importMesh: (
    libraryId: string,
    partId: string,
    opts?: { source?: string; replaces?: string }
  ): Promise<PartMeshImportResult> =>
    ipcRenderer.invoke('parts:importMesh', {
      libraryId,
      partId,
      source: opts?.source,
      replaces: opts?.replaces
    }),
  /**
   * Per bundled part: has the user edited it, and does this app ship a newer
   * version than the installed copy (#643)? An edited part is never overwritten by
   * the seeder, so without this the staleness is invisible until something
   * misbehaves.
   */
  bundledStatus: (): Promise<BundledPartStatus[]> => ipcRenderer.invoke('parts:bundledStatus'),
  /** Restore one bundled part to the version this app ships, backing up the
   *  current copy to `<library>/.backups/<id>/` first (#643). */
  resetToBundled: (partId: string): Promise<PartsWriteResult> =>
    ipcRenderer.invoke('parts:resetToBundled', partId),
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
  cachedUpdates: (): Promise<LibraryUpdate[]> => ipcRenderer.invoke('parts:cachedUpdates'),
  /** Subscribe to parts/libraries changing in ANOTHER window (e.g. the Part
   *  Editor saving a board's pins). Lets the main window's board list + the
   *  I²C-detect pin dropdowns refresh without an app reload. Returns unsubscribe. */
  onChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('parts:didChange', listener)
    return () => ipcRenderer.removeListener('parts:didChange', listener)
  }
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
  /** Import an STL/DAE mesh into the robot's `<urdf-folder>/meshes/` (#309).
   *  Without `src`, a native picker chooses the file; with `src` (an absolute path)
   *  that file is copied straight in — used to pull a URDF's own out-of-project
   *  meshes into the project (#407). Resolves to the mesh path relative to the
   *  URDF, or cancelled. */
  importMesh: (
    urdfPath: string,
    src?: string
  ): Promise<{ cancelled?: boolean; error?: string; rel?: string; name?: string }> =>
    ipcRenderer.invoke('robot:importMesh', { urdfPath, src }),
  /** Copy a Parts Library part's BUNDLED mesh into `<urdf-folder>/meshes/` (#406) —
   *  used by the drop bridge when a mesh-linked part is added to a design. Resolves to
   *  the mesh path relative to the URDF + (for an STL) its largest bbox dimension. */
  importPartMesh: (
    urdfPath: string,
    libraryId: string,
    partId: string,
    mesh: string
  ): Promise<{ error?: string; rel?: string; name?: string; maxDim?: number }> =>
    ipcRenderer.invoke('robot:importPartMesh', { urdfPath, libraryId, partId, mesh }),
  /** Subscribe to robot.yml changes from ANOTHER window (e.g. the Board View
   *  adding/removing a part). Returns an unsubscribe. */
  onChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('robot:didChange', listener)
    return () => ipcRenderer.removeListener('robot:didChange', listener)
  },
  /** Targeted robot.yml MODEL merges for the sync reconcile (#717) — link the
   *  urdf if absent, record the board link / a link's mass source, clear orphan
   *  ledger entries, append re-added part rows. Merged in MAIN against the
   *  file's current state, like patchPartLinks below. */
  patchModel: (
    folder: string | undefined,
    patch: {
      ensureUrdf?: string
      boardLink?: string
      linkMass?: { link: string; source: 'measured' | 'library' | 'estimated' | 'none' }
      clearOrphans?: string[]
      addParts?: RobotPart[]
    }
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('robot:patchModel', { folder, patch }),
  /** Record the URDF link a placement created onto its robot.yml part row
   *  (#716) — a targeted merge done in MAIN against the file's current state,
   *  so a slow placement can never revert another window's concurrent edits.
   *  Resolves {ok,error}; a part deleted mid-flight is silently skipped. */
  patchPartLinks: (
    folder: string | undefined,
    links: { partId: string; link: string }[]
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('robot:patchPartLinks', { folder, links }),
  /** Announce that the project `.urdf` was rewritten on disk (#716 — the
   *  placement bridge appending a part's Build body). Fans out to EVERY window
   *  as `onUrdfChanged`, so an open Build view re-reads instead of showing the
   *  new part only after a remount. */
  notifyUrdfChanged: (): void => ipcRenderer.send('robot:urdfChanged'),
  /** Subscribe to on-disk URDF rewrites (from any window). Returns an
   *  unsubscribe. */
  onUrdfChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('robot:didUrdfChange', listener)
    return () => ipcRenderer.removeListener('robot:didUrdfChange', listener)
  }
}

// Minimal, typed API exposed to the renderer. This establishes the IPC
// pattern that later feature work will extend.
/** In-app bug reporting (#206): submit the Report Bug form to the feedback API. */
const feedback = {
  submitBugReport: (payload: BugReportPayload): Promise<BugReportResult> =>
    ipcRenderer.invoke('feedback:submitBugReport', payload)
}

/**
 * Workspace relay + the session's project folder (#775).
 *
 * The workspace switcher lives in `AppShell`, in the main window — so a detached
 * instrument window (or the board window) needs a channel to ask for a switch,
 * the way `board.open()` already crosses that boundary. And the open project
 * folder is a property of the SESSION, not of any window: reading it here means
 * a part can be written to the right `robot.yml` without opening a window to
 * find out which one that is.
 */
const workspace = {
  /** Ask the MAIN window to show a workspace ('code' | 'board' | 'robot').
   *  Fire-and-forget, and sendable from any window including the main one. */
  show: (id: string): void => ipcRenderer.send('workspace:show', id),
  /** Subscribe to a workspace-switch request (the main window listens).
   *  Returns an unsubscribe function. */
  onShow: (cb: (id: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, id: string): void => cb(id)
    ipcRenderer.on('workspace:show', listener)
    return () => ipcRenderer.removeListener('workspace:show', listener)
  },
  /** Subscribe to the app menu's File ▸ Open Folder… request (#882). The main
   *  window listens and raises the picker; returns an unsubscribe function. */
  onOpenFolder: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('workspace:openFolder', listener)
    return () => ipcRenderer.removeListener('workspace:openFolder', listener)
  },
  /** Publish the open project folder (the main window, when it changes). */
  setFolder: (folder?: string): void => ipcRenderer.send('workspace:setFolder', folder),
  /** The open project folder, or null when no folder is open. Readable from any
   *  window, with nothing opened to fetch it. */
  folder: (): Promise<string | null> => ipcRenderer.invoke('workspace:folder')
}

/**
 * The published board index (#893) — "newer than what shipped", fetched here
 * because the renderer's CSP forbids outbound requests. Null on any failure;
 * the renderer keeps its bundled seed.
 */
const boards = {
  fetchIndex: (): Promise<unknown | null> => unwrap(ipcRenderer.invoke('boards:fetchIndex'))
}

const api = {
  boards,
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
  /** Workspace relay + the session's project folder (#775). */
  workspace,
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
