import type { JSX } from 'react'
import { Markdown } from './Markdown'
import './PartHelpDrawer.css'

/** One placed part's bundled mini-help, stacked in the Board View help drawer. */
export interface PartHelpItem {
  /** Stable key (`lib:part`) so identical parts collapse to one card. */
  key: string
  name: string
  helpText: string
}

/**
 * The Board View's HELP panel: a right-side drawer stacking the bundled mini-help
 * of every unique placed part as collapsed markdown cards (offline — the help ships
 * inside each part). Opened from the header Help button or the "help available"
 * notification shown when a part with help is placed.
 */
export function PartHelpDrawer({ items, onClose }: { items: PartHelpItem[]; onClose: () => void }): JSX.Element {
  return (
    <aside className="bg-help" aria-label="Part help">
      <div className="bg-help__head">
        <span className="bg-help__title">Help</span>
        <button type="button" className="bg-help__close" onClick={onClose} title="Close help" aria-label="Close help">
          ✕
        </button>
      </div>
      <div className="bg-help__body">
        {items.length === 0 ? (
          <p className="bg-help__empty">
            No help yet. Place a part that ships a mini-help (or add one in the Part Editor) to see it here.
          </p>
        ) : (
          items.map((it, i) => (
            <details key={it.key} className="bg-help__card" open={i === 0}>
              <summary className="bg-help__card-summary">{it.name}</summary>
              <Markdown source={it.helpText} className="bg-help__md" />
            </details>
          ))
        )}
      </div>
    </aside>
  )
}
