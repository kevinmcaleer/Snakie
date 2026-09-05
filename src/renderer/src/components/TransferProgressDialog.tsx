import { useEffect, useRef } from 'react'
import './TransferProgressDialog.css'

/** One row in the dialog's file list. */
export interface TransferRow {
  /** React key. Falls back to the label, which is unique for a file list but
   *  not for a queue, where a step can share a name with the task above it. */
  id?: string
  label: string
  state: 'pending' | 'copying' | 'done' | 'error'
  error?: string
  /** A sub-step of the row above it — one file of a queued folder copy. */
  indent?: boolean
}

export interface TransferProgressDialogProps {
  /** What is being copied, for the heading: `mylib → /lib`. */
  title: string
  rows: TransferRow[]
  /**
   * How far through we are. Defaults to counting `rows`, which is right when
   * every row is a file; the device queue passes its own because a row there can
   * be a heading over the steps that actually count (#837).
   */
  progress?: { done: number; total: number }
  /** True while the transfer is still running. */
  running: boolean
  /** Set when the transfer finished badly; keeps the dialog open. */
  error: string | null
  /** Close it (also used by the auto-dismiss on success). */
  onClose: () => void
  /** Ask the running transfer to stop after the current file. */
  onCancel: () => void
}

/** How long a finished, successful transfer stays on screen before closing. */
export const AUTO_DISMISS_MS = 1200

/**
 * The folder-transfer progress dialog (#848).
 *
 * A folder copy is many per-file round trips over a serial link, so it takes
 * real time — long enough that with no feedback it reads as a hang, which is
 * exactly what happened with driver installs (#842). So this shows the two
 * things that answer "is it stuck?": how far through it is, and which file it is
 * on right now.
 *
 * It dismisses ITSELF on success, after a short pause. The pause is the point —
 * vanishing the instant the last file lands makes it look like something went
 * wrong, and leaving it up makes the user close a box that has nothing left to
 * say. On FAILURE it stays put: an error the user did not see is an error that
 * did not happen, as far as they are concerned.
 */
export function TransferProgressDialog({
  title,
  rows,
  progress,
  running,
  error,
  onClose,
  onCancel
}: TransferProgressDialogProps): JSX.Element {
  const done = progress ? progress.done : rows.filter((r) => r.state === 'done').length
  const total = progress ? progress.total : rows.length
  const pct = total === 0 ? 100 : Math.round((done / total) * 100)
  const listRef = useRef<HTMLUListElement>(null)

  // Auto-dismiss, but only when there is nothing to read.
  useEffect(() => {
    if (running || error) return
    const t = setTimeout(onClose, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [running, error, onClose])

  // Keep the file being copied in view; a long folder scrolls past otherwise.
  useEffect(() => {
    const el = listRef.current?.querySelector('.transfer__row--copying')
    el?.scrollIntoView({ block: 'nearest' })
  }, [rows])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // Escape means "stop", not "hide" — a dialog dismissed mid-copy would
      // leave the transfer running with nothing reporting it.
      if (running) onCancel()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onCancel, onClose])

  return (
    <div className="transfer__backdrop" role="presentation">
      <div
        className="transfer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        aria-busy={running}
      >
        <h2 className="transfer__title" id="transfer-title">
          {title}
        </h2>

        <div
          className="transfer__bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Copy progress"
        >
          <div
            className={`transfer__bar-fill${error ? ' transfer__bar-fill--error' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Deliberately noun-free: the same dialog now reports a folder copy and
            a queue of driver installs, and "3 of 12 files" is a lie about one of
            them. The title says what is happening; this says how far in. */}
        <p className="transfer__count">
          {error ? 'Stopped' : running ? 'Working' : 'Finished'} — {done} of {total}
        </p>

        <ul className="transfer__list" ref={listRef}>
          {rows.map((row) => (
            <li
              key={row.id ?? row.label}
              className={`transfer__row transfer__row--${row.state}${
                row.indent ? ' transfer__row--sub' : ''
              }`}
            >
              <span className="transfer__tick" aria-hidden="true">
                {row.state === 'done' ? '☑' : row.state === 'error' ? '☒' : '☐'}
              </span>
              <span className="transfer__name" title={row.error ?? row.label}>
                {row.label}
              </span>
            </li>
          ))}
        </ul>

        {error && <p className="transfer__error">{error}</p>}

        <div className="transfer__actions">
          {running ? (
            <button type="button" className="transfer__btn" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <button type="button" className="transfer__btn transfer__btn--primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
