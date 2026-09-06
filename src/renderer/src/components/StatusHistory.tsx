import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  formatHistoryText,
  formatTime,
  historyFileName,
  type StatusEntry
} from '../../../shared/status-history'
import { useStatusHistory } from '../store/status-history'
import './StatusHistory.css'

/**
 * WHAT THE STATUS BAR SAID (#953).
 * =============================================================================
 *
 * Two surfaces over one log. The POPUP is the common case — click the bar, see
 * the last handful, carry on — and the FULL VIEW is for the times you need to
 * read, search or keep it: copy, save, clear.
 *
 * NEWEST FIRST on screen, oldest first in the file. The thing you just missed is
 * the thing you clicked for, so it belongs at the top; a saved log is read by
 * other tools and by future-you scrolling down, and those want time running
 * forwards.
 */

const PEEK_ROWS = 8

/** One row, in both views. */
function Row({ entry }: { entry: StatusEntry }): JSX.Element {
  return (
    <li className="shist__row">
      <span className="shist__time">{formatTime(entry.at)}</span>
      <span className="shist__text">{entry.text}</span>
    </li>
  )
}

/** Nothing recorded yet — say which of the two reasons it is. */
function Empty({ enabled }: { enabled: boolean }): JSX.Element {
  return (
    <p className="shist__empty">
      {enabled
        ? 'Nothing yet — messages appear here as they happen.'
        : 'History is off. Turn it on in Settings ▸ Editor to start keeping messages.'}
    </p>
  )
}

export interface StatusHistoryPopupProps {
  onClose: () => void
  /** Open the full-screen view instead. */
  onExpand: () => void
}

/** The click-the-bar popup: the most recent few, and a way to see the rest. */
export function StatusHistoryPopup({ onClose, onExpand }: StatusHistoryPopupProps): JSX.Element {
  const { entries, enabled } = useStatusHistory()
  const recent = useMemo(() => [...entries].reverse().slice(0, PEEK_ROWS), [entries])
  const box = useRef<HTMLDivElement>(null)

  // Click-away and Esc, the two ways out of anything that hovers.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Deferred: the click that OPENED this would otherwise close it again.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="shist__popup" ref={box} role="group" aria-label="Recent status messages">
      {recent.length === 0 ? (
        <Empty enabled={enabled} />
      ) : (
        <ul className="shist__list">
          {recent.map((e) => (
            <Row key={e.id} entry={e} />
          ))}
        </ul>
      )}
      <div className="shist__popup-foot">
        <button type="button" className="shist__link" onClick={onExpand}>
          Show all{entries.length > recent.length ? ` (${entries.length})` : ''}
        </button>
      </div>
    </div>
  )
}

/** The full-screen log: read it, copy it, save it, clear it. */
export function StatusHistoryView({ onClose }: { onClose: () => void }): JSX.Element {
  const { entries, enabled, clear } = useStatusHistory()
  const newestFirst = useMemo(() => [...entries].reverse(), [entries])
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Confirmation lives on the button that did the thing, briefly. A copy has no
  // other visible result, so without this it is indistinguishable from a no-op.
  useEffect(() => {
    if (!said) return
    const id = setTimeout(() => setSaid(null), 2000)
    return () => clearTimeout(id)
  }, [said])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatHistoryText(entries))
      setSaid('Copied')
    } catch {
      setSaid('Could not copy')
    }
  }

  const save = async (): Promise<void> => {
    const text = formatHistoryText(entries)
    try {
      const path = await window.api.fs.saveFileDialog(historyFileName())
      if (!path) return
      await window.api.fs.writeFile(path, text)
      setSaid('Saved')
    } catch {
      setSaid('Could not save')
    }
  }

  return (
    <div className="shist" role="dialog" aria-modal="true" aria-label="Status history">
      <div className="shist__backdrop" onClick={onClose} aria-hidden />
      <div className="shist__panel">
        <header className="shist__head">
          <h2 className="shist__title">Status history</h2>
          <span className="shist__count">
            {entries.length} {entries.length === 1 ? 'message' : 'messages'}
          </span>
          <span className="shist__spacer" />
          {said && (
            <span className="shist__said" role="status">
              {said}
            </span>
          )}
          <button
            type="button"
            className="shist__btn"
            onClick={() => void copy()}
            disabled={entries.length === 0}
          >
            Copy
          </button>
          <button
            type="button"
            className="shist__btn"
            onClick={() => void save()}
            disabled={entries.length === 0}
          >
            Save…
          </button>
          <button
            type="button"
            className="shist__btn shist__btn--danger"
            onClick={clear}
            disabled={entries.length === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="shist__close"
            onClick={onClose}
            aria-label="Close status history"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>
        <div className="shist__body">
          {newestFirst.length === 0 ? (
            <Empty enabled={enabled} />
          ) : (
            <ul className="shist__list shist__list--full">
              {newestFirst.map((e) => (
                <Row key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
