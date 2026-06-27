/**
 * Shared types for the firmware-flashing layer (issue #14).
 *
 * Like the device-layer types these are intentionally plain (no class
 * instances, no Buffers) so they serialize cleanly across the Electron IPC
 * boundary and can be re-used by the preload typings and the renderer.
 */

/**
 * The board families we know how to flash. `esp32` / `esp8266` shell out to
 * `esptool`; `rp2040` copies a `.uf2` onto the mounted boot drive; `microbit`
 * (BBC micro:bit v1/v2, a DAPLink device) copies a `.hex` onto the mounted
 * `MICROBIT` drive — the same drive-copy mechanism as RP2040.
 */
export type BoardType = 'esp32' | 'esp8266' | 'rp2040' | 'microbit'

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
   * USB VID/PID; RP2040 boards in BOOTSEL mode and BBC micro:bit boards both
   * appear as a mounted mass-storage volume (`RPI-RP2` / `MICROBIT`).
   */
  source: 'serial' | 'uf2-drive'
  /** Serial port path, when `source === 'serial'` (e.g. `/dev/ttyUSB0`). */
  port?: string
  /** Mounted boot/MSD drive path, when `source === 'uf2-drive'`. */
  mountPath?: string
  /** Human-friendly description for the UI dropdown. */
  label: string
  /** USB vendor id (hex string), when known. */
  vendorId?: string
  /** USB product id (hex string), when known. */
  productId?: string
  /**
   * For a detected micro:bit, which generation it is — read from `DETAILS.TXT`
   * on the `MICROBIT` drive. Lets the UI pre-select the matching firmware family
   * (nrf51 for v1, nrf52 for v2). Absent when not a micro:bit / undeterminable.
   */
  microbitVersion?: 'v1' | 'v2'
  /**
   * True when a micro:bit is in DAPLink **maintenance/bootloader mode** — it
   * mounts as `MAINTENANCE`, not `MICROBIT`. MicroPython can NOT be flashed in
   * this mode (it expects an interface-firmware update, and copying a target
   * `.hex` here can soft-brick the board), so the UI surfaces it but blocks the
   * flash and tells the user to reconnect normally.
   */
  maintenance?: boolean
}

/** A live progress / log line streamed to the renderer during a flash. */
export interface FlashProgress {
  /** Lifecycle phase the message belongs to. */
  kind: 'log' | 'error' | 'done'
  /** The text line (already trimmed of a trailing newline). */
  message: string
  /** Present on the terminal `done` event: whether the flash succeeded. */
  ok?: boolean
  /**
   * Optional 0–100 completion percentage for the current phase (download then
   * copy). Drives the UI progress bar without breaking the plain text log; many
   * `log` lines carry no `percent` and should leave the bar untouched.
   */
  percent?: number
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

/**
 * One downloadable firmware build (a single `.uf2` for one version), the leaf
 * of the catalog cascade.
 */
export interface FirmwareVersion {
  /** Version label, e.g. `v1.28.0` (or a preview/nightly tag). */
  version: string
  /** Absolute URL of the `.uf2` file on micropython.org. */
  url: string
}

/**
 * A board *variant* (Thonny's `title`, e.g. the SPIRAM vs. non-SPIRAM build, or
 * a vendor sub-model). Carries its own list of downloadable versions.
 */
export interface FirmwareVariant {
  /** Variant label shown in the Variant dropdown. */
  title: string
  /** Optional human info page for the variant/board. */
  infoUrl?: string
  /** Whether Thonny flags this entry as a popular/common choice. */
  popular?: boolean
  /** Downloadable versions, newest first. */
  versions: FirmwareVersion[]
}

/** A board *model* (e.g. `Raspberry Pi Pico`) grouping one or more variants. */
export interface FirmwareModel {
  /** Vendor name, e.g. `Raspberry Pi`. */
  vendor: string
  /** Model name, e.g. `Pico`. */
  model: string
  /** Display label combining vendor + model for the Model dropdown. */
  label: string
  /** Variants for this model. */
  variants: FirmwareVariant[]
}

/**
 * A board *family* (Thonny's `family`, e.g. `rp2`, `esp32`, `esp8266`),
 * grouping its models. This is the top of the Family → Model → Variant →
 * Version cascade rendered by the flash dialog.
 */
export interface FirmwareFamily {
  /** Family id, e.g. `rp2`. */
  family: string
  /** Models in the family, sorted by label. */
  models: FirmwareModel[]
}

/**
 * The serializable firmware catalog handed to the renderer: a list of families,
 * each cascading down to per-version `.uf2` download URLs.
 */
export interface FirmwareCatalog {
  families: FirmwareFamily[]
}

/**
 * Request to download a firmware file from a catalog URL and flash it onto a
 * device. Supports BOTH catalog paths (issues #64, #125):
 *  - **UF2 / RP2040** — downloads a `.uf2` and copies it onto `mountPath`.
 *  - **ESP (`.bin`)** — downloads a `.bin` and flashes it via esptool on `port`
 *    at `offset` (per-chip; see {@link FlashOptions.offset}).
 *
 * The extra fields are forwarded straight to {@link flash}, which dispatches by
 * `board`, so only the fields relevant to the target board need be supplied.
 */
export interface DownloadAndFlashOptions {
  /** Absolute URL of the `.uf2` (RP2040) or `.bin` (ESP) to download. */
  url: string
  /** Board family for the flash dispatch (UF2 copy uses `rp2040`). */
  board: BoardType
  /** Mounted UF2 boot-drive path to copy the firmware onto (RP2040 only). */
  mountPath?: string
  /** Serial port path for the esptool flash (ESP only). */
  port?: string
  /** Flash offset for the esptool `write_flash` (ESP only; per-chip). */
  offset?: string
}
