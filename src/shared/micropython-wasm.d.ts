/**
 * Minimal ambient types for the untyped MicroPython WebAssembly package
 * (`@micropython/micropython-webassembly-pyscript`). Only the surface the
 * simulated device uses (issue #135) is declared.
 *
 * @see https://docs.micropython.org/en/latest/reference/glossary.html#term-WebAssembly
 */
declare module '@micropython/micropython-webassembly-pyscript/micropython.mjs' {
  /** A loaded MicroPython interpreter instance. */
  export interface MicroPythonInstance {
    /** Print the friendly REPL banner + first prompt. */
    replInit(): void
    /** Feed one input byte to the REPL, running code via Asyncify when needed. */
    replProcessCharWithAsyncify(charCode: number): Promise<unknown>
    /** Synchronous variant (no Asyncify); unused here. */
    replProcessChar(charCode: number): number
    /** Run a snippet, awaiting Asyncify suspensions (e.g. `time.sleep`). */
    runPythonAsync(code: string): Promise<unknown>
    /** Run a snippet synchronously. */
    runPython(code: string): unknown
  }

  /** Options accepted by {@link loadMicroPython}. */
  export interface LoadMicroPythonOptions {
    /** Path / URL to the `.wasm` binary. */
    url?: string
    stdin?: () => string
    /** Per-line (linebuffer:true) or per-byte (linebuffer:false) output sink. */
    stdout?: (data: Uint8Array) => void
    stderr?: (data: Uint8Array) => void
    /** When false, stdout/stderr are called per byte; when true, per line. */
    linebuffer?: boolean
    heapsize?: number
    pystack?: number
  }

  export function loadMicroPython(
    options?: LoadMicroPythonOptions
  ): Promise<MicroPythonInstance>
}
