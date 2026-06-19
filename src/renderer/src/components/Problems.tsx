import { useDiagnostics } from '../store/diagnostics'
import { useWorkspace } from '../store/workspace'
import type { Diagnostic } from '../../../preload/index.d'
import { autofixFormat, formatKindForName } from './format-validate'

/**
 * Problems panel (issue #65) — lists the active file's diagnostics produced by
 * the reactive linter, mirroring the editor squiggles. Reads the shared
 * {@link useDiagnostics} store the editor publishes to; clicking a row jumps the
 * editor to that line via {@link useWorkspace}.revealLine.
 *
 * For JSON/YAML files (issue #93) it also shows a "Fix / Format" button when a
 * safe autofix exists ({@link autofixFormat}); applying it writes the canonical
 * text back through {@link useWorkspace}.updateContent, which the editor syncs.
 *
 * Rendered as one of the Shell region's tabs (Console | Plotter | Problems).
 * The linting on/off toggle lives in the header (see {@link ProblemsHeader}).
 */

/** A small severity glyph + class for a diagnostic row. */
function severityGlyph(severity: string): { glyph: string; cls: string } {
  switch (severity) {
    case 'error':
      return { glyph: '✕', cls: 'problems__sev--error' }
    case 'info':
      return { glyph: 'ℹ', cls: 'problems__sev--info' }
    case 'hint':
      return { glyph: '✦', cls: 'problems__sev--hint' }
    case 'warning':
    default:
      return { glyph: '⚠', cls: 'problems__sev--warning' }
  }
}

export function Problems(): JSX.Element {
  const { diagnostics, linterTool } = useDiagnostics()
  const { revealLine, openFiles, activeId, updateContent } = useWorkspace()

  // Offer the JSON/YAML autofix when the active file is a format file with a
  // safe canonical form available (re-format when valid; cleanup when fixable).
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const fixedContent =
    activeFile && formatKindForName(activeFile.name)
      ? autofixFormat(activeFile.name, activeFile.content)
      : null
  const applyFix = (): void => {
    if (activeId && fixedContent != null) updateContent(activeId, fixedContent)
  }

  if (diagnostics.length === 0) {
    return (
      <div className="problems problems--empty">
        <p className="problems__empty-text">No problems</p>
        {linterTool === 'none' && (
          <p className="problems__hint">
            Install <code>ruff</code> (<code>pip install ruff</code>) for Python linting.
          </p>
        )}
        {fixedContent != null && (
          <button type="button" className="btn problems__fix" onClick={applyFix}>
            Format {formatKindForName(activeFile!.name) === 'json' ? 'JSON' : 'YAML'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="problems-wrap">
      {fixedContent != null && (
        <div className="problems__toolbar">
          <button type="button" className="btn problems__fix" onClick={applyFix}>
            Fix / Format {formatKindForName(activeFile!.name) === 'json' ? 'JSON' : 'YAML'}
          </button>
        </div>
      )}
      <ul className="problems" aria-label="Problems">
        {diagnostics.map((d: Diagnostic, i: number) => {
        const sev = severityGlyph(d.severity)
        return (
          <li key={`${d.line}:${d.column ?? 0}:${i}`} className="problems__item">
            <button
              type="button"
              className="problems__row"
              onClick={() => revealLine(d.line)}
              title={`Go to line ${d.line}`}
            >
              <span className={`problems__sev ${sev.cls}`} aria-hidden="true">
                {sev.glyph}
              </span>
              <span className="problems__loc">
                {d.line}:{d.column ?? 1}
              </span>
              <span className="problems__msg">{d.message}</span>
              <span className="problems__source">{d.source}</span>
            </button>
          </li>
          )
        })}
      </ul>
    </div>
  )
}
