/**
 * mpy-cross COMPILE WORKER — `.py` → `.mpy` in the browser (#970).
 * =============================================================================
 *
 * The same compiler the desktop app runs (`resources/mpy-cross`, built by
 * `scripts/build-mpy-cross.sh`), loaded here from the BROWSER artifact: an ES
 * module Vite can bundle, with Emscripten's node branches linked out. The
 * `.wasm` is a static asset of the web bundle, fetched once and handed in as
 * `wasmBinary`, so the module never has to locate it by path.
 *
 * OFF THE MAIN THREAD FROM THE START. A compile is short, but it is a
 * SYNCHRONOUS WASM run: mpy-cross parses, compiles and exits inside one call,
 * with no yield the browser could paint between. The sim learned this the
 * expensive way (see `mp.worker.ts`) — a big file, or a slow Chromebook, is a
 * frozen editor. Nothing here needs the DOM, so there is no reason to be on it.
 *
 * ONE INSTANCE PER COMPILE, deliberately: the module is linked `EXIT_RUNTIME=1`,
 * so it tears itself down when mpy-cross returns and cannot be run twice. The
 * WASM bytes are cached instead, which is the part worth keeping.
 */
import MpyCross from '../../../../resources/mpy-cross/mpy-cross.mjs'
import mpyWasmUrl from '../../../../resources/mpy-cross/mpy-cross.wasm?url'
import { compileWithFactory, type CompileOutput } from '../../../shared/mpy-compile'

/** Compile one source string, named as it should appear inside the `.mpy`. */
export interface MpyWorkerRequest {
  id: number
  /** A BARE filename — Emscripten's in-memory filesystem starts empty. */
  name: string
  source: string
}

/** The compile's outcome, or the reason it never ran (a missing/blocked asset). */
export type MpyWorkerReply = ({ id: number } & CompileOutput) | { id: number; error: string }

/** The compiler binary, fetched once per worker. `getBinarySync` copies it into
 *  each module instance, so the same bytes serve every compile. */
let bytes: Promise<Uint8Array> | null = null
const wasmBinary = (): Promise<Uint8Array> => {
  bytes ??= fetch(mpyWasmUrl)
    .then(async (r) => {
      if (!r.ok) throw new Error(`the compiler didn’t load (HTTP ${r.status})`)
      return new Uint8Array(await r.arrayBuffer())
    })
    .catch((err) => {
      // Don't cache a failure — offline on the first try, cached on the second
      // (the PWA precaches the `.wasm`), and a retry should get that.
      bytes = null
      throw err
    })
  return bytes
}

self.onmessage = async (e: MessageEvent<MpyWorkerRequest>): Promise<void> => {
  const { id, name, source } = e.data
  try {
    const out = await compileWithFactory(MpyCross, await wasmBinary(), name, source)
    const reply: MpyWorkerReply = { id, ...out }
    postMessage(reply)
  } catch (err) {
    postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies MpyWorkerReply)
  }
}
