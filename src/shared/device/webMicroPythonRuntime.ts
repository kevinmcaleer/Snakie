/**
 * Browser/Web-Worker port of {@link MicroPythonRuntime} (epic #267 Phase W1).
 *
 * Wraps the same `@micropython/micropython-webassembly-pyscript` WASM build,
 * but with zero Node dependencies: no `Buffer`, no `createRequire`/
 * `require.resolve`. The `.wasm` asset location is supplied by the CALLER as a
 * plain `wasmUrl` string — in the real Web Worker entry that's a Vite `?url`
 * import (a same-origin fetchable URL); in unit tests it can be a filesystem
 * path resolved via Node's `require.resolve` (the test file itself is never
 * shipped to the browser, so that's fine there).
 *
 * The interpreter glue (`micropython.mjs`) auto-detects its host environment
 * (`ENVIRONMENT_IS_WORKER` / `ENVIRONMENT_IS_NODE` / …) and fetches the wasm
 * accordingly, so this same code path works unmodified inside a real Web
 * Worker or under Node (vitest).
 */
import type {
  LoadMicroPythonOptions,
  MicroPythonInstance
} from '@micropython/micropython-webassembly-pyscript/micropython.mjs'

/** How often buffered interpreter output is flushed to the consumer (ms). */
const FLUSH_INTERVAL_MS = 16

/** Signature of the package's `loadMicroPython` export, injected so tests can
 *  substitute a fake without booting real WASM. */
export type LoadMicroPython = (options: LoadMicroPythonOptions) => Promise<MicroPythonInstance>

/**
 * A REPL backend {@link WebSimulatedDevice} drives — the browser analogue of
 * `ReplRuntime` in `src/main/device/MicroPythonRuntime.ts`, but `Uint8Array`
 * instead of `Buffer` throughout.
 */
export interface WebReplRuntime {
  /** Boot the runtime; `onOutput` receives REPL output as raw byte chunks. */
  init(onOutput: (chunk: Uint8Array) => void): Promise<void>
  /** Feed raw input bytes (keystrokes, paste-mode payloads, control chars). */
  feed(data: string): Promise<void>
  /**
   * Run a snippet OUT-OF-BAND (not through the interactive REPL) and return
   * what it printed, WITHOUT that output reaching the console — used for
   * filesystem helpers (listdir/read/write/…) that should be invisible.
   * Rejects if the snippet raises a Python exception.
   */
  runCaptured(code: string): Promise<string>
  /** Tear the runtime down. */
  dispose(): void
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

/**
 * REAL MicroPython interpreter, compiled to WebAssembly, running in a Web
 * Worker (epic #267 Phase W1 — the WASM sim's native home per the epic doc,
 * vs. today's Electron main-process shoehorning). Behaviourally identical to
 * `MicroPythonRuntime`: `init()` boots the interpreter and prints the banner +
 * prompt; `feed()` pushes input through the genuine MicroPython REPL so
 * interactive typing, paste mode (Run), Ctrl-C and Ctrl-D all work natively.
 */
export class WebMicroPythonRuntime implements WebReplRuntime {
  private mp: MicroPythonInstance | null = null
  private onOutput: ((chunk: Uint8Array) => void) | null = null
  private pending: number[] = []
  /** When set, interpreter output is diverted here instead of the console. */
  private capturing: number[] | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  /** Serializes input so bytes are processed strictly in order. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly wasmUrl: string,
    private readonly loadMicroPython: LoadMicroPython
  ) {}

  async init(onOutput: (chunk: Uint8Array) => void): Promise<void> {
    this.onOutput = onOutput
    const options: LoadMicroPythonOptions = {
      url: this.wasmUrl,
      linebuffer: false,
      stdout: (bytes) => this.collect(bytes),
      stderr: (bytes) => this.collect(bytes)
    }
    const mp = await this.loadMicroPython(options)
    this.mp = mp
    // Stream buffered output on a short cadence so long-running programs show
    // progress instead of dumping everything when they finish.
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    // Print the banner + first prompt.
    mp.replInit()
    this.flush()
  }

  feed(data: string): Promise<void> {
    const op = this.queue.then(async () => {
      const mp = this.mp
      if (!mp) return
      for (const byte of textEncoder.encode(data)) {
        await mp.replProcessCharWithAsyncify(byte)
      }
      this.flush()
    })
    // Keep the queue alive even if one feed rejects — log so a silently
    // failing REPL feed isn't invisible (mirrors the Electron runtime).
    this.queue = op.catch((err) => console.error('[web sim runtime] feed failed', err))
    return op
  }

  runCaptured(code: string): Promise<string> {
    const op = this.queue.then(() => {
      const mp = this.mp
      if (!mp) throw new Error('MicroPython runtime is not running')
      // Emit any console output buffered so far, then divert this snippet's
      // output into a private buffer so it stays off the console.
      this.flush()
      this.capturing = []
      try {
        // Run SYNCHRONOUSLY (mp_js_do_exec), NOT the Asyncify path — see the
        // Electron runtime's identical comment for why (avoids Asyncify
        // reentrancy surfacing as a "NULL object" on nested calls).
        mp.runPython(code)
        return textDecoder.decode(new Uint8Array(this.capturing))
      } finally {
        this.capturing = null
      }
    })
    this.queue = op.catch((err) => console.error('[web sim runtime] exec failed', err))
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
    const chunk = new Uint8Array(this.pending)
    this.pending = []
    this.onOutput(chunk)
  }
}
