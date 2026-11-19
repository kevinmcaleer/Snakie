import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { SHEET_DRAG_SLOP, sheetSizeAt, sheetSnaps, sheetSnapTarget } from './sheet-snap'
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
 * panel into a pull-up sheet on small laptops, tablets and phones: a bar you can
 * drag up and down — it settles at the top, the middle, or minimised to just
 * the bar — and Console / Board / Instruments tabs. Tapping the grip steps
 * through the same three stops. The console itself (ShellPanel) stays mounted underneath so
 * its terminal keeps its scrollback; Board and Instruments render on top of it.
 */
export function CompactSheet({
  tab,
  onTab,
  onGrip,
  onSize,
  board,
  instruments
}: {
  tab: SheetTab
  onTab: (tab: SheetTab) => void
  /** Step the sheet to its next stop (min → middle → top → min). */
  onGrip: () => void
  /** Set the sheet's size (percent of the editor + sheet column). `settle` is
   *  true for the final, snapped size when the finger lifts. */
  onSize: (size: number, settle: boolean) => void
  board: ReactNode
  instruments: ReactNode
}): JSX.Element {
  // Dragging the bar. The press may land on a tab: it only becomes a drag once
  // the finger has moved, and then the click that follows is swallowed, so a
  // tab is never switched by the end of a drag.
  const drag = useRef<{
    id: number
    y0: number
    grab: number
    column: { top: number; height: number }
    moved: boolean
    size: number
    from: number
  } | null>(null)
  const draggedAt = useRef(0)
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const bar = e.currentTarget
    const col = bar.closest('.shell__vgroup')?.getBoundingClientRect()
    if (!col) return
    drag.current = {
      id: e.pointerId,
      y0: e.clientY,
      // Hold the sheet where it was taken: the bar sits 5px below the sheet's top.
      grab: e.clientY - bar.getBoundingClientRect().top + 5,
      column: { top: col.top, height: col.height },
      moved: false,
      size: 0,
      from: 0
    }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.moved) {
      if (Math.abs(e.clientY - d.y0) < SHEET_DRAG_SLOP) return
      d.moved = true
      // Where the sheet stood when the drag began (the finger has barely moved).
      d.from = ((d.column.top + d.column.height - (d.y0 - d.grab)) / d.column.height) * 100
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    d.size = sheetSizeAt(e.clientY, d.grab, d.column, sheetSnaps(d.column.height))
    onSize(d.size, false)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.moved) return
    draggedAt.current = Date.now()
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    onSize(sheetSnapTarget(d.size, e.clientY - d.y0, sheetSnaps(d.column.height), d.from), true)
  }
  return (
    <>
      <div
        className="csheet__bar"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClickCapture={(e) => {
          if (Date.now() - draggedAt.current < 400) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        <button
          type="button"
          className="csheet__grip"
          onClick={onGrip}
          title="Drag to resize — or tap to step between minimised, half and full"
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
          <path
            d="M3 3l10 10M13 3L3 13"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
