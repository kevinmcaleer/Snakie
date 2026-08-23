/**
 * WEB simulated-device backend — epic #267, Phase W1.
 * =============================================================================
 *
 * Implements the `window.api.device` namespace in the browser, backed by the
 * {@link WorkerMicroPythonRuntime}. It's the web twin of the main-process
 * `SimulatedDevice`: connect boots the interpreter (its banner streams out via
 * `onData`), `sendData` feeds the REPL, `exec`/`eval` run captured snippets, and
 * the filesystem ops drive MicroPython's in-memory VFS with the SAME Python that
 * the desktop simulator uses. Presented as the reserved virtual port so the
 * shell's port dropdown + Connect button "just work" — no hardware.
 *
 * The interpreter runs in a Web Worker ({@link ./worker-runtime}), so a `while
 * True:` loop churns off the UI thread and Stop reboots the worker to break it.
 * Still tracked on #464: synthetic `SNK` telemetry so the instruments animate.
 */
import { WorkerMicroPythonRuntime } from './worker-runtime'
import { scratchBlock } from '../../../shared/device-scratch'
import { VIRTUAL_PORT_PATH, VIRTUAL_PORT_LABEL } from '../../../shared/virtual-device'
import { isProbeCode, simulateProbeResponse, simulatedTelemetryFrame } from '../../../shared/simulation'
import type { RuntimeInfo } from '../../../shared/dialect'

/** How often the simulated board "prints" a telemetry frame (matches the desktop sim). */
const TELEMETRY_INTERVAL_MS = 120

type ConnState = 'disconnected' | 'connecting' | 'connected'
interface DeviceStatus {
  state: ConnState
  path: string
  baudRate: number
  /** Which Python this backend runs (#752). */
  runtime?: RuntimeInfo
}

/**
 * What the web simulator reports as its runtime (#752). Stated, not probed: the
 * interpreter behind it IS MicroPython (the official WASM port), so this is a
 * fact about the simulator rather than a guess about a board — and it matches
 * the desktop `SimulatedDevice`, which is the same thing in the other shell.
 * Whether a simulator should ever offer CircuitPython is #764.
 */
const SIM_RUNTIME: RuntimeInfo = { dialect: 'micropython' }

const enc = new TextEncoder()

/** Render a JS string as a Python string literal (paths/data injected into snippets). */
const pyStr = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`

/** Python that `mkdir`s each parent of `path` (MicroPython has no makedirs). */
const mkParents = (path: string): string => {
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

const SYSTEM_DIRS = new Set(['dev', 'proc', 'tmp', 'home'])

/** Build the `device` Api object (assigned to `window.api.device` on the web). */
export function createWebDeviceApi(): Record<string, unknown> {
  const dataSubs = new Set<(chunk: Uint8Array) => void>()
  const statusSubs = new Set<(status: DeviceStatus) => void>()
  let state: ConnState = 'disconnected'
  let runtime: WorkerMicroPythonRuntime | null = null
  // Synthetic-telemetry clock (drives the instruments + the Board Viewer probe),
  // exactly like the desktop SimulatedDevice — so scope / meter / plotter / IMU /
  // radar animate on the web sim with no hardware or running program.
  let tick = 0
  let telemetry: ReturnType<typeof setInterval> | null = null

  const emitData = (chunk: Uint8Array): void => dataSubs.forEach((cb) => cb(chunk))

  const emitTelemetryFrame = (): void => {
    if (state !== 'connected') return
    const frame = simulatedTelemetryFrame(tick++)
    if (frame.length > 0) emitData(enc.encode(frame.join('\r\n') + '\r\n'))
  }
  const startTelemetry = (): void => {
    if (!telemetry) telemetry = setInterval(emitTelemetryFrame, TELEMETRY_INTERVAL_MS)
  }
  const stopTelemetry = (): void => {
    if (telemetry) {
      clearInterval(telemetry)
      telemetry = null
    }
  }
  const status = (): DeviceStatus => {
    const st: DeviceStatus = { state, path: VIRTUAL_PORT_PATH, baudRate: 115200 }
    if (state === 'connected') st.runtime = SIM_RUNTIME
    return st
  }
  const setState = (s: ConnState): void => {
    state = s
    const st = status()
    statusSubs.forEach((cb) => cb(st))
  }
  const capture = async (code: string): Promise<string> => {
    if (!runtime) throw new Error('Not connected')
    return runtime.runCaptured(code)
  }

  return {
    listPorts: async () => [{ path: VIRTUAL_PORT_PATH, friendlyName: VIRTUAL_PORT_LABEL }],

    connect: async () => {
      if (state === 'connected') return
      setState('connecting')
      runtime = new WorkerMicroPythonRuntime()
      try {
        await runtime.init(emitData)
      } catch (err) {
        emitData(
          enc.encode(
            `\r\nSimulated device — Python REPL unavailable (${String(err)}).\r\n>>> `
          )
        )
      }
      setState('connected')
      startTelemetry()
    },

    disconnect: async () => {
      stopTelemetry()
      runtime?.dispose()
      runtime = null
      if (state !== 'disconnected') setState('disconnected')
    },

    getStatus: async () => status(),

    exec: async (code: string) => {
      // The Board Viewer's live-pin probe gets synthetic values (no hardware to
      // read), like the desktop sim; everything else runs on the interpreter.
      if (isProbeCode(code)) return { stdout: simulateProbeResponse(code, tick), stderr: '' }
      return { stdout: await capture(code), stderr: '' }
    },

    eval: async (code: string) => capture(code),

    sendData: async (data: string) => {
      if (runtime) await runtime.feed(data)
    },

    runProgram: async (code: string) => {
      // Run the whole program with output streaming, no REPL echo / paste framing
      // (#612) — the sim executes it directly on the interpreter.
      if (runtime) await runtime.runStream(code)
    },

    sendControl: async () => undefined, // no telemetry consumer on the sim yet (#464)

    interrupt: async () => {
      // Ctrl-C when idle; reboot the worker to stop a running (maybe no-yield) loop.
      if (runtime) await runtime.interrupt()
    },

    softReset: async () => {
      if (runtime) await runtime.feed('\x04') // Ctrl-D — soft reboot at the REPL
    },

    // ── In-memory filesystem (MicroPython VFS) — same snippets as the desktop sim ──
    listDir: async (path = '/') => {
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
      const raw = (await capture(code)).trim()
      const parsed = (raw ? JSON.parse(raw) : []) as [string, boolean, number][]
      const isRoot = path === '' || path === '/'
      return parsed
        .filter(([name, isDir]) => !(isRoot && isDir && SYSTEM_DIRS.has(name)))
        .map(([name, isDir, size]) => ({ name, isDir, size }))
    },

    df: async () => null,

    readFile: async (path: string) =>
      capture(
        scratchBlock(
          [
            'import sys',
            `with open(${pyStr(path)}) as _snk_f:`,
            '    sys.stdout.write(_snk_f.read())'
          ],
          '_snk_f'
        )
      ),

    // The board finds the line, so one line crosses the wire, not the file (#700).
    readFileLine: async (path: string, prefix: string) =>
      (
        await capture(
          scratchBlock(
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
        )
      ).trim(),

    writeFile: async (path: string, contents: string) => {
      const hex = Array.from(enc.encode(contents))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const code = scratchBlock(
        [
          mkParents(path),
          `_snk_d=bytes.fromhex(${pyStr(hex)})`,
          `with open(${pyStr(path)},'wb') as _snk_f:`,
          '    _snk_f.write(_snk_d)'
        ].filter(Boolean),
        '_snk_d',
        '_snk_f'
      )
      await capture(code)
    },

    remove: async (path: string) => {
      await capture(
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
            '            os.rmdir(_snk_p); _snk_s.pop()',
            '    else:',
            '        os.remove(_snk_p); _snk_s.pop()'
          ],
          '_snk_s',
          '_snk_p',
          '_snk_c'
        )
      )
    },

    mkdir: async (path: string) => {
      await capture(`import os\nos.mkdir(${pyStr(path)})`)
    },

    rename: async (from: string, to: string) => {
      await capture(`import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`)
    },

    stat: async (path: string) => {
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
      const [isDir, size, mtime] = JSON.parse((await capture(code)).trim()) as [
        boolean,
        number,
        number | null
      ]
      return { isDir, size, mtime: mtime ?? undefined }
    },

    onData: (cb: (chunk: Uint8Array) => void) => {
      dataSubs.add(cb)
      return () => dataSubs.delete(cb)
    },

    onStatus: (cb: (status: DeviceStatus) => void) => {
      statusSubs.add(cb)
      return () => statusSubs.delete(cb)
    }
  }
}
