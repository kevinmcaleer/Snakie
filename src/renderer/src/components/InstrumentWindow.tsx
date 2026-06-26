import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { clampOffset, type Offset } from './instrument-host'
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
  /**
   * Whether the GLOBAL instrument live-poll is on. When set (not `undefined`),
   * a LIVE toggle is rendered in the title bar reflecting this state — lit/green
   * when on, grey when off. Live reads enter the raw REPL and INTERRUPT a running
   * program, so the control is the user's way to start/stop the polling.
   */
  live?: boolean
  /**
   * Flip the global live-poll. The poll is one batched probe shared by ALL open
   * instruments, so toggling here affects every instrument's polling (and the
   * status-bar warning makes that global effect clear). Only rendered when
   * `live` is provided.
   */
  onToggleLive?: () => void
  /** Toggle dock ⟷ overlay placement (the dock-to-side key). */
  onToggleDock?: () => void
  /** Whether the window is currently docked (drives the dock key tooltip). */
  docked?: boolean
  /** Close this instrument window. */
  onClose?: () => void
  /**
   * Start a drag from the title bar (pointer-capture). When set, the title bar
   * shows a move cursor and the grip is the drag handle — used by the floating
   * placement in the main window ({@link InstrumentFloat}).
   */
  onTitlePointerDown?: (e: ReactPointerEvent<HTMLElement>) => void
  onTitlePointerMove?: (e: ReactPointerEvent<HTMLElement>) => void
  onTitlePointerUp?: (e: ReactPointerEvent<HTMLElement>) => void
  /** Extra class on the root (e.g. `instr--floating`). */
  className?: string
  /** Absolute-position style applied to the root (floating placement). */
  style?: CSSProperties
}

/** The shared 404px window with its title bar. */
export function InstrumentWindow({
  name,
  source,
  children,
  live,
  onToggleLive,
  onToggleDock,
  docked = true,
  onClose,
  onTitlePointerDown,
  onTitlePointerMove,
  onTitlePointerUp,
  className,
  style
}: InstrumentWindowProps): JSX.Element {
  const draggable = !!onTitlePointerDown
  return (
    <section className={`instr ${className ?? ''}`} aria-label={`${name} instrument`} style={style}>
      <header
        className={`instr__bar ${draggable ? 'instr__bar--drag' : ''}`}
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerUp}
      >
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
          {live !== undefined && (
            <button
              type="button"
              className={`instr__key instr__live ${live ? 'instr__live--on' : ''}`}
              onClick={onToggleLive}
              aria-pressed={live}
              title={
                live
                  ? 'LIVE on — live reads interrupt a running program. Click to stop polling.'
                  : 'LIVE off — instruments show static readings. Click to start live polling (interrupts a running program).'
              }
              aria-label={live ? 'Stop live polling' : 'Start live polling'}
            >
              <span className="instr__live-dot" aria-hidden="true" />
              LIVE
            </button>
          )}
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
 * The set of props a draggable {@link InstrumentWindow} needs to be positioned +
 * dragged: the title-bar pointer handlers and the absolute-position style/class.
 * Spread straight onto an `<Oscilloscope>` / `<Multimeter>` (they forward these
 * to {@link InstrumentWindow}).
 */
export interface FloatProps {
  className: string
  style: CSSProperties
  onTitlePointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onTitlePointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onTitlePointerUp: (e: ReactPointerEvent<HTMLElement>) => void
}

/**
 * Per-window drag state for the FLOATING placement (#98 pattern, mirrors
 * FindReplace): a pointer-capture drag by the title-bar grip translates the
 * window by an (x, y) offset, clamped on-screen against the host box.
 *
 * `initial` seeds the cascade start (so stacked windows don't overlap);
 * `getHostSize` returns the live host box so the clamp tracks editor resizes.
 * Returns the {@link FloatProps} to spread onto the instrument.
 */
export function useFloatPlacement(
  initial: Offset,
  getHostSize: () => { w: number; h: number }
): FloatProps {
  const [offset, setOffset] = useState<Offset>(initial)
  // Live drag bookkeeping kept in a ref so the move handler doesn't re-bind.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  )

  const onTitlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      // Let the dock/close keys take their click — don't start a drag from them.
      if ((e.target as HTMLElement).closest('.instr__key')) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y }
    },
    [offset]
  )

  const onTitlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      const drag = dragRef.current
      if (!drag) return
      const { w, h } = getHostSize()
      setOffset(
        clampOffset(
          { x: drag.baseX + (e.clientX - drag.startX), y: drag.baseY + (e.clientY - drag.startY) },
          w,
          h
        )
      )
    },
    [getHostSize]
  )

  const onTitlePointerUp = useCallback((e: ReactPointerEvent<HTMLElement>): void => {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  return {
    className: 'instr--floating',
    style: { left: offset.x, top: offset.y },
    onTitlePointerDown,
    onTitlePointerMove,
    onTitlePointerUp
  }
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
 * One icon-only instrument toggle (16×21, radius 6) per the Board View handoff.
 * Active = accent border + accent icon + a faint fill + inset top highlight;
 * inactive = sunken `#15171a`/`#26282b`/`#4a4f57`. The accent/border come from
 * the registry def via the `--toggle-accent` / `--toggle-accent-border` custom
 * props. `inUse` adds a small accent dot so an instrument the code declares is
 * visually distinguished from the merely-available ones. Visibility ONLY —
 * orthogonal to a window's docked/undocked state.
 */
export function InstrumentToggle({
  id,
  name,
  accent,
  border,
  icon,
  active,
  inUse,
  onToggle
}: {
  id: string
  name: string
  accent: string
  border: string
  /** Inline SVG path `d` string (drawn at 24×24). */
  icon: string
  active: boolean
  inUse?: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`instr-dock__toggle${active ? ' instr-dock__toggle--active' : ''}${
        inUse ? ' instr-dock__toggle--inuse' : ''
      }`}
      style={
        {
          '--toggle-accent': accent,
          '--toggle-accent-border': border
        } as CSSProperties
      }
      aria-pressed={active}
      onClick={onToggle}
      title={`${active ? 'Hide' : 'Show'} ${name}${inUse ? ' (used by this file)' : ''}`}
      aria-label={`${active ? 'Hide' : 'Show'} ${name}`}
      data-instrument={id}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d={icon}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {inUse && <span className="instr-dock__toggle-dot" aria-hidden="true" />}
    </button>
  )
}

/**
 * One engraved group of icon-only toggles (`INPUTS` / `OUTPUTS`). The label is a
 * small engraved caption; the row wraps so 13+ instruments stay readable in the
 * narrow dock. `children` are {@link InstrumentToggle}s.
 */
export function InstrumentToggleGroup({
  label,
  children
}: {
  label: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="instr-dock__group" role="group" aria-label={`${label} instruments`}>
      <span className="instr-dock__group-label">{label}</span>
      <div className="instr-dock__group-row">{children}</div>
    </div>
  )
}

/**
 * The `+ Add instrument` palette button — sits at the end of the header rows.
 * Opens the grouped catalogue ({@link InstrumentDockRegion} renders the popover);
 * this is just the trigger so the chrome stays in `InstrumentWindow`.
 */
export function AddInstrumentButton({
  open,
  onClick
}: {
  open: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`instr-dock__add${open ? ' instr-dock__add--open' : ''}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={onClick}
      title="Add an instrument"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 5 V19 M5 12 H19" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span>Add</span>
    </button>
  )
}

/**
 * The INSTRUMENT DOCK rail: a column on the right of the main window (the
 * rightmost panel, right of the chat). The `header` slot carries the engraved
 * `INSTRUMENT DOCK` title + the grouped toggle rows + the Add-instrument palette
 * (built by {@link InstrumentDockRegion} off the registry); `children` are the
 * stacked instrument windows.
 */
export function InstrumentDock({
  header,
  children,
  top
}: {
  header: ReactNode
  children: ReactNode
  /** Pinned content above the header row (e.g. the mini board view, #168). */
  top?: ReactNode
}): JSX.Element {
  return (
    <aside className="instr-dock" aria-label="Instrument dock">
      {top}
      <div className="instr-dock__head">
        <span className="instr-dock__title">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <line x1="14" y1="4" x2="14" y2="20" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          INSTRUMENT DOCK
        </span>
        {header}
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
