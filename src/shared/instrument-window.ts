/**
 * Shared identity for a DETACHED instrument OS window (issue #205).
 * =============================================================================
 *
 * When the user undocks an instrument it is no longer an in-renderer floating
 * overlay — it opens as a true, natively-resizable OS `BrowserWindow` (the
 * board.ts / find.ts precedent). The main process opens one window per
 * instrument keyed by {@link InstrumentWindowPayload.key}, buffers the payload so
 * the freshly-opened window can pull it on mount, and relays the live device
 * stream to it. This module is dependency-free so main, preload and both
 * renderers can agree on the payload shape.
 */

/** The parsed connection an instrument renders from (a structural copy of the
 *  renderer's `UsedPins`, kept here so this module needs no renderer imports). */
export interface InstrumentWindowConn {
  type: string
  pins: string[]
  variable: string
  constructor: string
  instrument?: string
  roles?: string[]
  bus?: number
}

/** Everything a detached instrument window needs to render itself. */
export interface InstrumentWindowPayload {
  /** Unique window id, e.g. `scope:pwm0`, `meter:adc0`, `singleton:imu`. */
  key: string
  /** Which family of instrument to render. */
  kind: 'scope' | 'meter' | 'singleton'
  /** Registry id for a singleton instrument (imu/range/led/…). */
  defId?: string
  /** The parsed connection for a scope/meter. */
  conn?: InstrumentWindowConn
  /** Window title (the instrument name). */
  title: string
}
