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
  /**
   * The board's **CircuitPython Board ID** — the per-board key circuitpython.org
   * publishes builds under, and the same string `boot_out.txt` prints (#756).
   *
   * Present only where a CircuitPython build genuinely exists for the board and
   * the id has been checked against the published catalog. Absent means exactly
   * that: CircuitPython has no build here (it dropped ESP8266 and the nRF51
   * micro:bit v1), or the profile names a chip generically rather than a board.
   * Never fill this in by guessing the slug — flashing another board's `.uf2`
   * leaves a board that needs re-flashing before it will talk again.
   */
  circuitPythonBoardId?: string
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
   * A firmware BUILD worth preferring for this board, and why.
   *
   * Advisory, NOT a hard requirement — the distinction matters. An ESP32-S3 with
   * octal PSRAM flashed with the plain build prints
   * `PSRAM ID read error … PSRAM enabled but initialization failed` at boot and
   * then **carries on booting**; it simply has no PSRAM. It is worth steering
   * people to the right variant, but a wrong one here is not why a board fails to
   * come up, and saying so sends them down a dead end.
   */
  preferredBuild?: { name: string; why: string; url?: string }
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
    circuitPythonBoardId: 'seeed_xiao_esp32s3',
    eraseByDefault: true,
    preferredBuild: {
      name: 'ESP32_GENERIC_S3-SPIRAM_OCT',
      why: 'This board has 8 MB of octal-SPI PSRAM, so the SPIRAM_OCT build is the one that can use it. The plain ESP32_GENERIC_S3 build also runs — Seeed\u2019s own guide uses it — it just leaves the PSRAM unavailable and prints a PSRAM error at boot.',
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
    ...ESP32_C3,
    circuitPythonBoardId: 'seeed_xiao_esp32c3'
  },
  {
    id: 'xiao-esp32c6',
    vendor: 'Seeed Studio',
    model: 'XIAO ESP32-C6',
    label: 'Seeed Studio XIAO ESP32-C6',
    ...ESP32_C6,
    circuitPythonBoardId: 'seeed_xiao_esp32c6'
  },
  {
    id: 'xiao-rp2040',
    vendor: 'Seeed Studio',
    model: 'XIAO RP2040',
    label: 'Seeed Studio XIAO RP2040',
    ...RP2,
    circuitPythonBoardId: 'seeeduino_xiao_rp2040'
  },
  {
    id: 'xiao-rp2350',
    vendor: 'Seeed Studio',
    model: 'XIAO RP2350',
    label: 'Seeed Studio XIAO RP2350',
    chipFamily: 'rp2',
    method: 'uf2',
    circuitPythonBoardId: 'seeeduino_xiao_rp2350'
  },
  {
    id: 'pico',
    vendor: 'Raspberry Pi',
    model: 'Pico',
    label: 'Raspberry Pi Pico',
    ...RP2,
    circuitPythonBoardId: 'raspberry_pi_pico',
    notes: 'Hold BOOTSEL while plugging in, so the RPI-RP2 drive appears.'
  },
  {
    id: 'pico-w',
    vendor: 'Raspberry Pi',
    model: 'Pico W',
    label: 'Raspberry Pi Pico W',
    ...RP2,
    // A different CircuitPython build from the plain Pico — same chip, different
    // board — which is exactly why the id is per board rather than per family.
    circuitPythonBoardId: 'raspberry_pi_pico_w',
    notes: 'Hold BOOTSEL while plugging in, so the RPI-RP2 drive appears.'
  },
  {
    id: 'pico2',
    vendor: 'Raspberry Pi',
    model: 'Pico 2',
    label: 'Raspberry Pi Pico 2',
    ...RP2,
    circuitPythonBoardId: 'raspberry_pi_pico2',
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
    id: 'adafruit-feather-esp32-v2',
    vendor: 'Adafruit',
    model: 'ESP32 Feather V2',
    label: 'Adafruit ESP32 Feather V2 (8 MB flash, 2 MB PSRAM)',
    chipFamily: 'esp32',
    method: 'esptool',
    // The original ESP32 — the one chip whose offset is not 0x0.
    offset: '0x1000',
    circuitPythonBoardId: 'adafruit_feather_esp32_v2',
    // A CH9102F bridge, not native USB: the port stays put across a flash, so
    // no replug is needed the way it is on an S3.
    nativeUsb: false,
    // This board ships with Adafruit's factory firmware on an 8 MB part, and a
    // plain `write_flash` leaves whatever that left behind. The reported symptom
    // was the exact one this flag exists for: the flash reports success and the
    // board then boot-loops with
    //   `esp_image: Image hash failed - image is corrupt`
    //   `boot: No bootable app partitions in the partition table`
    // which reads as a failed flash even though esptool exited 0.
    eraseByDefault: true,
    notes:
      'Hold BOOT, tap RESET, then release BOOT to enter download mode — this board does not auto-reset into the bootloader. It also ships with factory firmware, so Snakie erases the flash first by default; without that the board can boot-loop on a leftover partition table.'
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
    method: 'daplink',
    circuitPythonBoardId: 'microbit_v2'
  },
  {
    // No `circuitPythonBoardId`: CircuitPython has no nRF51 build, so the v1 can
    // only ever be flashed with MicroPython here.
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

/**
 * Is this firmware FILE the right kind for how the board is flashed? (#685)
 *
 * esptool writes raw bytes to an address. Hand it a `.uf2` and it writes the
 * container verbatim — UF2 is a wrapper of 512-byte blocks each carrying 256
 * bytes of payload, so what lands at `0x0` is block headers, not a bootloader.
 * Every step still reports success: esptool wrote what it was given, and the
 * verify pass checks that same data. The board then boot-loops, with nothing
 * anywhere saying why.
 *
 * The 2× size is the tell — a UF2 is roughly double the `.bin` it wraps.
 *
 * Returns a message naming the mismatch, or `null` when the file fits.
 */
export function firmwareFileIssue(method: FlashMethod, path: string): string | null {
  const name = path.trim().toLowerCase()
  if (!name) return null
  const ext = name.slice(name.lastIndexOf('.'))
  if (method === 'esptool') {
    if (ext === '.bin') return null
    if (ext === '.uf2') {
      return 'That is a .uf2 file, which esptool cannot flash — it would write the container instead of the firmware, and the board would not start. Download the .bin build for this chip instead.'
    }
    return `esptool needs a .bin file; this is ${ext || 'a file with no extension'}.`
  }
  if (method === 'uf2') {
    return ext === '.uf2' ? null : `This board is flashed by copying a .uf2 file; this is ${ext || 'a file with no extension'}.`
  }
  return ext === '.hex' ? null : `A micro:bit is flashed by copying a .hex file; this is ${ext || 'a file with no extension'}.`
}

/** The flash method implied by a coarse board type, for callers without a profile. */
export function methodForBoardType(board: 'esp32' | 'esp8266' | 'rp2040' | 'microbit'): FlashMethod {
  return board === 'rp2040' ? 'uf2' : board === 'microbit' ? 'daplink' : 'esptool'
}
