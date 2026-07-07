/**
 * MicroPython device driver over Web Serial (issue #283, epic #267 Phase W2).
 *
 * `WebSerialDevice` mirrors the public surface of
 * `src/main/device/MicroPythonDevice.ts` (the Electron/`serialport` adapter)
 * as closely as possible: connect/disconnect, status + data events, exec/eval,
 * and the filesystem helpers. Both classes are thin adapters around the same
 * transport-agnostic `RawReplEngine` (src/shared/raw-repl.ts, issue #281 Phase
 * W0) — this one drives it with a `WebSerialTransport` instead of
 * `serialport`. Because `listDir`/`readFile`/`writeFile`/etc. are all built on
 * top of `exec`/`eval` inside the shared engine, they work here with zero
 * extra protocol code — the "file tree / module installs / instrument
 * streaming come for free" claim from the epic (#267), proven at the class
 * level.
 *
 * **Deviation from `SnakieDevice` (`src/main/device/types.ts`):** that
 * interface is `Buffer`-typed (`readFileBytes(): Promise<Buffer>`,
 * `writeFile(path, contents: string | Buffer)`) because it crosses the
 * Electron IPC boundary as Node data. `Buffer` doesn't exist in a plain
 * browser target, so this class uses `Uint8Array` throughout instead and is
 * not literally declared `implements SnakieDevice`. Once the `window.api`
 * seam split (issue #281's other half) lands a `web-api.ts`, that thin layer
 * is the natural place to convert `Uint8Array` <-> `Buffer` at the boundary —
 * exactly the same pattern `MicroPythonDevice` already uses for the IPC
 * boundary today.
 *
 * Lives under `src/web/` (not `src/shared/`) because `WebSerialTransport`
 * needs DOM + Web Serial types unavailable under `tsconfig.node.json`.
 */
import { buildControlLine } from '../shared/control'
import { CTRL_C, CTRL_D, RawReplEngine } from '../shared/raw-repl'
import type { DirEntry, ExecResult, StatResult } from '../shared/raw-repl'
import { WebSerialTransport } from './webSerialTransport'
import type { WebSerialOpenOptions } from './webSerialTransport'

/** Connection lifecycle states — matches `ConnectionState` in `device/types.ts`. */
export type WebSerialConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Current status of the device connection. Matches `DeviceStatus`'s shape. */
export interface WebSerialDeviceStatus {
  state: WebSerialConnectionState
  baudRate?: number
  /** Populated when `state === 'error'`. */
  error?: string
}

/** Listener signatures for {@link WebSerialDevice}'s two event kinds. */
export interface WebSerialDeviceEvents {
  /** Raw bytes received from the device (forward to the REPL/console UI). */
  data: (chunk: Uint8Array) => void
  /** Connection status changed. */
  status: (status: WebSerialDeviceStatus) => void
}

/**
 * High-level driver for a MicroPython board over a Web Serial connection.
 * Construct with a `SerialPort` obtained from `portPicker.ts`
 * (`requestSnakiePort()` or the `getGrantedPorts()` fast-path), then
 * {@link connect}.
 */
export class WebSerialDevice {
  private transport: WebSerialTransport | null = null
  private state: WebSerialConnectionState = 'disconnected'
  private currentBaud?: number
  private readonly listeners: {
    data: Set<(chunk: Uint8Array) => void>
    status: Set<(status: WebSerialDeviceStatus) => void>
  } = { data: new Set(), status: new Set() }

  /**
   * The transport-agnostic raw-REPL protocol engine (buffering, handshake,
   * exec/eval, filesystem helpers) — the exact same class `MicroPythonDevice`
   * uses, just driven by a different transport.
   */
  private readonly engine = new RawReplEngine({
    write: (data) => this.write(data)
  })

  constructor(private readonly port: SerialPort) {}

  // ---------------------------------------------------------------------------
  // Typed event helpers
  // ---------------------------------------------------------------------------

  on<E extends keyof WebSerialDeviceEvents>(event: E, listener: WebSerialDeviceEvents[E]): this {
    this.listeners[event].add(listener as never)
    return this
  }

  off<E extends keyof WebSerialDeviceEvents>(event: E, listener: WebSerialDeviceEvents[E]): this {
    this.listeners[event].delete(listener as never)
    return this
  }

  private emitData(chunk: Uint8Array): void {
    for (const listener of this.listeners.data) listener(chunk)
  }

  private emitStatus(status: WebSerialDeviceStatus): void {
    for (const listener of this.listeners.status) listener(status)
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  /** Current connection status snapshot. */
  getStatus(): WebSerialDeviceStatus {
    return { state: this.state, baudRate: this.currentBaud }
  }

  isConnected(): boolean {
    return this.state === 'connected'
  }

  /** Open the Web Serial connection at the given baud rate (default 115200). */
  async connect(options: WebSerialOpenOptions = {}): Promise<void> {
    if (this.transport) {
      await this.disconnect()
    }
    const baudRate = options.baudRate ?? 115200
    this.currentBaud = baudRate
    this.setState('connecting')

    const transport = new WebSerialTransport(
      this.port,
      (chunk) => this.handleData(chunk),
      (reason) => this.handleTransportDisconnect(reason)
    )
    try {
      await transport.open({ baudRate })
    } catch (err) {
      this.transport = null
      const message = err instanceof Error ? err.message : String(err)
      this.setState('error', message)
      throw err instanceof Error ? err : new Error(message)
    }
    this.transport = transport
    this.setState('connected')
  }

  /** Close the Web Serial connection if open. */
  async disconnect(): Promise<void> {
    const transport = this.transport
    this.transport = null
    this.engine.reset()
    if (transport) {
      await transport.close()
    }
    this.setState('disconnected')
  }

  /**
   * Called when the transport reports the port stopped being usable (unplug,
   * or a read error) rather than an explicit {@link disconnect}. Unlike a
   * user-driven `disconnect()`, this does NOT clear `this.port` — the port
   * object itself is what a caller can later re-open via `connect()` once
   * it's replugged, without another `requestPort()` prompt (Web Serial only
   * needs a user gesture the first time a specific device is granted).
   */
  private handleTransportDisconnect(reason: 'closed' | 'unplugged'): void {
    if (!this.transport) return
    this.transport = null
    this.engine.reset()
    this.setState('disconnected', reason === 'unplugged' ? 'Device unplugged' : undefined)
  }

  private setState(state: WebSerialConnectionState, error?: string): void {
    this.state = state
    const status: WebSerialDeviceStatus = { state, baudRate: this.currentBaud }
    if (error) status.error = error
    this.emitStatus(status)
  }

  // ---------------------------------------------------------------------------
  // Low-level serial IO
  // ---------------------------------------------------------------------------

  private handleData(chunk: Uint8Array): void {
    // Always feed the raw-REPL engine (its `readUntil` waiters need every byte).
    this.engine.handleData(chunk)
    // Forward raw bytes to the console UI — EXCEPT while an internal `exec` is
    // in flight, exactly like `MicroPythonDevice.handleData` (see its comment):
    // exec drives the raw REPL (banners, Ctrl-C interrupts, live-value probes)
    // and that machine traffic must not pollute the user's console.
    if (!this.engine.execActive) this.emitData(chunk)
  }

  /** Write raw bytes to the port, rejecting if not connected. */
  private write(data: string | Uint8Array): Promise<void> {
    if (!this.transport) return Promise.reject(new Error('Not connected'))
    return this.transport.write(data)
  }

  // ---------------------------------------------------------------------------
  // Raw REPL control
  // ---------------------------------------------------------------------------

  /** Write raw user keystrokes to the friendly (`>>>`) REPL, verbatim — no
   *  raw-REPL handshake, matching `MicroPythonDevice.sendData`. */
  async sendData(data: string): Promise<void> {
    await this.write(data)
  }

  /** Write an IDE→board control line (issue #115): `SNKCMD <target> <payload>\n`.
   *  See `MicroPythonDevice.sendControl` for the full protocol description. */
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

  /** Toggle DTR/RTS — see `WebSerialTransport.resetViaSignals`. No-op if not connected. */
  async resetViaSignals(): Promise<void> {
    await this.transport?.resetViaSignals()
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
   * Execute `code` in the raw REPL and capture its output. Enters raw REPL if
   * not already in it; operations are serialized so concurrent callers don't
   * corrupt the protocol state.
   */
  exec(code: string, timeoutMs = 10000): Promise<ExecResult> {
    return this.engine.exec(code, timeoutMs)
  }

  /**
   * Run `code` and return its stdout, throwing if the device produced a
   * traceback on stderr.
   */
  async eval(code: string, timeoutMs = 10000): Promise<string> {
    const { stdout, stderr } = await this.exec(code, timeoutMs)
    if (stderr.trim().length > 0) {
      throw new Error(stderr.trim())
    }
    return stdout
  }

  // ---------------------------------------------------------------------------
  // Filesystem helpers (built on top of exec/eval — free once exec works)
  // ---------------------------------------------------------------------------

  async listDir(path = '/'): Promise<DirEntry[]> {
    return this.engine.listDir(path)
  }

  async readFile(path: string): Promise<string> {
    return this.engine.readFile(path)
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    return this.engine.readFileBytes(path)
  }

  async writeFile(path: string, contents: string | Uint8Array, chunkSize = 256): Promise<void> {
    await this.engine.writeFile(path, contents, chunkSize)
  }

  /** Remove a file OR a directory tree (#219). */
  async remove(path: string): Promise<void> {
    await this.engine.remove(path)
  }

  async mkdir(path: string): Promise<void> {
    await this.engine.mkdir(path)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.engine.rename(from, to)
  }

  async stat(path: string): Promise<StatResult> {
    return this.engine.stat(path)
  }

  /** Tear down resources. */
  async dispose(): Promise<void> {
    this.listeners.data.clear()
    this.listeners.status.clear()
    await this.disconnect().catch(() => undefined)
  }
}
