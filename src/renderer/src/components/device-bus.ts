/**
 * THE DEVICE ACTIONS, ADDRESSED BY NAME (#918, epic #913).
 * =============================================================================
 *
 * Run, Stop, Connect and Disconnect are on the Device menu now, and every one of
 * them already had an owner: `Toolbar` runs and stops, `ConnectionControl`
 * connects and disconnects. The menu has to reach THOSE, not reimplement them.
 *
 * Run is the reason this is a bus rather than four calls. `Toolbar.handleRun` is
 * forty lines of decisions — is a board already connected, was one connected
 * before, is the port that vanished the one we were on, should this fall back to
 * the simulator or say so out loud — and #871 turns on it doing a soft reboot so
 * `boot.py` runs again. A second Run that skipped any of that would be a
 * different Run wearing the same word, and the difference would only show up on
 * someone's desk with a board that had browned out.
 *
 * Connect and Disconnect are addressed SEPARATELY rather than as a toggle, even
 * though `ConnectionControl` implements them as one: a menu says what it will do
 * before you choose it, so "Disconnect" has to mean disconnect even if the state
 * changed between the menu opening and the click.
 *
 * Soft reset and Sync now are NOT here — they are one API call and one store
 * call respectively, with no component state behind them, so the menu makes them
 * directly rather than routing a message to somebody who would do the same.
 */

/** A device action a menu item can ask for. */
export type DeviceAction = 'run' | 'stop' | 'connect' | 'disconnect'

export const DEVICE_ACTION_EVENT = 'snakie:device-action'

export interface DeviceActionDetail {
  action: DeviceAction
}

/** Ask whoever owns `action` to perform it. */
export function dispatchDeviceAction(action: DeviceAction): void {
  window.dispatchEvent(
    new CustomEvent<DeviceActionDetail>(DEVICE_ACTION_EVENT, { detail: { action } })
  )
}

/**
 * Listen for one action. Returns the unsubscribe.
 *
 * Per-action rather than one listener with a switch, so a component subscribes
 * to exactly what it owns and two components cannot quietly both answer for Run.
 */
export function onDeviceAction(action: DeviceAction, run: () => void): () => void {
  const handler = (e: Event): void => {
    if ((e as CustomEvent<DeviceActionDetail>).detail?.action === action) run()
  }
  window.addEventListener(DEVICE_ACTION_EVENT, handler)
  return () => window.removeEventListener(DEVICE_ACTION_EVENT, handler)
}
