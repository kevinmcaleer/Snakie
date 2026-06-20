import type { ReactNode } from 'react'
import './InstrumentWindow.css'

/**
 * INSTRUMENT WINDOW — the shared skeuomorphic chrome for the Oscilloscope (#101)
 * and Multimeter (#102) (and, later, the Plotter #103).
 * =============================================================================
 *
 * A fixed 404px-wide floating instrument window: a 34px dark title bar (3-line
 * drag grip · instrument name · a green source pill · dock-to-side + close keys)
 * over a body slot the specific instrument fills. The colours/measurements come
 * straight from the design handoff's `Board View (clean).dc.html`.
 *
 * The component renders ONLY the window itself; the **placement** (docked in the
 * INSTRUMENT DOCK rail vs. floated as an overlay) is decided by the host
 * (BoardGraph) from the available width and expressed via {@link InstrumentDock}
 * / {@link InstrumentOverlay}. Same markup in both — only the wrapper changes,
 * exactly as the handoff specifies.
 */

export interface InstrumentWindowProps {
  /** Instrument name shown in the title bar (e.g. `OSCILLOSCOPE`). */
  name: string
  /** The green source pill text (e.g. `GP13 led_status`). */
  source: string
  /** The instrument body (screen + controls). */
  children: ReactNode
  /** Toggle dock ⟷ overlay placement (the dock-to-side key). */
  onToggleDock?: () => void
  /** Whether the window is currently docked (drives the dock key tooltip). */
  docked?: boolean
  /** Close this instrument window. */
  onClose?: () => void
}

/** The shared 404px window with its title bar. */
export function InstrumentWindow({
  name,
  source,
  children,
  onToggleDock,
  docked = true,
  onClose
}: InstrumentWindowProps): JSX.Element {
  return (
    <section className="instr" aria-label={`${name} instrument`}>
      <header className="instr__bar">
        <span className="instr__grip" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="instr__name">{name}</span>
        <span className="instr__source" title={`Source: ${source}`}>
          {source}
        </span>
        <span className="instr__keys">
          {onToggleDock && (
            <button
              type="button"
              className="instr__key"
              onClick={onToggleDock}
              title={docked ? 'Float as overlay' : 'Dock to side'}
              aria-label={docked ? 'Float as overlay' : 'Dock to side'}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <line x1="14" y1="4" x2="14" y2="20" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="instr__key"
              onClick={onClose}
              title="Close"
              aria-label={`Close ${name}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.2" />
              </svg>
            </button>
          )}
        </span>
      </header>
      <div className="instr__body">{children}</div>
    </section>
  )
}

/**
 * A reusable green-phosphor screen wrapper: the CRT bezel + the green screen
 * base treatment (radial vignette base, scanline overlay, vignette, top specular
 * gloss). The instrument drops its own SVG / readouts inside as `children`.
 */
export function PhosphorScreen({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className="instr__bezel">
      <div className={`instr__screen ${className ?? ''}`}>
        {children}
        <div className="instr__scanlines" aria-hidden="true" />
        <div className="instr__vignette" aria-hidden="true" />
        <div className="instr__gloss" aria-hidden="true" />
      </div>
    </div>
  )
}

/**
 * The INSTRUMENT DOCK rail (large screens): a fixed 436px column on the right of
 * the board canvas, instruments stacked top-to-bottom with a small engraved
 * header. Rendered only when at least one instrument is open.
 */
export function InstrumentDock({ children }: { children: ReactNode }): JSX.Element {
  return (
    <aside className="instr-dock" aria-label="Instrument dock">
      <div className="instr-dock__head">
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1="14" y1="4" x2="14" y2="20" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        INSTRUMENT DOCK
      </div>
      <div className="instr-dock__stack">{children}</div>
    </aside>
  )
}

/**
 * The OVERLAY placement (small board windows): the instruments float centred
 * over the canvas above a dim scrim. Clicking the scrim closes whatever the host
 * wires to `onScrim` (typically: close all overlay instruments).
 */
export function InstrumentOverlay({
  children,
  onScrim
}: {
  children: ReactNode
  onScrim?: () => void
}): JSX.Element {
  return (
    <div className="instr-overlay" role="dialog" aria-label="Instruments">
      <button
        type="button"
        className="instr-overlay__scrim"
        aria-label="Dismiss instruments"
        tabIndex={-1}
        onClick={onScrim}
      />
      <div className="instr-overlay__stack">{children}</div>
    </div>
  )
}

/**
 * A recessed green "source selector" slot (the amber-dot · mono-text · ▾ pill
 * shared by the scope + meter below their screen). A button so it can open a
 * dropdown; the caller supplies the dropdown menu via `menu` (rendered when
 * `open`).
 */
export function SourceSlot({
  label,
  open,
  onToggle,
  menu,
  className
}: {
  label: ReactNode
  open?: boolean
  onToggle?: () => void
  menu?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={`instr__source-wrap ${className ?? ''}`}>
      <button
        type="button"
        className="instr__slot"
        onClick={onToggle}
        aria-haspopup="listbox"
        aria-expanded={open ?? false}
        title="Choose the source pin"
      >
        <span className="instr__slot-dot" aria-hidden="true" />
        <span className="instr__slot-text">{label}</span>
        <span className="instr__slot-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && menu && (
        <ul className="instr__menu" role="listbox" aria-label="Source pins">
          {menu}
        </ul>
      )}
    </div>
  )
}
