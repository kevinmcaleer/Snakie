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
  /**
   * Optional docstring (the first string literal directly after a
   * function/class header), trimmed. Surfaced as a hover tooltip in the panel.
   */
  doc?: string
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

// A docstring opener on the first body line: an optional `r`/`u`/`b`/`f` prefix
// then `"""`, `'''`, `"`, or `'`. We capture the quote so we can find its close.
const DOCSTRING_OPEN_RE = /^(?:[rRuUbBfF]{0,2})("""|'''|"|')/

/**
 * Read the docstring of a function/class whose header is on `lines[headerIdx]`.
 *
 * Scans forward for the first non-blank, non-comment body line; if it begins
 * with a string literal (triple- or single-quoted, possibly spanning multiple
 * lines) the literal's contents are returned trimmed. Returns `undefined` when
 * there is no docstring. Pure helper — no side effects, easy to unit test.
 */
function extractDocstring(lines: string[], headerIdx: number): string | undefined {
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    // Skip blank lines and comments before the (potential) docstring.
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue

    const open = DOCSTRING_OPEN_RE.exec(trimmed)
    if (!open) return undefined // first body statement isn't a string ⇒ no doc.
    const quote = open[1]
    const after = trimmed.slice(open.index + open[0].length)

    // Single-line literal: closing quote on the same line.
    const closeOnSame = after.indexOf(quote)
    if (closeOnSame !== -1) return after.slice(0, closeOnSame).trim()

    // Triple-quoted literal that spans multiple lines; gather until the close.
    if (quote.length === 3) {
      const parts = [after]
      for (let j = i + 1; j < lines.length; j++) {
        const end = lines[j].indexOf(quote)
        if (end !== -1) {
          parts.push(lines[j].slice(0, end))
          return parts.join('\n').trim()
        }
        parts.push(lines[j])
      }
    }
    return undefined // unterminated literal ⇒ ignore.
  }
  return undefined
}

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
      const sym: OutlineSymbol = {
        kind: 'function',
        name: fn[1],
        line: i + 1,
        detail: `(${params})`
      }
      const doc = extractDocstring(lines, i)
      if (doc) sym.doc = doc
      symbols.push(sym)
      continue
    }

    const cls = CLASS_RE.exec(line)
    if (cls) {
      const bases = (cls[2] ?? '').trim()
      const sym: OutlineSymbol = {
        kind: 'class',
        name: cls[1],
        line: i + 1,
        detail: bases ? `(${bases})` : undefined
      }
      const doc = extractDocstring(lines, i)
      if (doc) sym.doc = doc
      symbols.push(sym)
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
              title={sym.doc ?? `Go to line ${sym.line}`}
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
