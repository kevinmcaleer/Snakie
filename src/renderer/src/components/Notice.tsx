import { useState, type JSX, type ReactNode } from 'react'
import './Notice.css'

/**
 * NOTICE — the shared compact notification row (#621).
 * =============================================================================
 *
 * Snakie grew three separate banners (instrument library, missing part imports,
 * part drivers) that each rendered their full prose as free-flowing text. Any two
 * of them showing at once ate a serious slice of the window, and the driver one
 * also listed every driver file. This is the one shape they all use instead.
 *
 * The rule that makes it compact: **the summary is a single clamped line and the
 * action sits on it.** Everything else — the full sentence, the file list — goes in
 * `detail`, behind a caret. So a notice is one row tall whether it is explaining a
 * missing import or eleven driver files, and it is actionable without expanding,
 * which was the explicit requirement: several notices, little space, still clickable.
 *
 * Two visual variants, because these appear in two very different places:
 * the default manila strip for the app chrome (above the toolbar), and `canvas`
 * for the dark Board View, whose palette is self-contained so it reads the same in
 * either theme.
 */

/** How loud the notice is — drives the accent stripe and the error styling. */
export type NoticeTone = 'info' | 'error'

/** The primary action, rendered as the notice's gold key. */
export interface NoticeAction {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

export function Notice({
  summary,
  detail,
  tone = 'info',
  variant = 'chrome',
  action,
  onDismiss,
  dismissDisabled,
  defaultExpanded = false,
  forceExpanded = false
}: {
  /** The one-line summary. Clamped — keep it short; put the prose in `detail`. */
  summary: ReactNode
  /** The full explanation, revealed by the caret. Omit for a summary-only notice. */
  detail?: ReactNode
  tone?: NoticeTone
  /** `chrome` = the manila strip above the toolbar; `canvas` = over the Board View. */
  variant?: 'chrome' | 'canvas'
  action?: NoticeAction
  onDismiss?: () => void
  dismissDisabled?: boolean
  defaultExpanded?: boolean
  /**
   * Force the detail open regardless of the user's toggle — for a failure whose
   * message is the only thing that explains what to do next, and so must not stay
   * hidden behind a collapsed row.
   */
  forceExpanded?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(defaultExpanded)
  const showDetail = !!detail && (open || forceExpanded)

  return (
    <div
      className={`notice notice--${variant}${tone === 'error' ? ' notice--error' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="notice__row">
        <span className="notice__spine" aria-hidden="true" />
        <span className="notice__summary" title={typeof summary === 'string' ? summary : undefined}>
          {summary}
        </span>
        {action && (
          <button
            type="button"
            className="notice__action"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.title}
          >
            {action.label}
          </button>
        )}
        {detail && !forceExpanded && (
          <button
            type="button"
            className="notice__toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={open ? 'Hide details' : 'Show details'}
            aria-label={open ? 'Hide details' : 'Show details'}
          >
            {open ? '▾' : '▸'}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="notice__close"
            onClick={onDismiss}
            disabled={dismissDisabled}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>
      {showDetail && <div className="notice__detail">{detail}</div>}
    </div>
  )
}

/**
 * Container for one or more {@link Notice}s. Announces politely as a group, so
 * several notices appearing at once don't each interrupt a screen reader.
 */
export function NoticeStack({ children }: { children: ReactNode }): JSX.Element {
  return <div className="notice-stack">{children}</div>
}
