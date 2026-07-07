/**
 * Installs `createWebApi()` as `window.api`/`window.electron` for the web
 * build (epic #267 Phase W1) — imported for its side effect from
 * `web-main.tsx` BEFORE anything renders, mirroring how Electron's preload
 * injects the bridge ahead of `main.tsx` (see `preloadFallback.ts`).
 */
import { createWebApi } from './webApi'

const noop = (): void => {}

const w = window as typeof window & { api?: Window['api']; electron?: Window['electron'] }
w.api = createWebApi()
// Nothing reads `window.electron` directly today (only `window.api`), but the
// type exists — stub it the same inert way `preloadFallback.ts` does so any
// future direct read degrades instead of throwing.
w.electron = {
  process: { versions: {} },
  ipcRenderer: {
    on: () => noop,
    once: noop,
    send: noop,
    invoke: () => Promise.resolve(undefined),
    removeListener: noop,
    removeAllListeners: noop
  }
} as unknown as Window['electron']
