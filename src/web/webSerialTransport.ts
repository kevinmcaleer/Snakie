/**
 * Web Serial transport for the shared MicroPython raw-REPL protocol (issue
 * #283, epic #267 Phase W2).
 *
 * `RawReplEngine` (src/shared/raw-repl.ts, issue #281 Phase W0) needs only a
 * `write(data)` sink and a stream of received `Uint8Array` chunks pushed in
 * via `handleData`. This module supplies that over `navigator.serial`
 * (Chromium's Web Serial API), mirroring exactly how `MicroPythonDevice`
 * (src/main/device/MicroPythonDevice.ts) drives the same engine over
 * `serialport`'s `write()` + `'data'` event — same shape, different transport.
 *
 * Lives under `src/web/` rather than `src/shared/` because it needs DOM +
 * Web Serial ambient types (`@types/w3c-web-serial`) that are not available
 * under `tsconfig.node.json` (no `lib: dom`) — see tsconfig.web.json's
 * `include`.
 *
 * This file has no dependency on any specific UI framework or app shell: it
 * only touches `navigator.serial` and the `SerialPort` it hands back, so it
 * can be unit tested with a plain mocked `SerialPort` object (no real
 * browser/hardware needed) and dropped into a future `web-api.ts` seam
 * unmodified.
 */

/** Options for {@link WebSerialTransport.open}. */
export interface WebSerialOpenOptions {
  /** Baud rate. Defaults to 115200 (the MicroPython convention, matching
   *  `ConnectOptions.baudRate` in `src/main/device/types.ts`). */
  baudRate?: number
}

/** Why a {@link WebSerialTransport} reports a disconnect. */
export type WebSerialDisconnectReason = 'closed' | 'unplugged'

/**
 * Drives a single `SerialPort` for the raw-REPL engine: opens it, pumps its
 * `ReadableStream` into `onData` chunks, and exposes a `write()` the engine
 * can call. Also surfaces the port's native `disconnect` event (unplug) so a
 * higher layer (e.g. `WebSerialDevice`) can update connection state and reset
 * the engine's buffered protocol state.
 *
 * Implements the `RawReplTransport` shape from `shared/raw-repl.ts`
 * structurally (a `write(data): Promise<void>` method) without importing it,
 * to keep this module's only external dependency the Web Serial API itself.
 */
export class WebSerialTransport {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private readLoopPromise: Promise<void> | null = null
  private closing = false
  private readonly encoder = new TextEncoder()
  private readonly onDisconnectListener: (ev: Event) => void

  /**
   * @param port The already-picked/granted `SerialPort` (from `requestPort()`
   *   or `getPorts()` — see `portPicker.ts`).
   * @param onData Called with every chunk read from the board. Feed this
   *   straight into `RawReplEngine.handleData`.
   * @param onDisconnect Called once when the port stops being usable, either
   *   because the browser fired its `disconnect` event (unplugged) or a read
   *   errored out (some platforms only surface the error, not the event).
   *   Never called for an explicit {@link close}.
   */
  constructor(
    private readonly port: SerialPort,
    private readonly onData: (chunk: Uint8Array) => void,
    private readonly onDisconnect: (reason: WebSerialDisconnectReason) => void
  ) {
    this.onDisconnectListener = () => this.handleUnplug()
  }

  /** Open the port at the given baud rate and start the read pump. */
  async open(options: WebSerialOpenOptions = {}): Promise<void> {
    const baudRate = options.baudRate ?? 115200
    await this.port.open({ baudRate })
    this.port.addEventListener('disconnect', this.onDisconnectListener)

    const writable = this.port.writable
    if (!writable) throw new Error('Serial port has no writable stream')
    this.writer = writable.getWriter()

    this.closing = false
    this.readLoopPromise = this.runReadLoop()
  }

  /** Feed bytes to the board. Accepts a string (UTF-8 encoded) or raw bytes. */
  async write(data: string | Uint8Array): Promise<void> {
    if (!this.writer) throw new Error('Not connected')
    const bytes = typeof data === 'string' ? this.encoder.encode(data) : data
    await this.writer.write(bytes)
  }

  /**
   * Toggle DTR/RTS off then on — the equivalent of the reset pulse some
   * boards' USB-serial bridge chips wire to the MCU's reset/bootloader pins.
   * Exposed as an opt-in helper (not called automatically from {@link open}):
   * the Electron `serialport` path doesn't toggle these either today, since
   * MicroPython boards already reset appropriately on a fresh connection —
   * callers that need an explicit hardware reset (e.g. before flashing) can
   * call this directly.
   */
  async resetViaSignals(): Promise<void> {
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: false })
    await this.port.setSignals({ dataTerminalReady: true, requestToSend: true })
  }

  /** Close the port and release all locks/readers/writers. Idempotent. */
  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    this.port.removeEventListener('disconnect', this.onDisconnectListener)

    if (this.reader) {
      await this.reader.cancel().catch(() => undefined)
    }
    // Give the read loop a chance to observe cancellation and release its lock.
    await this.readLoopPromise?.catch(() => undefined)

    if (this.writer) {
      await this.writer.close().catch(() => undefined)
      this.writer.releaseLock()
      this.writer = null
    }
    await this.port.close().catch(() => undefined)
  }

  private async runReadLoop(): Promise<void> {
    const readable = this.port.readable
    if (!readable) throw new Error('Serial port has no readable stream')
    this.reader = readable.getReader()
    try {
      for (;;) {
        const { value, done } = await this.reader.read()
        if (done) break
        if (value) this.onData(value)
      }
    } catch {
      // A read error (most commonly the device being unplugged mid-read)
      // surfaces here rather than via the `disconnect` event on some
      // platforms — treat it the same way, unless we caused it via close().
      if (!this.closing) this.onDisconnect('unplugged')
    } finally {
      this.reader?.releaseLock()
      this.reader = null
    }
  }

  private handleUnplug(): void {
    if (this.closing) return
    this.onDisconnect('unplugged')
  }
}
