import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { getActiveEditor, subscribeActiveEditor } from './editorBridge'
import './FindReplace.css'

/**
 * Find & Replace dialog (issue #92, skeuomorph polish).
 *
 * A floating, draggable panel docked top-right over the editor (non-blocking —
 * the editor stays interactive) with a Find box, prev/next arrows (↑ = previous,
 * ↓ = next), three search-option keys (case `Aa`, whole-word `|ab|`, regex `.*`),
 * a chevron that reveals/hides the Replace-with row (so Replace is reachable even
 * from find-only mode), and Replace / Replace+Find / Replace all buttons, plus a
 * live `N of M matches` status line.
 *
 * It does NOT reimplement search: it drives the live Monaco editor (exposed via
 * `editorBridge`) through `model.findMatches`, `editor.setSelection` and
 * `editor.executeEdits`. Because edits flow through the editor, Monaco's
 * `onDidChangeModelContent` handler pushes the new content to the workspace
 * store (marking the buffer dirty) for free.
 *
 *  - Find: next match relative to the cursor in the chosen direction (Down =
 *    forward, Up = backward), wrapping at the ends.
 *  - Replace: if the selection already equals a match, replace it; else Find.
 *  - Replace+Find: replace the current match, then Find the next.
 *  - Replace all: replace every match in a single edit (one undo stop).
 *
 * The case / whole-word / regex keys feed Monaco's `matchCase`, `wordSeparators`
 * and `isRegex` args; an invalid regex is caught (no throw) and surfaces as a
 * subtle error state. Enter finds the next match (Shift+Enter the previous).
 * Opening/closing + keyboard wiring lives in EditorArea.
 */

export interface FindReplaceProps {
  /** Whether the panel is shown. */
  open: boolean
  /** Start with the Replace row revealed (Cmd/Ctrl-H) vs. find-only (Cmd/Ctrl-F). */
  withReplace: boolean
  /** Close the panel (Esc / the × button) and return focus to the editor. */
  onClose: () => void
}

/**
 * Monaco's default word separators (the value its find widget uses for
 * whole-word matching). Passed as `wordSeparators` to `findMatches` when the
 * whole-word toggle is on; `null` otherwise. Kept inline to avoid importing a
 * non-public constant from the monaco bundle.
 */
const USUAL_WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'

/** A Monaco range, compared field-by-field (no reference identity available). */
function rangesEqual(a: monaco.IRange, b: monaco.IRange): boolean {
  return (
    a.startLineNumber === b.startLineNumber &&
    a.startColumn === b.startColumn &&
    a.endLineNumber === b.endLineNumber &&
    a.endColumn === b.endColumn
  )
}

export function FindReplace({ open, withReplace, onClose }: FindReplaceProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  // Whether the Replace row is revealed. Seeded from `withReplace` (Cmd/Ctrl-H
  // opens it shown, Cmd/Ctrl-F hidden) but toggleable in-dialog via the chevron,
  // so Replace is always reachable from find-only mode.
  const [showReplace, setShowReplace] = useState(withReplace)
  // Live match count + current index for the `N of M matches` status. Recomputed
  // on query/option/content changes and after every navigation/replace.
  const [matchCount, setMatchCount] = useState(0)
  const [matchIndex, setMatchIndex] = useState(0)
  // True when the regex toggle is on but the query doesn't compile — surfaced as
  // a subtle error state instead of throwing.
  const [regexError, setRegexError] = useState(false)
  // Bumps whenever the bridge reports a new editor, forcing the count effect to
  // re-run once Monaco's lazy chunk has mounted.
  const [editorTick, setEditorTick] = useState(0)
  // Drag offset applied to the floating panel (from its top-right dock).
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const findInputRef = useRef<HTMLInputElement>(null)
  // Live drag bookkeeping kept in a ref so pointer move handlers don't re-bind.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  )

  // Track editor availability so the match-count effect re-runs when the lazy
  // Monaco instance appears/disappears.
  useEffect(() => subscribeActiveEditor(() => setEditorTick((t) => t + 1)), [])

  /** All matches for the current query/options in the active model (empty if none). */
  const findAllMatches = useCallback((): monaco.editor.FindMatch[] => {
    const editor = getActiveEditor()
    const model = editor?.getModel()
    if (!editor || !model || query.length === 0) return []
    // findMatches(searchString, searchOnlyEditableRange, isRegex, matchCase,
    //   wordSeparators, captureMatches)
    return model.findMatches(
      query,
      false,
      useRegex,
      matchCase,
      wholeWord ? USUAL_WORD_SEPARATORS : null,
      false
    )
  }, [query, matchCase, wholeWord, useRegex])

  /**
   * Like `findAllMatches` but swallows the invalid-regex throw: when the regex
   * toggle is on and the pattern doesn't compile, Monaco throws — we return no
   * matches and flag the error so the UI can show it instead of crashing.
   */
  const safeFindAllMatches = useCallback((): monaco.editor.FindMatch[] => {
    try {
      const matches = findAllMatches()
      setRegexError(false)
      return matches
    } catch {
      setRegexError(true)
      return []
    }
  }, [findAllMatches])

  /** Index (1-based) of the current selection among `matches`, or 0 if none. */
  const indexOfSelection = useCallback((matches: monaco.editor.FindMatch[]): number => {
    const editor = getActiveEditor()
    const selection = editor?.getSelection()
    if (!selection) return 0
    const i = matches.findIndex((m) => rangesEqual(m.range, selection))
    return i < 0 ? 0 : i + 1
  }, [])

  // Keep the `N of M matches` status in sync. Re-runs on query/option changes and
  // when the editor instance changes; the cheap recompute is fine for a status.
  useEffect(() => {
    if (!open) return
    const matches = safeFindAllMatches()
    setMatchCount(matches.length)
    setMatchIndex(indexOfSelection(matches))
  }, [open, safeFindAllMatches, indexOfSelection, editorTick])

  // Focus the Find box whenever the panel opens (or flips between find/replace).
  useEffect(() => {
    if (!open) return
    const input = findInputRef.current
    if (input) {
      input.focus()
      input.select()
    }
  }, [open, withReplace])

  // Reveal/hide the Replace row to match the entry point each time the panel
  // opens (Cmd/Ctrl-F hidden, Cmd/Ctrl-H shown); the chevron can override after.
  useEffect(() => {
    if (open) setShowReplace(withReplace)
  }, [open, withReplace])

  // Reset the drag offset when the panel closes so it re-docks top-right next time.
  useEffect(() => {
    if (!open) setOffset({ x: 0, y: 0 })
  }, [open])

  /** Recompute count + current index after a navigation/replace. */
  const syncStatus = useCallback((): void => {
    const matches = safeFindAllMatches()
    setMatchCount(matches.length)
    setMatchIndex(indexOfSelection(matches))
  }, [safeFindAllMatches, indexOfSelection])

  /**
   * Select the next match in `dir` relative to the current selection, wrapping.
   * Returns true if a match was selected.
   */
  const findNext = useCallback(
    (dir: 'up' | 'down'): boolean => {
      const editor = getActiveEditor()
      if (!editor) return false
      const matches = safeFindAllMatches()
      if (matches.length === 0) return false

      const selection = editor.getSelection()
      let target: monaco.editor.FindMatch
      if (!selection) {
        target = dir === 'down' ? matches[0] : matches[matches.length - 1]
      } else if (dir === 'down') {
        // First match that starts strictly after the current selection's start;
        // wrap to the first match.
        target =
          matches.find((m) =>
            m.range.startLineNumber > selection.startLineNumber ||
            (m.range.startLineNumber === selection.startLineNumber &&
              m.range.startColumn > selection.startColumn)
          ) ?? matches[0]
      } else {
        // Last match that starts strictly before the current selection's start;
        // wrap to the last match.
        const prior = matches.filter((m) =>
          m.range.startLineNumber < selection.startLineNumber ||
          (m.range.startLineNumber === selection.startLineNumber &&
            m.range.startColumn < selection.startColumn)
        )
        target = prior.length > 0 ? prior[prior.length - 1] : matches[matches.length - 1]
      }

      editor.setSelection(target.range)
      editor.revealRangeInCenterIfOutsideViewport(target.range)
      return true
    },
    [safeFindAllMatches]
  )

  const handleFind = useCallback(
    (dir: 'up' | 'down' = 'down'): void => {
      findNext(dir)
      syncStatus()
      getActiveEditor()?.focus()
    },
    [findNext, syncStatus]
  )

  /**
   * If the current selection exactly matches a found range, replace it in place
   * (through the editor so the store updates) and return true; otherwise false.
   */
  const replaceCurrent = useCallback((): boolean => {
    const editor = getActiveEditor()
    if (!editor) return false
    const selection = editor.getSelection()
    if (!selection) return false
    const matches = safeFindAllMatches()
    const hit = matches.find((m) => rangesEqual(m.range, selection))
    if (!hit) return false
    editor.executeEdits('snakie-find-replace', [
      { range: hit.range, text: replacement, forceMoveMarkers: true }
    ])
    return true
  }, [safeFindAllMatches, replacement])

  const handleReplace = useCallback((): void => {
    // Replace the current match if the selection is on one; else find first so a
    // subsequent Replace lands on a match.
    if (!replaceCurrent()) findNext('down')
    syncStatus()
    getActiveEditor()?.focus()
  }, [replaceCurrent, findNext, syncStatus])

  const handleReplaceFind = useCallback((): void => {
    replaceCurrent()
    findNext('down')
    syncStatus()
    getActiveEditor()?.focus()
  }, [replaceCurrent, findNext, syncStatus])

  const handleReplaceAll = useCallback((): void => {
    const editor = getActiveEditor()
    if (!editor) return
    const matches = safeFindAllMatches()
    if (matches.length === 0) return
    // One executeEdits call = one undo stop for the whole replace-all.
    editor.executeEdits(
      'snakie-find-replace-all',
      matches.map((m) => ({ range: m.range, text: replacement, forceMoveMarkers: true }))
    )
    editor.focus()
    syncStatus()
  }, [safeFindAllMatches, replacement, syncStatus])

  // Enter in the Find box = Find (Shift+Enter = previous); Enter in Replace =
  // Replace+Find; Esc closes either.
  const onFindKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleFind(e.shiftKey ? 'up' : 'down')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [handleFind, onClose]
  )

  const onReplaceKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleReplaceFind()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [handleReplaceFind, onClose]
  )

  // --- Drag the panel by its title-bar grip -------------------------------
  const onGripPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y }
    },
    [offset]
  )

  const onGripPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    setOffset({
      x: drag.baseX + (e.clientX - drag.startX),
      y: drag.baseY + (e.clientY - drag.startY)
    })
  }, [])

  const onGripPointerUp = useCallback((e: ReactPointerEvent<HTMLButtonElement>): void => {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const status = useMemo(() => {
    if (query.length === 0) return ''
    if (regexError) return 'Invalid regex'
    if (matchCount === 0) return 'No results'
    if (matchIndex === 0) return `${matchCount} match${matchCount === 1 ? '' : 'es'}`
    return `${matchIndex} of ${matchCount} matches`
  }, [query, regexError, matchCount, matchIndex])

  const statusIsEmpty = query.length > 0 && (regexError || matchCount === 0)

  if (!open) return null

  // Drag offset is applied as a translate from the CSS top-right dock so the
  // panel re-docks cleanly when reopened (offset reset on close).
  const style =
    offset.x !== 0 || offset.y !== 0
      ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
      : undefined

  return (
    <div
      className="find-replace"
      role="search"
      aria-label="Find and replace"
      style={style}
      // Stop the editor's Cmd/Ctrl-F capture handler (in EditorArea) from acting
      // while the user is typing in this panel.
      onKeyDownCapture={(e) => e.stopPropagation()}
    >
      <div className="find-replace__titlebar">
        <button
          type="button"
          className="find-replace__grip"
          aria-label="Drag dialog"
          title="Drag"
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={onGripPointerUp}
          onPointerCancel={onGripPointerUp}
        >
          <span className="find-replace__grip-dots" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
        <span className="find-replace__title">FIND &amp; REPLACE</span>
        <button
          type="button"
          className="find-replace__close"
          onClick={onClose}
          aria-label="Close find and replace"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div className="find-replace__body">
        <div className="find-replace__row">
          <button
            type="button"
            className="find-replace__expand"
            aria-label={showReplace ? 'Hide replace' : 'Show replace'}
            aria-expanded={showReplace}
            title={showReplace ? 'Hide replace' : 'Show replace'}
            onClick={() => setShowReplace((v) => !v)}
          >
            {showReplace ? '▾' : '▸'}
          </button>
          <input
            ref={findInputRef}
            className={`find-replace__input${statusIsEmpty ? ' find-replace__input--error' : ''}`}
            type="text"
            placeholder="Find"
            aria-label="Find"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFindKeyDown}
          />
          <div className="find-replace__keys" role="group" aria-label="Search options">
            <button
              type="button"
              className={`find-replace__key${matchCase ? ' is-active' : ''}`}
              aria-pressed={matchCase}
              onClick={() => setMatchCase((v) => !v)}
              title="Match case"
            >
              Aa
            </button>
            <button
              type="button"
              className={`find-replace__key${wholeWord ? ' is-active' : ''}`}
              aria-pressed={wholeWord}
              onClick={() => setWholeWord((v) => !v)}
              title="Whole word"
            >
              |ab|
            </button>
            <button
              type="button"
              className={`find-replace__key${useRegex ? ' is-active' : ''}`}
              aria-pressed={useRegex}
              onClick={() => setUseRegex((v) => !v)}
              title="Use regular expression"
            >
              .*
            </button>
          </div>
          <div className="find-replace__nav" role="group" aria-label="Navigate matches">
            <button
              type="button"
              className="find-replace__arrow"
              onClick={() => handleFind('up')}
              disabled={query.length === 0}
              aria-label="Previous match"
              title="Previous match"
            >
              ↑
            </button>
            <button
              type="button"
              className="find-replace__arrow"
              onClick={() => handleFind('down')}
              disabled={query.length === 0}
              aria-label="Next match"
              title="Next match"
            >
              ↓
            </button>
          </div>
        </div>

        {showReplace && (
          <div className="find-replace__row">
            <input
              className="find-replace__input"
              type="text"
              placeholder="Replace with"
              aria-label="Replace with"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={onReplaceKeyDown}
            />
            <button
              type="button"
              className="find-replace__btn"
              onClick={handleReplace}
              disabled={query.length === 0}
            >
              Replace
            </button>
            <button
              type="button"
              className="find-replace__btn"
              onClick={handleReplaceFind}
              disabled={query.length === 0}
              title="Replace then find next"
            >
              Replace+Find
            </button>
            <button
              type="button"
              className="find-replace__btn find-replace__btn--gold"
              onClick={handleReplaceAll}
              disabled={query.length === 0}
            >
              Replace all
            </button>
          </div>
        )}

        <div className="find-replace__status">
          <span
            className={`find-replace__count${statusIsEmpty ? ' find-replace__count--empty' : ''}`}
          >
            {status}
          </span>
          <span className="find-replace__keyhint">↵ next · ⇧↵ prev · Esc close</span>
        </div>
      </div>
    </div>
  )
}

export default FindReplace
