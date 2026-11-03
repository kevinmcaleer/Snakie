/**
 * PYODIDE (CPython) WORKER for the embed — #1289.
 * =============================================================================
 *
 * The same job as `web/mp.worker.ts`, for lessons that need desktop Python:
 * pandas, numpy, matplotlib. Pyodide is loaded from `indexURL` (jsDelivr) on
 * `init`, so nothing is downloaded until a reader presses Run.
 *
 * Protocol (main → worker): `init {indexURL, packages}`, `run {id, code}`,
 * `line {id, line}`. Worker → main: `out {text}`, `image {png}` (a matplotlib
 * figure, base64), `ready`, `failed {error}`, `done {id}`.
 *
 * matplotlib draws with the Agg backend and `plt.show()` posts each figure as a
 * PNG, because a worker has no DOM — which is also why no COOP/COEP headers are
 * needed on the host page. `input()` isn't supported yet (it would need either
 * SharedArrayBuffer or a synchronous channel to the page); it says so.
 */

interface PyodideApi {
  runPython(code: string, opts?: { globals?: unknown }): unknown
  loadPackagesFromImports(code: string, opts?: { messageCallback?: (msg: string) => void; errorCallback?: (msg: string) => void }): Promise<unknown>
  loadPackage(names: string[], opts?: { messageCallback?: (msg: string) => void; errorCallback?: (msg: string) => void }): Promise<unknown>
  setStdout(opts: { write: (buf: Uint8Array) => number }): void
  setStderr(opts: { write: (buf: Uint8Array) => number }): void
  registerJsModule(name: string, module: Record<string, unknown>): void
  globals: { set(name: string, value: unknown): void; get(name: string): unknown }
}

type InMsg =
  | { type: 'init'; indexURL: string; packages?: string[] }
  | { type: 'run'; id: number; code: string }
  | { type: 'line'; id: number; line: string }

const decoder = new TextDecoder()
let py: PyodideApi | null = null

const out = (text: string): void => postMessage({ type: 'out', text: text.replace(/\r?\n/g, '\r\n') })
const writer = {
  write: (buf: Uint8Array): number => {
    out(decoder.decode(buf, { stream: true }))
    return buf.length
  }
}
const note = (text: string): void => out(`\x1b[2m${text}\x1b[0m\n`)

/** Runs once after Pyodide loads: the namespace, `input`, the console, matplotlib. */
const BOOT_PY = `
import os, sys, builtins, code as _snk_code
os.environ['MPLBACKEND'] = 'AGG'
_snk_ns = {'__name__': '__main__', '__builtins__': builtins}

def _snk_input(prompt=''):
    raise RuntimeError("input() isn't supported in this embed yet. Put the value in the code instead.")
builtins.input = _snk_input

_snk_console = _snk_code.InteractiveConsole(_snk_ns, filename='<stdin>')

def _snk_show_figures(*args, **kwargs):
    import io, base64, _snk
    import matplotlib.pyplot as plt
    for num in plt.get_fignums():
        buf = io.BytesIO()
        plt.figure(num).savefig(buf, format='png', dpi=100, bbox_inches='tight')
        _snk.image(base64.b64encode(buf.getvalue()).decode('ascii'))
    plt.close('all')

def _snk_patch_mpl():
    if 'matplotlib' not in sys.modules:
        try:
            import matplotlib
        except ImportError:
            return
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.show = _snk_show_figures

def _snk_flush_figures():
    if 'matplotlib.pyplot' in sys.modules:
        if sys.modules['matplotlib.pyplot'].get_fignums():
            _snk_show_figures()

def _snk_run(src, name):
    import traceback
    try:
        exec(compile(src, name, 'exec'), _snk_ns)
    except SystemExit:
        pass
    except BaseException:
        et, ev, tb = sys.exc_info()
        traceback.print_exception(et, ev, tb.tb_next)
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
    try:
        _snk_flush_figures()
    except Exception as e:
        print('Could not draw the plot:', e, file=sys.stderr)

def _snk_push(line):
    try:
        more = _snk_console.push(line)
    except SystemExit:
        more = False
    if 'matplotlib.pyplot' in sys.modules and not more:
        _snk_patch_mpl()
        _snk_flush_figures()
    sys.stdout.flush()
    sys.stderr.flush()
    return more
`

async function load(indexURL: string, packages: string[]): Promise<void> {
  note('Loading Python (about 6 MB, only the first time)…')
  const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as {
    loadPyodide: (opts: { indexURL: string }) => Promise<PyodideApi>
  }
  const api = await mod.loadPyodide({ indexURL })
  api.setStdout(writer)
  api.setStderr(writer)
  api.registerJsModule('_snk', { image: (png: string) => postMessage({ type: 'image', png }) })
  api.runPython(BOOT_PY)
  if (packages.length > 0) {
    await api.loadPackage(packages, { messageCallback: note, errorCallback: note })
  }
  py = api
}

async function handle(msg: InMsg): Promise<void> {
  if (msg.type === 'init') {
    try {
      await load(msg.indexURL, msg.packages ?? [])
      postMessage({ type: 'ready' })
    } catch (err) {
      postMessage({ type: 'failed', error: `Python couldn't load: ${String((err as Error)?.message ?? err)}` })
    }
    return
  }
  // Messages run in order (see the chain below), so no Python here means it
  // failed to load — answer, so the caller isn't left waiting.
  if (!py) {
    postMessage({ type: 'done', id: msg.id })
    return
  }
  if (msg.type === 'run') {
    try {
      await py.loadPackagesFromImports(msg.code, { messageCallback: note, errorCallback: note })
      py.runPython('_snk_patch_mpl()')
      py.globals.set('_snk_src', msg.code)
      py.runPython("_snk_run(_snk_src, '<main.py>')")
    } catch (err) {
      out(`${String((err as Error)?.message ?? err)}\n`)
    }
    out('>>> ')
    postMessage({ type: 'done', id: msg.id })
    return
  }
  if (msg.type === 'line') {
    let more = false
    try {
      // A line that imports a package loads it first, as Run does.
      if (/\bimport\b/.test(msg.line)) {
        await py.loadPackagesFromImports(msg.line, { messageCallback: note, errorCallback: note })
      }
      py.globals.set('_snk_line', msg.line)
      more = py.runPython('_snk_push(_snk_line)') === true
    } catch (err) {
      out(`${String((err as Error)?.message ?? err)}\n`)
    }
    out(more ? '... ' : '>>> ')
    postMessage({ type: 'done', id: msg.id })
  }
}

// Messages are handled one at a time, in order: a line typed while a package
// loads waits for it rather than racing it.
let chain: Promise<void> = Promise.resolve()
self.onmessage = (e: MessageEvent<InMsg>): void => {
  chain = chain.then(() => handle(e.data))
}
export {}
