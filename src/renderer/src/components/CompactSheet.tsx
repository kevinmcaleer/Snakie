import type { ReactNode } from 'react'
import './CompactSheet.css'

/** The pull-up sheet's three tabs on small screens. */
export type SheetTab = 'console' | 'board' | 'instruments'

const TABS: { id: SheetTab; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'board', label: 'Board' },
  { id: 'instruments', label: 'Instruments' }
]

/**
 * COMPACT SHEET (small-screen layout C) — the chrome that turns the console
 * panel into a pull-up sheet on small laptops, tablets and phones: a grip that
 * snaps the sheet between half and nearly-full height, and Console / Board /
 * Instruments tabs. The console itself (ShellPanel) stays mounted underneath so
 * its terminal keeps its scrollback; Board and Instruments render on top of it.
 */
export function CompactSheet({
  tab,
  onTab,
  onGrip,
  board,
  instruments
}: {
  tab: SheetTab
  onTab: (tab: SheetTab) => void
  /** Snap the sheet to its next height (half ↔ tall). */
  onGrip: () => void
  board: ReactNode
  instruments: ReactNode
}): JSX.Element {
  return (
    <>
      <div className="csheet__bar">
        <button
          type="button"
          className="csheet__grip"
          onClick={onGrip}
          title="Resize the sheet"
          aria-label="Resize the sheet"
        >
          <span aria-hidden="true" />
        </button>
        <div className="csheet__tabs" role="tablist" aria-label="Sheet">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`csheet__tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab !== 'console' && (
        <div className="csheet__pane" role="tabpanel">
          {tab === 'board' ? board : instruments}
        </div>
      )}
    </>
  )
}

/**
 * The floating mini board (picture-in-picture) over the editor on small screens.
 * A peek only: tapping it opens the sheet's Board tab, × hides it.
 */
export function BoardPip({
  onOpen,
  onHide,
  children
}: {
  onOpen: () => void
  onHide: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div className="csheet-pip">
      <div className="csheet-pip__view" aria-hidden="true">
        {children}
      </div>
      <button
        type="button"
        className="csheet-pip__open"
        onClick={onOpen}
        title="Show the board"
        aria-label="Show the board"
      />
      <button
        type="button"
        className="csheet-pip__hide"
        onClick={onHide}
        title="Hide the floating board"
        aria-label="Hide the floating board"
      >
        <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
