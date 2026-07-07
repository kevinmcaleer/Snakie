/**
 * Browser port of {@link SimulatedDevice} (epic #267 Phase W1) — the same
 * zero-hardware simulated device (issue #135) driven from a Web Worker instead
 * of Electron's main process. Behaviourally identical: REPL, Run (paste mode),
 * synthetic `SNK …` telemetry so instruments animate, `<<SNKV>>` live-pin
 * probe responses, and a REAL in-memory MicroPython VFS for file operations.
 *
 * Differences from the Electron version are purely environmental — no Node
 * `EventEmitter` (a tiny hand-rolled emitter instead) and `Uint8Array`
 * (instead of `Buffer`) for the `data` stream — the actual telemetry/exec/FS
 * logic is shared via `simulation.ts` and `fsSnippets.ts`.
 */
import {
  listDirSnippet,
  mkdirSnippet,
  readFileSnippet,
  removeSnippet,
  renameSnippet,
  statSnippet,
  writeFileSnippet
} from './fsSnippets'
import {
  isProbeCode,
  simulateProbeResponse,
  simulatedTelemetryFrame
} from './simulation'
import type { WebReplRuntime } from './webMicroPythonRuntime'
import type {
  ConnectionState,
  DeviceStatus,
  DirEntry,
  ExecResult,
  StatResult
} from '../../main/device/types'

/** How often the simulated board "prints" a telemetry frame (ms). */
const TELEMETRY_INTERVAL_MS = 120

/** Virtual port path reported for the browser sim (mirrors the Electron
 *  simulated device's `VIRTUAL_PORT_PATH`, kept local so this stays Node-free). */
const VIRTUAL_PORT_PATH = 'sim://web'

/** Sentinel markers emitted by the device install snippet (kept in sync with
 *  `src/main/packages/install.ts` — duplicated here rather than imported so
 *  this module has no Electron/Node dependency). */
const INSTALL_START = '<<SNAKIE_MIP_START>>'
const INSTALL_ERR = '<<SNAKIE_MIP_ERR>>'

const textEncoder = new TextEncoder()

type Listener<T> = (arg: T) => void

/** Minimal typed pub/sub — the browser stand-in for Node's `EventEmitter`,
 *  supporting only the two events {@link WebSimulatedDevice} needs. */
class MiniEmitter {
  private readonly dataListeners = new Set<Listener<Uint8Array>>()
  private readonly statusListeners = new Set<Listener<DeviceStatus>>()

  on(event: 'data', listener: Listener<Uint8Array>): this
  on(event: 'status', listener: Listener<DeviceStatus>): this
  on(event: 'data' | 'status', listener: Listener<never>): this {
    if (event === 'data') this.dataListeners.add(listener as Listener<Uint8Array>)
    else this.statusListeners.add(listener as Listener<DeviceStatus>)
    return this
  }

  off(event: 'data' | 'status', listener: Listener<never>): void {
    if (event === 'data') this.dataListeners.delete(listener as Listener<Uint8Array>)
    else this.statusListeners.delete(listener as Listener<DeviceStatus>)
  }

  emitData(chunk: Uint8Array): void {
    for (const l of this.dataListeners) l(chunk)
  }

  emitStatus(status: DeviceStatus): void {
    for (const l of this.statusListeners) l(status)
  }

  removeAll(): void {
    this.dataListeners.clear()
    this.statusListeners.clear()
  }
}

/**
 * SIMULATED MicroPython device, browser edition. A drop-in analogue of
 * `SnakieDevice` (see `src/main/device/types.ts`) minus the Node-specific
 * bits: `data` chunks are `Uint8Array`, `writeFile` accepts `string |
 * Uint8Array`, and there is no `connect(path)` — the sim always "is" the
 * device, so `connect()` takes no arguments.
 */
export class WebSimulatedDevice {
  private state: ConnectionState = 'disconnected'
  private timer: ReturnType<typeof setInterval> | null = null
  private tick = 0
  private readonly runtime: WebReplRuntime
  private readonly emitter = new MiniEmitter()
  /** Latest control payload per target (for inspection / future feedback). */
  private readonly control = new Map<string, string>()

  constructor(runtime: WebReplRuntime) {
    this.runtime = runtime
  }

  on(event: 'data', listener: Listener<Uint8Array>): this
  on(event: 'status', listener: Listener<DeviceStatus>): this
  on(event: 'data' | 'status', listener: Listener<never>): this {
    this.emitter.on(event as 'data', listener as Listener<Uint8Array>)
    return this
  }

  off(event: 'data' | 'status', listener: Listener<never>): void {
    this.emitter.off(event, listener)
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  getStatus(): DeviceStatus {
    return { state: this.state, path: VIRTUAL_PORT_PATH, baudRate: 115200 }
  }

  isConnected(): boolean {
    return this.state === 'connected'
  }

  async connect(): Promise<void> {
    if (this.state === 'connected') return
    this.setState('connecting')
    try {
      await this.runtime.init((chunk) => this.emitter.emitData(chunk))
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      this.emitter.emitData(
        textEncoder.encode(
          `\r\nSimulated device — Python REPL unavailable (${reason}).\r\n` +
            'Instruments and the Board Viewer still work.\r\n>>> '
        )
      )
    }
    this.setState('connected')
    this.startTelemetry()
  }

  async disconnect(): Promise<void> {
    this.stopTelemetry()
    this.control.clear()
    this.runtime.dispose()
    if (this.state !== 'disconnected') this.setState('disconnected')
  }

  private setState(state: ConnectionState): void {
    this.state = state
    this.emitter.emitStatus({ state, path: VIRTUAL_PORT_PATH, baudRate: 115200 })
  }

  // ---------------------------------------------------------------------------
  // Telemetry stream (board → IDE)
  // ---------------------------------------------------------------------------

  private startTelemetry(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.emitTelemetryFrame(), TELEMETRY_INTERVAL_MS)
  }

  private stopTelemetry(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Emit one frame of `SNK …` telemetry as a single `data` chunk. */
  private emitTelemetryFrame(): void {
    if (this.state !== 'connected') return
    const frame = simulatedTelemetryFrame(this.tick++)
    if (frame.length === 0) return
    this.emitter.emitData(textEncoder.encode(frame.join('\r\n') + '\r\n'))
  }

  // ---------------------------------------------------------------------------
  // REPL / exec
  // ---------------------------------------------------------------------------

  /**
   * Run code in the "raw REPL". The only snippet we meaningfully answer is the
   * Board Viewer's `<<SNKV>>` live-pin probe (with synthetic values, since
   * there is no hardware to read); anything else runs on the real
   * interpreter. Interactive code execution flows through `sendData` → the
   * real REPL.
   */
  async exec(code: string): Promise<ExecResult> {
    if (this.state !== 'connected') throw new Error('Not connected')
    if (isProbeCode(code)) {
      return { stdout: simulateProbeResponse(code, this.tick), stderr: '' }
    }
    // `mip` package installs can't run on the WASM device (no network, and no
    // `mip` module in the port) — answer with a clear, sentinel'd result.
    if (code.includes(INSTALL_START)) {
      return {
        stdout:
          `${INSTALL_START}\n${INSTALL_ERR} Package install needs a network connection and a ` +
          "real board — it isn't available on the simulated device (offline).",
        stderr: ''
      }
    }
    const out = await this.runtime.runCaptured(code)
    return { stdout: out, stderr: '' }
  }

  async eval(code: string): Promise<string> {
    const { stdout, stderr } = await this.exec(code)
    if (stderr.trim().length > 0) throw new Error(stderr.trim())
    return stdout
  }

  /** Feed user keystrokes / Run paste-mode payloads to the real MicroPython REPL. */
  async sendData(data: string): Promise<void> {
    if (this.state !== 'connected') return
    await this.runtime.feed(data)
  }

  /** Record an IDE→board control command (latest-wins per target). */
  async sendControl(target: string, payload = ''): Promise<void> {
    this.control.set(target, payload)
  }

  /** Ctrl-C — interrupt the running program in the real REPL. */
  async interrupt(): Promise<void> {
    await this.sendData('\x03')
  }

  /** Ctrl-D — soft-reset the real REPL. */
  async softReset(): Promise<void> {
    await this.sendData('\x04')
  }

  // ---------------------------------------------------------------------------
  // Filesystem — backed by the interpreter's REAL in-memory VFS (#135).
  // ---------------------------------------------------------------------------

  /** Emscripten MEMFS mounts that aren't part of a "board" — hidden at root. */
  private static readonly SYSTEM_DIRS = new Set(['dev', 'proc', 'tmp', 'home'])

  async listDir(path = '/'): Promise<DirEntry[]> {
    const raw = (await this.runtime.runCaptured(listDirSnippet(path))).trim()
    const parsed = JSON.parse(raw) as [string, boolean, number][]
    const isRoot = path === '' || path === '/'
    return parsed
      .filter(([name, isDir]) => !(isRoot && isDir && WebSimulatedDevice.SYSTEM_DIRS.has(name)))
      .map(([name, isDir, size]) => ({ name, isDir, size }))
  }

  async readFile(path: string): Promise<string> {
    return this.runtime.runCaptured(readFileSnippet(path))
  }

  async writeFile(path: string, contents: string | Uint8Array): Promise<void> {
    const bytes = typeof contents === 'string' ? textEncoder.encode(contents) : contents
    await this.runtime.runCaptured(writeFileSnippet(path, bytesToHex(bytes)))
  }

  async remove(path: string): Promise<void> {
    await this.runtime.runCaptured(removeSnippet(path))
  }

  async mkdir(path: string): Promise<void> {
    await this.runtime.runCaptured(mkdirSnippet(path))
  }

  async rename(from: string, to: string): Promise<void> {
    await this.runtime.runCaptured(renameSnippet(from, to))
  }

  async stat(path: string): Promise<StatResult> {
    const raw = (await this.runtime.runCaptured(statSnippet(path))).trim()
    const [isDir, size, mtime] = JSON.parse(raw) as [boolean, number, number | null]
    return { isDir, size, mtime: mtime ?? undefined }
  }

  async dispose(): Promise<void> {
    this.stopTelemetry()
    this.runtime.dispose()
    this.emitter.removeAll()
    this.state = 'disconnected'
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
