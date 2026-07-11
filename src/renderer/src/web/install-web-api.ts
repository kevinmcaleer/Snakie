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

export function installWebApi(): void {
  const w = window as typeof window & { api?: Record<string, unknown> }
  if (!w.api) return // the fallback runs first and sets this; guard defensively
  w.api.device = createWebDeviceApi() as unknown as Window['api']['device']
  // eslint-disable-next-line no-console
  console.info(
    '[Snakie] Web simulated device ready — pick "Simulated device (offline)" and Connect to run Python.'
  )
}
