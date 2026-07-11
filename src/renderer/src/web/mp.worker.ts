/**
 * MicroPython sim WEB WORKER — epic #267, Phase W1.
 * =============================================================================
 *
 * Runs the MicroPython WASM interpreter OFF the main thread, so a student's
 * `while True:` loop churns in the worker and the UI (editor, Stop button) stays
 * responsive. The main thread ({@link ./worker-runtime}) drives it over
 * postMessage: `init` boots the interpreter, `feed` streams REPL/Run input,
 * `run` executes a captured snippet. Interpreter output is buffered and flushed
 * on a short cadence as `out` messages.
 *
 * A tight loop with no `await` can't be interrupted from here (no
 * SharedArrayBuffer on GitHub Pages — needs cross-origin isolation), so the main
 * thread stops such a loop by terminating + reinitialising this worker (a fresh
 * REPL — the sim's RAM filesystem resets, exactly like a reconnect).
 */
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'
import type { MicroPythonInstance } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'
import mpWasmUrl from '@micropython/micropython-webassembly-pyscript/micropython.wasm?url'
import { SIM_MACHINE_PY } from '../../../shared/sim-machine'
import { INSTRUMENTS_PY, SNAKIE_PY } from './web-lib-sources'

type InMsg =
  | { type: 'init' }
  | { type: 'feed'; id: number; data: string }
  | { type: 'run'; id: number; code: string }

const enc = new TextEncoder()

/**
 * Write a text file into the sim's in-memory VFS via a hex-encoded snippet
 * (MicroPython has no bulk file API from JS). The hex + paths are all ASCII, so
 * `JSON.stringify` yields valid Python string literals.
 */
const writeVfsFile = (mpi: MicroPythonInstance, path: string, source: string): void => {
  const hex = Array.from(enc.encode(source))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const dir = path.slice(0, path.lastIndexOf('/')) || '/'
  mpi.runPython(
    `import os\ntry:\n    os.mkdir(${JSON.stringify(dir)})\nexcept OSError:\n    pass\n` +
      `_d = bytes.fromhex(${JSON.stringify(hex)})\n` +
      `_f = open(${JSON.stringify(path)}, 'wb')\n_f.write(_d)\n_f.close()\ndel _d, _f`
  )
}

/**
 * Seed `/lib/instruments.py` + `/lib/snakie.py` so `import instruments` /
 * `from snakie import Servo` work with no install step. The RAM VFS resets on a
 * worker reboot (Stop), so this re-runs on every init — exactly like a reconnect.
 */
const installLibrary = (mpi: MicroPythonInstance): void => {
  writeVfsFile(mpi, '/lib/instruments.py', INSTRUMENTS_PY)
  writeVfsFile(mpi, '/lib/snakie.py', SNAKIE_PY)
}
let mp: MicroPythonInstance | null = null
let pending: number[] = []
let capturing: number[] | null = null

const collect = (bytes: Uint8Array): void => {
  const sink = capturing ?? pending
  for (const b of bytes) sink.push(b)
}

const flush = (): void => {
  if (capturing || pending.length === 0) return
  const chunk = Uint8Array.from(pending)
  pending = []
  postMessage({ type: 'out', bytes: chunk })
}

self.onmessage = async (e: MessageEvent<InMsg>): Promise<void> => {
  const msg = e.data
  if (msg.type === 'init') {
    mp = await loadMicroPython({
      url: mpWasmUrl,
      linebuffer: false,
      stdout: collect,
      stderr: collect
    })
    setInterval(flush, 24)
    // The WASM port has no `machine` module — install a simulated one so
    // `from machine import Pin` (every lesson's first line) works.
    try {
      mp.runPython(SIM_MACHINE_PY)
    } catch {
      /* best-effort — a missing machine stub just means the ImportError returns */
    }
    // Seed the bundled `instruments` + `snakie` libraries into the VFS so the
    // demos' `from snakie import Servo` / `import instruments` just work (#267).
    try {
      installLibrary(mp)
    } catch {
      /* best-effort — the install banner can still write them on demand */
    }
    mp.replInit()
    flush()
    postMessage({ type: 'ready' })
    return
  }
  if (!mp) return
  if (msg.type === 'feed') {
    try {
      for (const byte of enc.encode(msg.data)) {
        await mp.replProcessCharWithAsyncify(byte)
      }
      flush()
      postMessage({ type: 'done', id: msg.id })
    } catch (err) {
      flush()
      postMessage({ type: 'done', id: msg.id, error: String(err) })
    }
    return
  }
  if (msg.type === 'run') {
    flush()
    capturing = []
    try {
      mp.runPython(msg.code)
      postMessage({
        type: 'result',
        id: msg.id,
        value: new TextDecoder().decode(Uint8Array.from(capturing))
      })
    } catch (err) {
      postMessage({ type: 'result', id: msg.id, error: String(err) })
    } finally {
      capturing = null
    }
  }
}
