/**
 * WEB `mpy` backend — "Compile to .mpy" in the browser (#970).
 * =============================================================================
 *
 * The desktop reaches the compiler over IPC (`mpy:available` / `mpy:compile`,
 * handled in `main/mpy/ipc.ts`). There is no main process here, so this answers
 * the SAME two calls on the page: `available()` says the compiler shipped with
 * this bundle, and `compile()` reads the `.py` through the web filesystem,
 * hands it to {@link ./mpy.worker}, and writes the `.mpy` back beside it.
 *
 * Which is the whole difference between the platforms — the module loader and
 * the two file ends. Everything between them is `shared/mpy-compile.ts`, so a
 * fix to the Emscripten wiring or to how an error is worded reaches both.
 *
 * The file ends are the web fs api (`web-fs.ts`), not node's: a real folder on
 * disk via the File System Access API, or the OPFS `Projects/` folder on an
 * iPad. Both write bytes, which is what a `.mpy` needs — routing it through the
 * TEXT `writeFile` would UTF-8 mangle every byte above 0x7F (#959).
 */
import buildMeta from '../../../../resources/mpy-cross/BUILD.json'
import {
  baseNameOf,
  compileErrorMessage,
  isCompilable,
  mpyPathFor,
  type CompileOutput,
  type CompileResult
} from '../../../shared/mpy-compile'
import type { MpyWorkerReply, MpyWorkerRequest } from './mpy.worker'

/** The slice of the web fs api a compile needs: text in, bytes out. */
export interface WebMpyFs {
  readFile(path: string): Promise<string>
  writeFileBytes(path: string, bytes: Uint8Array): Promise<void>
}

/**
 * A compile worker, spawned on first use and then kept.
 *
 * Kept because the cost of a worker is its boot and its `.wasm` fetch, and
 * neither is worth paying per compile; the Emscripten INSTANCE inside it is
 * still one-per-compile (it exits when mpy-cross returns). Spawned lazily
 * because most sessions never compile anything, and an idle worker holding a
 * 334 KB binary is not what a Chromebook wants for nothing.
 */
class CompileWorker {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (v: CompileOutput) => void; reject: (e: Error) => void }
  >()

  private spawn(): Worker {
    const worker = new Worker(new URL('./mpy.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<MpyWorkerReply>): void => {
      const msg = e.data
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if ('error' in msg) p.reject(new Error(msg.error))
      else p.resolve(msg)
    }
    // A worker that never loads (asset missing, CSP, an offline cache miss)
    // otherwise leaves the caller's promise hanging forever — the same failure
    // #500 was, in the sim. Fail the in-flight work and drop the worker so the
    // next compile gets a fresh one.
    worker.onerror = (e: ErrorEvent): void => {
      const err = new Error(e.message || 'the MicroPython compiler failed to load')
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      if (this.worker === worker) this.worker = null
      worker.terminate()
    }
    return worker
  }

  compile(name: string, source: string): Promise<CompileOutput> {
    this.worker ??= this.spawn()
    const id = this.nextId++
    const req: MpyWorkerRequest = { id, name, source }
    return new Promise<CompileOutput>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker?.postMessage(req)
    })
  }
}

/**
 * The `window.api.mpy` namespace for the browser.
 *
 * `fs` is the web filesystem backend the file tree is already reading — the
 * `.mpy` has to land in the SAME folder the user is looking at, and on the web
 * that folder is a directory handle, not a path.
 */
export function createWebMpyApi(fs: WebMpyFs): Record<string, unknown> {
  const worker = new CompileWorker()

  return {
    /**
     * Yes — the compiler is bundled with this build.
     *
     * The desktop checks that the artifact was actually shipped, because there
     * it is a file read by path at runtime. Here it is an IMPORT: if it were
     * missing the bundle would not have built, so the honest answer is a
     * constant. `micropython` comes from the same `BUILD.json` the desktop
     * reads, so both platforms name the release they were built from.
     */
    available: async (): Promise<{ available: boolean; micropython: string | null }> => ({
      available: true,
      micropython: typeof buildMeta.micropython === 'string' ? buildMeta.micropython : null
    }),

    /**
     * Compile `path`, writing the `.mpy` beside it.
     *
     * Failures come back as a message rather than a throw, because every one of
     * them is something to show the user: a syntax error in their file, a file
     * that is not Python, or a folder we could not write to.
     */
    compile: async (path: string): Promise<CompileResult> => {
      if (!isCompilable(path)) return { ok: false, error: 'Only .py files can be compiled.' }
      let source: string
      try {
        source = await fs.readFile(path)
      } catch (err) {
        return { ok: false, error: `Couldn’t read ${baseNameOf(path)}: ${(err as Error).message}` }
      }

      let result: CompileOutput
      try {
        // A BARE filename: the compiler's in-memory filesystem starts empty, so
        // `sub/foo.py` fails on the missing directory rather than compiling.
        result = await worker.compile(baseNameOf(path), source)
      } catch (err) {
        return { ok: false, error: `Couldn’t run the compiler — ${(err as Error).message}.` }
      }
      if (result.status !== 0 || !result.mpy) {
        return { ok: false, error: compileErrorMessage(result) }
      }

      const out = mpyPathFor(path)
      try {
        await fs.writeFileBytes(out, result.mpy)
      } catch (err) {
        return { ok: false, error: `Couldn’t write ${baseNameOf(out)}: ${(err as Error).message}` }
      }
      return { ok: true, path: out, bytes: result.mpy.length }
    }
  }
}
