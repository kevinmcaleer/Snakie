/**
 * Transport-agnostic MicroPython raw-REPL protocol engine (issue #281, epic #267
 * Phase W0 — "the seam").
 *
 * This module used to live inline in `src/main/device/MicroPythonDevice.ts`,
 * tangled together with `serialport`. It has been extracted here so a second
 * transport — Web Serial, for the browser build — can drive the exact same
 * protocol/state-machine code without depending on Node or Electron.
 *
 * Everything on the wire is modelled as `Uint8Array` (not Node's `Buffer`) so
 * this module has zero Node dependencies and can run in a browser tab or a Web
 * Worker unmodified. `serialport` (Electron main) and Web Serial (browser) both
 * happily accept/emit anything that quacks like `Uint8Array`.
 *
 * @see https://docs.micropython.org/en/latest/reference/repl.html
 */

/**
 * The only thing this engine needs from its host: a way to write bytes to the
 * wire, in order, one at a time, resolving once the write has been flushed.
 * Received bytes are pushed IN via {@link RawReplEngine.handleData} — the
 * engine does not subscribe to anything itself, so callers stay in full
 * control of when/whether raw traffic reaches other listeners (e.g. suppress
 * a console broadcast while an internal exec is in flight).
 */
export interface RawReplTransport {
  write(data: string | Uint8Array): Promise<void>
}

/** Result of running code in the raw REPL. */
export interface ExecResult {
  /** Decoded stdout captured between the raw-REPL output markers. */
  stdout: string
  /** Decoded stderr / traceback captured after the first `\x04` marker. */
  stderr: string
}

/** A single entry returned by {@link RawReplEngine.listDir}. */
export interface DirEntry {
  name: string
  /** True when the entry is a directory. */
  isDir: boolean
  /** File size in bytes (0 for directories). */
  size: number
}

/** Result of {@link RawReplEngine.stat}, mirroring `os.stat` essentials. */
export interface StatResult {
  isDir: boolean
  size: number
  /** st_mtime (seconds since epoch) as reported by the device, if available. */
  mtime?: number
}

/** Control bytes used by the MicroPython REPL. */
export const CTRL_A = '\x01' // enter raw REPL
export const CTRL_B = '\x02' // exit raw REPL
export const CTRL_C = '\x03' // interrupt / KeyboardInterrupt
export const CTRL_D = '\x04' // soft reset (friendly) / execute (raw)

// ---------------------------------------------------------------------------
// Byte-buffer helpers (Uint8Array equivalents of the Buffer calls the old
// implementation relied on — see MicroPythonDevice.ts pre-#281 history).
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

/** Encode a plain ASCII/latin1 string (protocol markers, hex digits) to bytes. */
function asciiToBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff
  return out
}

/** Decode a string, assuming UTF-8 (used for REPL stdout/stderr). */
function bytesToUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** Find `needle` within `haystack`, or -1. Naive but fine for small buffers. */
function indexOfSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) return 0
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

/**
 * Render a JS string as a Python string literal, escaping characters that
 * would break out of the quotes. Used to inject paths/data into generated
 * Python.
 */
function pyStr(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
  return `'${escaped}'`
}

/**
 * Transport-agnostic implementation of the MicroPython raw-REPL handshake
 * (`exec`/`eval`) plus the filesystem helpers built on top of it. Owns receive
 * buffering and the "wait for marker" logic; knows nothing about serial ports,
 * Web Serial, or any other specific transport — just an object it can call
 * `.write()` on.
 *
 * Usage: construct with a {@link RawReplTransport}, feed every received chunk
 * to {@link handleData}, then call {@link exec}/{@link eval}/the filesystem
 * helpers as needed. Call {@link reset} when the underlying connection drops
 * so stale buffered state doesn't leak into the next connection.
 */
export class RawReplEngine {
  private rxBuffer: Uint8Array = new Uint8Array(0)

  private pending: {
    marker: Uint8Array
    resolve: (data: Uint8Array) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  /** Serializes raw-REPL operations so two callers never interleave on the wire. */
  private opQueue: Promise<unknown> = Promise.resolve()

  /** True once we have entered raw REPL and not yet exited it. */
  private inRawRepl = false

  constructor(private readonly transport: RawReplTransport) {}

  /** True while an internal `exec` is in flight (enter raw-REPL through exit). */
  get execActive(): boolean {
    return this._execActive
  }
  private _execActive = false

  /**
   * Feed newly-received bytes into the engine. Callers own subscribing to the
   * underlying transport's data event and should call this for every chunk,
   * before deciding whether to also forward the chunk elsewhere (e.g. a
   * console view) — see {@link execActive} to suppress that while a probe is
   * in flight.
   */
  handleData(chunk: Uint8Array): void {
    this.rxBuffer = concatBytes(this.rxBuffer, chunk)
    this.tryResolvePending()
  }

  /** Clear all buffered/pending state. Call this when the connection drops. */
  reset(): void {
    this.rxBuffer = new Uint8Array(0)
    this.inRawRepl = false
    this.failPending(new Error('Disconnected'))
  }

  private tryResolvePending(): void {
    if (!this.pending) return
    const idx = indexOfSubarray(this.rxBuffer, this.pending.marker)
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

  private write(data: string | Uint8Array): Promise<void> {
    return this.transport.write(data)
  }

  /**
   * Wait until `marker` (an ASCII/latin1 string) appears in the receive
   * buffer, returning everything up to and including it. Rejects after
   * `timeoutMs`.
   */
  private readUntil(marker: string, timeoutMs = 5000): Promise<Uint8Array> {
    if (this.pending) {
      return Promise.reject(new Error('A read is already in progress'))
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`Timed out waiting for ${JSON.stringify(marker)}`))
      }, timeoutMs)
      this.pending = { marker: asciiToBytes(marker), resolve, reject, timer }
      // The marker may already be in the buffer from a previous read.
      this.tryResolvePending()
    })
  }

  // ---------------------------------------------------------------------------
  // Raw REPL control
  // ---------------------------------------------------------------------------

  /** Enter raw REPL mode (Ctrl-A), interrupting any running program first. */
  async enterRawRepl(): Promise<void> {
    // Clear any stale buffered output.
    this.rxBuffer = new Uint8Array(0)
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
   * captured stdout/stderr. Operations are serialized so concurrent callers
   * do not corrupt the protocol state.
   */
  exec(code: string, timeoutMs = 10000): Promise<ExecResult> {
    const op = this.opQueue.then(() => this.execLocked(code, timeoutMs))
    // Keep the queue alive even if this op rejects.
    this.opQueue = op.catch(() => undefined)
    return op
  }

  private async execLocked(code: string, timeoutMs: number): Promise<ExecResult> {
    // Suppress the caller's console broadcast for the WHOLE exec (raw-REPL
    // enter through exit) so probe/banner/interrupt bytes never reach a
    // terminal — callers check {@link execActive} before forwarding chunks.
    this._execActive = true
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
        if (!bytesToUtf8(ack).includes('OK')) {
          throw new Error('Device did not acknowledge code (no "OK")')
        }

        // stdout is everything up to the first \x04.
        const stdoutRaw = await this.readUntil(CTRL_D, timeoutMs)
        const stdout = bytesToUtf8(stdoutRaw.subarray(0, stdoutRaw.length - 1))

        // stderr/traceback is everything up to the second \x04.
        const stderrRaw = await this.readUntil(CTRL_D, timeoutMs)
        const stderr = bytesToUtf8(stderrRaw.subarray(0, stderrRaw.length - 1))

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
      this._execActive = false
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
    const bytes = await this.readFileBytes(path)
    return bytesToUtf8(bytes)
  }

  /** Read a file from the device and return its raw bytes. */
  async readFileBytes(path: string): Promise<Uint8Array> {
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
    return hexToBytes(hex)
  }

  /**
   * Write `contents` to `path`, creating/overwriting the file. The payload is
   * sent in hex-encoded chunks so that arbitrary binary content survives the
   * text-oriented REPL transport.
   */
  async writeFile(
    path: string,
    contents: string | Uint8Array,
    chunkSize = 256
  ): Promise<void> {
    const data = typeof contents === 'string' ? textEncoder.encode(contents) : contents
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
        const hex = bytesToHex(slice)
        await this.eval(`_f.write(ubinascii.unhexlify(${pyStr(hex)}))`)
      }
    } finally {
      await this.eval('_f.close()').catch(() => undefined)
    }
  }

  /** Remove a file OR a directory tree. `os.remove()` can't delete directories
   *  (and `os.rmdir()` only empty ones), so walk depth-first with an explicit
   *  stack: children first, then the emptied folder (#219). */
  async remove(path: string): Promise<void> {
    await this.eval(
      [
        'import os',
        `_s = [${pyStr(path)}]`,
        'while _s:',
        '    _p = _s[-1]',
        '    if (os.stat(_p)[0] & 0x4000) != 0:',
        '        _c = os.listdir(_p)',
        '        if _c:',
        "            _s.extend([_p + '/' + _x for _x in _c])",
        '        else:',
        '            os.rmdir(_p)',
        '            _s.pop()',
        '    else:',
        '        os.remove(_p)',
        '        _s.pop()'
      ].join('\n')
    )
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
}
