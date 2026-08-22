import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { diffLines, diffStats } from '../../../shared/refactor/diff'
import { dispatchOpenHelp } from './editorBridge'
import {
  REFACTOR_PREVIEW_EVENT,
  suppressPreview,
  type RefactorPreviewDetail
} from './refactor-bus'
import { RefactorBenchmark } from './RefactorBenchmark'
import './RefactorPreview.css'

/**
 * The diff preview shown before any refactoring touches the file (#634 §2.4).
 *
 * Non-negotiable for trust: this feature rewrites people's working robot code,
 * so nothing is applied until they have seen exactly what changes. The modal
 * carries three things beyond the diff itself:
 *
 * - **"Why?"** — every rule has a help article, and this is where the teaching
 *   payload of the whole epic actually reaches the user.
 * - **A warning** for rules that are not provably behaviour-preserving (the
 *   §3.7 speed trade-offs, the ones that change what callers must do).
 * - **"Don't ask again"** per rule id, for the ones a user has come to trust.
 *
 * Mounted once near the app root; it listens for {@link REFACTOR_PREVIEW_EVENT}
 * and renders nothing until a refactoring is proposed.
 */
export function RefactorPreview(): JSX.Element | null {
  const [request, setRequest] = useState<RefactorPreviewDetail | null>(null)
  const [skipNextTime, setSkipNextTime] = useState(false)
  const dialogRef = useFocusTrap<HTMLDivElement>(!!request)

  useEffect(() => {
    const onPreview = (event: Event): void => {
      setSkipNextTime(false)
      setRequest((event as CustomEvent<RefactorPreviewDetail>).detail)
    }
    window.addEventListener(REFACTOR_PREVIEW_EVENT, onPreview)
    return () => window.removeEventListener(REFACTOR_PREVIEW_EVENT, onPreview)
  }, [])

  const hunks = useMemo(
    () => (request ? diffLines(request.before, request.after) : []),
    [request]
  )
  const stats = useMemo(() => diffStats(hunks), [hunks])

  const close = useCallback((): void => {
    setRequest(null)
    setSkipNextTime(false)
  }, [])

  const onApply = useCallback((): void => {
    if (!request) return
    if (skipNextTime) suppressPreview(request.ruleId)
    request.onApply()
    close()
  }, [request, skipNextTime, close])

  if (!request) return null

  return (
    <div
      className="refactor-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className="refactor-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      >
        <header className="refactor-modal__head">
          <h2 className="refactor-modal__title">{request.title}</h2>
          <button
            type="button"
            className="refactor-modal__why"
            onClick={() => dispatchOpenHelp(request.helpArticle)}
            title="Read why this refactoring matters"
          >
            Why?
          </button>
        </header>

        <p className="refactor-modal__message">{request.message}</p>

        {!request.safe && (
          <p className="refactor-modal__caution" role="note">
            This one is a judgement call, not a guaranteed-equivalent rewrite — read the diff
            before you accept it.
          </p>
        )}

        <div className="refactor-modal__stats">
          <span className="refactor-modal__stat refactor-modal__stat--add">+{stats.added}</span>
          <span className="refactor-modal__stat refactor-modal__stat--remove">−{stats.removed}</span>
          <span className="refactor-modal__stat">
            {request.editCount} {request.editCount === 1 ? 'change' : 'changes'}
          </span>
        </div>

        <div className="refactor-diff" aria-label="Proposed changes">
          {hunks.length === 0 ? (
            <p className="refactor-diff__empty">Nothing would change.</p>
          ) : (
            hunks.map((hunk, hi) => (
              <div className="refactor-diff__hunk" key={`${hunk.beforeStart}:${hi}`}>
                {hunk.lines.map((line, li) => (
                  <div
                    className={`refactor-diff__line refactor-diff__line--${line.kind}`}
                    key={`${hi}:${li}`}
                  >
                    <span className="refactor-diff__gutter" aria-hidden="true">
                      {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
                    </span>
                    <span className="refactor-diff__num">
                      {line.kind === 'add' ? line.afterLine : line.beforeLine}
                    </span>
                    <code className="refactor-diff__text">{line.text || ' '}</code>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <RefactorBenchmark request={request} />

        <footer className="refactor-modal__actions">
          <label className="refactor-modal__skip">
            <input
              type="checkbox"
              checked={skipNextTime}
              onChange={(e) => setSkipNextTime(e.target.checked)}
            />
            Don&apos;t ask again for this refactoring
          </label>
          <div className="refactor-modal__buttons">
            <button type="button" className="btn btn--ghost" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={onApply} autoFocus>
              Apply
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
