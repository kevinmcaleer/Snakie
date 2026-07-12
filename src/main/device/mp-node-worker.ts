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
import type { MicroPythonInstance } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'

const require = createRequire(import.meta.url)
const MP_MJS = '@micropython/micropython-webassembly-pyscript/micropython.mjs'
const MP_WASM = '@micropython/micropython-webassembly-pyscript/micropython.wasm'

type InMsg =
  | { type: 'init' }
  | { type: 'feed'; id: number; data: string }
  | { type: 'run'; id: number; code: string }

const port = parentPort
if (!port) throw new Error('mp-node-worker must run as a worker_threads Worker')

/** Flush console output once it reaches this many bytes without a newline. */
const FLUSH_BYTES = 256

const enc = new TextEncoder()
let mp: MicroPythonInstance | null = null
let pending: number[] = []
let capturing: number[] | null = null

const flush = (): void => {
  if (capturing || pending.length === 0) return
  const chunk = Uint8Array.from(pending)
  pending = []
  port.postMessage({ type: 'out', bytes: chunk })
}

const collect = (bytes: Uint8Array): void => {
  if (capturing) {
    for (const b of bytes) capturing.push(b)
    return
  }
  let sawNewline = false
  for (const b of bytes) {
    pending.push(b)
    if (b === 10) sawNewline = true
  }
  // A `while True:` with time.sleep starves the flush TIMER (Asyncify doesn't
  // yield to macrotasks until the loop ends), but this stdout callback IS called
  // as the program prints — so pump here, batched per line, to keep a running
  // program's output + `SNK …` telemetry streaming instead of stalling.
  if (sawNewline || pending.length >= FLUSH_BYTES) flush()
}

port.on('message', async (msg: InMsg): Promise<void> => {
  if (msg.type === 'init') {
    const { loadMicroPython } = await import(MP_MJS)
    const loaded: MicroPythonInstance = await loadMicroPython({
      url: require.resolve(MP_WASM),
      linebuffer: false,
      stdout: collect,
      stderr: collect
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
    flush()
    capturing = []
    try {
      instance.runPython(msg.code)
      port.postMessage({
        type: 'result',
        id: msg.id,
        value: new TextDecoder().decode(Uint8Array.from(capturing))
      })
    } catch (err) {
      port.postMessage({ type: 'result', id: msg.id, error: String(err) })
    } finally {
      capturing = null
    }
  }
})
