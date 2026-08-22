import { useMemo, useState } from 'react'
import { useDiagnostics } from '../store/diagnostics'
import { useWorkspace } from '../store/workspace'
import type { Diagnostic } from '../../../preload/index.d'
import { autofixFormat, formatKindForName } from './format-validate'
import { diagnosticSources, mergeDiagnostics } from './refactor-hints'
import { dispatchOpenHelp } from './editorBridge'

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
 * Since epic #634 it also carries the refactoring engine's whole-file hints.
 * Every producer normalises to one `Diagnostic` shape and is namespaced by
 * `source` (§5), so a filter chip per source lets a learner hide the blue
 * refactoring hints without losing ruff's errors — the answer to the epic's own
 * §9 worry that a file full of hints would be demoralising. Refactoring rows
 * carry a **Why?** link into the mini help, which is where the teaching payload
 * of the whole epic actually lands.
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
  const { diagnostics, refactorHints, linterTool } = useDiagnostics()
  const { revealLine, openFiles, activeId, updateContent } = useWorkspace()
  /** Sources the user has hidden. Empty means "show everything". */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  const all = useMemo(
    () => mergeDiagnostics(diagnostics, refactorHints),
    [diagnostics, refactorHints]
  )
  const sources = useMemo(() => diagnosticSources(all), [all])
  const shown = useMemo(() => all.filter((d) => !hidden.has(d.source)), [all, hidden])

  const toggleSource = (source: string): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

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

  if (all.length === 0) {
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
      {(fixedContent != null || sources.length > 1) && (
        <div className="problems__toolbar">
          {sources.length > 1 && (
            <div className="problems__filters" role="group" aria-label="Filter problems by source">
              {sources.map((source) => {
                const count = all.filter((d) => d.source === source).length
                const on = !hidden.has(source)
                return (
                  <button
                    key={source}
                    type="button"
                    className={`problems__chip${on ? ' problems__chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleSource(source)}
                    title={`${on ? 'Hide' : 'Show'} ${source} problems`}
                  >
                    {source} <span className="problems__chip-count">{count}</span>
                  </button>
                )
              })}
            </div>
          )}
          {fixedContent != null && (
            <button type="button" className="btn problems__fix" onClick={applyFix}>
              Fix / Format {formatKindForName(activeFile!.name) === 'json' ? 'JSON' : 'YAML'}
            </button>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="problems__hint problems__hint--filtered">
          Every problem is hidden by the filters above.
        </p>
      ) : (
        <ul className="problems" aria-label="Problems">
          {shown.map((d: Diagnostic, i: number) => {
            const sev = severityGlyph(d.severity)
            return (
              <li key={`${d.source}:${d.line}:${d.column ?? 0}:${i}`} className="problems__item">
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
                {d.helpArticle && (
                  <button
                    type="button"
                    className="problems__why"
                    onClick={() => dispatchOpenHelp(d.helpArticle!)}
                    title="Why does this matter?"
                  >
                    Why?
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
