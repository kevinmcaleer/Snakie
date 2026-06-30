import { EventEmitter } from 'events'
import { VIRTUAL_PORT_PATH } from '../../shared/virtual-device'
import { MicroPythonRuntime, type ReplRuntime } from './MicroPythonRuntime'
import { isProbeCode, simulateProbeResponse, simulatedTelemetryFrame } from './simulation'
import type {
  ConnectionState,
  DeviceStatus,
  DirEntry,
  ExecResult,
  SnakieDevice,
  StatResult
} from './types'

/** How often the simulated board "prints" a telemetry frame (ms). */
const TELEMETRY_INTERVAL_MS = 120

/**
 * SIMULATED MicroPython device (issue #135).
 *
 * A drop-in {@link SnakieDevice} that needs no hardware. It runs a REAL
 * MicroPython interpreter (compiled to WebAssembly, via {@link MicroPythonRuntime})
 * so the REPL, the Run button (paste mode) and `print()` all work — and, on top
 * of that, continuously emits realistic `SNK …` telemetry so the instruments
 * animate and answers the Board Viewer's `<<SNKV>>` live-pin probe with plausible
 * values. The result: you can write and run Python, watch instruments and use the
 * Board Viewer Live View completely offline.
 *
 * Hardware modules (`machine`, etc.) don't exist in the WASM port, so the
 * synthetic telemetry/probe stand in for a board's sensors — the instruments and
 * Live View stay useful without real pins. The REPL output and the telemetry
 * share the `data` channel safely: the Terminal's telemetry filter drops whole
 * `SNK …` lines wherever they fall, and the two are emitted as separate complete
 * chunks, so they never splice into one another.
 *
 * The interpreter is injected as a {@link ReplRuntime} so the device can be
 * unit-tested against a lightweight fake without loading WebAssembly.
 */
export class SimulatedDevice extends EventEmitter implements SnakieDevice {
  private state: ConnectionState = 'disconnected'
  private timer: ReturnType<typeof setInterval> | null = null
  private tick = 0
  private readonly runtime: ReplRuntime
  /** Latest control payload per target (for inspection / future feedback). */
  private readonly control = new Map<string, string>()

  constructor(runtime: ReplRuntime = new MicroPythonRuntime()) {
    super()
    this.runtime = runtime
  }

  on(event: 'data', listener: (chunk: Buffer) => void): this
  on(event: 'status', listener: (status: DeviceStatus) => void): this
  on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void)
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
    // Mimic the real flow: a brief "connecting" then "connected".
    this.setState('connecting')
    try {
      // Boot the interpreter; its banner + prompt stream out via `data`.
      await this.runtime.init((chunk) => this.emit('data', chunk))
    } catch (err) {
      // The REPL couldn't start — still connect so the instruments + Board
      // Viewer work; just print a notice instead of a live Python prompt.
      const reason = err instanceof Error ? err.message : String(err)
      this.emit(
        'data',
        Buffer.from(
          `\r\nSimulated device — Python REPL unavailable (${reason}).\r\n` +
            'Instruments and the Board Viewer still work.\r\n>>> ',
          'utf8'
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
    this.emit('status', { state, path: VIRTUAL_PORT_PATH, baudRate: 115200 })
  }

  // ---------------------------------------------------------------------------
  // Telemetry stream (board → IDE)
  // ---------------------------------------------------------------------------

  private startTelemetry(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.emitTelemetryFrame(), TELEMETRY_INTERVAL_MS)
    // Guard against the interval keeping the app alive on quit (Node only).
    this.timer.unref?.()
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
    this.emit('data', Buffer.from(frame.join('\r\n') + '\r\n', 'utf8'))
  }

  // ---------------------------------------------------------------------------
  // REPL / exec
  // ---------------------------------------------------------------------------

  /**
   * Run code in the "raw REPL". The only snippet we meaningfully answer is the
   * Board Viewer's `<<SNKV>>` live-pin probe (with synthetic values, since there
   * is no hardware to read); anything else returns empty output (no traceback).
   * Interactive code execution flows through {@link sendData} → the real REPL.
   */
  async exec(code: string): Promise<ExecResult> {
    if (this.state !== 'connected') throw new Error('Not connected')
    if (isProbeCode(code)) {
      return { stdout: simulateProbeResponse(code, this.tick), stderr: '' }
    }
    return { stdout: '', stderr: '' }
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
  // Filesystem — a tiny, read-only simulated FS so the device tree isn't broken
  // ---------------------------------------------------------------------------

  async listDir(path = '/'): Promise<DirEntry[]> {
    const root = path === '' || path === '/'
    if (root) {
      return [
        { name: 'boot.py', isDir: false, size: 24 },
        { name: 'main.py', isDir: false, size: 96 },
        { name: 'lib', isDir: true, size: 0 }
      ]
    }
    if (path === '/lib' || path === 'lib') {
      return [{ name: 'snakie_instruments.py', isDir: false, size: 0 }]
    }
    return []
  }

  async readFile(path: string): Promise<string> {
    if (path.endsWith('main.py')) {
      return '# Simulated device — connect real hardware to edit files.\nprint("hello from the simulator")\n'
    }
    return ''
  }

  async writeFile(): Promise<void> {
    // Writes are accepted but not persisted on the simulated device.
  }

  async remove(): Promise<void> {}

  async mkdir(): Promise<void> {}

  async rename(): Promise<void> {}

  async stat(path: string): Promise<StatResult> {
    const isDir = path.endsWith('/lib') || path === '/' || path === ''
    return { isDir, size: isDir ? 0 : 96 }
  }

  async dispose(): Promise<void> {
    this.stopTelemetry()
    this.runtime.dispose()
    this.removeAllListeners()
    this.state = 'disconnected'
  }
}
