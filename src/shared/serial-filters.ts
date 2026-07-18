/**
 * USB VID/PID filters + labels for the Web Serial port picker (#465).
 * =============================================================================
 *
 * Passed to `navigator.serial.requestPort({ filters })` so the browser's device
 * chooser only offers plausible MicroPython boards + their USB-serial bridge
 * chips — the same families the desktop's `firmware/detect.ts` knows about, plus
 * the Raspberry Pi Pico. Numeric (Web Serial wants decimal/number VIDs).
 */
export interface UsbFilter {
  usbVendorId: number
  label: string
}

/** Known board / bridge-chip vendors. */
export const USB_VENDORS: UsbFilter[] = [
  { usbVendorId: 0x2e8a, label: 'Raspberry Pi (Pico / RP2040)' },
  { usbVendorId: 0x303a, label: 'Espressif (ESP32-S2/S3, native USB)' },
  { usbVendorId: 0x239a, label: 'Adafruit board' },
  { usbVendorId: 0x10c4, label: 'Silicon Labs CP210x bridge (ESP32)' },
  { usbVendorId: 0x1a86, label: 'WCH CH340 bridge' },
  { usbVendorId: 0x0403, label: 'FTDI bridge' },
  { usbVendorId: 0x067b, label: 'Prolific PL2303 bridge' }
]

/** `filters` for `requestPort` — narrows the chooser to likely boards. */
export const SERIAL_USB_FILTERS = USB_VENDORS.map((v) => ({ usbVendorId: v.usbVendorId }))

/** A friendly name for a granted port from its USB VID/PID. */
export function describeUsb(vendorId?: number, productId?: number): string {
  const known = USB_VENDORS.find((v) => v.usbVendorId === vendorId)
  const hex = (n?: number): string => (n == null ? '????' : n.toString(16).padStart(4, '0'))
  const id = `${hex(vendorId)}:${hex(productId)}`
  return known ? `${known.label} · ${id}` : `USB serial device · ${id}`
}
