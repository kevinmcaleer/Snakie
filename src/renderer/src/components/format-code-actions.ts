/**
 * Quick-fix (lightbulb) support for the JSON/YAML format validator (issue #93).
 *
 * The format validator ({@link validateFormat}) produces {@link Diagnostic}s
 * that may carry a whole-file `fix` (re-formatted / cleaned content). This
 * module registers a Monaco `CodeActionProvider` for the `yaml` language that
 * turns those fixes into `quickfix` `CodeAction`s. (`.json` files open as
 * `plaintext` — see MonacoEditor.languageForName — so JSON's autofix is surfaced
 * via the Problems-panel "Fix / Format" button instead; YAML files get both.)
 *
 * Mirrors plugin-code-actions.ts: a per-URI store of diagnostics-with-fixes, a
 * single idempotent registration guarded against HMR double-registration, and a
 * `WorkspaceEdit` that replaces the model's full range with the fixed text.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { Diagnostic } from '../../../preload/index.d'

/** Diagnostics (with fixes) for a single model, keyed by `model.uri.toString()`. */
const formatDiagnosticsByUri = new Map<string, Diagnostic[]>()

/** Record the current format diagnostics for a model so fixes can be offered. */
export function setFormatDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
  const withFixes = diagnostics.filter((d) => d.fixes && d.fixes.length > 0)
  if (withFixes.length > 0) formatDiagnosticsByUri.set(uri, withFixes)
  else formatDiagnosticsByUri.delete(uri)
}

/** Forget a model's format diagnostics (e.g. when its file is closed). */
export function clearFormatDiagnostics(uri: string): void {
  formatDiagnosticsByUri.delete(uri)
}

/** Marker key making double-registration idempotent across HMR. */
const REGISTERED_KEY = '__snakieFormatCodeActionsRegistered'

type GuardedGlobal = typeof globalThis & { [REGISTERED_KEY]?: boolean }

/**
 * Register the format quick-fix provider for `yaml`. Idempotent: the first call
 * wins, later calls (e.g. HMR re-eval) are no-ops. The fix replaces the model's
 * entire range with the re-formatted text (whole-file edits).
 */
export function registerFormatCodeActions(monaco: typeof Monaco): Monaco.IDisposable | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const disposable = monaco.languages.registerCodeActionProvider('yaml', {
    provideCodeActions(model) {
      const diags = formatDiagnosticsByUri.get(model.uri.toString())
      if (!diags || diags.length === 0) return { actions: [], dispose: () => {} }

      const fullRange = model.getFullModelRange()
      const actions: Monaco.languages.CodeAction[] = []
      for (const diag of diags) {
        for (const fix of diag.fixes ?? []) {
          actions.push({
            title: fix.title,
            kind: 'quickfix',
            edit: {
              edits: [
                {
                  resource: model.uri,
                  textEdit: { range: fullRange, text: fix.edit.newText },
                  versionId: model.getVersionId()
                } as Monaco.languages.IWorkspaceTextEdit
              ]
            },
            isPreferred: true
          })
        }
      }
      return { actions, dispose: () => {} }
    }
  })

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposable.dispose()
      formatDiagnosticsByUri.clear()
      g[REGISTERED_KEY] = false
    })
  }

  return disposable
}
