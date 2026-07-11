/**
 * WEB simulated-device backend — epic #267, Phase W1.
 * =============================================================================
 *
 * Implements the `window.api.device` namespace in the browser, backed by the
 * {@link BrowserMicroPythonRuntime}. It's the web twin of the main-process
 * `SimulatedDevice`: connect boots the interpreter (its banner streams out via
 * `onData`), `sendData` feeds the REPL, `exec`/`eval` run captured snippets, and
 * the filesystem ops drive MicroPython's in-memory VFS with the SAME Python that
 * the desktop simulator uses. Presented as the reserved virtual port so the
 * shell's port dropdown + Connect button "just work" — no hardware.
 *
 * Not covered here (tracked on #464): synthetic `SNK` telemetry (instruments) and
 * running the interpreter in a Worker (a `while True:` loop currently blocks the
 * tab until interrupted — fine for short classroom programs; the Worker is the
 * follow-up).
 */
import { BrowserMicroPythonRuntime } from './mp-runtime'
import { VIRTUAL_PORT_PATH, VIRTUAL_PORT_LABEL } from '../../../shared/virtual-device'

type ConnState = 'disconnected' | 'connecting' | 'connected'
interface DeviceStatus {
  state: ConnState
  path: string
  baudRate: number
}

const enc = new TextEncoder()

/** Render a JS string as a Python string literal (paths/data injected into snippets). */
const pyStr = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`

/** Python that `mkdir`s each parent of `path` (MicroPython has no makedirs). */
const mkParents = (path: string): string => {
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

const SYSTEM_DIRS = new Set(['dev', 'proc', 'tmp', 'home'])

/** Build the `device` Api object (assigned to `window.api.device` on the web). */
export function createWebDeviceApi(): Record<string, unknown> {
  const dataSubs = new Set<(chunk: Uint8Array) => void>()
  const statusSubs = new Set<(status: DeviceStatus) => void>()
  let state: ConnState = 'disconnected'
  let runtime: BrowserMicroPythonRuntime | null = null

  const emitData = (chunk: Uint8Array): void => dataSubs.forEach((cb) => cb(chunk))
  const status = (): DeviceStatus => ({ state, path: VIRTUAL_PORT_PATH, baudRate: 115200 })
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
      runtime = new BrowserMicroPythonRuntime()
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
    },

    disconnect: async () => {
      runtime?.dispose()
      runtime = null
      if (state !== 'disconnected') setState('disconnected')
    },

    getStatus: async () => status(),

    exec: async (code: string) => ({ stdout: await capture(code), stderr: '' }),

    eval: async (code: string) => capture(code),

    sendData: async (data: string) => {
      if (runtime) await runtime.feed(data)
    },

    sendControl: async () => undefined, // no telemetry consumer on the sim yet (#464)

    interrupt: async () => {
      if (runtime) await runtime.feed('\x03') // Ctrl-C
    },

    softReset: async () => {
      if (runtime) await runtime.feed('\x04') // Ctrl-D
    },

    // ── In-memory filesystem (MicroPython VFS) — same snippets as the desktop sim ──
    listDir: async (path = '/') => {
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
      const raw = (await capture(code)).trim()
      const parsed = (raw ? JSON.parse(raw) : []) as [string, boolean, number][]
      const isRoot = path === '' || path === '/'
      return parsed
        .filter(([name, isDir]) => !(isRoot && isDir && SYSTEM_DIRS.has(name)))
        .map(([name, isDir, size]) => ({ name, isDir, size }))
    },

    df: async () => null,

    readFile: async (path: string) =>
      capture(`import sys\nwith open(${pyStr(path)}) as f:\n    sys.stdout.write(f.read())`),

    writeFile: async (path: string, contents: string) => {
      const hex = Array.from(enc.encode(contents))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const code = [
        mkParents(path),
        `_d=bytes.fromhex(${pyStr(hex)})`,
        `with open(${pyStr(path)},'wb') as f:`,
        '    f.write(_d)'
      ]
        .filter(Boolean)
        .join('\n')
      await capture(code)
    },

    remove: async (path: string) => {
      await capture(
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
    },

    mkdir: async (path: string) => {
      await capture(`import os\nos.mkdir(${pyStr(path)})`)
    },

    rename: async (from: string, to: string) => {
      await capture(`import os\nos.rename(${pyStr(from)}, ${pyStr(to)})`)
    },

    stat: async (path: string) => {
      const code = [
        'import os, json',
        `st=os.stat(${pyStr(path)})`,
        'isdir=(st[0] & 0x4000)!=0',
        'print(json.dumps([isdir, st[6], st[8] if len(st)>8 else None]))'
      ].join('\n')
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
