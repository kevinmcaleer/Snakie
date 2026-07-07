# Snakie for Web — build & architecture (epic #267, Phase W1: #282)

Snakie's Electron desktop app targets makers with a board on the desk. The
**web build** targets the classroom: a Chromebook (or any browser) with no
native app install and often no hardware at all. Phase **W1** ("zero-hardware
classroom MVP") ships a sim-only, fully offline-capable build: the same
editor/Board-View/instruments UI as the desktop app, driving a REAL
MicroPython interpreter compiled to WebAssembly — running in a Web Worker in
the browser tab, not in an Electron process.

Real hardware (Web Serial) is **Phase W2** — out of scope here.

## Running it

```bash
npm run dev:web     # Vite dev server (unminified, fast reload)
npm run build:web   # production build → out-web/
npm run preview:web # serve the out-web/ production build locally
```

These are a separate config/script pair (`vite.web.config.ts`) from the
Electron build (`electron.vite.config.ts` / `npm run dev|build|dist`) — neither
affects the other.

## Architecture: one renderer, two backends

The entire renderer (`src/renderer/src/App.tsx` down) is Electron-agnostic: it
only ever talks to `window.api`, an object shaped by the `Api` type
(`src/preload/index.ts`). On desktop, Electron's preload script installs the
real bridge. On web, `src/renderer/src/web-main.tsx` installs a different
`window.api` implementation (`createWebApi()`) **before** rendering the exact
same `<App/>` — no UI fork, no feature-detection branches in components.

```
Browser tab (web-main.tsx, web.html)
  └─ App.tsx                                    (UNCHANGED — same as Electron)
       └─ window.api = createWebApi()
            ├─ device   → WorkerDeviceClient  ⇄ (postMessage RPC) ⇄  micropython.worker.ts
            │                                                        └─ WebSimulatedDevice
            │                                                             └─ WebMicroPythonRuntime
            │                                                                  (loadMicroPython, WASM fetched by URL)
            ├─ fs       → OPFS / File System Access project layer
            ├─ robot    → robot.yml persistence on the same project root
            └─ everything else (git/llm/firmware/packages/modules/updates/
               board-window/instrument-windows/find/console-window/parts/
               plugins/feedback) → an inert stub, explicit "not available on
               web" degrade (see Known limitations below).
```

### `createInertApi()` — the crash-proof base (`src/renderer/src/lib/inertApi.ts`)

Every `Api` namespace answers with a safe empty/disconnected default instead of
throwing. It's used two ways:

- `preloadFallback.ts` installs it verbatim as a crash-guard for the Electron
  renderer itself, when the preload bridge is missing (e.g. a broken preload
  load, or `index.html` opened directly).
- The web build's `createWebApi()` layers **real** `device`/`fs`/`robot` on top
  of it.

It's typed directly against `Api` (`const api: Api = {...}`, no unsafe cast) —
deliberately, so a missing or mismatched member is a **compile error** here
instead of a runtime crash the first time some UI component calls it.

### The MicroPython Web Worker

`src/renderer/src/web/device/micropython.worker.ts` is a real ES module Worker
(`new Worker(url, { type: 'module' })`) that boots
`WebSimulatedDevice`+`WebMicroPythonRuntime` — a browser-native port of the
Electron main-process `SimulatedDevice`/`MicroPythonRuntime` (issue #135),
sharing the same telemetry/probe simulation (`src/main/device/simulation.ts`)
and Python FS snippets. The `@micropython/micropython-webassembly-pyscript`
package's `micropython.mjs` glue code auto-detects
`ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope` and fetches the
`.wasm` file by URL — so it runs unmodified, fed a Vite-resolved
`?url` asset URL.

`src/renderer/src/web/device/WorkerDeviceClient.ts` (main thread) implements
the exact `device` `Api` surface over `postMessage` RPC
(`src/shared/device/workerProtocol.ts`), so `ConnectionControl`'s port
dropdown, REPL console, Run/Stop, file tree, and instrument telemetry all work
identically to the desktop simulated device. `listPorts()` advertises the same
`snakie://virtual` "Simulated device (offline)" entry the Electron build
injects for its offline mode — pick it and hit **Connect**.

### OPFS + File System Access project layer

`src/renderer/src/web/fs/` implements the `fs` and `robot` `Api` surfaces:

- **Default (zero-permission-prompt):** an Origin Private File System (OPFS)
  directory (`navigator.storage.getDirectory()`) — works instantly on any
  browser, including locked-down/managed Chromebooks, and survives reloads
  natively. This is what a student gets with zero clicks.
- **"Open Folder" → `showDirectoryPicker()`:** when the browser supports the
  File System Access API, this lets a student point Snakie at a real folder on
  disk (or a synced Drive folder). The picked handle is persisted in
  IndexedDB so it's restored (with a permission re-check) across reloads.
  Falls back silently to OPFS on unsupported browsers or if the user cancels.
- `robot.yml` always lives at the root of whichever project is active — unlike
  desktop, there's no separate "no folder open" app-data fallback location,
  since the web build always has exactly one active project root.

**Known limitation:** `saveFileDialog()`'s `showSaveFilePicker()` handles (for
saving to an arbitrary external location) are tracked in memory only — they
are **not** persisted across a reload, unlike the OPFS/picked-project-folder
path. Re-open the file (or re-pick the folder) after a reload to keep saving
to the same external file.

### PWA (installable, offline-capable)

`src/renderer/public-web/` (Vite's `publicDir` for the web build) holds a
hand-rolled `manifest.webmanifest` + `service-worker.js` — no
`vite-plugin-pwa` dependency. The service worker (registered from
`web-main.tsx`) caches Vite's content-hashed `/assets/*` cache-first (safe
forever — a new build gets new hashes) and everything else
stale-while-revalidate, so a returning visit works fully offline and a
redeploy is picked up on the next visit. Install icons are generated from the
existing `build/icon.png` (192/512/maskable-512 — the maskable icon has extra
padding so it survives OS icon-shape masking).

## Known limitations (Phase W1, by design)

These namespaces intentionally degrade to an explicit "not available on web"
message rather than working (each is either genuinely desktop-only, or planned
for a later phase):

| Namespace | Why | Phase |
|---|---|---|
| Real hardware (Web Serial) | Not yet wired | W2 |
| Git (`git.*`) | No filesystem git binary in the browser | — |
| Python plugin system (`plugins.*`) | Spawns a local Python process | — |
| Firmware flashing (`firmware.*`) | Needs esptool / raw USB access | — |
| LLM chat (`llm.*`) | No key storage / provider wiring on web yet | — |
| Detached Board View / instrument OS windows | No multi-window model in a browser tab | — |
| MIP/PyPI package installs (`packages.*`, `modules.install`) | Needs a real device's filesystem | — |
