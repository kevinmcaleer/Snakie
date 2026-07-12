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
import { createWebDeviceRouter } from './web-device-router'
import { createWebFsApi } from './web-fs'
import { createWebRobotApi, type WebRobotFs } from './web-robot'
import { createWebPartsApi } from './web-parts'
import { INSTRUMENTS_PY, SNAKIE_PY } from './web-lib-sources'
import { VIRTUAL_PORT_PATH } from '../../../shared/virtual-device'

export function installWebApi(): void {
  const w = window as typeof window & { api?: Record<string, unknown> }
  if (!w.api) return // the fallback runs first and sets this; guard defensively
  // Report the real app version (injected from package.json by vite.web.config) so
  // the status bar shows it — the fallback returns '' (no Electron `app.getVersion`).
  const version = (import.meta.env as unknown as { VITE_SNAKIE_VERSION?: string }).VITE_SNAKIE_VERSION ?? ''
  w.api.appVersion = (async () => version) as unknown as Window['api']['appVersion']
  // External links (docs.snakie.org, etc.) open in a new browser tab — the Electron
  // `shell.openExternal` has no web equivalent, so the fallback was a silent no-op.
  w.api.openExternal = (async (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }) as unknown as Window['api']['openExternal']
  // The device namespace multiplexes the WASM simulator + real Web Serial boards.
  w.api.device = createWebDeviceRouter() as unknown as Window['api']['device']
  // Serve the bundled MicroPython library sources so the "Install library" banner
  // + its version check work on the web (the fallback returns '' → the install
  // failed with "library source unavailable"). The sim also auto-seeds these into
  // its VFS on connect (see the worker), so imports work without an install step.
  const instruments = (w.api.instruments ?? {}) as Record<string, unknown>
  instruments.librarySource = async (): Promise<string> => INSTRUMENTS_PY
  instruments.umbrellaSource = async (): Promise<string> => SNAKIE_PY
  w.api.instruments = instruments as unknown as Window['api']['instruments']
  // Serve the bundled Standard Parts library (read-only) so the board view can
  // resolve a placed part's shapes/pins — otherwise a wired servo shows only its
  // title (#475). Authoring/registry writes keep the honest fallback stub.
  const parts = (w.api.parts ?? {}) as Record<string, unknown>
  Object.assign(parts, createWebPartsApi())
  w.api.parts = parts as unknown as Window['api']['parts']
  // Local files via the File System Access API — only when the browser supports it
  // (Chromium); elsewhere the no-op fallback stays and "Open Folder" is inert.
  // The robot.yml layer rides on the same backend (bindings/poses/urdf link), so
  // it's gated with it — on other browsers the honest fallback stub remains.
  if ('showDirectoryPicker' in window) {
    const fs = createWebFsApi()
    w.api.fs = fs as unknown as Window['api']['fs']
    w.api.robot = createWebRobotApi(fs as unknown as WebRobotFs) as unknown as Window['api']['robot']
  }
  // eslint-disable-next-line no-console
  console.info(
    '[Snakie] Web backend ready — Connect the "Simulated device (offline)" to run Python; ' +
      'Open Folder to edit local files.'
  )
}

/**
 * Auto-connect to the simulated device shortly after first render (#267). On the
 * web the sim is the ONLY port, and the Connect control lives in the shell-panel
 * header where first-time users don't find it — they type a program and see a
 * greyed-out Run button ("I'm not able to run a program"). Connecting for them
 * makes Run work out of the box. The delay lets the shell terminal mount its
 * data subscription first so the MicroPython banner lands on screen; the status
 * check keeps us from double-connecting if the user beat us to the button.
 */
export function autoConnectSimulator(delayMs = 400): void {
  window.setTimeout(() => {
    void (async () => {
      try {
        const device = window.api.device
        const status = await device.getStatus()
        if (status.state === 'disconnected') await device.connect(VIRTUAL_PORT_PATH)
      } catch {
        // Auto-connect is best-effort — the manual Connect button still works.
      }
    })()
  }, delayMs)
}
