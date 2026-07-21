import type { ReactNode } from 'react'
import './CollapsiblePanel.css'

/**
 * SOFT SHELL COLLAPSIBLE PANEL (#577, epic #573) — the one collapsible-panel
 * primitive the workspaces share, so every panel owns its OWN collapse control
 * (a chevron in its own header) and a control never means different things in
 * different workspaces.
 *
 * Controlled: the caller owns `open` + `onToggle` (persist it however it likes —
 * the layout store, localStorage, component state). The toggle is a real button
 * with `aria-expanded`; header `actions` sit BESIDE it (never nested in it, so
 * the markup stays valid).
 *
 * `keepMounted` keeps the body in the tree (hidden) when collapsed, for panels
 * whose contents must survive a collapse — a terminal's scrollback, a live
 * plotter. Otherwise the body unmounts.
 */
export interface CollapsiblePanelProps {
  title: string
  open: boolean
  onToggle: () => void
  /** A count / status shown after the title (e.g. an item count). */
  badge?: ReactNode
  /** Header actions (icon buttons), right-aligned, shown only when open. */
  actions?: ReactNode
  /** Keep the body mounted (hidden) when collapsed, to preserve its state. */
  keepMounted?: boolean
  /** Extra class on the panel root. */
  className?: string
  /** Extra class on the body wrapper (e.g. a list layout). */
  bodyClassName?: string
  children: ReactNode
}

export function CollapsiblePanel({
  title,
  open,
  onToggle,
  badge,
  actions,
  keepMounted = false,
  className,
  bodyClassName,
  children
}: CollapsiblePanelProps): JSX.Element {
  const renderBody = open || keepMounted
  return (
    <div className={`cpanel${open ? '' : ' cpanel--collapsed'}${className ? ` ${className}` : ''}`}>
      <div className="cpanel__head">
        <button
          type="button"
          className="cpanel__toggle"
          aria-expanded={open}
          onClick={onToggle}
          title={open ? `Hide ${title}` : `Show ${title}`}
        >
          <span className="cpanel__chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="cpanel__title">{title}</span>
          {badge != null && <span className="cpanel__badge">{badge}</span>}
        </button>
        {open && actions && <div className="cpanel__actions">{actions}</div>}
      </div>
      {renderBody && (
        <div
          className={`cpanel__body${open ? '' : ' cpanel__body--hidden'}${
            bodyClassName ? ` ${bodyClassName}` : ''
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
