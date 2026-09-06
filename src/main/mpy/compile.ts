import { app } from 'electron'
import { createRequire } from 'module'
import { existsSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { basename, join } from 'path'
import {
  compileErrorMessage,
  compileWithFactory,
  isCompilable,
  mpyPathFor,
  type CompileOutput,
  type CompileResult,
  type MpyCrossFactory
} from '../../shared/mpy-compile'

/**
 * COMPILING `.py` TO `.mpy` — the DESKTOP half (#949).
 * =============================================================================
 *
 * `mpy-cross` is MicroPython's own cross-compiler, built here to WebAssembly by
 * `scripts/build-mpy-cross.sh` from a pinned MicroPython tag. Running it as
 * WASM rather than a native binary means no per-platform builds and no third
 * executable to sign and notarize inside the app bundle.
 *
 * IT RUNS IN MAIN, not the renderer. The output is a file written next to its
 * source, which is main's job anyway; keeping it here also keeps a 334 KB
 * `.wasm` out of the Electron renderer bundle and away from the asset-URL
 * problem that #947 was. The WEB build has no main process, so it runs the
 * same compiler in a worker on the page instead — see
 * `renderer/src/web/web-mpy.ts` (#970).
 *
 * THE LOADER IS `.cjs` ON PURPOSE. Emscripten's export line is guarded by
 * `typeof module === 'object'`; this package.json is `"type": "module"`, so a
 * `.js` would be parsed as ESM, that branch would never run, and `require()`
 * would hand back an empty object. Exactly why the preload is `index.cjs`.
 * (The browser gets its own `mpy-cross.mjs` from the same build, for the
 * mirror-image reason.)
 *
 * ONLY THE TWO ENDS ARE HERE. Loading the module, reading the source and
 * writing the `.mpy` are node's; the run in between — Emscripten's in-memory
 * filesystem, the callbacks, the error wording — is `shared/mpy-compile.ts`,
 * which the web worker drives identically.
 */

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

export type { CompileOutput, CompileResult }
export { isCompilable, mpyPathFor }

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
  return compileWithFactory(factory, wasmBinary, name, source)
}

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
  if (result.status !== 0 || !result.mpy) return { ok: false, error: compileErrorMessage(result) }

  const out = mpyPathFor(pyPath)
  await writeFile(out, result.mpy)
  return { ok: true, path: out, bytes: result.mpy.length }
}
