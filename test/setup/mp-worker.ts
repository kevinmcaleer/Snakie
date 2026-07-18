import { resolve } from 'path'

/**
 * The MicroPython sim runs its interpreter in a worker_threads worker (so a
 * `while True:` can't freeze the process). worker_threads can't load a `.ts`
 * file and tests have no built `out/main`, so the vitest globalSetup compiles
 * the worker to this repo-root temp `.mjs` (where `@micropython` + the `.wasm`
 * resolve), and the per-file setup points the runtime at it via env.
 */
export const TEST_WORKER_PATH = resolve(process.cwd(), '.mp-node-worker.built.mjs')
export const WORKER_ENTRY = resolve(process.cwd(), 'src/main/device/mp-node-worker.ts')
