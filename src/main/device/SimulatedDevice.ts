import { EventEmitter } from 'events'
import { scratchBlock } from '../../shared/device-scratch'
import { VIRTUAL_PORT_PATH } from '../../shared/virtual-device'
import { MicroPythonRuntime, type ReplRuntime } from './MicroPythonRuntime'
import { isProbeCode, simulateProbeResponse, simulatedTelemetryFrame } from '../../shared/simulation'
import type { RuntimeInfo } from '../../shared/dialect'
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
 * What the simulator reports as its runtime (#752). Stated rather than probed:
 * the interpreter behind it IS MicroPython (the official WASM port), so this is
 * a fact about the simulator, not a guess about a board. No version — the WASM
 * build's is the port's, not a board firmware anyone could flash, and offering
 * it would invite the update check to compare against a firmware catalog.
 * Whether the simulator should ever offer CircuitPython is #764.
 */
const SIM_RUNTIME: RuntimeInfo = { dialect: 'micropython' }

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
    return this.statusFor(this.state)
  }

  /** The status payload for a state — one place, so the snapshot and the pushed
   *  event can never disagree about what the simulator is. */
  private statusFor(state: ConnectionState): DeviceStatus {
    const status: DeviceStatus = { state, path: VIRTUAL_PORT_PATH, baudRate: 115200 }
    if (state === 'connected') status.runtime = SIM_RUNTIME
    return status
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
    this.emit('status', this.statusFor(state))
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
    // (Installs used to be intercepted here: they ran `mip` ON the device, and
    // the WASM port has neither `mip` nor a network, so the snippet had to be
    // answered with a canned "offline" error. #776 removed that whole route —
    // packages are resolved on the HOST now and arrive as ordinary file writes,
    // which the simulator's VFS accepts like any other file.)
    //
    // Actually RUN the snippet on the real WASM interpreter and return what it
    // printed (this used to be a `''` stub, which silently broke every exec-based
    // probe on the sim — e.g. `modules.probeInstalled`, so the missing-library
    // banner could never clear after an install). Tracebacks arrive in the
    // captured output, matching how a raw-REPL board surfaces them well enough
    // for the sentinel-parsing callers (they just see no sentinel line).
    const out = await this.runtime.runCaptured(code)
    return { stdout: out, stderr: '' }
  }

  async eval(code: string): Promise<string> {
    const { stdout, stderr } = await this.exec(code)
    if (stderr.trim().length > 0) throw new Error(stderr.trim())
    return stdout
  }

  /** Feed user keystrokes to the real MicroPython REPL. */
  async sendData(data: string): Promise<void> {
    if (this.state !== 'connected') return
    await this.runtime.feed(data)
  }

  /** Run a whole user PROGRAM, streaming only its output (#612) — executed
   *  directly on the interpreter, so the REPL never echoes the source or the
   *  paste-mode `===` framing. */
  async runProgram(code: string): Promise<void> {
    if (this.state !== 'connected') return
    await this.runtime.runStream(code)
  }

  /** Record an IDE→board control command (latest-wins per target). */
  async sendControl(target: string, payload = ''): Promise<void> {
    this.control.set(target, payload)
  }

  /** Stop the running program. Goes to the runtime (not through `sendData`): the
   *  sim runs the interpreter in a worker, and a `while True:` can only be broken
   *  by rebooting it — a queued Ctrl-C would never be read. When idle it's a
   *  gentle Ctrl-C that keeps state. */
  async interrupt(): Promise<void> {
    if (this.state !== 'connected') return
    await this.runtime.interrupt()
  }

  /** Ctrl-D — soft-reset the real REPL. */
  async softReset(): Promise<void> {
    await this.sendData('\x04')
  }

  // ---------------------------------------------------------------------------
  // Filesystem — backed by the interpreter's REAL in-memory VFS (#135), so
  // uploaded files persist and are importable (e.g. `import instruments`, since
  // `/lib` is on sys.path). It's RAM-backed, so it resets on disconnect.
  // ---------------------------------------------------------------------------

  /** Emscripten MEMFS mounts that aren't part of a "board" — hidden at root. */
  private static readonly SYSTEM_DIRS = new Set(['dev', 'proc', 'tmp', 'home'])

  async listDir(path = '/'): Promise<DirEntry[]> {
    const code = scratchBlock(
      [
        'import os, json',
        'def _snk_ls(p):',
        '    out=[]',
        '    try: it=os.ilistdir(p)',
        '    except AttributeError: it=[(n,0,0) for n in os.listdir(p)]',
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
    const raw = (await this.runtime.runCaptured(code)).trim()
    const parsed = JSON.parse(raw) as [string, boolean, number][]
    const isRoot = path === '' || path === '/'
    return parsed
      .filter(([name, isDir]) => !(isRoot && isDir && SimulatedDevice.SYSTEM_DIRS.has(name)))
      .map(([name, isDir, size]) => ({ name, isDir, size }))
  }

  async readFile(path: string): Promise<string> {
    // Text read (the simulator's files are source); exact bytes via stdout.write.
    const code = scratchBlock(
      ['import sys', `with open(${pyStr(path)}) as _snk_f:`, '    sys.stdout.write(_snk_f.read())'],
      '_snk_f'
    )
    return this.runtime.runCaptured(code)
  }

  /**
   * The same read as bytes (#875). Hex-encoded on the way out for the same
   * reason the serial device does it: stdout is a text channel, so anything that
   * is not valid UTF-8 would not survive the trip.
   */
  async readFileBytes(path: string): Promise<Buffer> {
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
    return Buffer.from((await this.runtime.runCaptured(code)).trim(), 'hex')
  }

  async readFileLine(path: string, prefix: string): Promise<string> {
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
    return (await this.runtime.runCaptured(code)).trim()
  }

  async writeFile(path: string, contents: string | Buffer): Promise<void> {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
    // The VFS starts EMPTY (no `/lib` by default), so create any missing parent
    // directories first — otherwise writing e.g. `/lib/instruments.py` fails with
    // OSError. Then hex-encode the body so arbitrary (incl. binary) content
    // survives without escaping.
    // `_snk_d` holds the whole file, so leaving it bound kept a copy of the last
    // upload resident on the board — and showed it in the Inspect panel (#798).
    const code = scratchBlock(
      [
        mkParentsSnippet(path),
        `_snk_d=bytes.fromhex(${pyStr(data.toString('hex'))})`,
        `with open(${pyStr(path)},'wb') as _snk_f:`,
        '    _snk_f.write(_snk_d)'
      ].filter(Boolean),
      '_snk_d',
      '_snk_f'
    )
    await this.runtime.runCaptured(code)
  }

  async remove(path: string): Promise<void> {
    // Recursive, mirroring MicroPythonDevice.remove: files delete directly;
    // directory trees walk depth-first (children, then the emptied dir) (#219).
    await this.runtime.runCaptured(
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
  }

  async mkdir(path: string): Promise<void> {
    await this.runtime.runCaptured(`import os\nos.mkdir(${pyStr(path)})`)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.runtime.runCaptured(`import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`)
  }

  async stat(path: string): Promise<StatResult> {
    const code = scratchBlock(
      [
        'import os, json',
        `_snk_st=os.stat(${pyStr(path)})`,
        '_snk_isdir=(_snk_st[0] & 0x4000)!=0',
        'print(json.dumps([_snk_isdir, _snk_st[6], _snk_st[8] if len(_snk_st)>8 else None]))'
      ],
      '_snk_st',
      '_snk_isdir'
    )
    const raw = (await this.runtime.runCaptured(code)).trim()
    const [isDir, size, mtime] = JSON.parse(raw) as [boolean, number, number | null]
    return { isDir, size, mtime: mtime ?? undefined }
  }

  async dispose(): Promise<void> {
    this.stopTelemetry()
    this.runtime.dispose()
    this.removeAllListeners()
    this.state = 'disconnected'
  }
}

/**
 * Python that creates each parent directory of `path` (e.g. `/lib` for
 * `/lib/instruments.py`), ignoring "already exists". Returns '' for a root-level
 * path with no parent to create. MicroPython has no `os.makedirs`, so build the
 * chain segment by segment.
 */
function mkParentsSnippet(path: string): string {
  const slash = path.lastIndexOf('/')
  const dir = slash > 0 ? path.slice(0, slash) : ''
  if (!dir || dir === '/') return ''
  return scratchBlock(
    [
      'import os',
      '_snk_cur=""',
      `for _snk_seg in ${pyStr(dir)}.strip("/").split("/"):`,
      '    _snk_cur+="/"+_snk_seg',
      '    try:',
      '        os.mkdir(_snk_cur)',
      '    except OSError:',
      '        pass'
    ],
    '_snk_cur',
    '_snk_seg'
  )
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
