/**
 * Shared types for the firmware-flashing layer (issue #14).
 *
 * Like the device-layer types these are intentionally plain (no class
 * instances, no Buffers) so they serialize cleanly across the Electron IPC
 * boundary and can be re-used by the preload typings and the renderer.
 */

/**
 * The board families we know how to flash. `esp32` / `esp8266` shell out to
 * `esptool`; `rp2040` copies a `.uf2` file onto the mounted boot drive.
 */
export type BoardType = 'esp32' | 'esp8266' | 'rp2040'

/**
 * A board candidate detected from a serial port (ESP) or a mounted UF2 boot
 * drive (RP2040). Detection is best-effort: it ranks likely matches and lets
 * the user confirm/override before flashing.
 */
export interface BoardCandidate {
  /** Best-guess board family. */
  board: BoardType
  /**
   * How the candidate was found. ESP boards are found via the serial port's
   * USB VID/PID; RP2040 boards in BOOTSEL mode appear as a mounted UF2 volume.
   */
  source: 'serial' | 'uf2-drive'
  /** Serial port path, when `source === 'serial'` (e.g. `/dev/ttyUSB0`). */
  port?: string
  /** Mounted UF2 boot-drive path, when `source === 'uf2-drive'`. */
  mountPath?: string
  /** Human-friendly description for the UI dropdown. */
  label: string
  /** USB vendor id (hex string), when known. */
  vendorId?: string
  /** USB product id (hex string), when known. */
  productId?: string
}

/** A live progress / log line streamed to the renderer during a flash. */
export interface FlashProgress {
  /** Lifecycle phase the message belongs to. */
  kind: 'log' | 'error' | 'done'
  /** The text line (already trimmed of a trailing newline). */
  message: string
  /** Present on the terminal `done` event: whether the flash succeeded. */
  ok?: boolean
}

/** Options describing a flash request from the renderer. */
export interface FlashOptions {
  board: BoardType
  /** Absolute path to the firmware file (`.bin` for ESP, `.uf2` for RP2040). */
  firmwarePath: string
  /** Serial port path — required for ESP boards. */
  port?: string
  /** Mounted UF2 boot-drive path — required for RP2040; auto-detected if omitted. */
  mountPath?: string
  /**
   * Flash offset for ESP `write_flash` (e.g. `0x1000` for esp32, `0x0` for
   * esp8266). Defaults are applied per board when omitted.
   */
  offset?: string
  /** esptool baud rate. Defaults to 460800. */
  baud?: number
}

/** Result of a flash operation, returned in addition to the streamed logs. */
export interface FlashResult {
  ok: boolean
  /** Failure detail when `ok === false`. */
  error?: string
}

/** Result of probing for the external `esptool` prerequisite. */
export interface EsptoolInfo {
  /** True when an `esptool` / `esptool.py` executable was found on PATH. */
  available: boolean
  /** The command name that resolved, when available. */
  command?: string
  /** Version string reported by the tool, when it could be read. */
  version?: string
}
