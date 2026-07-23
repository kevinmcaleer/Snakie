/**
 * Transport-agnostic MicroPython raw-REPL client (epic #267, Phase W2 / #465).
 * =============================================================================
 *
 * The same raw-REPL protocol the desktop `MicroPythonDevice` speaks over
 * `serialport`, but decoupled from Node so it can drive a REAL board over **Web
 * Serial** in the browser. The transport is reduced to {@link SerialTransport}
 * (`write` + `onData` + `close`, plus optional `setSignals`); everything else —
 * the raw-REPL handshake, `exec`/`eval`, and the filesystem helpers — lives here,
 * byte-for-byte matching the desktop so a Pico behaves identically on web.
 *
 * Browser-safe: `Uint8Array` + `TextEncoder`/`TextDecoder`, no `Buffer`/Node.
 * Pure logic, unit-tested against a mock transport (no hardware needed).
 *
 * The raw REPL handshake (see MicroPython docs):
 *   1. Ctrl-C ×2 — interrupt anything running.
 *   2. Ctrl-A — enter raw REPL; the board replies `raw REPL; CTRL-B to exit\r\n>`.
 *   3. code + Ctrl-D — execute; board replies `OK`, stdout, `\x04`, stderr, `\x04`, `>`.
 *   4. Ctrl-B — back to the friendly REPL.
 */
import { buildControlLine } from './control'

const CTRL_A = '\x01'
const CTRL_B = '\x02'
const CTRL_C = '\x03'
const CTRL_D = '\x04'

/** The minimal byte transport a {@link RawReplClient} drives. */
export interface SerialTransport {
  write(data: Uint8Array): Promise<void>
  onData(cb: (chunk: Uint8Array) => void): void
  close(): Promise<void>
  /** Toggle DTR/RTS — used to hard-reset some boards. Optional. */
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>
}

export interface ExecResult {
  stdout: string
  stderr: string
}
export interface DirEntry {
  name: string
  isDir: boolean
  size: number
}
export interface StatResult {
  isDir: boolean
  size: number
  mtime?: number
}

/** A JS string → a MicroPython single-quoted string literal (safe for snippets). */
export function pyStr(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
  return `'${escaped}'`
}

const enc = new TextEncoder()
const dec = new TextDecoder()

/** latin1 string → bytes (control bytes + protocol markers are latin1). */
const bin = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff)

/** Index of `needle` bytes within `hay`, or -1. */
function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) return 0
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

type Pending = {
  marker: Uint8Array
  resolve: (v: Uint8Array) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class RawReplClient {
  private rxBuffer: Uint8Array = new Uint8Array(0)
  private pending: Pending | null = null
  /** Active while {@link runProgram} streams a program's output (framing stripped). */
  private streamPending: { resolve: () => void; reject: (e: Error) => void } | null = null
  private inRawRepl = false
  /** While an exec/run drives the raw REPL, its framing must NOT reach the console. */
  private execActive = false
  private opQueue: Promise<unknown> = Promise.resolve()

  /**
   * @param transport the byte transport (Web Serial in the browser).
   * @param onConsole receives user-facing REPL bytes (everything not consumed by
   *        an in-flight exec) — wire to the terminal.
   */
  constructor(
    private readonly transport: SerialTransport,
    private readonly onConsole: (chunk: Uint8Array) => void
  ) {
    transport.onData((chunk) => this.handleData(chunk))
  }

  private handleData(chunk: Uint8Array): void {
    this.rxBuffer = concat(this.rxBuffer, chunk)
    if (this.streamPending) this.pumpStream()
    else this.tryResolvePending()
    if (!this.execActive) this.onConsole(chunk)
  }

  /** Forward buffered program output to the console up to the next `\x04`, which
   *  terminates stdout (then stderr); the terminator is stripped. See #612. */
  private pumpStream(): void {
    const idx = this.rxBuffer.indexOf(4)
    if (idx === -1) {
      if (this.rxBuffer.length > 0) {
        this.onConsole(this.rxBuffer)
        this.rxBuffer = new Uint8Array(0)
      }
      return
    }
    const out = this.rxBuffer.slice(0, idx)
    if (out.length > 0) this.onConsole(out)
    this.rxBuffer = this.rxBuffer.slice(idx + 1)
    const done = this.streamPending
    this.streamPending = null
    done?.resolve()
  }

  /** Stream one `\x04`-terminated segment (stdout, then stderr) to the console.
   *  No timeout — a running program may print indefinitely; it ends on completion
   *  or Stop (which yields the terminating `\x04`). */
  private streamUntilCtrlD(): Promise<void> {
    if (this.streamPending) return Promise.reject(new Error('A stream is already in progress'))
    return new Promise<void>((resolve, reject) => {
      this.streamPending = { resolve, reject }
      this.pumpStream()
    })
  }

  private tryResolvePending(): void {
    if (!this.pending) return
    const idx = indexOfBytes(this.rxBuffer, this.pending.marker)
    if (idx === -1) return
    const end = idx + this.pending.marker.length
    const data = this.rxBuffer.slice(0, end)
    this.rxBuffer = this.rxBuffer.slice(end)
    const { resolve, timer } = this.pending
    clearTimeout(timer)
    this.pending = null
    resolve(data)
  }

  private write(data: string | Uint8Array): Promise<void> {
    return this.transport.write(typeof data === 'string' ? bin(data) : data)
  }

  private readUntil(marker: string, timeoutMs = 5000): Promise<Uint8Array> {
    if (this.pending) return Promise.reject(new Error('A read is already in progress'))
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null
        reject(new Error(`Timed out waiting for ${JSON.stringify(marker)}`))
      }, timeoutMs)
      this.pending = { marker: bin(marker), resolve, reject, timer }
      this.tryResolvePending()
    })
  }

  // ── Friendly-REPL passthrough (typing, Run paste, control bytes) ──────────
  async sendData(data: string): Promise<void> {
    await this.write(data)
  }
  async sendControl(target: string, payload = ''): Promise<void> {
    await this.write(buildControlLine(target, payload))
  }
  async interrupt(): Promise<void> {
    await this.write(CTRL_C)
  }
  async softReset(): Promise<void> {
    await this.write(CTRL_D)
  }

  // ── Raw REPL ──────────────────────────────────────────────────────────────
  private async enterRawRepl(): Promise<void> {
    this.rxBuffer = new Uint8Array(0)
    await this.write(CTRL_C)
    await this.write(CTRL_C)
    await this.write(CTRL_A)
    await this.readUntil('raw REPL; CTRL-B to exit\r\n>')
    this.inRawRepl = true
  }
  private async exitRawRepl(): Promise<void> {
    // Ctrl-B returns to the friendly REPL, which REPRINTS its banner + `>>>`
    // prompt — consume it so it never leaks after an exec/Run and make a run look
    // like a reboot (#612). Hold the suppression flag ourselves for the whole
    // Ctrl-B + consume so it's independent of the caller's state; drop residue.
    const prevExecActive = this.execActive
    this.execActive = true
    try {
      await this.write(CTRL_B)
      this.inRawRepl = false
      await this.readUntil('>>> ', 2000).catch(() => undefined)
      this.rxBuffer = new Uint8Array(0)
    } finally {
      this.execActive = prevExecActive
    }
  }

  exec(code: string, timeoutMs = 10000): Promise<ExecResult> {
    const op = this.opQueue.then(() => this.execLocked(code, timeoutMs))
    this.opQueue = op.catch(() => undefined)
    return op
  }

  private async execLocked(code: string, timeoutMs: number): Promise<ExecResult> {
    this.execActive = true
    try {
      const enteredHere = !this.inRawRepl
      if (enteredHere) await this.enterRawRepl()
      try {
        await this.write(code)
        await this.write(CTRL_D)
        const ack = await this.readUntil('OK', timeoutMs)
        if (!dec.decode(ack).includes('OK')) throw new Error('Device did not acknowledge code (no "OK")')
        const stdoutRaw = await this.readUntil(CTRL_D, timeoutMs)
        const stdout = dec.decode(stdoutRaw.subarray(0, stdoutRaw.length - 1))
        const stderrRaw = await this.readUntil(CTRL_D, timeoutMs)
        const stderr = dec.decode(stderrRaw.subarray(0, stderrRaw.length - 1))
        await this.readUntil('>', timeoutMs)
        return { stdout, stderr }
      } finally {
        if (enteredHere) await this.exitRawRepl().catch(() => undefined)
      }
    } finally {
      this.execActive = false
    }
  }

  async eval(code: string, timeoutMs = 10000): Promise<string> {
    const { stdout, stderr } = await this.exec(code, timeoutMs)
    if (stderr.trim().length > 0) throw new Error(stderr.trim())
    return stdout
  }

  /**
   * Run a whole user PROGRAM, streaming only its output to the console (#612) —
   * raw REPL (no source echo, no `===` paste banner), forwarding just the
   * program's stdout + stderr while stripping the `OK`/`\x04`/`>` framing. Mirrors
   * the desktop {@link MicroPythonDevice.runProgram}.
   */
  runProgram(code: string): Promise<void> {
    const op = this.opQueue.then(() => this.runLocked(code))
    this.opQueue = op.catch(() => undefined)
    return op
  }

  private async runLocked(code: string): Promise<void> {
    this.execActive = true
    try {
      const enteredHere = !this.inRawRepl
      if (enteredHere) await this.enterRawRepl()
      try {
        await this.write(code)
        await this.write(CTRL_D)
        const ack = await this.readUntil('OK')
        if (!dec.decode(ack).includes('OK')) throw new Error('Device did not acknowledge the program (no "OK")')
        await this.streamUntilCtrlD() // stdout
        await this.streamUntilCtrlD() // stderr (tracebacks)
        await this.readUntil('>')
      } finally {
        if (enteredHere) {
          await this.exitRawRepl().catch(() => undefined)
          // A clean friendly-REPL prompt in place of the suppressed banner.
          this.onConsole(bin('\r\n>>> '))
        }
      }
    } finally {
      this.execActive = false
    }
  }

  // ── Filesystem helpers (same snippets as the desktop) ──────────────────────
  async listDir(path = '/'): Promise<DirEntry[]> {
    const code = [
      'import os, json',
      'def _ls(p):',
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
    const parsed = (raw ? JSON.parse(raw) : []) as [string, boolean, number][]
    return parsed.map(([name, isDir, size]) => ({ name, isDir, size }))
  }

  async readFile(path: string): Promise<string> {
    return dec.decode(await this.readFileBytes(path))
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
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
    const out = new Uint8Array(hex.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
    return out
  }

  async writeFile(path: string, contents: string | Uint8Array, chunkSize = 256): Promise<void> {
    const bytes = typeof contents === 'string' ? enc.encode(contents) : contents
    await this.eval(
      ['try:\n import ubinascii\nexcept ImportError:\n import binascii as ubinascii', `_f=open(${pyStr(path)},'wb')`].join('\n')
    )
    try {
      for (let i = 0; i < bytes.length || i === 0; i += chunkSize) {
        const slice = bytes.subarray(i, i + chunkSize)
        if (slice.length === 0 && i > 0) break
        let hex = ''
        for (const b of slice) hex += b.toString(16).padStart(2, '0')
        await this.eval(`_f.write(ubinascii.unhexlify(${pyStr(hex)}))`)
        if (slice.length < chunkSize) break
      }
    } finally {
      await this.eval('_f.close()').catch(() => undefined)
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.eval(`import os\nos.mkdir(${pyStr(path)})`)
  }
  async rename(from: string, to: string): Promise<void> {
    await this.eval(`import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`)
  }
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
        '            os.rmdir(_p); _s.pop()',
        '    else:',
        '        os.remove(_p); _s.pop()'
      ].join('\n')
    )
  }
  async stat(path: string): Promise<StatResult> {
    const code = [
      'import os, json',
      `st=os.stat(${pyStr(path)})`,
      'isdir=(st[0] & 0x4000)!=0',
      'mtime=st[8] if len(st)>8 else None',
      'print(json.dumps([isdir, st[6], mtime]))'
    ].join('\n')
    const [isDir, size, mtime] = JSON.parse((await this.eval(code)).trim()) as [boolean, number, number | null]
    return { isDir, size, mtime: mtime ?? undefined }
  }
}
