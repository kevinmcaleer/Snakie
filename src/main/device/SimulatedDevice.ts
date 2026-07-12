import { EventEmitter } from 'events'
import { VIRTUAL_PORT_PATH } from '../../shared/virtual-device'
import { INSTALL_START, INSTALL_ERR } from '../packages/install'
import { MicroPythonRuntime, type ReplRuntime } from './MicroPythonRuntime'
import { isProbeCode, simulateProbeResponse, simulatedTelemetryFrame } from '../../shared/simulation'
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
    // `mip` package installs can't run on the WASM device (no network, and no
    // `mip` module in the port). Detect the install snippet and answer with a
    // clear, sentinel'd result so the Packages / SAM / driver UIs explain it —
    // instead of the cryptic "mip failed" an empty response parses to (#135).
    if (code.includes(INSTALL_START)) {
      return {
        stdout:
          `${INSTALL_START}\n${INSTALL_ERR} Package install needs a network connection and a ` +
          "real board — it isn't available on the simulated device (offline).",
        stderr: ''
      }
    }
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

  /** Feed user keystrokes / Run paste-mode payloads to the real MicroPython REPL. */
  async sendData(data: string): Promise<void> {
    if (this.state !== 'connected') return
    await this.runtime.feed(data)
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
    const code = [
      'import os, json',
      'def _ls(p):',
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
      `print(json.dumps(_ls(${pyStr(path)})))`
    ].join('\n')
    const raw = (await this.runtime.runCaptured(code)).trim()
    const parsed = JSON.parse(raw) as [string, boolean, number][]
    const isRoot = path === '' || path === '/'
    return parsed
      .filter(([name, isDir]) => !(isRoot && isDir && SimulatedDevice.SYSTEM_DIRS.has(name)))
      .map(([name, isDir, size]) => ({ name, isDir, size }))
  }

  async readFile(path: string): Promise<string> {
    // Text read (the simulator's files are source); exact bytes via stdout.write.
    const code = `import sys\nwith open(${pyStr(path)}) as f:\n    sys.stdout.write(f.read())`
    return this.runtime.runCaptured(code)
  }

  async writeFile(path: string, contents: string | Buffer): Promise<void> {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
    // The VFS starts EMPTY (no `/lib` by default), so create any missing parent
    // directories first — otherwise writing e.g. `/lib/instruments.py` fails with
    // OSError. Then hex-encode the body so arbitrary (incl. binary) content
    // survives without escaping.
    const code = [
      mkParentsSnippet(path),
      `_d=bytes.fromhex(${pyStr(data.toString('hex'))})`,
      `with open(${pyStr(path)},'wb') as f:`,
      '    f.write(_d)'
    ]
      .filter(Boolean)
      .join('\n')
    await this.runtime.runCaptured(code)
  }

  async remove(path: string): Promise<void> {
    // Recursive, mirroring MicroPythonDevice.remove: files delete directly;
    // directory trees walk depth-first (children, then the emptied dir) (#219).
    await this.runtime.runCaptured(
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

  async mkdir(path: string): Promise<void> {
    await this.runtime.runCaptured(`import os\nos.mkdir(${pyStr(path)})`)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.runtime.runCaptured(`import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`)
  }

  async stat(path: string): Promise<StatResult> {
    const code = [
      'import os, json',
      `st=os.stat(${pyStr(path)})`,
      'isdir=(st[0] & 0x4000)!=0',
      'print(json.dumps([isdir, st[6], st[8] if len(st)>8 else None]))'
    ].join('\n')
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
  return [
    'import os',
    '_cur=""',
    `for _s in ${pyStr(dir)}.strip("/").split("/"):`,
    '    _cur+="/"+_s',
    '    try:',
    '        os.mkdir(_cur)',
    '    except OSError:',
    '        pass'
  ].join('\n')
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
