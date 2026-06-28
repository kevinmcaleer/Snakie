import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { FindStatusPayload } from '../../../preload/index.d'
import './FindReplace.css'

/**
 * Find & Replace panel (issue #92, rehoused as a native window in #146).
 *
 * This now renders inside its OWN frameless OS window (`find.html` /
 * `find-main.tsx`) — NOT over the editor. It has no Monaco access; it ships the
 * query + options to the MAIN window over IPC (`window.api.find.sendCommand`) and
 * shows the match count it gets back (`onStatus`). The actual search/replace runs
 * in the main window via `findController`.
 *
 * #146 changes vs. the old in-editor panel:
 *  - native window (above), so Enter can never leak into and edit the document;
 *  - the Replace row is ALWAYS shown (no chevron / find-only mode);
 *  - the regex toggle is gone — find is plain-text (Match-case + Whole-word stay);
 *  - Enter = find next, Shift+Enter = previous, Esc = close — wired at the window
 *    root so they work whatever control has focus;
 *  - no fixed-width clip, so every button (incl. the gold Replace all) is visible.
 */

export function FindReplace(): JSX.Element {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [status, setStatus] = useState<FindStatusPayload>({ matchIndex: 0, matchCount: 0 })

  const findInputRef = useRef<HTMLInputElement>(null)

  /** Ship an action to the editor with the current query + options. */
  const send = useCallback(
    (action: 'next' | 'prev' | 'replace' | 'replaceFind' | 'replaceAll' | 'count'): void => {
      window.api.find.sendCommand({ action, query, replacement, matchCase, wholeWord })
    },
    [query, replacement, matchCase, wholeWord]
  )

  /** Close the window. */
  const close = useCallback((): void => window.api.find.close(), [])

  // Subscribe to the match status pushed back from the editor window.
  useEffect(() => window.api.find.onStatus(setStatus), [])

  // Refresh the count whenever the query or the case/whole-word options change
  // (the replacement text doesn't affect the count).
  useEffect(() => {
    window.api.find.sendCommand({ action: 'count', query, replacement, matchCase, wholeWord })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, matchCase, wholeWord])

  // Focus the Find box on mount.
  useEffect(() => {
    const input = findInputRef.current
    input?.focus()
    input?.select()
  }, [])

  // Window-level shortcuts so they work regardless of which control has focus:
  // Enter = next, Shift+Enter = previous, Esc = close.
  const onRootKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        send(e.shiftKey ? 'prev' : 'next')
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    },
    [send, close]
  )

  const statusIsEmpty = query.length > 0 && status.matchCount === 0

  const statusText = useMemo(() => {
    if (query.length === 0) return ''
    if (status.matchCount === 0) return 'No results'
    if (status.matchIndex === 0) {
      return `${status.matchCount} match${status.matchCount === 1 ? '' : 'es'}`
    }
    return `${status.matchIndex} of ${status.matchCount} matches`
  }, [query, status])

  return (
    <div
      className="find-replace find-replace--window"
      role="search"
      aria-label="Find and replace"
      onKeyDown={onRootKeyDown}
    >
      {/* Title bar, drag and close are the native window chrome now (#185); Esc
          still closes via onRootKeyDown. */}
      <div className="find-replace__body">
        <div className="find-replace__row">
          <input
            ref={findInputRef}
            className={`find-replace__input${statusIsEmpty ? ' find-replace__input--error' : ''}`}
            type="text"
            placeholder="Find"
            aria-label="Find"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
          </div>
          <div className="find-replace__nav" role="group" aria-label="Navigate matches">
            <button
              type="button"
              className="find-replace__arrow"
              onClick={() => send('prev')}
              disabled={query.length === 0}
              aria-label="Previous match"
              title="Previous match"
            >
              ↑
            </button>
            <button
              type="button"
              className="find-replace__arrow"
              onClick={() => send('next')}
              disabled={query.length === 0}
              aria-label="Next match"
              title="Next match"
            >
              ↓
            </button>
          </div>
        </div>

        <div className="find-replace__row">
          <input
            className="find-replace__input"
            type="text"
            placeholder="Replace with"
            aria-label="Replace with"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
          <button
            type="button"
            className="find-replace__btn"
            onClick={() => send('replace')}
            disabled={query.length === 0}
          >
            Replace
          </button>
          <button
            type="button"
            className="find-replace__btn"
            onClick={() => send('replaceFind')}
            disabled={query.length === 0}
            title="Replace then find next"
          >
            Replace+Find
          </button>
          <button
            type="button"
            className="find-replace__btn find-replace__btn--gold"
            onClick={() => send('replaceAll')}
            disabled={query.length === 0}
          >
            Replace all
          </button>
        </div>

        <div className="find-replace__status">
          <span
            className={`find-replace__count${statusIsEmpty ? ' find-replace__count--empty' : ''}`}
          >
            {statusText}
          </span>
          <span className="find-replace__keyhint">↵ next · ⇧↵ prev · Esc close</span>
        </div>
      </div>
    </div>
  )
}

export default FindReplace
