import { EventEmitter } from 'events'
import { SerialPort } from 'serialport'
import { buildControlLine } from '../../shared/control'
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

/**
 * Control bytes used by the MicroPython REPL.
 *
 * The MicroPython "raw REPL" is a machine-friendly mode that lets a host run a
 * snippet of code and reliably capture its output. The handshake is:
 *
 *  1. Send Ctrl-C (twice) to interrupt anything currently running.
 *  2. Send Ctrl-A to enter raw REPL. The device replies with a banner that
 *     ends in `raw REPL; CTRL-B to exit\r\n>`.
 *  3. Send the code followed by Ctrl-D to execute it. The device responds with
 *     `OK`, then stdout, then `\x04` (end of stdout), then stderr/traceback,
 *     then another `\x04` (end of stderr), then `>` to prompt for more.
 *  4. Send Ctrl-B to leave raw REPL and return to the friendly REPL.
 *
 * @see https://docs.micropython.org/en/latest/reference/repl.html
 */
const CTRL_A = '\x01' // enter raw REPL
const CTRL_B = '\x02' // exit raw REPL
const CTRL_C = '\x03' // interrupt / KeyboardInterrupt
const CTRL_D = '\x04' // soft reset (friendly) / execute (raw)

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
 *  - implement the raw-REPL protocol (`exec`, `eval`),
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
   * Buffer of bytes received from the device. When a command is awaiting a
   * specific marker, {@link readUntil} consumes from this buffer; otherwise
   * incoming bytes are simply forwarded to listeners.
   */
  private rxBuffer = Buffer.alloc(0)

  /** Resolver waiting for a particular byte sequence to appear in `rxBuffer`. */
  private pending: {
    marker: Buffer
    resolve: (data: Buffer) => void
    reject: (err: Error) => void
    timer: NodeJS.Timeout
  } | null = null

  /**
   * Serializes raw-REPL operations. Each `exec` chains onto this promise so two
   * callers never interleave on the wire.
   */
  private opQueue: Promise<unknown> = Promise.resolve()

  /** True once we have entered raw REPL and not yet exited it. */
  private inRawRepl = false

  /** True while an internal `exec` runs — suppresses the console `data` broadcast
   * so raw-REPL/probe traffic (live-value polls, etc.) never hits the terminal. */
  private execActive = false

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
            this.inRawRepl = false
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
    this.inRawRepl = false
    this.failPending(new Error('Disconnected'))
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
    // Always buffer for the raw-REPL reader (readUntil).
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk])
    this.tryResolvePending()
    // Forward raw bytes to the renderer REPL — EXCEPT while an internal `exec`
    // is in flight. Exec drives the raw REPL (banners, Ctrl-C interrupts, our
    // live-value probes like `<<SNKV>>0:9922`); that machine traffic must not
    // pollute the user's console. User typing + Run go through `sendData` (the
    // friendly REPL), not `exec`, so they still stream through.
    if (!this.execActive) this.emit('data', chunk)
  }

  private tryResolvePending(): void {
    if (!this.pending) return
    const idx = this.rxBuffer.indexOf(this.pending.marker)
    if (idx === -1) return
    const end = idx + this.pending.marker.length
    const data = this.rxBuffer.subarray(0, end)
    this.rxBuffer = this.rxBuffer.subarray(end)
    const { resolve, timer } = this.pending
    clearTimeout(timer)
    this.pending = null
    resolve(data)
  }

  private failPending(err: Error): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    const { reject } = this.pending
    this.pending = null
    reject(err)
  }

  /** Write raw bytes to the port, rejecting if not connected. */
  private write(data: string | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.port.isOpen) {
        reject(new Error('Not connected'))
        return
      }
      this.port.write(data, (err) => {
        if (err) {
          reject(new Error(err.message))
          return
        }
        this.port?.drain(() => resolve())
      })
    })
  }

  /**
   * Wait until `marker` appears in the receive buffer, returning everything up
   * to and including it. Rejects after `timeoutMs`.
   */
  private readUntil(marker: string, timeoutMs = 5000): Promise<Buffer> {
    if (this.pending) {
      return Promise.reject(new Error('A read is already in progress'))
    }
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`Timed out waiting for ${JSON.stringify(marker)}`))
      }, timeoutMs)
      this.pending = { marker: Buffer.from(marker, 'binary'), resolve, reject, timer }
      // The marker may already be in the buffer from a previous read.
      this.tryResolvePending()
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
    // Clear any stale buffered output.
    this.rxBuffer = Buffer.alloc(0)
    // Interrupt twice to break out of running code or input().
    await this.write(CTRL_C)
    await this.write(CTRL_C)
    await this.write(CTRL_A)
    await this.readUntil('raw REPL; CTRL-B to exit\r\n>')
    this.inRawRepl = true
  }

  /** Leave raw REPL mode (Ctrl-B), returning to the friendly REPL. */
  async exitRawRepl(): Promise<void> {
    await this.write(CTRL_B)
    this.inRawRepl = false
  }

  /**
   * Execute `code` in the raw REPL and capture its output.
   *
   * Enters raw REPL if not already in it, runs the snippet, and returns the
   * captured stdout/stderr. Operations are serialized so concurrent callers do
   * not corrupt the protocol state.
   */
  exec(code: string, timeoutMs = 10000): Promise<ExecResult> {
    const op = this.opQueue.then(() => this.execLocked(code, timeoutMs))
    // Keep the queue alive even if this op rejects.
    this.opQueue = op.catch(() => undefined)
    return op
  }

  private async execLocked(code: string, timeoutMs: number): Promise<ExecResult> {
    if (!this.isConnected()) {
      throw new Error('Not connected')
    }
    // Suppress the renderer-console broadcast for the WHOLE exec (raw-REPL enter
    // through exit) so probe/banner/interrupt bytes never reach the terminal.
    this.execActive = true
    try {
      const enteredHere = !this.inRawRepl
      if (enteredHere) {
        await this.enterRawRepl()
      }
      try {
        // Send the code and execute with Ctrl-D.
        await this.write(code)
        await this.write(CTRL_D)

        // The device acknowledges a well-formed paste with "OK".
        const ack = await this.readUntil('OK', timeoutMs)
        if (!ack.toString('binary').includes('OK')) {
          throw new Error('Device did not acknowledge code (no "OK")')
        }

        // stdout is everything up to the first \x04.
        const stdoutRaw = await this.readUntil(CTRL_D, timeoutMs)
        const stdout = stdoutRaw.subarray(0, stdoutRaw.length - 1).toString('utf8')

        // stderr/traceback is everything up to the second \x04.
        const stderrRaw = await this.readUntil(CTRL_D, timeoutMs)
        const stderr = stderrRaw.subarray(0, stderrRaw.length - 1).toString('utf8')

        // Consume the trailing prompt so the buffer is clean for the next op.
        await this.readUntil('>', timeoutMs)

        return { stdout, stderr }
      } finally {
        if (enteredHere) {
          // Best-effort return to friendly REPL.
          await this.exitRawRepl().catch(() => undefined)
        }
      }
    } finally {
      this.execActive = false
    }
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

  /**
   * List a directory. Returns entries with name, type and size. Uses
   * `os.ilistdir` when available (gives type + size in one call) and emits a
   * compact, machine-parseable line per entry.
   */
  async listDir(path = '/'): Promise<DirEntry[]> {
    const code = [
      'import os, json',
      `def _ls(p):`,
      '    out=[]',
      '    try:',
      '        it=os.ilistdir(p)',
      '    except AttributeError:',
      '        it=[(n,0,0) for n in os.listdir(p)]',
      '    for e in it:',
      '        name=e[0]; typ=e[1] if len(e)>1 else 0',
      '        full=(p.rstrip("/")+"/"+name) if p else name',
      '        isdir=(typ & 0x4000)!=0',
      '        try: size=0 if isdir else os.stat(full)[6]',
      '        except OSError: size=0',
      '        out.append([name,isdir,size])',
      '    return out',
      `print(json.dumps(_ls(${pyStr(path)})))`
    ].join('\n')
    const raw = (await this.eval(code)).trim()
    const parsed = JSON.parse(raw) as [string, boolean, number][]
    return parsed.map(([name, isDir, size]) => ({ name, isDir, size }))
  }

  /** Read a file from the device and return its contents as a string (UTF-8). */
  async readFile(path: string): Promise<string> {
    const buf = await this.readFileBytes(path)
    return buf.toString('utf8')
  }

  /** Read a file from the device and return its raw bytes. */
  async readFileBytes(path: string): Promise<Buffer> {
    // `ubinascii` is exposed as `binascii` on some ports; import defensively.
    const code = [
      'import sys',
      'try:\n import ubinascii\nexcept ImportError:\n import binascii as ubinascii',
      `with open(${pyStr(path)},'rb') as f:`,
      '    while True:',
      '        b=f.read(256)',
      '        if not b: break',
      '        sys.stdout.write(ubinascii.hexlify(b))'
    ].join('\n')
    const hex = (await this.eval(code)).trim()
    return Buffer.from(hex, 'hex')
  }

  /**
   * Write `contents` to `path`, creating/overwriting the file. The payload is
   * sent in hex-encoded chunks so that arbitrary binary content survives the
   * text-oriented REPL transport.
   */
  async writeFile(path: string, contents: string | Buffer, chunkSize = 256): Promise<void> {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
    // Open the file once, then stream hex chunks via repeated exec calls so we
    // never put a multi-megabyte literal on a single line.
    const open = [
      'import sys',
      'try:\n import ubinascii\nexcept ImportError:\n import binascii as ubinascii',
      `_f=open(${pyStr(path)},'wb')`
    ].join('\n')
    await this.eval(open)
    try {
      for (let i = 0; i < data.length; i += chunkSize) {
        const slice = data.subarray(i, i + chunkSize)
        const hex = slice.toString('hex')
        await this.eval(`_f.write(ubinascii.unhexlify(${pyStr(hex)}))`)
      }
    } finally {
      await this.eval('_f.close()').catch(() => undefined)
    }
  }

  /** Remove a file. */
  async remove(path: string): Promise<void> {
    await this.eval(`import os\nos.remove(${pyStr(path)})`)
  }

  /** Create a directory. */
  async mkdir(path: string): Promise<void> {
    await this.eval(`import os\nos.mkdir(${pyStr(path)})`)
  }

  /** Rename / move a path. */
  async rename(from: string, to: string): Promise<void> {
    await this.eval(`import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`)
  }

  /** Stat a path, returning type, size and mtime when available. */
  async stat(path: string): Promise<StatResult> {
    const code = [
      'import os, json',
      `st=os.stat(${pyStr(path)})`,
      'isdir=(st[0] & 0x4000)!=0',
      'mtime=st[8] if len(st)>8 else None',
      'print(json.dumps([isdir, st[6], mtime]))'
    ].join('\n')
    const raw = (await this.eval(code)).trim()
    const [isDir, size, mtime] = JSON.parse(raw) as [boolean, number, number | null]
    return { isDir, size, mtime: mtime ?? undefined }
  }

  /** Tear down resources (called on app quit). */
  async dispose(): Promise<void> {
    this.removeAllListeners()
    await this.disconnect().catch(() => undefined)
  }
}

/**
 * Render a JS string as a Python string literal, escaping characters that would
 * break out of the quotes. Used to inject paths/data into generated Python.
 */
function pyStr(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
  return `'${escaped}'`
}
