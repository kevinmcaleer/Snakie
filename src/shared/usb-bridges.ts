/**
 * Known USB vendor/product ids for MicroPython-capable boards (issue #283,
 * epic #267 Phase W2).
 *
 * This table started life inline in `src/main/firmware/detect.ts` (issue #14)
 * as a heuristic for firmware-flashing board guesses from a `serialport`
 * enumeration. It's extracted here — plain data, zero Node/DOM dependencies —
 * so it can be shared by two very different consumers:
 *
 *  - `firmware/detect.ts` (Electron main, via `serialport`): guesses a board
 *    family from an enumerated port's VID/PID for the flashing UI.
 *  - `src/web/portPicker.ts` (browser, via Web Serial): builds
 *    `SerialPortFilter[]` for `navigator.serial.requestPort()` and produces a
 *    friendly label for a picked port — reusing the exact same identifiers so
 *    the classroom enterprise-policy VID/PID allowlist (docs/
 *    web-serial-classroom-policy.md) matches what the port picker itself
 *    filters on.
 *
 * Two families of ids are covered:
 *  - **USB-serial bridge chips** (CP210x, CH340/341, FT232R) — common on ESP32
 *    / ESP8266 dev boards, which have no native USB and rely on a bridge chip.
 *    The same bridge chip ships on boards from many different chip families,
 *    so these are heuristic best-guesses, not a certain identification.
 *  - **Native USB CDC** — boards with an MCU that talks USB directly, no
 *    bridge chip: Espressif's native USB (ESP32-S2/S3/C3) and the Raspberry Pi
 *    Foundation's vendor id (RP2040/RP2350 boards like the Pico, which enumerate
 *    directly once MicroPython is running).
 */

/** Board families this table can identify. A subset of firmware's `BoardType`
 *  (no `microbit`: BBC micro:bit is detected via its DAPLink mass-storage
 *  drive, not a serial VID/PID, in both the flashing and web-picker paths). */
export type KnownBoardFamily = 'esp32' | 'esp8266' | 'rp2040'

/** One USB vendor/product id identifying a board family (exactly or by vendor only). */
export interface UsbBridgeEntry {
  /** USB vendor id, lowercase hex without the `0x` prefix (e.g. `2e8a`). */
  vid: string
  /** USB product id, lowercase hex without the `0x` prefix. Omitted = match any pid for this vid. */
  pid?: string
  /** Best-guess board family. */
  board: KnownBoardFamily
  /** Human-readable chip/board description, for UI labels. */
  chip: string
}

/**
 * Known USB-serial bridge chips + native-USB ids found on common MicroPython
 * dev boards. Values are lowercase hex without the `0x` prefix, matching
 * `PortInfo` (Electron) and `SerialPortInfo` (Web Serial).
 */
export const USB_SERIAL_BRIDGES: UsbBridgeEntry[] = [
  // Silicon Labs CP210x — extremely common on ESP32 dev boards.
  { vid: '10c4', pid: 'ea60', board: 'esp32', chip: 'CP210x' },
  // WCH CH340 / CH341 — common on cheaper ESP8266 (NodeMCU) and some ESP32.
  { vid: '1a86', pid: '7523', board: 'esp8266', chip: 'CH340' },
  { vid: '1a86', pid: '5523', board: 'esp8266', chip: 'CH341' },
  // FTDI FT232R — older ESP dev boards.
  { vid: '0403', pid: '6001', board: 'esp32', chip: 'FT232R' },
  // Espressif native USB CDC (ESP32-S2/S3/C3 built-in USB JTAG/serial).
  { vid: '303a', board: 'esp32', chip: 'Espressif native USB' },
  // Raspberry Pi Foundation native USB CDC — RP2040/RP2350 boards (Pico,
  // Pico 2, Pico W, and third-party RP2040 boards using the same vendor id)
  // enumerate directly with MicroPython running, no bridge chip needed.
  { vid: '2e8a', pid: '0005', board: 'rp2040', chip: 'Raspberry Pi Pico (MicroPython native USB)' },
  { vid: '2e8a', board: 'rp2040', chip: 'RP2040/RP2350 native USB' }
]

/**
 * Match a vendor/product id pair against the known bridge table. Prefers an
 * exact vid+pid match, then falls back to a vid-only entry. Case-insensitive.
 */
export function matchUsbBridge(
  vendorId?: string,
  productId?: string
): UsbBridgeEntry | undefined {
  if (!vendorId) return undefined
  const vid = vendorId.toLowerCase()
  const pid = productId?.toLowerCase()
  return (
    USB_SERIAL_BRIDGES.find((e) => e.vid === vid && e.pid && e.pid === pid) ??
    USB_SERIAL_BRIDGES.find((e) => e.vid === vid && !e.pid)
  )
}
