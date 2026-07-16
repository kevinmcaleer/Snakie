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
import { createWebFsApi, opfsFallbackAvailable } from './web-fs'
import { createWebRobotApi, type WebRobotFs } from './web-robot'
import { createWebPartsApi } from './web-parts'
import { INSTRUMENTS_PY, SNAKIE_PY } from './web-lib-sources'
import { createWebFeedbackApi, captureTabScreenshot } from './web-feedback'
import { createWebModulesApi } from './web-modules'
import { VIRTUAL_PORT_PATH } from '../../../shared/virtual-device'

export function installWebApi(): void {
  const w = window as typeof window & { api?: Record<string, unknown> }
  if (!w.api) return // the fallback runs first and sets this; guard defensively
  // Report the real app version (injected from package.json by vite.web.config) so
  // the status bar shows it — the fallback returns '' (no Electron `app.getVersion`).
  const version = (import.meta.env as unknown as { VITE_SNAKIE_VERSION?: string }).VITE_SNAKIE_VERSION ?? ''
  w.api.appVersion = (async () => version) as unknown as Window['api']['appVersion']
  // Real bug reporting (#513): submissions post straight to the feedback API
  // (key baked in at build time; CSP allowlists the endpoint), and diagnostics
  // report the web build — no more "Snakie undefined · undefined undefined".
  const fb = createWebFeedbackApi(version)
  w.api.feedback = fb.feedback as unknown as Window['api']['feedback']
  w.api.diagnostics = fb.diagnostics as unknown as Window['api']['diagnostics']
  // The modules-changed broadcast is Electron IPC on desktop; on the web the
  // fallback stubs made it a silent no-op, so a driver/instruments install
  // never refreshed the Packages panel's ON BOARD list or the device tree.
  // Bridge it with a window event — same-window is all the web build needs.
  const MODULES_EVENT = 'snakie:modules-changed'
  const modules = (w.api.modules ?? {}) as Record<string, unknown>
  // Real driver/library installs (#513): catalog + probe + install over the web
  // device — the fallback stub made every Modules-panel install fail silently.
  Object.assign(modules, createWebModulesApi())
  modules.notifyChanged = (): void => {
    window.dispatchEvent(new CustomEvent(MODULES_EVENT))
  }
  modules.onChanged = (cb: () => void): (() => void) => {
    const h = (): void => cb()
    window.addEventListener(MODULES_EVENT, h)
    return () => window.removeEventListener(MODULES_EVENT, h)
  }
  w.api.modules = modules as unknown as Window['api']['modules']
  // Screenshots come from the Screen Capture API (browser tab picker) — the
  // Electron multi-window composite doesn't exist here.
  w.api.captureScreenshot = captureTabScreenshot as unknown as Window['api']['captureScreenshot']
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
  // Local files via the File System Access API (Chromium), or — where the picker
  // doesn't exist but OPFS does (iPadOS Safari, #525) — an origin-private
  // `Projects/` folder in browser storage, so Open Folder / New robot work there
  // too. The robot.yml layer rides on the same backend (bindings/poses/urdf
  // link), so it's gated with it — elsewhere the honest fallback stub remains.
  if ('showDirectoryPicker' in window || opfsFallbackAvailable()) {
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
