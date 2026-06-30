import { createRequire } from 'module'
import type {
  LoadMicroPythonOptions,
  MicroPythonInstance
} from '@micropython/micropython-webassembly-pyscript/micropython.mjs'

// The main bundle is ESM, so reconstruct a `require` for resolving the package's
// `.wasm` file path (works in dev, in the packaged asar, and under vitest).
const require = createRequire(import.meta.url)

/** Specifier of the MicroPython WebAssembly ESM loader + its binary. */
const MP_MJS = '@micropython/micropython-webassembly-pyscript/micropython.mjs'
const MP_WASM = '@micropython/micropython-webassembly-pyscript/micropython.wasm'

/** How often buffered interpreter output is flushed to the consumer (ms). */
const FLUSH_INTERVAL_MS = 16

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
  /** Tear the runtime down. */
  dispose(): void
}

/**
 * REAL MicroPython interpreter, compiled to WebAssembly (issue #135).
 *
 * Wraps the official `@micropython/micropython-webassembly-pyscript` build so the
 * simulated device runs ACTUAL Python: `init()` boots the interpreter and prints
 * the friendly banner + prompt, and `feed()` pushes input bytes through the
 * genuine MicroPython REPL — so interactive typing, **paste mode** (how the Run
 * button ships a file: Ctrl-E … Ctrl-D), Ctrl-C and Ctrl-D all work natively.
 *
 * Output arrives one byte at a time from Emscripten; we buffer it and flush on a
 * short timer so a running program streams without firing an IPC message per
 * character. Hardware modules (`machine`, etc.) don't exist in the WASM port, so
 * importing them raises `ImportError` — exactly like a board with no such device.
 */
export class MicroPythonRuntime implements ReplRuntime {
  private mp: MicroPythonInstance | null = null
  private onOutput: ((chunk: Buffer) => void) | null = null
  private pending: number[] = []
  /** When set, interpreter output is diverted here instead of the console. */
  private capturing: number[] | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  /** Serializes input so bytes are processed strictly in order. */
  private queue: Promise<unknown> = Promise.resolve()

  async init(onOutput: (chunk: Buffer) => void): Promise<void> {
    this.onOutput = onOutput
    const wasmPath = require.resolve(MP_WASM)
    const { loadMicroPython } = await import(MP_MJS)
    const options: LoadMicroPythonOptions = {
      url: wasmPath,
      linebuffer: false,
      stdout: (bytes) => this.collect(bytes),
      stderr: (bytes) => this.collect(bytes)
    }
    const mp = await loadMicroPython(options)
    this.mp = mp
    // Stream buffered output on a short cadence so long-running programs show
    // progress instead of dumping everything when they finish.
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    this.flushTimer.unref?.()
    // Print the banner + first prompt.
    mp.replInit()
    this.flush()
  }

  feed(data: string): Promise<void> {
    const op = this.queue.then(async () => {
      const mp = this.mp
      if (!mp) return
      for (const byte of Buffer.from(data, 'utf8')) {
        await mp.replProcessCharWithAsyncify(byte)
      }
      this.flush()
    })
    // Keep the queue alive even if one feed rejects.
    this.queue = op.catch(() => undefined)
    return op
  }

  runCaptured(code: string): Promise<string> {
    const op = this.queue.then(async () => {
      const mp = this.mp
      if (!mp) throw new Error('MicroPython runtime is not running')
      // Emit any console output buffered so far, then divert this snippet's
      // output into a private buffer so it stays off the console.
      this.flush()
      this.capturing = []
      try {
        await mp.runPythonAsync(code)
        return Buffer.from(this.capturing).toString('utf8')
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

  /** Accumulate interpreter output — into the capture buffer if one is active
   * (a `runCaptured` snippet), otherwise the console-bound pending buffer. */
  private collect(bytes: Uint8Array): void {
    const sink = this.capturing ?? this.pending
    for (const b of bytes) sink.push(b)
  }

  /** Emit any buffered output as a single chunk. */
  private flush(): void {
    if (this.pending.length === 0 || !this.onOutput) return
    const chunk = Buffer.from(this.pending)
    this.pending = []
    this.onOutput(chunk)
  }
}
