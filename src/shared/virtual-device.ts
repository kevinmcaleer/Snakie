/**
 * VIRTUAL (SIMULATED) DEVICE — shared identity for Snakie's offline mode (#135).
 * =============================================================================
 *
 * Snakie can target a SIMULATED MicroPython device when no hardware is plugged
 * in, so the instruments and the Board Viewer Live View work offline (for
 * learning, demos and development). The simulated device is presented in the
 * shell's port dropdown like any other port, identified by a reserved sentinel
 * "path" that can never collide with a real OS serial path (`/dev/…`, `COM3`,
 * etc.) because of the `snakie://` scheme.
 *
 * This module is dependency-free so every layer can agree on the identity:
 *  - the MAIN process routes `device:connect` to the simulator for this path,
 *  - `device:listPorts` injects it as a selectable port,
 *  - the RENDERER labels it cleanly and shows an "offline / simulated" badge.
 */

/** Reserved sentinel "port path" for the built-in simulated device. */
export const VIRTUAL_PORT_PATH = 'snakie://virtual'

/** Friendly label shown for the simulated device in the port dropdown. */
export const VIRTUAL_PORT_LABEL = 'Simulated device (offline)'

/** Short label for compact UI (status bar badge, etc.). */
export const VIRTUAL_PORT_SHORT = 'Simulated device'

/** Is `path` the reserved simulated-device sentinel? */
export function isVirtualPort(path: string | undefined | null): boolean {
  return path === VIRTUAL_PORT_PATH
}
