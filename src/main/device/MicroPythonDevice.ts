import { EventEmitter } from 'events'
import { stat } from 'fs/promises'
import { join } from 'path'
import { SerialPort } from 'serialport'
import { buildControlLine } from '../../shared/control'
import { delScratch, scratchBlock } from '../../shared/device-scratch'
import {
  RUNTIME_PROBE_PY,
  parseRuntimeProbe,
  runtimeGreeting,
  type RuntimeInfo
} from '../../shared/dialect'
import { RAW_REPL_NO_RESPONSE } from '../../shared/raw-repl'
import { findCircuitPyDrives, pairDriveToPort } from './circuitpy'
import {
  driveListDir,
  driveMkdir,
  driveReadFileBytes,
  driveReadFileLine,
  driveRemove,
  driveRename,
  driveStat,
  driveUsage,
  driveWriteFile,
  readOnlyFsError
} from './circuitpy-fs'
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

  /** What the board said it is (#752), probed on connect. Null until the probe
   *  answers, and stays null for a board that wouldn't say — the rest of the app
   *  reads this instead of assuming MicroPython. Cleared on disconnect so the
   *  next board can't inherit the last one's runtime. */
  private runtime: RuntimeInfo | null = null

  /** The CIRCUITPY drive this board's files live on (#754), resolved once the
   *  runtime probe says it is CircuitPython. Null means "use the REPL", which is
   *  right for MicroPython AND for a CircuitPython board that has handed its
   *  filesystem to itself with `storage.remount`. */
  private mount: string | null = null

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
    /** The IDLE window, re-armed on every chunk — see {@link readUntil}. */
    idleMs: number
  } | null = null

  /** Active while {@link runProgram} streams a program's stdout/stderr to the
   *  console — bytes are forwarded (framing stripped) until a `\x04` terminator. */
  private streamPending: { resolve: () => void; reject: (err: Error) => void } | null = null

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
    const status: DeviceStatus = {
      state: this.state,
      path: this.currentPath,
      baudRate: this.currentBaud
    }
    if (this.runtime) status.runtime = this.runtime
    return status
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
    // Greet: print the board's MicroPython banner so a successful connection is
    // visible (#612). The old "connected" banner was actually the raw-REPL probe's
    // Ctrl-B banner LEAKING — now suppressed — so show it explicitly instead. Fire-
    // and-forget so it never delays or fails the connection.
    void this.greet()
  }

  /**
   * Ask the board what it is, then print its greeting to the terminal — the
   * connect cue the leaked Ctrl-B banner used to provide (#612).
   *
   * One probe serves both jobs (#752). It reads `sys.implementation` for the
   * DIALECT — MicroPython or CircuitPython, which the rest of the app reads off
   * the session rather than assuming — and `os.uname()` for the version, build
   * date and board string that make the greeting read like the board's own.
   * Because each runtime words its banner differently, the line is rebuilt from
   * what was probed rather than hard-coded, so a CircuitPython user isn't
   * greeted with MicroPython's wording.
   *
   * Fire-and-forget: a board that answers neither still connects, and simply
   * shows no banner.
   */
  private async greet(): Promise<void> {
    const info = await this.probeRuntime()
    try {
      if (!info || !this.isConnected()) return
      this.runtime = info
      // Now that we know it is CircuitPython, find the drive its files live on
      // (#754). Best-effort: no drive just means the REPL path, which is what a
      // `storage.remount` board wants anyway.
      if (info.dialect === 'circuitpython') await this.resolveMount()
      // The `connected` status went out before the probe answered, so publish a
      // second one now that the runtime is known.
      this.emit('status', this.getStatus())
      const line = runtimeGreeting(info)
      if (line) {
        this.emit('data', Buffer.from(`\r\n${line}\r\nType "help()" for more information.\r\n>>> `))
      }
    } catch (e) {
      // Best-effort — a board that can't answer still connects. But SAY so: a
      // silent catch here made a wrong runtime label indistinguishable from a
      // transport error, and cost a hardware round-trip to narrow (#770).
      console.warn('[device] greeting failed after a successful probe:', e)
    }
  }

  /**
   * Read the board's runtime, retrying a couple of times before giving up.
   *
   * The probe is fired the instant the port opens, which is the noisiest moment
   * in the session: the board may still be emitting boot output, and #612's
   * Ctrl-B banner consume is running. A probe lost to that noise used to leave
   * the session with NO dialect at all — and because everything downstream keys
   * off it, that silently disabled the status-bar runtime, the greeting, and the
   * CIRCUITPY mount resolution that file writes depend on (#769, #770). The
   * script itself was never at fault; it returns all three lines when pasted by
   * hand on the same board.
   *
   * So: give the board a moment to settle and ask again. Cheap — a board that
   * answers first time (the common case) pays nothing.
   */
  private async probeRuntime(attempts = 3): Promise<RuntimeInfo | null> {
    for (let i = 0; i < attempts; i++) {
      if (!this.isConnected()) return null
      // Let the connect chatter drain before the first ask, and back off after
      // a miss rather than hammering a board that is still booting.
      await new Promise((r) => setTimeout(r, i === 0 ? 120 : 250 * i))
      if (!this.isConnected()) return null
      try {
        const raw = await this.eval(RUNTIME_PROBE_PY)
        const info = parseRuntimeProbe(raw)
        if (info) return info
        // Parsed nothing: the board answered, but not with our marker lines.
        // Show what it DID say — that is the one fact that identifies whether
        // this is transport noise or an unexpected runtime.
        console.warn(
          `[device] runtime probe ${i + 1}/${attempts} unparsed; board said:`,
          JSON.stringify(raw.slice(0, 200))
        )
      } catch (e) {
        console.warn(`[device] runtime probe ${i + 1}/${attempts} threw:`, e)
      }
    }
    console.warn('[device] runtime unknown after', attempts, 'attempts — no dialect for this session')
    return null
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
    // A new connection knows nothing about the board yet, and the PREVIOUS
    // board's runtime must not leak into it — unplugging a Pico and plugging in
    // a Feather would otherwise leave the status bar naming the wrong Python.
    if (state !== 'connected') {
      this.runtime = null
      this.mount = null
    }
    const status: DeviceStatus = {
      state,
      path: this.currentPath,
      baudRate: this.currentBaud
    }
    if (this.runtime) status.runtime = this.runtime
    if (error) status.error = error
    this.emit('status', status)
  }

  // ---------------------------------------------------------------------------
  // Low-level serial IO
  // ---------------------------------------------------------------------------

  private handleData(chunk: Buffer): void {
    // Always buffer for the raw-REPL reader (readUntil / stream pump).
    this.rxBuffer = Buffer.concat([this.rxBuffer, chunk])
    // Bytes arrived, so the device is alive and answering: restart the idle
    // window (#700). A read only fails when the device goes QUIET, never because
    // what it is sending is large.
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.timer = this.armIdleTimer(this.pending.idleMs)
    }
    if (this.streamPending) this.pumpStream()
    else this.tryResolvePending()
    // Forward raw bytes to the renderer REPL — EXCEPT while an internal `exec` or
    // a program `runProgram` is in flight. Exec drives the raw REPL (banners,
    // Ctrl-C interrupts, live-value probes like `<<SNKV>>0:9922`) and runProgram
    // forwards ONLY the program's own stdout/stderr via `pumpStream` (framing
    // stripped) — so neither machine traffic nor the raw-REPL framing pollutes the
    // user's console. User typing goes through `sendData` (friendly REPL).
    if (!this.execActive) this.emit('data', chunk)
  }

  /** During a {@link runProgram} stream, forward buffered program output to the
   *  console up to the next `\x04` terminator (which ends stdout, then stderr),
   *  stripping the terminator. Resolves the stream when it's seen. */
  private pumpStream(): void {
    const idx = this.rxBuffer.indexOf(0x04)
    if (idx === -1) {
      // No terminator yet — the program is still printing; forward it all live.
      if (this.rxBuffer.length > 0) {
        this.emit('data', this.rxBuffer)
        this.rxBuffer = Buffer.alloc(0)
      }
      return
    }
    const out = this.rxBuffer.subarray(0, idx)
    if (out.length > 0) this.emit('data', out)
    this.rxBuffer = this.rxBuffer.subarray(idx + 1) // drop the \x04
    const done = this.streamPending
    this.streamPending = null
    done?.resolve()
  }

  /** Wait for one `\x04`-terminated segment (stdout, then stderr), forwarding it to
   *  the console as it streams. No timeout — a running program may print forever;
   *  it ends when the program finishes or is Stopped (which yields the `\x04`). */
  private streamUntilCtrlD(): Promise<void> {
    if (this.streamPending) return Promise.reject(new Error('A stream is already in progress'))
    return new Promise<void>((resolve, reject) => {
      this.streamPending = { resolve, reject }
      this.pumpStream() // drain anything already buffered (e.g. output right after "OK")
    })
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
    // A program streaming when the port drops must not hang its run promise.
    if (this.streamPending) {
      const { reject } = this.streamPending
      this.streamPending = null
      reject(err)
    }
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

  /** Arm the idle timer that fails the current read after `ms` of SILENCE. */
  private armIdleTimer(ms: number): NodeJS.Timeout {
    return setTimeout(() => {
      const p = this.pending
      this.pending = null
      p?.reject(new Error(`Device went quiet for ${ms}ms waiting for ${JSON.stringify(p.marker.toString('binary'))}`))
    }, ms)
  }

  /**
   * Wait until `marker` appears in the receive buffer, returning everything up
   * to and including it.
   *
   * `timeoutMs` is an **idle** window, not a total budget: it is restarted every
   * time a byte arrives, so a read fails when the device stops answering and never
   * merely because the answer is long (#700).
   *
   * A total budget was wrong by construction here. Reading a file hex-encodes it,
   * so the wire time is proportional to its SIZE: reading the 80 KB
   * `instruments.py` puts 161 KB on the wire, which is 14 s at 115200 baud against
   * a 10 s limit. It could never succeed — and worse, aborting mid-transfer left
   * the board still sending, so the remainder landed in the user's terminal as raw
   * hex.
   */
  private readUntil(marker: string, timeoutMs = 5000): Promise<Buffer> {
    if (this.pending) {
      return Promise.reject(new Error('A read is already in progress'))
    }
    return new Promise<Buffer>((resolve, reject) => {
      this.pending = {
        marker: Buffer.from(marker, 'binary'),
        resolve,
        reject,
        timer: this.armIdleTimer(timeoutMs),
        idleMs: timeoutMs
      }
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
    try {
      await this.readUntil('raw REPL; CTRL-B to exit\r\n>')
    } catch {
      // The board never answered the raw-REPL handshake. The low-level "went
      // quiet" message is opaque here — replace it with something the user can
      // act on (the common causes, in order of likelihood).
      throw new Error(RAW_REPL_NO_RESPONSE)
    }
    this.inRawRepl = true
  }

  /** Leave raw REPL mode (Ctrl-B), returning to the friendly REPL. */
  async exitRawRepl(): Promise<void> {
    // Ctrl-B returns to the friendly REPL, which REPRINTS its `MicroPython v… /
    // Type "help()"…` banner + `>>>` prompt. Consume it so it never leaks to the
    // console after an exec or a Run — otherwise every run looks like the board
    // rebooted (#612). Hold the console-suppression flag OURSELVES for the whole
    // Ctrl-B + banner-consume, so it works regardless of the caller's state (not
    // just inside an execActive window). Short timeout + swallow: a board that
    // doesn't reprint just falls through; drop any residue so nothing leaks late.
    const prevExecActive = this.execActive
    this.execActive = true
    try {
      await this.write(CTRL_B)
      this.inRawRepl = false
      await this.readUntil('>>> ', 2000).catch(() => undefined)
      this.rxBuffer = Buffer.alloc(0)
    } finally {
      this.execActive = prevExecActive
    }
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

  /**
   * After an exec dies mid-flight, get the wire quiet again BEFORE the console
   * starts listening (#700).
   *
   * A failed exec leaves the board still talking — mid `hexlify` dump, mid
   * traceback — and the next thing those bytes reach is the user's terminal, which
   * is how an aborted file read spewed raw hex into a REPL. Interrupt the board,
   * wait for it to actually stop, and bin whatever arrived.
   *
   * Bounded and never throws: this runs on the failure path, where the connection
   * may already be gone, and it must not replace the original error.
   */
  private async resyncAfterFailure(): Promise<void> {
    try {
      if (!this.isConnected()) return
      // Drop any half-read state so nothing tries to resolve against the drain.
      if (this.pending) {
        clearTimeout(this.pending.timer)
        this.pending = null
      }
      await this.write(CTRL_C).catch(() => undefined)
      // Quiet means QUIET: wait for a gap with no new bytes, not a fixed sleep,
      // because how long a board takes to stop depends on what it was doing.
      const QUIET_MS = 250
      const GIVE_UP_MS = 3000
      const started = Date.now()
      let last = this.rxBuffer.length
      let lastChange = Date.now()
      while (Date.now() - started < GIVE_UP_MS) {
        await new Promise((r) => setTimeout(r, 50))
        if (this.rxBuffer.length !== last) {
          last = this.rxBuffer.length
          lastChange = Date.now()
        } else if (Date.now() - lastChange >= QUIET_MS) {
          break
        }
      }
    } catch {
      // Never mask the real failure.
    } finally {
      // Whatever it managed to send is protocol debris, not console output.
      this.rxBuffer = Buffer.alloc(0)
    }
  }

  private async execLocked(code: string, timeoutMs: number): Promise<ExecResult> {
    if (!this.isConnected()) {
      throw new Error('Not connected')
    }
    // Suppress the renderer-console broadcast for the WHOLE exec (raw-REPL enter
    // through exit) so probe/banner/interrupt bytes never reach the terminal.
    this.execActive = true
    let failed = false
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
      } catch (err) {
        // Drain FIRST, while the console broadcast is still suppressed (#700).
        failed = true
        await this.resyncAfterFailure()
        throw err
      } finally {
        if (enteredHere && !failed) {
          // Best-effort return to friendly REPL. Skipped after a resync, which
          // already interrupted the board and left it at the friendly prompt.
          await this.exitRawRepl().catch(() => undefined)
        }
        if (failed) this.inRawRepl = false
      }
    } finally {
      this.execActive = false
    }
  }

  /**
   * Run a whole user PROGRAM, streaming only its output to the console (#612).
   *
   * Unlike {@link sendData} paste mode (which the friendly REPL echoes back with a
   * `paste mode…` banner + `=== ` line prefixes), this uses the RAW REPL, which
   * does not echo the source: enter raw REPL, send the code, then forward only the
   * program's stdout + stderr to the terminal while stripping the `OK` / `\x04` /
   * `>` protocol framing. Resolves when the program finishes; a `while True:` loop
   * resolves only when Stopped (the interrupt yields the terminating `\x04`).
   */
  runProgram(code: string): Promise<void> {
    const op = this.opQueue.then(() => this.runLocked(code))
    this.opQueue = op.catch(() => undefined)
    return op
  }

  private async runLocked(code: string): Promise<void> {
    if (!this.isConnected()) throw new Error('Not connected')
    // Suppress the raw-REPL framing broadcast; the program's own output reaches the
    // console via pumpStream instead.
    this.execActive = true
    try {
      const enteredHere = !this.inRawRepl
      if (enteredHere) await this.enterRawRepl()
      try {
        await this.write(code)
        await this.write(CTRL_D)
        // Acknowledge (strips the "OK"); the raw-REPL banner was already consumed.
        const ack = await this.readUntil('OK')
        if (!ack.toString('binary').includes('OK')) {
          throw new Error('Device did not acknowledge the program (no "OK")')
        }
        // Stream stdout, then stderr (tracebacks), live to the console.
        await this.streamUntilCtrlD()
        await this.streamUntilCtrlD()
        // Consume the trailing prompt so the buffer is clean for the next op.
        await this.readUntil('>')
      } finally {
        if (enteredHere) {
          await this.exitRawRepl().catch(() => undefined)
          // Show a fresh friendly-REPL prompt so the user sees the program ended
          // and they're back at the REPL (the reprinted banner is suppressed by
          // exitRawRepl, so this replaces it with just a clean `>>>`).
          this.emit('data', Buffer.from('\r\n>>> '))
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
  // Where this board's files live (#754)
  // ---------------------------------------------------------------------------

  /** Find the CIRCUITPY drive belonging to THIS port and remember it. Silent on
   *  failure — every caller treats "no mount" as "use the REPL". */
  private async resolveMount(): Promise<void> {
    this.mount = null
    try {
      const drives = await findCircuitPyDrives()
      if (drives.length === 0) return
      const ports = await MicroPythonDevice.listPorts()
      // Normally the connected port is in the list, carrying the USB serial
      // number that identifies the board. Where enumeration reports nothing
      // useful — no permissions, no udev metadata — fall back to the bare path:
      // it can't match by id, but one drive and no other board still can, and
      // any other enumerated port correctly makes it ambiguous.
      const self = ports.find((p) => p.path === this.currentPath) ?? { path: this.currentPath ?? '' }
      const paired = pairDriveToPort(drives, self, ports)
      // An ambiguous pairing deliberately yields nothing: writing to the wrong
      // board's drive is worse than falling back to the REPL (#753).
      this.mount = paired.drive?.mountPath ?? null
      // The drive's `boot_out.txt` carries the per-board build id, which the
      // REPL probe cannot ask for — `sys.implementation` has no such field. It
      // is the only precise key for a CircuitPython firmware-update check
      // (#757), so carry it on the session rather than re-reading the drive
      // later. Only ever from a drive we actually paired to THIS port: an
      // ambiguous pairing leaves it absent, and absent means "offer nothing".
      const boardId = paired.drive?.runtime.boardId
      if (boardId && this.runtime) this.runtime = { ...this.runtime, boardId }
    } catch {
      // Detection is an optimisation over the REPL, never a prerequisite.
    }
  }

  /**
   * The drive to use for filesystem operations right now, or null for the REPL.
   *
   * Re-checked rather than trusted: a CIRCUITPY drive ejects when the board soft
   * reboots and returns a moment later at the same path, so a remembered mount
   * can be a path that does not currently exist. One `stat` of the marker file
   * is cheap; a re-resolve only happens when it has genuinely gone.
   */
  private async driveMount(): Promise<string | null> {
    if (!this.mount) return null
    try {
      await stat(join(this.mount, 'boot_out.txt'))
      return this.mount
    } catch {
      await this.resolveMount()
      return this.mount
    }
  }

  /**
   * Run a filesystem WRITE over the REPL, turning a read-only-filesystem
   * failure into something a user can act on.
   *
   * This is the path a CircuitPython board takes when no drive was found — and
   * the one it takes when the runtime probe couldn't identify it at all, which
   * is exactly when a bare `OSError: 30` would be most baffling. Every other
   * error passes through untouched.
   */
  private async replWrite<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (err) {
      throw readOnlyFsError(err)
    }
  }

  // ---------------------------------------------------------------------------
  // Filesystem helpers (over the drive when there is one, else the REPL)
  // ---------------------------------------------------------------------------

  /**
   * List a directory. Returns entries with name, type and size. Uses
   * `os.ilistdir` when available (gives type + size in one call) and emits a
   * compact, machine-parseable line per entry.
   */
  async listDir(path = '/'): Promise<DirEntry[]> {
    const mount = await this.driveMount()
    if (mount) return driveListDir(mount, path)
    const code = scratchBlock(
      [
        'import os, json',
        `def _snk_ls(p):`,
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
        `print(json.dumps(_snk_ls(${pyStr(path)})))`
      ],
      '_snk_ls'
    )
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
    const mount = await this.driveMount()
    if (mount) return driveReadFileBytes(mount, path)
    // `ubinascii` is exposed as `binascii` on some ports; import defensively.
    const code = scratchBlock(
      [
        'import sys',
        'try:\n import ubinascii\nexcept ImportError:\n import binascii as ubinascii',
        `with open(${pyStr(path)},'rb') as _snk_f:`,
        '    while True:',
        '        _snk_b=_snk_f.read(256)',
        '        if not _snk_b: break',
        '        sys.stdout.write(ubinascii.hexlify(_snk_b))'
      ],
      '_snk_f',
      '_snk_b'
    )
    const hex = (await this.eval(code)).trim()
    return Buffer.from(hex, 'hex')
  }

  /**
   * The first line of `path` starting with `prefix`, or `''` if there is none.
   *
   * The board does the searching, so what crosses the wire is one line rather than
   * the file (#700). That distinction is not a micro-optimisation: reading a file
   * hex-encodes it, so asking for `instruments.py` to learn its `__version__` put
   * 161 KB on the wire — 14 s at 115200 baud — to keep about 25 bytes of it.
   *
   * Line-oriented rather than a head-read on purpose: it does not care where in
   * the file the line sits, so it cannot start failing because a file grew or its
   * header was reordered.
   */
  async readFileLine(path: string, prefix: string): Promise<string> {
    const mount = await this.driveMount()
    if (mount) return driveReadFileLine(mount, path, prefix)
    const code = scratchBlock(
      [
        `_snk_l = ''`,
        `try:`,
        `    with open(${pyStr(path)}) as _snk_f:`,
        `        for _snk_x in _snk_f:`,
        `            if _snk_x.startswith(${pyStr(prefix)}):`,
        `                _snk_l = _snk_x`,
        `                break`,
        `except OSError:`,
        `    pass`,
        `print(_snk_l)`
      ],
      '_snk_l',
      '_snk_f',
      '_snk_x'
    )
    return (await this.eval(code)).trim()
  }

  /**
   * Write `contents` to `path`, creating/overwriting the file. The payload is
   * sent in hex-encoded chunks so that arbitrary binary content survives the
   * text-oriented REPL transport.
   */
  async writeFile(path: string, contents: string | Buffer, chunkSize = 256): Promise<void> {
    const mount = await this.driveMount()
    if (mount) return driveWriteFile(mount, path, contents)
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
    // Open the file once, then stream hex chunks via repeated exec calls so we
    // never put a multi-megabyte literal on a single line. `_snk_f` is the one
    // scratch global that must OUTLIVE its snippet — the handle is what the next
    // chunk writes to — so it carries the prefix and is unbound on close (#798).
    const open = [
      'import sys',
      'try:\n import ubinascii\nexcept ImportError:\n import binascii as ubinascii',
      `_snk_f=open(${pyStr(path)},'wb')`
    ].join('\n')
    await this.replWrite(() => this.eval(open))
    try {
      for (let i = 0; i < data.length; i += chunkSize) {
        const slice = data.subarray(i, i + chunkSize)
        const hex = slice.toString('hex')
        await this.replWrite(() => this.eval(`_snk_f.write(ubinascii.unhexlify(${pyStr(hex)}))`))
      }
    } finally {
      // Close AND unbind: a handle left bound holds the file open on the board
      // for as long as the name lives, whichever way the transfer ended. The
      // close is guarded so the unbind still runs when there is nothing to close
      // (an `open()` that failed never bound it).
      await this.eval(
        ['try: _snk_f.close()', 'except Exception: pass', delScratch('_snk_f')].join('\n')
      ).catch(() => undefined)
    }
  }

  /** Remove a file OR a directory tree. `os.remove()` can't delete directories
   *  (and `os.rmdir()` only empty ones), so walk depth-first with an explicit
   *  stack: children first, then the emptied folder (#219). */
  async remove(path: string): Promise<void> {
    const mount = await this.driveMount()
    if (mount) return driveRemove(mount, path)
    await this.replWrite(() =>
      this.eval(
        // In a `scratchBlock` because this one RAISES on a path that isn't there
        // — the error still reaches the caller, but the walk's stack doesn't stay
        // bound on the board afterwards (#798).
        scratchBlock(
          [
            'import os',
            `_snk_s = [${pyStr(path)}]`,
            'while _snk_s:',
            '    _snk_p = _snk_s[-1]',
            '    if (os.stat(_snk_p)[0] & 0x4000) != 0:',
            '        _snk_c = os.listdir(_snk_p)',
            '        if _snk_c:',
            "            _snk_s.extend([_snk_p + '/' + _snk_x for _snk_x in _snk_c])",
            '        else:',
            '            os.rmdir(_snk_p)',
            '            _snk_s.pop()',
            '    else:',
            '        os.remove(_snk_p)',
            '        _snk_s.pop()'
          ],
          '_snk_s',
          '_snk_p',
          '_snk_c'
        )
      )
    )
  }

  /** Create a directory. */
  async mkdir(path: string): Promise<void> {
    const mount = await this.driveMount()
    if (mount) return driveMkdir(mount, path)
    await this.replWrite(() => this.eval(`import os\nos.mkdir(${pyStr(path)})`))
  }

  /** Rename / move a path. */
  async rename(from: string, to: string): Promise<void> {
    const mount = await this.driveMount()
    if (mount) return driveRename(mount, from, to)
    await this.replWrite(() => this.eval(`import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`))
  }

  /** Stat a path, returning type, size and mtime when available. */
  async stat(path: string): Promise<StatResult> {
    const mount = await this.driveMount()
    if (mount) return driveStat(mount, path)
    const code = scratchBlock(
      [
        'import os, json',
        `_snk_st=os.stat(${pyStr(path)})`,
        '_snk_isdir=(_snk_st[0] & 0x4000)!=0',
        '_snk_mtime=_snk_st[8] if len(_snk_st)>8 else None',
        'print(json.dumps([_snk_isdir, _snk_st[6], _snk_mtime]))'
      ],
      '_snk_st',
      '_snk_isdir',
      '_snk_mtime'
    )
    const raw = (await this.eval(code)).trim()
    const [isDir, size, mtime] = JSON.parse(raw) as [boolean, number, number | null]
    return { isDir, size, mtime: mtime ?? undefined }
  }

  /**
   * Free/total bytes for the flash gauge (#211), when this board's files live on
   * a drive (#754).
   *
   * Null means "ask the board", which is what every MicroPython board wants. For
   * a mounted CircuitPython board the HOST has the honest number: `os.statvfs`
   * there describes a filesystem the board cannot write to, while the gauge is
   * answering "how much room is left for what I am about to copy".
   */
  async driveUsage(): Promise<{ total: number; free: number; used: number } | null> {
    const mount = await this.driveMount()
    return mount ? driveUsage(mount) : null
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
