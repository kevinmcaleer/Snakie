import { EventEmitter } from 'events'
import { SerialPort } from 'serialport'
import { buildControlLine } from '../../shared/control'
import { CTRL_C, CTRL_D, RawReplEngine } from '../../shared/raw-repl'
import type {
  ConnectOptions,
  ConnectionState,
  DeviceStatus,
  DirEntry,
  ExecResult,
  PortInfo,
  SnakieDevice,
  StatResult
} from './types'

/** Map of events emitted by {@link MicroPythonDevice} to their payload types. */
export interface MicroPythonDeviceEvents {
  /** Raw bytes received from the device (forwarded to the renderer REPL). */
  data: Buffer
  /** Connection status changed. */
  status: DeviceStatus
}

/**
 * High-level driver for a MicroPython board over a serial connection.
 *
 * Responsibilities:
 *  - own the {@link SerialPort} lifecycle (connect / disconnect / state),
 *  - implement the raw-REPL protocol (`exec`, `eval`) by delegating to the
 *    transport-agnostic {@link RawReplEngine} (issue #281, epic #267 Phase
 *    W0) — this class supplies the engine with a `write` transport and feeds
 *    it received bytes; the browser build supplies the same engine with a Web
 *    Serial transport instead,
 *  - provide filesystem helpers built on top of `exec` so that later features
 *    (file tree, upload, file ops) can reuse them,
 *  - stream raw serial output and status changes via events.
 *
 * The class is deliberately transport-agnostic about Electron: it only emits
 * `data` / `status` events. The IPC layer (see `device/ipc.ts`) wires those to
 * `webContents.send`.
 */
export class MicroPythonDevice extends EventEmitter implements SnakieDevice {
  private port: SerialPort | null = null
  private state: ConnectionState = 'disconnected'
  private currentPath?: string
  private currentBaud?: number

  /**
   * The transport-agnostic raw-REPL protocol engine (buffering, handshake,
   * exec/eval, filesystem helpers). This adapter's only job is to feed it
   * bytes and give it a way to write bytes back.
   */
  private readonly engine = new RawReplEngine({
    write: (data) => this.write(data)
  })

  // ---------------------------------------------------------------------------
  // Typed event helpers (thin wrappers over EventEmitter)
  // ---------------------------------------------------------------------------

  on<E extends keyof MicroPythonDeviceEvents>(
    event: E,
    listener: (payload: MicroPythonDeviceEvents[E]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  emit<E extends keyof MicroPythonDeviceEvents>(
    event: E,
    payload: MicroPythonDeviceEvents[E]
  ): boolean {
    return super.emit(event, payload)
  }

  // ---------------------------------------------------------------------------
  // Port enumeration
  // ---------------------------------------------------------------------------

  /** List the serial ports currently visible to the OS. */
  static async listPorts(): Promise<PortInfo[]> {
    const ports = await SerialPort.list()
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
      vendorId: p.vendorId,
      productId: p.productId,
      friendlyName: (p as { friendlyName?: string }).friendlyName
    }))
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /** Current connection status snapshot (safe to send over IPC). */
  getStatus(): DeviceStatus {
    return {
      state: this.state,
      path: this.currentPath,
      baudRate: this.currentBaud
    }
  }

  isConnected(): boolean {
    return this.state === 'connected' && this.port?.isOpen === true
  }

  /** Open a serial connection to `path` at the given baud rate (default 115200). */
  async connect(path: string, options: ConnectOptions = {}): Promise<void> {
    if (this.port) {
      await this.disconnect()
    }
    const baudRate = options.baudRate ?? 115200
    this.currentPath = path
    this.currentBaud = baudRate
    this.setState('connecting')

    await new Promise<void>((resolve, reject) => {
      const port = new SerialPort({ path, baudRate, autoOpen: false })
      port.open((err) => {
        if (err) {
          this.port = null
          this.setState('error', err.message)
          reject(new Error(err.message))
          return
        }
        this.port = port
        port.on('data', (chunk: Buffer) => this.handleData(chunk))
        port.on('error', (e: Error) => {
          this.setState('error', e.message)
        })
        port.on('close', () => {
          // Only transition if we still think we're connected; an explicit
          // disconnect() handles its own state change.
          if (this.state === 'connected' || this.state === 'connecting') {
            this.port = null
            this.engine.reset()
            this.setState('disconnected')
          }
        })
        this.setState('connected')
        resolve()
      })
    })
  }

  /** Close the serial connection if open. */
  async disconnect(): Promise<void> {
    const port = this.port
    this.port = null
    this.engine.reset()
    if (port && port.isOpen) {
      await new Promise<void>((resolve) => port.close(() => resolve()))
    }
    this.setState('disconnected')
  }

  private setState(state: ConnectionState, error?: string): void {
    this.state = state
    const status: DeviceStatus = {
      state,
      path: this.currentPath,
      baudRate: this.currentBaud
    }
    if (error) status.error = error
    this.emit('status', status)
  }

  // ---------------------------------------------------------------------------
  // Low-level serial IO
  // ---------------------------------------------------------------------------

  private handleData(chunk: Buffer): void {
    // Always feed the raw-REPL engine (its `readUntil` waiters need every byte).
    this.engine.handleData(chunk)
    // Forward raw bytes to the renderer REPL — EXCEPT while an internal `exec`
    // is in flight. Exec drives the raw REPL (banners, Ctrl-C interrupts, our
    // live-value probes like `<<SNKV>>0:9922`); that machine traffic must not
    // pollute the user's console. User typing + Run go through `sendData` (the
    // friendly REPL), not `exec`, so they still stream through.
    if (!this.engine.execActive) this.emit('data', chunk)
  }

  /** Write raw bytes to the port, rejecting if not connected. */
  private write(data: string | Buffer | Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        reject(new Error('Not connected'))
        return
      }
      const payload = typeof data === 'string' ? data : Buffer.from(data)
      this.port.write(payload, (err) => {
        if (err) {
          reject(new Error(err.message))
          return
        }
        this.port?.drain(() => resolve())
      })
    })
  }

  // ---------------------------------------------------------------------------
  // Raw REPL control
  // ---------------------------------------------------------------------------

  /**
   * Write raw user keystrokes to the friendly (`>>>`) REPL. Unlike {@link exec},
   * this performs no raw-REPL handshake — the bytes are sent verbatim, which is
   * exactly what an interactive terminal needs (including control bytes such as
   * Ctrl-C `\x03` and Ctrl-D `\x04`).
   */
  async sendData(data: string): Promise<void> {
    await this.write(data)
  }

  /**
   * Write an IDE→board control line (issue #115): `SNKCMD <target> <payload>\n`.
   *
   * This is the WRITE counterpart of the `SNK …` telemetry the board prints. The
   * line is built + sanitised by {@link buildControlLine} (target reduced to a
   * single token, no embedded newlines that could frame a second command) and
   * sent verbatim over the friendly REPL, exactly like {@link sendData} — the
   * on-device `control` helper polls stdin non-blockingly and applies the latest
   * value per target. No raw-REPL handshake, so it does not interrupt a running
   * program. Latest-wins is enforced on the DEVICE side (the IDE may send freely).
   */
  async sendControl(target: string, payload = ''): Promise<void> {
    await this.write(buildControlLine(target, payload))
  }

  /** Send Ctrl-C to interrupt any running program. */
  async interrupt(): Promise<void> {
    await this.write(CTRL_C)
  }

  /** Send Ctrl-D to perform a soft reset (only meaningful in friendly REPL). */
  async softReset(): Promise<void> {
    await this.write(CTRL_D)
  }

  /** Enter raw REPL mode (Ctrl-A), interrupting any running program first. */
  async enterRawRepl(): Promise<void> {
    await this.engine.enterRawRepl()
  }

  /** Leave raw REPL mode (Ctrl-B), returning to the friendly REPL. */
  async exitRawRepl(): Promise<void> {
    await this.engine.exitRawRepl()
  }

  /**
   * Execute `code` in the raw REPL and capture its output.
   *
   * Enters raw REPL if not already in it, runs the snippet, and returns the
   * captured stdout/stderr. Operations are serialized so concurrent callers do
   * not corrupt the protocol state.
   */
  exec(code: string, timeoutMs = 10000): Promise<ExecResult> {
    // No explicit `isConnected()` guard here: the engine's first `write()`
    // call (via this adapter's `write`) already rejects with 'Not connected'
    // as soon as the port is closed/null, so disconnected calls fail with the
    // same error either way.
    return this.engine.exec(code, timeoutMs)
  }

  /**
   * Run `code` and return its stdout, throwing if the device produced a
   * traceback on stderr. Convenience wrapper around {@link exec} for small
   * snippets whose output we care about.
   */
  async eval(code: string, timeoutMs = 10000): Promise<string> {
    const { stdout, stderr } = await this.exec(code, timeoutMs)
    if (stderr.trim().length > 0) {
      throw new Error(stderr.trim())
    }
    return stdout
  }

  // ---------------------------------------------------------------------------
  // Filesystem helpers (built on top of exec/eval)
  // ---------------------------------------------------------------------------

  /** List a directory. Returns entries with name, type and size. */
  async listDir(path = '/'): Promise<DirEntry[]> {
    return this.engine.listDir(path)
  }

  /** Read a file from the device and return its contents as a string (UTF-8). */
  async readFile(path: string): Promise<string> {
    return this.engine.readFile(path)
  }

  /** Read a file from the device and return its raw bytes. */
  async readFileBytes(path: string): Promise<Buffer> {
    const bytes = await this.engine.readFileBytes(path)
    return Buffer.from(bytes)
  }

  /**
   * Write `contents` to `path`, creating/overwriting the file. The payload is
   * sent in hex-encoded chunks so that arbitrary binary content survives the
   * text-oriented REPL transport.
   */
  async writeFile(path: string, contents: string | Buffer, chunkSize = 256): Promise<void> {
    await this.engine.writeFile(path, contents, chunkSize)
  }

  /** Remove a file OR a directory tree (#219). */
  async remove(path: string): Promise<void> {
    await this.engine.remove(path)
  }

  /** Create a directory. */
  async mkdir(path: string): Promise<void> {
    await this.engine.mkdir(path)
  }

  /** Rename / move a path. */
  async rename(from: string, to: string): Promise<void> {
    await this.engine.rename(from, to)
  }

  /** Stat a path, returning type, size and mtime when available. */
  async stat(path: string): Promise<StatResult> {
    return this.engine.stat(path)
  }

  /** Tear down resources (called on app quit). */
  async dispose(): Promise<void> {
    this.removeAllListeners()
    await this.disconnect().catch(() => undefined)
  }
}
