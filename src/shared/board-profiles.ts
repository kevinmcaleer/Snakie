/**
 * BOARD PROFILES — what Snakie knows about a specific board before you flash it.
 * =============================================================================
 *
 * The flash dialog used to ask the user for the mechanics (board TYPE, flash
 * offset, baud) and take the firmware list straight from Thonny's catalog. Two
 * things go wrong with that:
 *
 *  1. **The offset is the user's problem.** Only the original ESP32 flashes at
 *     `0x1000`; every other ESP chip is `0x0`. Get it wrong on an ESP32-S3 and
 *     esptool reports SUCCESS — it wrote the bytes — but the ROM finds no
 *     bootloader where it looks, so the board never boots and never comes back
 *     as a REPL. A silent, confusing failure.
 *  2. **Thonny's catalog is not complete.** It lists a XIAO ESP32C6 but no XIAO
 *     ESP32-S3, so a board plenty of people own simply isn't offerable.
 *
 * Naming the board first fixes both: the profile carries the mechanics, and it
 * exists whether or not an upstream catalog happens to know the board. The
 * catalog is then just where the firmware BINARY comes from — matched by chip
 * family, which is what a generic build is keyed on anyway.
 *
 * Kept dependency-free so the renderer, preload and main can all import it.
 */

/** How the firmware reaches the board. */
export type FlashMethod = 'esptool' | 'uf2' | 'daplink'

/**
 * A board we can describe precisely. `chipFamily` matches the `family` field in
 * Thonny's catalogs (`esp32s3`, `rp2`, …) so a profile can pre-select the right
 * firmware without the user knowing what an "ESP32-S3" is.
 */
export interface BoardProfile {
  id: string
  vendor: string
  model: string
  /** Vendor + model, for the picker. */
  label: string
  chipFamily: string
  method: FlashMethod
  /** esptool `write_flash` offset. Absent for non-esptool methods. */
  offset?: string
  /** Recommended baud; absent ⇒ the flasher default. */
  baud?: number
  /**
   * The board presents its own USB device rather than going through a bridge
   * chip. It therefore **re-enumerates after flashing** — the download-mode port
   * disappears and MicroPython's comes up as a different device — so the port
   * list must be re-read, and often the board replugged, before a REPL appears.
   * This is the single most common "the flash worked but nothing happened".
   */
  nativeUsb?: boolean
  /** Anything the user genuinely needs to know, shown next to the picker. */
  notes?: string
  /**
   * Erase the whole flash before writing, by default, for this board.
   *
   * On when the board commonly arrives running something else: a leftover
   * partition table or NVS survives a plain `write_flash`, and the board then
   * boot-loops — enumerating for a second and dropping off — which reads exactly
   * like a failed flash even though the flash succeeded.
   */
  eraseByDefault?: boolean
  /**
   * The firmware BUILD this board needs, when a generic one will not do.
   *
   * Some boards only run a specific variant, and picking the wrong one produces
   * a board that flashes cleanly and then boot-loops. The XIAO ESP32-S3 is the
   * case in point: it carries 8 MB of OCTAL-SPI PSRAM, so it needs the
   * `SPIRAM_OCT` build — and the upstream catalog only offers the plain one.
   */
  requiredBuild?: { name: string; why: string; url?: string }
}

const ESP32_S3 = { chipFamily: 'esp32s3', method: 'esptool' as const, offset: '0x0', nativeUsb: true }
const ESP32_C3 = { chipFamily: 'esp32c3', method: 'esptool' as const, offset: '0x0', nativeUsb: true }
const ESP32_C6 = { chipFamily: 'esp32c6', method: 'esptool' as const, offset: '0x0', nativeUsb: true }
const RP2 = { chipFamily: 'rp2', method: 'uf2' as const }

/**
 * The boards Snakie knows how to set up. Deliberately curated rather than
 * generated: the point is to carry the things a catalog does not know — the
 * offset, whether the USB port survives a flash — for the boards people actually
 * bring to this app.
 */
export const BOARD_PROFILES: BoardProfile[] = [
  {
    id: 'xiao-esp32s3',
    vendor: 'Seeed Studio',
    model: 'XIAO ESP32-S3',
    label: 'Seeed Studio XIAO ESP32-S3',
    ...ESP32_S3,
    eraseByDefault: true,
    requiredBuild: {
      name: 'ESP32_GENERIC_S3-SPIRAM_OCT',
      why: 'This board has 8 MB of octal-SPI PSRAM. The plain ESP32_GENERIC_S3 build flashes cleanly and then boot-loops — the board appears for a moment and drops off again.',
      url: 'https://micropython.org/download/ESP32_GENERIC_S3/'
    },
    notes:
      'Native USB: after flashing, unplug and replug the board — MicroPython comes back on a different port than the bootloader used.'
  },
  {
    id: 'xiao-esp32c3',
    vendor: 'Seeed Studio',
    model: 'XIAO ESP32-C3',
    label: 'Seeed Studio XIAO ESP32-C3',
    ...ESP32_C3
  },
  {
    id: 'xiao-esp32c6',
    vendor: 'Seeed Studio',
    model: 'XIAO ESP32-C6',
    label: 'Seeed Studio XIAO ESP32-C6',
    ...ESP32_C6
  },
  {
    id: 'xiao-rp2040',
    vendor: 'Seeed Studio',
    model: 'XIAO RP2040',
    label: 'Seeed Studio XIAO RP2040',
    ...RP2
  },
  {
    id: 'xiao-rp2350',
    vendor: 'Seeed Studio',
    model: 'XIAO RP2350',
    label: 'Seeed Studio XIAO RP2350',
    chipFamily: 'rp2',
    method: 'uf2'
  },
  {
    id: 'pico',
    vendor: 'Raspberry Pi',
    model: 'Pico',
    label: 'Raspberry Pi Pico',
    ...RP2,
    notes: 'Hold BOOTSEL while plugging in, so the RPI-RP2 drive appears.'
  },
  {
    id: 'pico-w',
    vendor: 'Raspberry Pi',
    model: 'Pico W',
    label: 'Raspberry Pi Pico W',
    ...RP2,
    notes: 'Hold BOOTSEL while plugging in, so the RPI-RP2 drive appears.'
  },
  {
    id: 'pico2',
    vendor: 'Raspberry Pi',
    model: 'Pico 2',
    label: 'Raspberry Pi Pico 2',
    ...RP2,
    notes: 'Hold BOOTSEL while plugging in, so the RP2350 drive appears.'
  },
  {
    id: 'esp32-devkit',
    vendor: 'Espressif',
    model: 'ESP32 DevKit',
    label: 'Espressif ESP32 DevKit (original ESP32)',
    chipFamily: 'esp32',
    method: 'esptool',
    // The ONE chip that is not 0x0.
    offset: '0x1000'
  },
  {
    id: 'esp32-s3-generic',
    vendor: 'Espressif',
    model: 'ESP32-S3 (generic)',
    label: 'Espressif ESP32-S3 (generic)',
    ...ESP32_S3,
    eraseByDefault: true
  },
  {
    id: 'esp32-c3-generic',
    vendor: 'Espressif',
    model: 'ESP32-C3 (generic)',
    label: 'Espressif ESP32-C3 (generic)',
    ...ESP32_C3
  },
  {
    id: 'esp8266',
    vendor: 'Espressif',
    model: 'ESP8266',
    label: 'Espressif ESP8266',
    chipFamily: 'esp8266',
    method: 'esptool',
    offset: '0x0'
  },
  {
    id: 'microbit-v2',
    vendor: 'BBC',
    model: 'micro:bit v2',
    label: 'BBC micro:bit v2',
    chipFamily: 'nrf52',
    method: 'daplink'
  },
  {
    id: 'microbit-v1',
    vendor: 'BBC',
    model: 'micro:bit v1',
    label: 'BBC micro:bit v1',
    chipFamily: 'nrf51',
    method: 'daplink'
  }
]

/** Look a profile up by id. */
export function boardProfile(id: string): BoardProfile | undefined {
  return BOARD_PROFILES.find((b) => b.id === id)
}

/**
 * Does a firmware family fit this board?
 *
 * The check that catches the mistake worth catching: an ESP32-S3 flashed with an
 * original-ESP32 build (or vice versa) writes cleanly and never boots. Compared
 * loosely on the family string, because a catalog may say `rp2` where a profile
 * says `rp2` but a variant says `RPI_PICO_W`.
 */
export function familyFitsBoard(profile: BoardProfile, family: string): boolean {
  return family.trim().toLowerCase() === profile.chipFamily
}

/**
 * A one-line warning when the chosen firmware does not match the chosen board,
 * or `null` when it is fine. Phrased as what will happen, because "incompatible"
 * does not tell anyone why their board went quiet.
 */
export function firmwareMismatch(profile: BoardProfile, family: string): string | null {
  if (!family || familyFitsBoard(profile, family)) return null
  return `That firmware is for ${family} — a ${profile.model} is ${profile.chipFamily}. It will flash without error and the board will not start.`
}
