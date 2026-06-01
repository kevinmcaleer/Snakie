import { useMemo } from 'react'
import './OutlinePanel.css'
import { useWorkspace } from '../store/workspace'

/**
 * OUTLINE TAB (issue #16)
 * =======================
 *
 * A code outline for the ACTIVE editor file: top-level `def` functions, `class`
 * definitions, and module-level (column-0) assignments. Clicking a symbol asks
 * the editor to reveal its line via the workspace store's `revealLine` action
 * (no cross-component refs — see `workspace.ts`).
 *
 * Parsing is a defensive line scan rather than a full Python parser: it only
 * considers indentation-0 lines, skips comments/strings cheaply, and is
 * tolerant of malformed input (it simply yields fewer symbols).
 */

type SymbolKind = 'function' | 'class' | 'variable'

interface OutlineSymbol {
  kind: SymbolKind
  name: string
  /** 1-based line number in the source. */
  line: number
  /** Optional signature/detail shown muted after the name. */
  detail?: string
}

const KIND_GLYPH: Record<SymbolKind, string> = {
  function: 'ƒ',
  class: 'C',
  variable: '='
}

const KIND_LABEL: Record<SymbolKind, string> = {
  function: 'function',
  class: 'class',
  variable: 'variable'
}

// Matches a top-level (column-0) symbol declaration. We anchor at the start of
// the line so indented members (methods, locals) are intentionally excluded.
const FUNC_RE = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/
const CLASS_RE = /^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/
// Module-level assignment: `NAME = ...`, `NAME: type = ...`, or multi-target
// `A = B = ...`. Excludes `==`, `<=`, etc. by requiring a non-`=` char after.
const ASSIGN_RE = /^([A-Za-z_]\w*)\s*(?::\s*[^=]+)?=(?!=)/

/** Extract top-level outline symbols from Python source via a line scan. */
export function parseOutline(source: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = []
  if (!source) return symbols
  const seenVars = new Set<string>()
  const lines = source.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    // Only top-level constructs: skip any indented or blank/comment line.
    if (raw.length === 0 || /^\s/.test(raw)) continue
    const line = raw
    if (line.startsWith('#')) continue

    const fn = FUNC_RE.exec(line)
    if (fn) {
      const params = fn[2].trim()
      symbols.push({
        kind: 'function',
        name: fn[1],
        line: i + 1,
        detail: `(${params})`
      })
      continue
    }

    const cls = CLASS_RE.exec(line)
    if (cls) {
      const bases = (cls[2] ?? '').trim()
      symbols.push({
        kind: 'class',
        name: cls[1],
        line: i + 1,
        detail: bases ? `(${bases})` : undefined
      })
      continue
    }

    const assign = ASSIGN_RE.exec(line)
    if (assign) {
      const name = assign[1]
      // Keywords like `if`, `for`, `while`, `return` can never be assignment
      // targets, but a bare identifier followed by `=` is safe to treat as one.
      if (!seenVars.has(name)) {
        seenVars.add(name)
        symbols.push({ kind: 'variable', name, line: i + 1 })
      }
    }
  }

  return symbols
}

export function OutlinePanel(): JSX.Element {
  const { openFiles, activeId, revealLine } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null

  const symbols = useMemo(
    () => parseOutline(activeFile?.content ?? ''),
    [activeFile?.content]
  )

  if (!activeFile) {
    return (
      <div className="outline">
        <p className="outline__hint">Open a file to see its outline.</p>
      </div>
    )
  }

  if (symbols.length === 0) {
    return (
      <div className="outline">
        <p className="outline__hint">
          No top-level functions, classes, or variables found in{' '}
          <code>{activeFile.name}</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="outline">
      <ul className="outline__list" role="list">
        {symbols.map((sym) => (
          <li key={`${sym.kind}:${sym.name}:${sym.line}`}>
            <button
              type="button"
              className="outline__item"
              title={`Go to line ${sym.line}`}
              onClick={() => revealLine(sym.line)}
            >
              <span
                className={`outline__glyph outline__glyph--${sym.kind}`}
                aria-hidden="true"
                title={KIND_LABEL[sym.kind]}
              >
                {KIND_GLYPH[sym.kind]}
              </span>
              <span className="outline__name">{sym.name}</span>
              {sym.detail != null && (
                <span className="outline__detail">{sym.detail}</span>
              )}
              <span className="outline__line">{sym.line}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
