import { useEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { VIRTUAL_PORT_SHORT } from '../../../shared/virtual-device'
import './SimulatedDeviceNotice.css'

/** Where the callout sits in the viewport, measured from its anchor. */
interface Placement {
  left: number
  bottom: number
}

/**
 * Measure `anchor` and keep the callout pinned just above it.
 *
 * The callout is `position: fixed` rather than absolute, because the console
 * header it belongs to lives inside a resizable Panel that CLIPS its overflow —
 * an absolutely-positioned notice reaching above the header is simply not
 * painted (the same reason the memory dialog beside it is fixed). Fixed escapes
 * the clip and costs a measurement, which is this hook.
 *
 * Re-measured on a window resize and on a console drag: the panel's own resize
 * moves the header vertically without changing the control's size, so watching
 * the anchor alone would leave the callout behind.
 */
function useAnchoredAbove(
  anchor: RefObject<HTMLElement> | undefined,
  self: RefObject<HTMLElement>
): Placement | null {
  const [place, setPlace] = useState<Placement | null>(null)
  useEffect(() => {
    const el = anchor?.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      // Clamped to the viewport: the control sits in a panel whose left edge
      // moves with the sidebar, so on a narrow window an unclamped `left` would
      // hang the callout off the right of the screen.
      const w = self.current?.offsetWidth ?? 0
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8))
      setPlace({ left, bottom: Math.round(window.innerHeight - r.top) + 10 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const panel = el.closest('.region--shell')
    if (panel) ro.observe(panel)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [anchor, self])
  return place
}

/**
 * THE SIMULATED-DEVICE NOTICE (#1163) — a callout above the port dropdown.
 * =============================================================================
 *
 * Anchored to the connection control and pointing down at it, because that is
 * the control the message is about: the dropdown showing "Simulated device
 * (offline)" and refusing to open. It says the two things the user needs —
 * this is Snakie's built-in board, and Disconnect is how you get to yours —
 * and offers Disconnect as the action rather than describing it.
 *
 * Presentational: when it shows, and whether it has been dismissed, is
 * {@link ../components/sim-notice shouldShowSimNotice}'s business.
 */
export function SimulatedDeviceNotice({
  onDisconnect,
  onDismiss,
  anchor,
  busy = false
}: {
  /** Disconnect the simulator, freeing the dropdown to pick a real board. */
  onDisconnect: () => void
  /** Dismiss for good (persisted by the caller). */
  onDismiss: () => void
  /** The control to sit above — the connection control's own wrapper. */
  anchor?: RefObject<HTMLElement>
  /** A connect/disconnect is in flight — the action would race it. */
  busy?: boolean
}): JSX.Element {
  const self = useRef<HTMLDivElement>(null)
  const place = useAnchoredAbove(anchor, self)
  return (
    <div
      ref={self}
      className="sim-notice"
      role="status"
      aria-live="polite"
      // Hidden for the one frame before the anchor is measured, rather than
      // painted at the viewport's default position and then jumping.
      style={place ? { left: place.left, bottom: place.bottom } : { visibility: 'hidden' }}
    >
      <button
        type="button"
        className="sim-notice__close"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss this notice"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <p className="sim-notice__title">You’re on the {VIRTUAL_PORT_SHORT.toLowerCase()}</p>
      <p className="sim-notice__body">
        Snakie connected its built-in offline board so you can run Python straight away. To use a
        real board, press <strong>Disconnect</strong> first — the port list below is locked while a
        device is connected.
      </p>
      <div className="sim-notice__actions">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={onDisconnect}
          disabled={busy}
        >
          Disconnect
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onDismiss}>
          Got it
        </button>
      </div>
      <span className="sim-notice__tail" aria-hidden="true" />
    </div>
  )
}
