/**
 * THE EMBED'S ENGINES (#1286, #1289).
 * =============================================================================
 *
 * One small interface, two interpreters, so the toolbar, the REPL and the
 * footer never ask which one is running:
 *
 *  - **MicroPython** — the web app's own WASM worker (`web/mp.worker.ts`), with
 *    the simulated `machine`, `turtle` and Snakie libraries already seeded. Its
 *    REPL is MicroPython's friendly REPL, so the terminal forwards raw keys.
 *  - **Pyodide** — full CPython in `pyodide.worker.ts`, loaded from jsDelivr on
 *    first Run. It has no raw REPL, so the terminal edits a line locally and
 *    sends it whole (`lineMode`).
 *
 * Both run in a worker and both stop the same way: a program with no `await`
 * can't be interrupted without SharedArrayBuffer (which needs COOP/COEP headers
 * the host page can't be asked for), so Stop terminates the worker and starts
 * a fresh one.
 */
import { WorkerMicroPythonRuntime } from '../web/worker-runtime'
import type { EmbedEngineId } from './params'

export interface EngineHandlers {
  /** Text for the terminal (may contain ANSI / `\r\n`). */
  output: (text: string) => void
  /** A matplotlib figure, as base64 PNG. */
  image?: (pngBase64: string) => void
}

export interface EmbedEngine {
  readonly id: EmbedEngineId
  /** What the footer calls it. */
  readonly label: string
  /** True → the terminal edits a line itself and sends it on Enter. */
  readonly lineMode: boolean
  /** Boot the interpreter. Safe to call twice; the second call is a no-op. */
  start(handlers: EngineHandlers): Promise<void>
  /** Run a whole program; resolves when it finishes (or is stopped). */
  run(code: string): Promise<void>
  /** Raw keystrokes (MicroPython) or one whole line (line mode). */
  input(data: string): void
  /** Stop a running program (restarts the interpreter if it must). */
  stop(): Promise<void>
  dispose(): void
}

const decoder = new TextDecoder()

export class MicroPythonEngine implements EmbedEngine {
  readonly id = 'micropython' as const
  readonly label = 'MicroPython'
  readonly lineMode = false
  private runtime: WorkerMicroPythonRuntime | null = null
  private booting: Promise<void> | null = null

  start(handlers: EngineHandlers): Promise<void> {
    if (this.booting) return this.booting
    const runtime = new WorkerMicroPythonRuntime()
    this.runtime = runtime
    this.booting = runtime.init((bytes) => handlers.output(decoder.decode(bytes, { stream: true })))
    return this.booting
  }

  async run(code: string): Promise<void> {
    if (!this.runtime) throw new Error('MicroPython is not started')
    await this.booting
    await this.runtime.runStream(code)
  }

  input(data: string): void {
    void this.runtime?.feed(data).catch(() => undefined)
  }

  async stop(): Promise<void> {
    await this.runtime?.interrupt()
  }

  dispose(): void {
    this.runtime?.dispose()
    this.runtime = null
    this.booting = null
  }
}

/**
 * Pinned, and loaded from jsDelivr's Pyodide mirror (free, no key). The core is
 * about 6 MB and is only fetched when a reader presses Run on a Python lesson.
 */
export const PYODIDE_VERSION = '314.0.7'
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

type PyOut =
  | { type: 'out'; text: string }
  | { type: 'image'; png: string }
  | { type: 'ready' }
  | { type: 'failed'; error: string }
  | { type: 'done'; id: number }

export class PyodideEngine implements EmbedEngine {
  readonly id = 'pyodide' as const
  readonly label = 'Python 3 (Pyodide)'
  readonly lineMode = true
  private worker: Worker | null = null
  private handlers: EngineHandlers | null = null
  private booting: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<number, () => void>()

  constructor(private readonly packages: readonly string[] = []) {}

  start(handlers: EngineHandlers): Promise<void> {
    this.handlers = handlers
    if (this.booting) return this.booting
    this.booting = this.spawn()
    return this.booting
  }

  private spawn(): Promise<void> {
    const worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    return new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<PyOut>): void => {
        const msg = e.data
        if (msg.type === 'out') this.handlers?.output(msg.text)
        else if (msg.type === 'image') this.handlers?.image?.(msg.png)
        else if (msg.type === 'ready') resolve()
        else if (msg.type === 'failed') {
          this.handlers?.output(`\r\n\x1b[31m${msg.error}\x1b[0m\r\n`)
          this.booting = null
          reject(new Error(msg.error))
        } else if (msg.type === 'done') {
          const settle = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          settle?.()
        }
      }
      worker.onerror = (e: ErrorEvent): void => {
        this.booting = null
        reject(new Error(e.message || 'Python failed to load'))
      }
      worker.postMessage({ type: 'init', indexURL: PYODIDE_INDEX_URL, packages: this.packages })
    })
  }

  private request(payload: Record<string, unknown>): Promise<void> {
    if (!this.worker) return Promise.resolve()
    const id = this.nextId++
    return new Promise<void>((resolve) => {
      this.pending.set(id, resolve)
      this.worker!.postMessage({ ...payload, id })
    })
  }

  async run(code: string): Promise<void> {
    await this.booting
    await this.request({ type: 'run', code })
  }

  input(line: string): void {
    void this.request({ type: 'line', line })
  }

  async stop(): Promise<void> {
    if (!this.worker) return
    // Settle everything in flight: stopping a program is a normal end to it.
    for (const settle of this.pending.values()) settle()
    this.pending.clear()
    this.worker.terminate()
    this.worker = null
    this.handlers?.output('\r\n[stopped — Python restarted]\r\n')
    this.booting = this.spawn()
    await this.booting.catch(() => undefined)
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
    this.booting = null
  }
}

export function createEngine(id: EmbedEngineId, packages: readonly string[] = []): EmbedEngine {
  return id === 'pyodide' ? new PyodideEngine(packages) : new MicroPythonEngine()
}
