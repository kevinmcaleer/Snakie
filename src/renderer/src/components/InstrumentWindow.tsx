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

/** Per-kind dock visibility flags (the SCOPE/METER/PLOT toggle row). */
export interface DockVisibility {
  scope: boolean
  meter: boolean
  plotter: boolean
}

/**
 * The dock-header visibility toggle row: three pill buttons (SCOPE · METER ·
 * PLOT) pushed to the right of the `INSTRUMENT DOCK` label. Each flips its
 * kind's `visible` flag — visibility ONLY, orthogonal to docked/undocked state.
 * Defaults to all-on (handled by the caller's default state).
 *
 * Active = accent border + accent text/icon + a faint fill + inset top
 * highlight; inactive = sunken `#15171a`/`#26282b`/`#4a4f57`. Each kind carries
 * its own accent (scope green, meter teal, plot blue) matching the node
 * launchers, applied via the `--accent` / `--accent-border` custom props.
 */
const TOGGLE_META: Record<
  keyof DockVisibility,
  { label: string; accent: string; accentBorder: string; icon: ReactNode }
> = {
  scope: {
    label: 'SCOPE',
    accent: '#86ffb6',
    accentBorder: 'rgba(82,224,138,.45)',
    // square wave — same as the PWM-node scope launcher
    icon: (
      <path
        d="M3 15 L3 9 L8 9 L8 15 L13 15 L13 9 L18 9 L18 15 L21 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    )
  },
  meter: {
    label: 'METER',
    accent: '#5fe0c8',
    accentBorder: 'rgba(70,214,187,.45)',
    // gauge + needle — same as the ADC-node meter launcher
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 18 A9 9 0 0 1 20 18" />
        <line x1="12" y1="18" x2="16.6" y2="12.4" />
        <circle cx="12" cy="18" r="1.7" fill="currentColor" stroke="none" />
      </g>
    )
  },
  plotter: {
    label: 'PLOT',
    accent: '#7fc4f0',
    accentBorder: 'rgba(95,184,240,.45)',
    // trend line
    icon: (
      <path
        d="M3 17 L9 11 L13 14.5 L21 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    )
  }
}

function DockToggleRow({
  vis,
  onToggleVisible
}: {
  vis: DockVisibility
  onToggleVisible: (kind: keyof DockVisibility) => void
}): JSX.Element {
  return (
    <div className="instr-dock__toggles" role="group" aria-label="Instrument visibility">
      {(Object.keys(TOGGLE_META) as Array<keyof DockVisibility>).map((kind) => {
        const meta = TOGGLE_META[kind]
        const active = vis[kind]
        return (
          <button
            key={kind}
            type="button"
            className={`instr-dock__toggle${active ? ' instr-dock__toggle--active' : ''}`}
            style={
              {
                '--toggle-accent': meta.accent,
                '--toggle-accent-border': meta.accentBorder
              } as CSSProperties
            }
            aria-pressed={active}
            onClick={() => onToggleVisible(kind)}
            title={`${active ? 'Hide' : 'Show'} ${meta.label} in the dock`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {meta.icon}
            </svg>
            <span>{meta.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The INSTRUMENT DOCK rail: a fixed 436px column on the right of the main
 * window (now the rightmost panel, right of the chat). Instruments stacked
 * top-to-bottom under a small engraved header that carries the SCOPE/METER/PLOT
 * visibility toggle row.
 */
export function InstrumentDock({
  vis,
  onToggleVisible,
  children
}: {
  vis: DockVisibility
  onToggleVisible: (kind: keyof DockVisibility) => void
  children: ReactNode
}): JSX.Element {
  return (
    <aside className="instr-dock" aria-label="Instrument dock">
      <div className="instr-dock__head">
        <span className="instr-dock__title">
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <line x1="14" y1="4" x2="14" y2="20" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          INSTRUMENT DOCK
        </span>
        <DockToggleRow vis={vis} onToggleVisible={onToggleVisible} />
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
