/**
 * MicroPython sim NODE WORKER (worker_threads) — #135 / desktop twin of the web's
 * {@link ../../renderer/src/web/mp.worker}.
 * =============================================================================
 *
 * Runs the MicroPython WASM interpreter OFF the Electron MAIN thread. A student's
 * `while True:` loop yields to JS only via Asyncify, which — crucially — does NOT
 * let the event loop's macrotasks run until the loop ends. In-process that froze
 * the whole main process (IPC, Stop button, everything) on any perpetual loop; in
 * a worker it only saturates the worker thread, and the main process stays live.
 * {@link MicroPythonRuntime} drives this over `parentPort`, and stops a runaway
 * loop by terminating + re-spawning the worker (the only reliable way — Ctrl-C
 * can't be delivered while the loop monopolises the worker's event loop).
 */
import { parentPort } from 'worker_threads'
import { createRequire } from 'module'
import { SIM_MACHINE_PY } from '../../shared/sim-machine'
import { SimOutputPump } from '../../shared/sim-output-pump'
import type { MicroPythonInstance } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'

const require = createRequire(import.meta.url)
const MP_MJS = '@micropython/micropython-webassembly-pyscript/micropython.mjs'
const MP_WASM = '@micropython/micropython-webassembly-pyscript/micropython.wasm'

type InMsg =
  | { type: 'init'; heapBytes?: number }
  | { type: 'feed'; id: number; data: string }
  | { type: 'run'; id: number; code: string }
  | { type: 'runStream'; id: number; code: string }

const port = parentPort
if (!port) throw new Error('mp-node-worker must run as a worker_threads Worker')

const enc = new TextEncoder()
let mp: MicroPythonInstance | null = null
// Batches output per line, and posts from inside the stdout callback rather
// than only on the timer — a `while True:` with `time.sleep` starves the timer
// (the sleep is a busy-wait inside `runPython`), but the callback IS called as
// the program prints. Shared with the web worker so the two cannot drift.
const pump = new SimOutputPump((bytes) => port.postMessage({ type: 'out', bytes }))
const { collect, flush } = pump

// Messages that arrive while the WASM is still loading (the handler is async,
// so a feed/run can interleave with init's awaits — e.g. typing right after a
// Stop reboot). Dropping them hung the caller's promise forever and leaked the
// runtime's busy count, turning every later Stop into a VFS wipe (#501).
const queuedEarly: InMsg[] = []
port.on('message', async (msg: InMsg): Promise<void> => {
  if (msg.type !== 'init' && !mp) {
    queuedEarly.push(msg)
    return
  }
  if (msg.type === 'init') {
    const { loadMicroPython } = await import(MP_MJS)
    const loaded: MicroPythonInstance = await loadMicroPython({
      url: require.resolve(MP_WASM),
      linebuffer: false,
      stdout: collect,
      stderr: collect,
      // The GC heap the interpreter starts with (#901). Omitted → the port's own
      // 1 MB default. It is fixed here, at `mp_js_init` — which is why changing
      // it costs a restart rather than applying to a live session.
      ...(msg.heapBytes ? { heapsize: msg.heapBytes } : {})
    })
    mp = loaded
    const timer = setInterval(flush, 16)
    timer.unref?.()
    // The WASM port has no `machine` module — install a simulated one so
    // `from machine import Pin` (every lesson's first line) works (#267).
    try {
      loaded.runPython(SIM_MACHINE_PY)
    } catch {
      /* best-effort — a missing machine stub just means the ImportError returns */
    }
    loaded.replInit()
    flush()
    port.postMessage({ type: 'ready' })
    // Drain anything that raced the load — order preserved.
    while (queuedEarly.length > 0) port.emit('message', queuedEarly.shift())
    return
  }
  const instance = mp
  if (!instance) return
  if (msg.type === 'feed') {
    try {
      for (const byte of enc.encode(msg.data)) {
        await instance.replProcessCharWithAsyncify(byte)
      }
      flush()
      port.postMessage({ type: 'done', id: msg.id })
    } catch (err) {
      flush()
      port.postMessage({ type: 'done', id: msg.id, error: String(err) })
    }
    return
  }
  if (msg.type === 'run') {
    pump.beginCapture()
    try {
      instance.runPython(msg.code)
      port.postMessage({ type: 'result', id: msg.id, value: pump.captured() })
    } catch (err) {
      port.postMessage({ type: 'result', id: msg.id, error: String(err) })
    } finally {
      pump.endCapture()
    }
  }
  // Run a whole user PROGRAM with its output STREAMING to the terminal (#612):
  // execute directly (not through the REPL), so there is no source echo and no
  // paste-mode `===` framing — just the program's stdout/stderr via `collect`. A
  // Python exception's traceback streams through the stderr → collect path, so we
  // never surface it as a transport error (that program ran; it just raised).
  if (msg.type === 'runStream') {
    flush()
    try {
      instance.runPython(msg.code)
    } catch (err) {
      // `runPython` throws a Python exception WITHOUT printing the traceback to
      // stderr — surface it to the terminal so the user still sees the error.
      const text = String((err as Error)?.message ?? err)
      collect(enc.encode(text.endsWith('\n') ? text : text + '\n'))
    } finally {
      // A fresh friendly-REPL prompt so the user sees the REPL is ready for
      // another command after the program finishes (#612).
      collect(enc.encode('\r\n>>> '))
      flush()
      port.postMessage({ type: 'done', id: msg.id })
    }
  }
})
