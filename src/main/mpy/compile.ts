import { app } from 'electron'
import { createRequire } from 'module'
import { existsSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'

/**
 * COMPILING `.py` TO `.mpy` (#949).
 * =============================================================================
 *
 * `mpy-cross` is MicroPython's own cross-compiler, built here to WebAssembly by
 * `scripts/build-mpy-cross.sh` from a pinned MicroPython tag. Running it as
 * WASM rather than a native binary means no per-platform builds and no third
 * executable to sign and notarize inside the app bundle.
 *
 * IT RUNS IN MAIN, not the renderer. The output is a file written next to its
 * source, which is main's job anyway; keeping it here also keeps a 334 KB
 * `.wasm` out of the renderer bundle and away from the asset-URL problem that
 * #947 was. The web build has no main process, so `mpy.available` reports false
 * there and the menu item says why rather than failing when pressed.
 *
 * THE LOADER IS `.cjs` ON PURPOSE. Emscripten's export line is guarded by
 * `typeof module === 'object'`; this package.json is `"type": "module"`, so a
 * `.js` would be parsed as ESM, that branch would never run, and `require()`
 * would hand back an empty object. Exactly why the preload is `index.cjs`.
 *
 * ALL THE GLUE IS HERE. The published `@pybricks/mpy-cross-v6` bakes its
 * filesystem and callback wiring into the artifact with `--pre-js`; ours does
 * not, because Emscripten will take `preRun`, `print`, `printErr` and `onExit`
 * on the Module object. So the thing we ship is mpy-cross, and every line of
 * plumbing around it is in this file where it can be read and typed.
 */

/** The Emscripten module factory, as much of it as we use. */
type MpyCrossModule = {
  FS: {
    writeFile(path: string, data: string): void
    readFile(path: string, opts: { encoding: 'binary' }): Uint8Array
  }
}
type MpyCrossFactory = (opts: {
  arguments: string[]
  wasmBinary: Uint8Array
  print(line: string): void
  printErr(line: string): void
  preRun: Array<(m: MpyCrossModule) => void>
  onExit(status: number): void
}) => unknown

const require_ = createRequire(import.meta.url)

/**
 * Where the built compiler lives.
 *
 * Packaged: shipped under `resources/` by electron-builder's `extraResources`.
 * Dev: `__dirname` is `out/main`, so the repo root is two levels up. The same
 * shape `PluginHost` uses to find `python/`.
 */
function artifactDir(): string {
  const packaged = join(process.resourcesPath, 'mpy-cross')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(__dirname, '..', '..', 'resources', 'mpy-cross')
}

/** Whether the compiler was actually shipped with this build. */
export function mpyCrossAvailable(): boolean {
  const dir = artifactDir()
  return existsSync(join(dir, 'mpy-cross.cjs')) && existsSync(join(dir, 'mpy-cross.wasm'))
}

/** The MicroPython release the bundled compiler was built from, or null. */
export function mpyCrossVersion(): string | null {
  try {
    const meta = JSON.parse(readFileSync(join(artifactDir(), 'BUILD.json'), 'utf8'))
    return typeof meta.micropython === 'string' ? meta.micropython : null
  } catch {
    return null
  }
}

/** What one compile produced. */
export interface CompileOutput {
  /** mpy-cross's exit code — 0 on success. */
  status: number
  /** The bytecode, on success. */
  mpy: Uint8Array | null
  /** Everything it said on stderr, joined. Its diagnostics are here. */
  stderr: string
}

/**
 * Run the compiler over one source string.
 *
 * `name` is a BARE FILENAME, not a path: Emscripten's in-memory filesystem
 * starts empty, so `dir/foo.py` fails on the missing directory rather than
 * compiling. Callers pass the basename and place the result themselves.
 */
export function compileSource(name: string, source: string): Promise<CompileOutput> {
  const dir = artifactDir()
  const factory = require_(join(dir, 'mpy-cross.cjs')) as MpyCrossFactory
  const wasmBinary = readFileSync(join(dir, 'mpy-cross.wasm'))

  return new Promise<CompileOutput>((resolve, reject) => {
    const stderr: string[] = []
    let mod: MpyCrossModule | null = null
    const out = name.replace(/\.py$/i, '.mpy')
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

/** The `.mpy` a `.py` compiles to: same folder, same stem. */
export function mpyPathFor(pyPath: string): string {
  return join(dirname(pyPath), basename(pyPath).replace(/\.py$/i, '') + '.mpy')
}

/** Is this a file we can compile at all? */
export function isCompilable(path: string): boolean {
  return extname(path).toLowerCase() === '.py'
}

export type CompileResult = { ok: true; path: string; bytes: number } | { ok: false; error: string }

/**
 * Compile `pyPath`, writing the `.mpy` beside it.
 *
 * Failures come back as a message rather than a throw, because every one of
 * them is something to show the user: a syntax error in their file, a build
 * without the compiler in it, or a file that is not Python.
 */
export async function compileFile(pyPath: string): Promise<CompileResult> {
  if (!isCompilable(pyPath)) return { ok: false, error: 'Only .py files can be compiled.' }
  if (!mpyCrossAvailable()) {
    return { ok: false, error: 'This build does not include the MicroPython compiler.' }
  }
  let source: string
  try {
    source = readFileSync(pyPath, 'utf8')
  } catch (err) {
    return { ok: false, error: `Couldn’t read ${basename(pyPath)}: ${(err as Error).message}` }
  }

  const result = await compileSource(basename(pyPath), source)
  if (result.status !== 0 || !result.mpy) {
    // mpy-cross prints a CPython-style traceback; the last line is the actual
    // complaint and the only part worth putting in front of someone.
    const lines = result.stderr.split('\n').filter((l) => l.trim())
    return { ok: false, error: lines[lines.length - 1] ?? `mpy-cross exited ${result.status}` }
  }

  const out = mpyPathFor(pyPath)
  await writeFile(out, result.mpy)
  return { ok: true, path: out, bytes: result.mpy.length }
}
