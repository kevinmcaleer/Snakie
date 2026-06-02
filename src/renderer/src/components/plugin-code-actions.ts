/**
 * Quick-fix (lightbulb) support for Snakie plugin diagnostics.
 *
 * The reactive linter (see `useReactiveLint`) sets Monaco markers AND records,
 * per model URI, the diagnostics that carry fixes. This module registers a
 * SINGLE Monaco `CodeActionProvider` for `python` (guarded against double-
 * registration the same way the completion provider is) which turns those
 * recorded fixes into `quickfix` `CodeAction`s with a `WorkspaceEdit` applying
 * the fix's resolved range/newText to the model.
 *
 * Applying a fix mutates the model, which fires `onDidChangeModelContent` ->
 * `updateContent` (already wired in MonacoEditor), so the buffer + dirty state
 * stay in sync and a re-lint is triggered automatically.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { Diagnostic } from '../../../preload/index.d'
import { diagnosticRange, resolveFixRange, type ModelLike } from './plugin-diagnostics'

/** Diagnostics (with fixes) for a single model, keyed by `model.uri.toString()`. */
const diagnosticsByUri = new Map<string, Diagnostic[]>()

/** Record the current diagnostics for a model so the provider can offer fixes. */
export function setModelDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
  const withFixes = diagnostics.filter((d) => d.fixes && d.fixes.length > 0)
  if (withFixes.length > 0) diagnosticsByUri.set(uri, withFixes)
  else diagnosticsByUri.delete(uri)
}

/** Forget a model's diagnostics (e.g. when its file is closed). */
export function clearModelDiagnostics(uri: string): void {
  diagnosticsByUri.delete(uri)
}

/** Marker key making double-registration idempotent across HMR. */
const REGISTERED_KEY = '__snakiePluginCodeActionsRegistered'

type GuardedGlobal = typeof globalThis & { [REGISTERED_KEY]?: boolean }

/** Does a diagnostic's range intersect the requested range? (cheap overlap.) */
function diagnosticInRange(model: ModelLike, diag: Diagnostic, range: Monaco.IRange): boolean {
  const r = diagnosticRange(model, diag)
  if (r.endLineNumber < range.startLineNumber || r.startLineNumber > range.endLineNumber) {
    return false
  }
  return true
}

/**
 * Register the plugin quick-fix provider for `python`. Idempotent: the first
 * call wins, later calls (e.g. HMR re-eval) are no-ops. Returns the disposable
 * on first registration, otherwise `undefined`.
 */
export function registerPluginCodeActions(
  monaco: typeof Monaco
): Monaco.IDisposable | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const disposable = monaco.languages.registerCodeActionProvider('python', {
    provideCodeActions(model, range) {
      const diags = diagnosticsByUri.get(model.uri.toString())
      if (!diags || diags.length === 0) return { actions: [], dispose: () => {} }

      const modelLike = model as unknown as ModelLike
      const actions: Monaco.languages.CodeAction[] = []

      for (const diag of diags) {
        if (!diagnosticInRange(modelLike, diag, range)) continue
        for (const fix of diag.fixes ?? []) {
          const fixRange = resolveFixRange(modelLike, diag, fix)
          actions.push({
            title: fix.title,
            kind: 'quickfix',
            edit: {
              edits: [
                {
                  resource: model.uri,
                  // Monaco's WorkspaceEdit text-edit shape.
                  textEdit: {
                    range: {
                      startLineNumber: fixRange.startLineNumber,
                      startColumn: fixRange.startColumn,
                      endLineNumber: fixRange.endLineNumber,
                      endColumn: fixRange.endColumn
                    },
                    text: fix.edit.newText
                  },
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
      diagnosticsByUri.clear()
      g[REGISTERED_KEY] = false
    })
  }

  return disposable
}
