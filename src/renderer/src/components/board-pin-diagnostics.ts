/**
 * Monaco glue for the board-aware bus pin check ({@link ./board-pin-check}).
 *
 * `applyBoardPinDiagnostics` turns {@link BusDiagnostic}s into editor squiggles
 * (its own marker owner, kept separate from plugin/format markers) and records
 * the ones carrying a fix per model URI. `registerBoardPinCodeActions` installs a
 * single `python` `CodeActionProvider` (idempotent, HMR-guarded — same shape as
 * `plugin-code-actions.ts`) that offers those fixes as `quickfix` code actions.
 */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type { BusDiagnostic } from './board-pin-check'

/** Our marker owner — separate from `snakie-plugins` / `snakie-format`. */
const MARKER_OWNER = 'snakie-board-pins'

/** Diagnostics WITH fixes, per model URI, for the code-action provider. */
const fixesByUri = new Map<string, BusDiagnostic[]>()

/** Push the current bus-check diagnostics onto a model as markers + record fixes. */
export function applyBoardPinDiagnostics(monaco: typeof Monaco, model: Monaco.editor.ITextModel, diags: BusDiagnostic[]): void {
  const markers: Monaco.editor.IMarkerData[] = diags.map((d) => ({
    severity: d.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
    message: d.message,
    startLineNumber: d.line,
    startColumn: d.startCol,
    endLineNumber: d.line,
    endColumn: d.endCol,
    source: 'board pins'
  }))
  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers)

  const uri = model.uri.toString()
  const withFixes = diags.filter((d) => d.fix)
  if (withFixes.length > 0) fixesByUri.set(uri, withFixes)
  else fixesByUri.delete(uri)
}

/** Clear the bus-check markers + recorded fixes for a model (e.g. non-python). */
export function clearBoardPinDiagnostics(monaco: typeof Monaco, model: Monaco.editor.ITextModel): void {
  monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
  fixesByUri.delete(model.uri.toString())
}

const REGISTERED_KEY = '__snakieBoardPinCodeActionsRegistered'
type GuardedGlobal = typeof globalThis & { [REGISTERED_KEY]?: boolean }

/** Register the bus-check quick-fix provider for `python`. Idempotent across HMR. */
export function registerBoardPinCodeActions(monaco: typeof Monaco): Monaco.IDisposable | undefined {
  const g = globalThis as GuardedGlobal
  if (g[REGISTERED_KEY]) return undefined
  g[REGISTERED_KEY] = true

  const disposable = monaco.languages.registerCodeActionProvider('python', {
    provideCodeActions(model, range) {
      const diags = fixesByUri.get(model.uri.toString())
      if (!diags || diags.length === 0) return { actions: [], dispose: () => {} }
      const actions: Monaco.languages.CodeAction[] = []
      for (const d of diags) {
        const fix = d.fix
        if (!fix) continue
        // Offer the fix when the cursor/selection overlaps the diagnostic's line.
        if (d.line < range.startLineNumber || d.line > range.endLineNumber) continue
        actions.push({
          title: fix.title,
          kind: 'quickfix',
          diagnostics: [
            {
              severity: monaco.MarkerSeverity.Error,
              message: d.message,
              startLineNumber: d.line,
              startColumn: d.startCol,
              endLineNumber: d.line,
              endColumn: d.endCol
            }
          ],
          edit: {
            edits: [
              {
                resource: model.uri,
                textEdit: {
                  range: {
                    startLineNumber: fix.line,
                    startColumn: fix.startCol,
                    endLineNumber: fix.line,
                    endColumn: fix.endCol
                  },
                  text: fix.text
                },
                versionId: model.getVersionId()
              } as Monaco.languages.IWorkspaceTextEdit
            ]
          },
          isPreferred: true
        })
      }
      return { actions, dispose: () => {} }
    }
  })

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposable.dispose()
      fixesByUri.clear()
      g[REGISTERED_KEY] = false
    })
  }
  return disposable
}
