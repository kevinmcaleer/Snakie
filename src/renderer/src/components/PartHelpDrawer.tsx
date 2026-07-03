import { useEffect, useRef, type JSX } from 'react'
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
 * inside each part). Opened from the header Help button (whole list) or a part's
 * mini-toolbar help button, which focuses that part's card via `focusKey` (#207).
 */
export function PartHelpDrawer({
  items,
  focusKey,
  onClose
}: {
  items: PartHelpItem[]
  /** A `lib:part` key to open + scroll to; null opens the first card. */
  focusKey?: string | null
  onClose: () => void
}): JSX.Element {
  const focusedRef = useRef<HTMLDetailsElement | null>(null)
  // Bring the focused card into view whenever the focus target changes.
  useEffect(() => {
    if (focusKey && focusedRef.current) focusedRef.current.scrollIntoView({ block: 'nearest' })
  }, [focusKey])

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
          items.map((it, i) => {
            // Open the focused card (or the first when nothing's focused).
            const isFocused = focusKey ? it.key === focusKey : false
            const open = focusKey ? isFocused : i === 0
            return (
              <details
                key={it.key}
                ref={isFocused ? focusedRef : undefined}
                className="bg-help__card"
                open={open}
              >
                <summary className="bg-help__card-summary">{it.name}</summary>
                <Markdown source={it.helpText} className="bg-help__md" />
              </details>
            )
          })
        )}
      </div>
    </aside>
  )
}
