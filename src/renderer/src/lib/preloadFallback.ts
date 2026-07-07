/**
 * Preload-bridge fallback.
 *
 * In Electron, `window.api` / `window.electron` are injected by the preload
 * script. Outside Electron — a plain browser, or if the preload ever fails to
 * load — they are `undefined`, and any component that touches them on mount
 * (e.g. the Toolbar via `useDeviceStatus`) would throw and crash the whole
 * renderer to a blank screen.
 *
 * This installs the {@link createInertApi} no-op fallback so the UI still
 * renders and degrades gracefully. It is imported for its side effect from
 * `main.tsx` BEFORE React renders. In real Electron the bridge is already
 * present, so this is a safety net only (and logs a warning if used). The web
 * build (`web-main.tsx`, epic #267 Phase W1) installs `createWebApi()`
 * instead, which layers real implementations over the same inert base.
 */
import { createInertApi } from './inertApi'

const noop = (): void => {}

// Read through a widened type so TS doesn't treat the (declared non-optional)
// globals as always-present — outside Electron they genuinely are not.
const w = window as typeof window & {
  api?: Window['api']
  electron?: Window['electron']
}

if (!w.api) {
  // Inside Electron a missing bridge means the preload FAILED to load (a real
  // bug) — log loudly so it isn't silently masked. In a plain browser it's
  // expected (no preload), so a warning suffices. Either way we install the
  // no-op stub to keep the UI from blank-screening.
  const inElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent)
  const log = inElectron ? console.error : console.warn
  log(
    `[Snakie] window.api is missing — installing a no-op fallback. Device, file, ` +
      `firmware, LLM, package, Git, plugin and robot features are inert. ` +
      (inElectron
        ? 'Running in Electron, so the PRELOAD FAILED TO LOAD — check the preload path / sandbox setting.'
        : 'Not running inside Electron (e.g. a browser preview).')
  )

  w.api = createInertApi()
  w.electron = {
    process: { versions: {} },
    ipcRenderer: {
      on: () => noop,
      once: noop,
      send: noop,
      invoke: (): Promise<undefined> => Promise.resolve(undefined),
      removeListener: noop,
      removeAllListeners: noop
    }
  } as unknown as Window['electron']
}
