/**
 * Wire Monaco's web workers to the LOCALLY BUNDLED copy of `monaco-editor`.
 *
 * Snakie ships under a strict CSP (`script-src 'self'`) inside Electron, so
 * Monaco must NOT pull anything from a CDN. Vite's `?worker` imports emit the
 * worker as a same-origin chunk under `assets/`, which `'self'` permits — the
 * worker is constructed from an app-served URL, not a blob or remote script.
 *
 * Python needs no language-specific worker; the base `editor.worker` is enough
 * to drive the editor (tokenisation for `python` is synchronous/built-in).
 *
 * This module sets `self.MonacoEnvironment` exactly once, the first time it is
 * imported, before any editor is instantiated.
 */
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // Python/Markdown are basic (synchronous) languages and need no dedicated
    // worker — the base editor worker covers them. JSON ships a language worker
    // for validation/formatting.
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  }
}
