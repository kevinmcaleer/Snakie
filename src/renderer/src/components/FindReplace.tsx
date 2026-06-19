import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { getActiveEditor, subscribeActiveEditor } from './editorBridge'
import './FindReplace.css'

/**
 * Find & Replace panel (issue #92).
 *
 * A compact bar mounted over the editor (below the tabs) with a Find box, a
 * Replace-with box, a case-sensitive toggle, an Up/Down search-direction radio
 * (Down is the default), and Find / Replace / Replace+Find / Replace all
 * buttons, plus a live match-count hint.
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
 * The case-sensitive toggle feeds Monaco's `matchCase` arg; the direction drives
 * Find / Replace+Find. Opening/closing + keyboard wiring lives in EditorArea.
 */

export interface FindReplaceProps {
  /** Whether the panel is shown. */
  open: boolean
  /** Start with the Replace row revealed (Cmd/Ctrl-H) vs. find-only (Cmd/Ctrl-F). */
  withReplace: boolean
  /** Close the panel (Esc / the × button) and return focus to the editor. */
  onClose: () => void
}

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
  const [direction, setDirection] = useState<'up' | 'down'>('down')
  // Live match count for the hint; recomputed on query/case/content changes.
  const [matchCount, setMatchCount] = useState(0)
  // Bumps whenever the bridge reports a new editor, forcing the count effect to
  // re-run once Monaco's lazy chunk has mounted.
  const [editorTick, setEditorTick] = useState(0)

  const findInputRef = useRef<HTMLInputElement>(null)

  // Track editor availability so the match-count effect re-runs when the lazy
  // Monaco instance appears/disappears.
  useEffect(() => subscribeActiveEditor(() => setEditorTick((t) => t + 1)), [])

  /** All matches for the current query/case in the active model (empty if none). */
  const findAllMatches = useCallback((): monaco.editor.FindMatch[] => {
    const editor = getActiveEditor()
    const model = editor?.getModel()
    if (!editor || !model || query.length === 0) return []
    // findMatches(searchString, searchOnlyEditableRange, isRegex, matchCase,
    //   wordSeparators, captureMatches)
    return model.findMatches(query, false, false, matchCase, null, false)
  }, [query, matchCase])

  // Keep the match-count hint in sync. Re-runs on query/case changes and when
  // the editor instance changes; the cheap recompute is fine for a hint.
  useEffect(() => {
    if (!open) return
    setMatchCount(findAllMatches().length)
  }, [open, findAllMatches, editorTick])

  // Focus the Find box whenever the panel opens (or flips between find/replace).
  useEffect(() => {
    if (!open) return
    const input = findInputRef.current
    if (input) {
      input.focus()
      input.select()
    }
  }, [open, withReplace])

  /**
   * Select the next match in `dir` relative to the current selection, wrapping.
   * Returns true if a match was selected.
   */
  const findNext = useCallback(
    (dir: 'up' | 'down'): boolean => {
      const editor = getActiveEditor()
      if (!editor) return false
      const matches = findAllMatches()
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
    [findAllMatches]
  )

  const handleFind = useCallback((): void => {
    findNext(direction)
    getActiveEditor()?.focus()
  }, [findNext, direction])

  /**
   * If the current selection exactly matches a found range, replace it in place
   * (through the editor so the store updates) and return true; otherwise false.
   */
  const replaceCurrent = useCallback((): boolean => {
    const editor = getActiveEditor()
    if (!editor) return false
    const selection = editor.getSelection()
    if (!selection) return false
    const matches = findAllMatches()
    const hit = matches.find((m) => rangesEqual(m.range, selection))
    if (!hit) return false
    editor.executeEdits('snakie-find-replace', [
      { range: hit.range, text: replacement, forceMoveMarkers: true }
    ])
    return true
  }, [findAllMatches, replacement])

  const handleReplace = useCallback((): void => {
    // Replace the current match if the selection is on one; else find first so a
    // subsequent Replace lands on a match.
    if (!replaceCurrent()) findNext(direction)
    getActiveEditor()?.focus()
  }, [replaceCurrent, findNext, direction])

  const handleReplaceFind = useCallback((): void => {
    replaceCurrent()
    findNext(direction)
    getActiveEditor()?.focus()
  }, [replaceCurrent, findNext, direction])

  const handleReplaceAll = useCallback((): void => {
    const editor = getActiveEditor()
    if (!editor) return
    const matches = findAllMatches()
    if (matches.length === 0) return
    // One executeEdits call = one undo stop for the whole replace-all.
    editor.executeEdits(
      'snakie-find-replace-all',
      matches.map((m) => ({ range: m.range, text: replacement, forceMoveMarkers: true }))
    )
    editor.focus()
  }, [findAllMatches, replacement])

  // Enter in the Find box = Find; Enter in Replace = Replace+Find; Esc closes.
  const onFindKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleFind()
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

  const hint = useMemo(() => {
    if (query.length === 0) return ''
    return matchCount === 0 ? 'No results' : `${matchCount} match${matchCount === 1 ? '' : 'es'}`
  }, [query, matchCount])

  if (!open) return null

  return (
    <div className="find-replace" role="search" aria-label="Find and replace">
      <div className="find-replace__row">
        <input
          ref={findInputRef}
          className="find-replace__input"
          type="text"
          placeholder="Find"
          aria-label="Find"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFindKeyDown}
        />
        <span
          className={`find-replace__hint${
            query.length > 0 && matchCount === 0 ? ' find-replace__hint--empty' : ''
          }`}
        >
          {hint}
        </span>
        <button type="button" className="btn btn--sm" onClick={handleFind} disabled={query.length === 0}>
          Find
        </button>
        <button
          type="button"
          className="find-replace__close btn btn--sm btn--ghost"
          onClick={onClose}
          aria-label="Close find and replace"
        >
          ×
        </button>
      </div>

      {withReplace && (
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
            className="btn btn--sm"
            onClick={handleReplace}
            disabled={query.length === 0}
          >
            Replace
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={handleReplaceFind}
            disabled={query.length === 0}
          >
            Replace+Find
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={handleReplaceAll}
            disabled={query.length === 0}
          >
            Replace all
          </button>
        </div>
      )}

      <div className="find-replace__row find-replace__row--options">
        <label className="find-replace__option">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          Case sensitive
        </label>
        <fieldset className="find-replace__direction">
          <legend className="find-replace__legend">Direction</legend>
          <label className="find-replace__option">
            <input
              type="radio"
              name="find-direction"
              value="up"
              checked={direction === 'up'}
              onChange={() => setDirection('up')}
            />
            Up
          </label>
          <label className="find-replace__option">
            <input
              type="radio"
              name="find-direction"
              value="down"
              checked={direction === 'down'}
              onChange={() => setDirection('down')}
            />
            Down
          </label>
        </fieldset>
      </div>
    </div>
  )
}

export default FindReplace
