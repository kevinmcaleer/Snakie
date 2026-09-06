/**
 * DRIVING mpy-cross — the half that is the same everywhere (#949, #970).
 * =============================================================================
 *
 * `mpy-cross` is MicroPython's own cross-compiler, built to WebAssembly by
 * `scripts/build-mpy-cross.sh` from a pinned MicroPython tag. Exactly one thing
 * differs between the desktop app and the browser: WHERE the module and the
 * source come from and where the `.mpy` goes. Everything in between — write the
 * source into Emscripten's in-memory filesystem, run, read the bytecode back,
 * turn mpy-cross's stderr into a sentence — is identical, so it lives here and
 * both platforms call it:
 *
 *   desktop  `src/main/mpy/compile.ts`   — `require()` the `.cjs`, node `fs`
 *   web      `src/renderer/src/web/mpy.worker.ts` — `import` the `.mjs`, web fs
 *
 * This module is deliberately free of `fs`, `path`, `electron` and the DOM: it
 * is compiled into the main bundle, the renderer bundle AND a web worker.
 *
 * ALL THE GLUE IS OURS. The published `@pybricks/mpy-cross-v6` bakes its
 * filesystem and callback wiring into the artifact with `--pre-js`; ours does
 * not, because Emscripten will take `preRun`, `print`, `printErr` and `onExit`
 * on the Module object. So the thing we ship is mpy-cross, and every line of
 * plumbing around it is here where it can be read and typed.
 */

/** The Emscripten module, as much of it as we use. */
export interface MpyCrossModule {
  FS: {
    writeFile(path: string, data: string): void
    readFile(path: string, opts: { encoding: 'binary' }): Uint8Array
  }
}

/** The options the module factory takes — `INCOMING_MODULE_JS_API` in the build
 *  script is pruned to exactly this list, so adding one here needs a rebuild. */
export interface MpyCrossOptions {
  arguments: string[]
  wasmBinary: Uint8Array
  print(line: string): void
  printErr(line: string): void
  preRun: Array<(m: MpyCrossModule) => void>
  onExit(status: number): void
}

/** The MODULARIZE factory both loaders hand back. */
export type MpyCrossFactory = (opts: MpyCrossOptions) => unknown

/** What one compile produced. */
export interface CompileOutput {
  /** mpy-cross's exit code — 0 on success. */
  status: number
  /** The bytecode, on success. */
  mpy: Uint8Array | null
  /** Everything it said on stderr, joined. Its diagnostics are here. */
  stderr: string
}

/** The `.mpy` a `.py` compiles to: same folder, same stem. Pure string work, so
 *  it holds for a Windows path, a POSIX one and a web-fs token alike. */
export function mpyPathFor(pyPath: string): string {
  return pyPath.replace(/\.py$/i, '') + '.mpy'
}

/** Is this a file we can compile at all? */
export function isCompilable(path: string): boolean {
  return /\.py$/i.test(path)
}

/** The last path segment, for either separator — the bare name to compile as. */
export function baseNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

/**
 * Run the compiler over one source string.
 *
 * `name` is a BARE FILENAME, not a path: Emscripten's in-memory filesystem
 * starts empty, so `dir/foo.py` fails on the missing directory rather than
 * compiling. Callers pass the basename and place the result themselves.
 */
export function compileWithFactory(
  factory: MpyCrossFactory,
  wasmBinary: Uint8Array,
  name: string,
  source: string
): Promise<CompileOutput> {
  return new Promise<CompileOutput>((resolve, reject) => {
    const stderr: string[] = []
    let mod: MpyCrossModule | null = null
    const out = mpyPathFor(name)
    try {
      factory({
        arguments: [name],
        wasmBinary,
        print: () => {},
        printErr: (line) => stderr.push(line),
        // Emscripten hands the module to the callback as an ARGUMENT; `this` is
        // not it, which is a half-hour nobody else needs to spend.
        preRun: [
          (m) => {
            mod = m
            m.FS.writeFile(name, source)
          }
        ],
        onExit: (status) => {
          let mpy: Uint8Array | null = null
          if (status === 0 && mod) {
            try {
              mpy = mod.FS.readFile(out, { encoding: 'binary' })
            } catch {
              // Exited clean but wrote nothing: treat as a failure with whatever
              // it said, rather than reporting success and writing an empty file.
            }
          }
          resolve({ status, mpy, stderr: stderr.join('\n') })
        }
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/**
 * The one line of a failed compile worth putting in front of someone.
 *
 * mpy-cross prints a CPython-style traceback; the last line is the actual
 * complaint (`SyntaxError: invalid syntax`) and the frames above it are the
 * compiler's own, not the user's. Anything vaguer than that last line — "exit
 * code 1" — sends the reader back to guess at their own file.
 */
export function compileErrorMessage(result: CompileOutput): string {
  const lines = result.stderr.split('\n').filter((l) => l.trim())
  return lines[lines.length - 1] ?? `mpy-cross exited ${result.status}`
}

/** The shape `mpy:compile` resolves to, on both platforms. */
export type CompileResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; error: string }
