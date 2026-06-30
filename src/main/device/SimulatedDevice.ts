import { EventEmitter } from 'events'
import { VIRTUAL_PORT_PATH } from '../../shared/virtual-device'
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

/** Boot banner the simulated friendly REPL greets with. */
const BANNER =
  '\r\nMicroPython v1.24.0 (Snakie simulator) on rp2; Virtual board with RP2040\r\n' +
  'Type "help()" for more information.\r\n>>> '

/**
 * SIMULATED MicroPython device (issue #135).
 *
 * A drop-in {@link SnakieDevice} that needs no hardware: it fakes the friendly
 * REPL (banner + keystroke echo), continuously emits realistic `SNK …` telemetry
 * so the instruments animate, and answers the Board Viewer's `<<SNKV>>` live-pin
 * probe with plausible values — letting users explore Snakie, the instruments
 * and the Board Viewer Live View completely offline.
 *
 * It deliberately mirrors {@link MicroPythonDevice}'s public surface (and emits
 * the same `data` / `status` events) so `device/ipc.ts` can route to it for the
 * reserved virtual port without any special-casing downstream. All the signal
 * generation lives in the pure `simulation.ts` helpers; this class only owns the
 * connection lifecycle, the telemetry timer and the fake REPL/filesystem.
 */
export class SimulatedDevice extends EventEmitter implements SnakieDevice {
  private state: ConnectionState = 'disconnected'
  private timer: ReturnType<typeof setInterval> | null = null
  private tick = 0
  /** Latest control payload per target (for inspection / future feedback). */
  private readonly control = new Map<string, string>()

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
    this.setState('connected')
    // Greet on the friendly REPL, then start the telemetry stream.
    this.emit('data', Buffer.from(BANNER, 'utf8'))
    this.startTelemetry()
  }

  async disconnect(): Promise<void> {
    this.stopTelemetry()
    this.control.clear()
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
   * Board Viewer's `<<SNKV>>` live-pin probe; anything else returns empty output
   * (no traceback), which is enough for the offline experience.
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

  /** Echo user keystrokes back to the fake REPL so typing feels alive. */
  async sendData(data: string): Promise<void> {
    if (this.state !== 'connected') return
    if (data.includes('\x03')) {
      // Ctrl-C → KeyboardInterrupt and a fresh prompt.
      this.emit('data', Buffer.from('\r\nKeyboardInterrupt\r\n>>> ', 'utf8'))
      return
    }
    if (data.includes('\x04')) {
      // Ctrl-D → soft reset: re-print the banner.
      this.emit('data', Buffer.from(BANNER, 'utf8'))
      return
    }
    // Echo what was typed; on Enter, drop to a new prompt line.
    const echoed = data.replace(/\r/g, '\r\n>>> ')
    this.emit('data', Buffer.from(echoed, 'utf8'))
  }

  /** Record an IDE→board control command (latest-wins per target). */
  async sendControl(target: string, payload = ''): Promise<void> {
    this.control.set(target, payload)
  }

  async interrupt(): Promise<void> {
    await this.sendData('\x03')
  }

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
    this.removeAllListeners()
    this.state = 'disconnected'
  }
}
