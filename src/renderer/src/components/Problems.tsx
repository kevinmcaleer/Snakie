import { useDiagnostics } from '../store/diagnostics'
import { useWorkspace } from '../store/workspace'
import type { Diagnostic } from '../../../preload/index.d'

/**
 * Problems panel (issue #65) — lists the active file's diagnostics produced by
 * the reactive linter, mirroring the editor squiggles. Reads the shared
 * {@link useDiagnostics} store the editor publishes to; clicking a row jumps the
 * editor to that line via {@link useWorkspace}.revealLine.
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
  const { revealLine } = useWorkspace()

  if (diagnostics.length === 0) {
    return (
      <div className="problems problems--empty">
        <p className="problems__empty-text">No problems</p>
        {linterTool === 'none' && (
          <p className="problems__hint">
            Install <code>ruff</code> (<code>pip install ruff</code>) for Python linting.
          </p>
        )}
      </div>
    )
  }

  return (
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
  )
}
