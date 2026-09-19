/**
 * THE SIMULATED-DEVICE NOTICE (#1163) — pure rules.
 * =============================================================================
 *
 * Snakie connects its built-in simulator for you a moment after the web build
 * loads (#267), so Run works without anyone finding the Connect control first.
 * That is the right default and it has one cost: the port dropdown is DISABLED
 * while a device is connected, so a user who then plugs in a real Pico finds a
 * greyed-out list with "Simulated device (offline)" in it and no obvious way
 * out. The board is in their hand and the app looks like it cannot see it.
 *
 * The fix is to say so, above the dropdown, at the moment it is true: you are
 * on the simulator, press Disconnect to choose a real board. Dismissible, and
 * the dismissal sticks — this is a first-run explanation, not a warning that
 * earns its place on screen every session.
 *
 * Pure + storage-injected so the rule is a unit test rather than something you
 * find out by loading the web build with a board plugged in.
 */
import { isVirtualPort } from '../../../shared/virtual-device'

/** Where the dismissal persists (same `localStorage` as the layout store). */
export const SIM_NOTICE_KEY = 'snakie.device.simNoticeDismissed'

/** What the rule needs to know: the live connection, and the stored dismissal. */
export interface SimNoticeInput {
  /** The device layer's state (`connected`, `connecting`, `disconnected`, …). */
  state: string
  /** The connected port's path, if any. */
  path?: string | null
  /** Has the user dismissed the notice before (this session or an earlier one)? */
  dismissed: boolean
}

/**
 * Should the notice be on screen?
 *
 * Only while the simulator is actually CONNECTED. Selecting it in the list is
 * not the confusing state — the list is still yours to change then — and a
 * notice that appeared merely because the sim was highlighted would fire on
 * every fresh load of the desktop build, where nothing has been connected at
 * all.
 */
export function shouldShowSimNotice({ state, path, dismissed }: SimNoticeInput): boolean {
  if (dismissed) return false
  return state === 'connected' && isVirtualPort(path)
}
