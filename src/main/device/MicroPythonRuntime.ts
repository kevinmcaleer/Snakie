import { Worker } from 'worker_threads'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// The worker file is emitted alongside this bundle (electron.vite builds
// `mp-node-worker` as a second main entry → out/main/mp-node-worker.js).
const WORKER_FILE = 'mp-node-worker.js'
const defaultWorkerPath = join(dirname(fileURLToPath(import.meta.url)), WORKER_FILE)

/**
 * A REPL backend the {@link SimulatedDevice} drives. Abstracted so the device
 * can be unit-tested against a lightweight fake without loading WebAssembly.
 */
export interface ReplRuntime {
  /** Boot the runtime; `onOutput` receives REPL output as raw byte chunks. */
  init(onOutput: (chunk: Buffer) => void): Promise<void>
  /** Feed raw input bytes (keystrokes, paste-mode payloads, control chars). */
  feed(data: string): Promise<void>
  /**
   * Run a snippet OUT-OF-BAND (not through the interactive REPL) and return what
   * it printed, WITHOUT that output reaching the console — used for filesystem
   * helpers (listdir/read/write/…) that should be invisible. Rejects if the
   * snippet raises a Python exception.
   */
  runCaptured(code: string): Promise<string>
  /**
   * Stop whatever's running (Stop button). When idle this is a gentle Ctrl-C
   * that keeps REPL state; when a program is running it reboots the interpreter
   * (the only way to break a no-yield / tight loop), resetting the RAM VFS —
   * exactly like a reconnect.
   */
  interrupt(): Promise<void>
  /** Tear the runtime down. */
  dispose(): void
}

type Pending = { resolve: (v: string) => void; reject: (e: Error) => void; kind: 'feed' | 'run' }
type OutMsg =
  | { type: 'out'; bytes: Uint8Array }
  | { type: 'ready' }
  | { type: 'done'; id: number; error?: string }
  | { type: 'result'; id: number; value?: string; error?: string }

/**
 * REAL MicroPython interpreter (WebAssembly, issue #135), run in a Node
 * worker_threads worker so a perpetual `while True:` loop can't freeze the
 * Electron main process. This is the main-thread proxy — the twin of the web
 * build's `WorkerMicroPythonRuntime` — driving {@link ./mp-node-worker} over
 * messages: `init` boots the interpreter (+ the simulated `machine` module),
 * `feed` streams REPL/paste-mode input, `run` executes a captured snippet.
 *
 * `interrupt()` is smart: idle → a queued Ctrl-C (keeps the VFS); running → a
 * worker reboot (the only way to break a loop that never yields to JS), which
 * resets the RAM filesystem like a reconnect.
 */
export class MicroPythonRuntime implements ReplRuntime {
  private worker: Worker | null = null
  private onOutput: ((chunk: Buffer) => void) | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readyResolve: (() => void) | null = null
  private readyReject: ((err: Error) => void) | null = null
  /** In-flight feed/run count — >0 means the interpreter is busy/running. */
  private busy = 0
  private readonly workerPath: string

  /** `workerFile` overrides the bundled worker path. Falls back to
   *  `SNAKIE_MP_WORKER` (set by the vitest setup, which compiles the worker to a
   *  temp file since tests have no built `out/main`), then the bundled path. */
  constructor(workerFile?: string) {
    this.workerPath = workerFile ?? process.env.SNAKIE_MP_WORKER ?? defaultWorkerPath
  }

  async init(onOutput: (chunk: Buffer) => void): Promise<void> {
    this.onOutput = onOutput
    await this.spawn()
  }

  private spawn(): Promise<void> {
    const worker = new Worker(this.workerPath)
    this.worker = worker
    worker.on('message', (m: OutMsg) => this.handle(m))
    // A worker-level error rejects the boot / any in-flight request rather than
    // hanging the device layer. (This used to RESOLVE the boot — connect then
    // "succeeded" with a dead worker installed and every request hung, #500.)
    worker.on('error', (err) => {
      const e = err instanceof Error ? err : new Error(String(err))
      for (const p of this.pending.values()) p.reject(e)
      this.pending.clear()
      this.busy = 0
      this.readyReject?.(e)
      this.readyResolve = null
      this.readyReject = null
      // Tear the dead worker down so later requests fail fast, not silently.
      if (this.worker === worker) this.worker = null
      void worker.terminate()
    })
    const ready = new Promise<void>((res, rej) => {
      this.readyResolve = res
      this.readyReject = rej
    })
    worker.postMessage({ type: 'init' })
    return ready
  }

  private handle(msg: OutMsg): void {
    if (msg.type === 'out') {
      this.onOutput?.(Buffer.from(msg.bytes))
      return
    }
    if (msg.type === 'ready') {
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      return
    }
    // 'done' (feed) or 'result' (run) — settle the matching request.
    this.busy = Math.max(0, this.busy - 1)
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.type === 'result' ? (msg.value ?? '') : '')
  }

  private request(payload: { type: 'feed'; data: string } | { type: 'run'; code: string }): Promise<string> {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('MicroPython runtime is not running'))
    const id = this.nextId++
    this.busy += 1
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, kind: payload.type })
      worker.postMessage({ ...payload, id })
    })
  }

  async feed(data: string): Promise<void> {
    await this.request({ type: 'feed', data })
  }

  runCaptured(code: string): Promise<string> {
    return this.request({ type: 'run', code })
  }

  async interrupt(): Promise<void> {
    // Idle → a gentle Ctrl-C keeps REPL + VFS state. Busy (a program is running,
    // possibly a no-yield loop) → reboot the worker: the only way to break it.
    if (this.busy <= 0) {
      await this.feed('\x03').catch(() => undefined)
      return
    }
    await this.reboot()
  }

  private async reboot(): Promise<void> {
    // The in-flight FEED is the running program itself (the Run) — stopping it is
    // a normal completion, so RESOLVE it (rejecting would surface a spurious
    // "couldn't send your program" from the Run button's catch). In-flight RUNs
    // (FS ops / probes) genuinely didn't complete — reject so callers can retry.
    for (const p of this.pending.values()) {
      if (p.kind === 'feed') p.resolve('')
      else p.reject(new Error('interrupted'))
    }
    this.pending.clear()
    this.busy = 0
    await this.worker?.terminate()
    this.worker = null
    this.onOutput?.(Buffer.from('\r\n[stopped — simulator restarted]\r\n', 'utf8'))
    await this.spawn()
  }

  dispose(): void {
    void this.worker?.terminate()
    this.worker = null
    this.onOutput = null
    this.pending.clear()
    this.busy = 0
  }
}
