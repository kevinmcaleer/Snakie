/**
 * Web Serial port picker (issue #283, epic #267 Phase W2).
 *
 * Two entry points, matching the epic's classroom UX goal:
 *
 *  - {@link requestSnakiePort} — the user-gesture-driven path
 *    (`navigator.serial.requestPort()`), filtered to the known MicroPython
 *    board VID/PIDs (`shared/usb-bridges.ts`) so the browser's picker dialog
 *    only lists relevant devices. Must be called from a click handler (or
 *    other user-activation event) — Web Serial's security model requires it.
 *
 *  - {@link getGrantedPorts} — the zero-prompt fast path
 *    (`navigator.serial.getPorts()`). Returns ports the user (or, on a
 *    managed Chromebook, the `SerialAllowUsbDevicesForUrls` enterprise
 *    policy — see docs/web-serial-classroom-policy.md) has already granted
 *    to this origin. A classroom app should try this FIRST on load/connect
 *    and only fall back to {@link requestSnakiePort} if it comes back empty,
 *    so pre-provisioned students never see a permission prompt.
 *
 * {@link describePort} turns a granted `SerialPort` into a friendly label the
 * same way `PortInfo.friendlyName` does on the Electron side, reusing the
 * exact same VID/PID table so the label a student sees matches the id an IT
 * admin allowlisted.
 */
import { matchUsbBridge, USB_SERIAL_BRIDGES } from '../shared/usb-bridges'

/** Zero-pad a number to a 4-digit lowercase hex string (matches `PortInfo`'s VID/PID format). */
function toHex4(n: number): string {
  return n.toString(16).padStart(4, '0')
}

/**
 * Build the `SerialPortFilter[]` for `navigator.serial.requestPort()` from
 * the shared USB bridge table, so the browser's device picker only shows
 * boards Snakie actually knows how to talk to.
 */
export function getSerialFilters(): SerialPortFilter[] {
  return USB_SERIAL_BRIDGES.map((entry) => {
    const filter: SerialPortFilter = { usbVendorId: parseInt(entry.vid, 16) }
    if (entry.pid) filter.usbProductId = parseInt(entry.pid, 16)
    return filter
  })
}

/**
 * Prompt the user to pick a serial port, filtered to known MicroPython
 * boards. Must be called synchronously from a user gesture (e.g. a button
 * click) — throws `DOMException` ("NotAllowedError" or the user cancelling
 * the picker with "NotFoundError") otherwise, which callers should catch and
 * surface as "no device selected" rather than a hard error.
 */
export async function requestSnakiePort(): Promise<SerialPort> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial is not supported in this browser')
  }
  return navigator.serial.requestPort({ filters: getSerialFilters() })
}

/**
 * List ports already granted to this origin — no user gesture, no prompt.
 * The classroom fast-path: pre-provisioned Chromebooks (via
 * `SerialAllowUsbDevicesForUrls`) and returning users land here directly.
 */
export async function getGrantedPorts(): Promise<SerialPort[]> {
  if (!('serial' in navigator)) return []
  return navigator.serial.getPorts()
}

/** A human-friendly description of a granted port, when we can identify it. */
export interface PortDescription {
  /** e.g. "Raspberry Pi Pico (MicroPython native USB)" or "CP210x" — the best guess. */
  label: string
  /** Lowercase hex VID, e.g. `2e8a`, when the port info exposes one. */
  vendorId?: string
  /** Lowercase hex PID, e.g. `0005`, when the port info exposes one. */
  productId?: string
  /** True when the VID/PID matched a known entry in the bridge table. */
  recognized: boolean
}

/**
 * Describe a `SerialPort` for display in a port list, reusing the shared
 * VID/PID table so the label matches what firmware detection (Electron) and
 * the classroom policy docs call the same device.
 */
export function describePort(port: SerialPort): PortDescription {
  const info = port.getInfo()
  const vendorId = info.usbVendorId !== undefined ? toHex4(info.usbVendorId) : undefined
  const productId = info.usbProductId !== undefined ? toHex4(info.usbProductId) : undefined
  const match = matchUsbBridge(vendorId, productId)
  return {
    label: match ? match.chip : 'Unknown serial device',
    vendorId,
    productId,
    recognized: match !== undefined
  }
}
