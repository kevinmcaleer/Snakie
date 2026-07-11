/**
 * BROWSER MicroPython runtime — epic #267, Phase W1.
 * =============================================================================
 *
 * The browser twin of the main-process `MicroPythonRuntime`: it runs the SAME
 * official `@micropython/micropython-webassembly-pyscript` interpreter, but loads
 * the `.wasm` via a Vite `?url` asset import (the sim's native home) and speaks
 * `Uint8Array` instead of Node `Buffer`. It powers the web build's simulated
 * device, so a school Chromebook with no hardware gets a real REPL + Run + a
 * writable in-memory filesystem.
 */
import { loadMicroPython } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'
import type { MicroPythonInstance } from '@micropython/micropython-webassembly-pyscript/micropython.mjs'
import mpWasmUrl from '@micropython/micropython-webassembly-pyscript/micropython.wasm?url'

const FLUSH_INTERVAL_MS = 24
const enc = new TextEncoder()

/** Interpreter output → app, matching the desktop runtime's `ReplRuntime`. */
export class BrowserMicroPythonRuntime {
  private mp: MicroPythonInstance | null = null
  private onOutput: ((chunk: Uint8Array) => void) | null = null
  private pending: number[] = []
  private capturing: number[] | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  async init(onOutput: (chunk: Uint8Array) => void): Promise<void> {
    this.onOutput = onOutput
    this.mp = await loadMicroPython({
      url: mpWasmUrl,
      linebuffer: false,
      stdout: (bytes) => this.collect(bytes),
      stderr: (bytes) => this.collect(bytes)
    })
    // Stream buffered output on a short cadence so long-running programs show
    // progress instead of dumping everything when they finish.
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    this.mp.replInit()
    this.flush()
  }

  /** Feed user keystrokes / Run paste-mode payloads to the REPL (async/Asyncify). */
  feed(data: string): Promise<void> {
    const op = this.queue.then(async () => {
      const mp = this.mp
      if (!mp) return
      for (const byte of enc.encode(data)) {
        await mp.replProcessCharWithAsyncify(byte)
      }
      this.flush()
    })
    // Keep the queue alive even if one feed rejects (swallow), but return `op`
    // so the caller still sees the error.
    this.queue = op.catch(() => undefined)
    return op
  }

  /** Run a snippet synchronously and return exactly what it printed. */
  runCaptured(code: string): Promise<string> {
    const op = this.queue.then(() => {
      const mp = this.mp
      if (!mp) throw new Error('MicroPython runtime is not running')
      this.flush()
      this.capturing = []
      try {
        mp.runPython(code)
        return new TextDecoder().decode(Uint8Array.from(this.capturing))
      } finally {
        this.capturing = null
      }
    })
    this.queue = op.catch(() => undefined)
    return op
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this.flush()
    this.mp = null
    this.onOutput = null
    this.pending = []
    this.capturing = null
  }

  /** Accumulate output — into the capture buffer if one is active, else pending. */
  private collect(bytes: Uint8Array): void {
    const sink = this.capturing ?? this.pending
    for (const b of bytes) sink.push(b)
  }

  /** Emit any buffered console output as a single chunk. */
  private flush(): void {
    if (this.capturing || this.pending.length === 0 || !this.onOutput) return
    const chunk = Uint8Array.from(this.pending)
    this.pending = []
    this.onOutput(chunk)
  }
}
