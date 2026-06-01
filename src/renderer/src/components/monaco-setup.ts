/**
 * Wire Monaco's web workers to the LOCALLY BUNDLED copy of `monaco-editor`.
 *
 * Snakie ships under a strict CSP (`script-src 'self'`) inside Electron, so
 * Monaco must NOT pull anything from a CDN. Vite's `?worker` imports emit the
 * worker as a same-origin chunk under `assets/`, which `'self'` permits — the
 * worker is constructed from an app-served URL, not a blob or remote script.
 *
 * Python/Markdown are basic (synchronous) languages and need no language-
 * specific worker; the base `editor.worker` is enough to drive the editor
 * (tokenisation is built-in). We deliberately do NOT ship the JSON language
 * service (its worker + mode add ~900 kB) — this is a MicroPython editor, so
 * `.json` files just open as plaintext.
 *
 * This module sets `self.MonacoEnvironment` exactly once, the first time it is
 * imported, before any editor is instantiated.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { registerMicropythonCompletions } from './micropython-completions'

self.MonacoEnvironment = {
  getWorker(): Worker {
    // Only the base editor worker is needed; no language services are bundled.
    return new EditorWorker()
  }
}

// Register MicroPython-aware autocomplete for the `python` language. This is
// idempotent (guarded against HMR double-registration inside the function), so
// it is safe even though this module may be re-evaluated by Vite.
registerMicropythonCompletions(monaco)
