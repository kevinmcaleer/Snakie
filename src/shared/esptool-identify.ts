/**
 * WHAT THE BOARD SAYS ABOUT ITSELF — parsing `esptool flash-id`.
 * =============================================================================
 *
 * esptool can interrogate a connected ESP before anything is written to it, and
 * it answers the two questions the flash dialog otherwise has to ask the user
 * to guess at:
 *
 *   Chip type:          ESP32-PICO-V3-02 (revision v3.0)
 *   Features:           Wi-Fi, BT, Dual Core + LP Core, 240MHz, Embedded Flash,
 *                       Embedded PSRAM, Vref calibration in eFuse, ...
 *   Crystal frequency:  40MHz
 *   MAC:                e8:9f:6d:26:93:20
 *   Detected flash size: 8MB
 *
 * **PSRAM is the one that matters most.** MicroPython publishes `ESP32_GENERIC`
 * and `ESP32_GENERIC-SPIRAM` as separate builds, and only the second can use the
 * PSRAM — but nothing in the firmware catalog says which your board has, so the
 * choice has been left to a user who often has no way to know. The board knows,
 * and will say so if asked.
 *
 * Pure text parsing, so it is testable against real esptool output without a
 * board attached. The running of esptool lives in `main/firmware/detect.ts`.
 */

/** What a board reported about itself. Every field is optional: esptool's
 *  wording varies by version and by chip, and a missing field must degrade to
 *  "unknown" rather than to a wrong guess. */
export interface BoardIdentity {
  /** The precise part, e.g. `ESP32-PICO-V3-02`. */
  chip?: string
  /** Silicon revision, e.g. `v3.0`. */
  revision?: string
  /** Chip family for the firmware catalog, e.g. `esp32`, `esp32s3`. */
  family?: string
  /** True when the chip reports PSRAM — the SPIRAM build is then the right one. */
  psram?: boolean
  /** Flash size as reported, e.g. `8MB`. */
  flashSize?: string
  /** The board's MAC, which is the only unique thing about it. */
  mac?: string
  /** Everything on the Features line, for display. */
  features?: string[]
}

/**
 * The catalog `family` for a chip name.
 *
 * Ordered longest-first so `ESP32-S3` is not matched by the `ESP32` rule. The
 * PICO and the WROOM/WROVER modules are all plain `esp32` parts — the module
 * name says what is around the die, not what the die is.
 */
function familyFor(chip: string): string | undefined {
  const c = chip.toUpperCase()
  for (const [needle, family] of [
    ['ESP32-S2', 'esp32s2'],
    ['ESP32-S3', 'esp32s3'],
    ['ESP32-C2', 'esp32c2'],
    ['ESP32-C3', 'esp32c3'],
    ['ESP32-C6', 'esp32c6'],
    ['ESP32-H2', 'esp32h2'],
    ['ESP32-P4', 'esp32p4'],
    ['ESP8266', 'esp8266'],
    ['ESP32', 'esp32']
  ] as const) {
    if (c.includes(needle)) return family
  }
  return undefined
}

/** Parse the output of `esptool … flash-id`. Never throws; unknown stays unknown. */
export function parseEsptoolIdentity(stdout: string): BoardIdentity {
  const text = (stdout ?? '').replace(/\r/g, '')
  const out: BoardIdentity = {}

  const chip = /^\s*Chip type:\s*(.+?)\s*$/m.exec(text)
  if (chip) {
    // `ESP32-PICO-V3-02 (revision v3.0)` → chip + revision.
    const rev = /^(.*?)\s*\(revision\s*([^)]+)\)\s*$/.exec(chip[1])
    out.chip = (rev ? rev[1] : chip[1]).trim()
    if (rev) out.revision = rev[2].trim()
    out.family = familyFor(out.chip)
  }

  const feats = /^\s*Features:\s*(.+?)\s*$/m.exec(text)
  if (feats) {
    out.features = feats[1].split(',').map((f) => f.trim()).filter(Boolean)
    // "Embedded PSRAM" on a PICO, "PSRAM" elsewhere — match the word, not a
    // fixed phrase, since the wording differs by chip and esptool version.
    out.psram = out.features.some((f) => /\bPSRAM\b/i.test(f))
  }

  const size = /^\s*Detected flash size:\s*(\S+)\s*$/m.exec(text)
  if (size) out.flashSize = size[1]

  const mac = /^\s*MAC:\s*([0-9a-f:]{17})\s*$/im.exec(text)
  if (mac) out.mac = mac[1].toLowerCase()

  return out
}

/**
 * The MicroPython build worth preferring for what the board reported, or null
 * when nothing useful can be said.
 *
 * Only the plain `esp32` family gets an opinion here. The S3's PSRAM story is a
 * three-way choice (plain / SPIRAM / SPIRAM_OCT) that depends on the RAM's bus
 * width, which `flash-id` does not report — guessing there could send someone to
 * a build that boots with a PSRAM error, so it says nothing instead.
 */
export function suggestedBuildFor(id: BoardIdentity): { name: string; why: string } | null {
  if (id.family !== 'esp32' || id.psram !== true) return null
  return {
    name: 'ESP32_GENERIC-SPIRAM',
    why: `This board reports PSRAM${id.chip ? ` (${id.chip})` : ''}, and only the SPIRAM build can use it. The plain ESP32_GENERIC build runs fine — it just leaves the PSRAM unavailable.`
  }
}

/** A one-line summary for the dialog, e.g. `ESP32-PICO-V3-02 · 8MB flash · PSRAM`. */
export function describeIdentity(id: BoardIdentity): string {
  const bits = [
    id.chip,
    id.flashSize ? `${id.flashSize} flash` : undefined,
    id.psram === true ? 'PSRAM' : undefined
  ].filter(Boolean)
  return bits.join(' · ')
}
