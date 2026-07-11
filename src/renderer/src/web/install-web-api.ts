/**
 * Install the WEB backends over the preload fallback (epic #267, Phase W1).
 * =============================================================================
 *
 * `main.tsx` imports the preload FALLBACK first, which installs a full no-op
 * `window.api` stub so the UI renders in the browser. This then swaps the
 * `device` namespace for the REAL WASM simulator ({@link createWebDeviceApi}), so
 * the shell can connect to the "Simulated device (offline)" port and actually run
 * Python. The other namespaces keep the safe fallback until later web phases.
 *
 * Loaded only in the web build (guarded by `import.meta.env.VITE_SNAKIE_WEB` in
 * `main.tsx`, via a dynamic import), so the Electron bundle never pulls in the
 * MicroPython WASM.
 */
import { createWebDeviceApi } from './web-device'
import { createWebFsApi } from './web-fs'
import { INSTRUMENTS_PY, SNAKIE_PY } from './web-lib-sources'

export function installWebApi(): void {
  const w = window as typeof window & { api?: Record<string, unknown> }
  if (!w.api) return // the fallback runs first and sets this; guard defensively
  w.api.device = createWebDeviceApi() as unknown as Window['api']['device']
  // Serve the bundled MicroPython library sources so the "Install library" banner
  // + its version check work on the web (the fallback returns '' → the install
  // failed with "library source unavailable"). The sim also auto-seeds these into
  // its VFS on connect (see the worker), so imports work without an install step.
  const instruments = (w.api.instruments ?? {}) as Record<string, unknown>
  instruments.librarySource = async (): Promise<string> => INSTRUMENTS_PY
  instruments.umbrellaSource = async (): Promise<string> => SNAKIE_PY
  w.api.instruments = instruments as unknown as Window['api']['instruments']
  // Local files via the File System Access API — only when the browser supports it
  // (Chromium); elsewhere the no-op fallback stays and "Open Folder" is inert.
  if ('showDirectoryPicker' in window) {
    w.api.fs = createWebFsApi() as unknown as Window['api']['fs']
  }
  // eslint-disable-next-line no-console
  console.info(
    '[Snakie] Web backend ready — Connect the "Simulated device (offline)" to run Python; ' +
      'Open Folder to edit local files.'
  )
}
