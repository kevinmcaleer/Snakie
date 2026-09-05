/**
 * THE BOARDS UPSTREAM DOES NOT BUILD FOR (#902, epic #884).
 * =============================================================================
 *
 * The board index has 15 Adafruit boards. It has no Adafruit ESP32 board at all,
 * because MicroPython builds no firmware under any of those names — there is no
 * `micropython.org/download/ADAFRUIT_FEATHER_ESP32_V2/`, and there never was.
 * You are expected to know that the right file is `ESP32_GENERIC-SPIRAM`.
 *
 * That expectation is the whole reason this epic exists. A Feather V2 owner
 * opened the model list, did not find their board, picked "ESP32 / WROOM" as the
 * nearest thing, and flashed a build without SPIRAM — on a board whose 2 MB of
 * PSRAM only the SPIRAM build initialises. A week of `ENOMEM`, mDNS allocation
 * failures and an eventual ESP-IDF `abort()`.
 *
 * So "missing boards" does not mean boards someone forgot to fetch. It means
 * boards that CANNOT come from the generator, because upstream has nothing to
 * generate from. They can only be curated, and this is where.
 *
 * WHAT AN ENTRY MUST CARRY. Each borrows a real upstream build by its exact
 * name, and says so on the card: substituting another board's firmware silently
 * is how the original mistake was made, and doing it silently on the user's
 * behalf is the same mistake with better manners. Every size names its source.
 * Every CircuitPython id was checked against the published catalogue rather than
 * inferred from the slug — a wrong `.uf2` leaves a board that needs re-flashing
 * before it will talk again.
 *
 * WHAT AN ENTRY IS NOT. Not a board upstream already has under another name:
 * {@link overlayEntries} stands an entry down the moment upstream publishes the
 * real thing, so this list shrinks by itself instead of quietly double-listing.
 *
 * Pure and DOM-free, so the merge and the step-aside are unit tests in node.
 */
import type { BoardSize, IndexedBoard } from './board-index'
import { newestBuilds } from './board-index'

/** Byte sizes, spelled out so a typo in a zero cannot hide in a literal. */
const KiB = 1024
const MiB = 1024 * 1024

/** Espressif's own figure for a chip's built-in SRAM. */
const espressifSram = (bytes: number, chip: string): BoardSize => ({
  bytes,
  source: `Espressif ${chip} datasheet`,
  scope: 'chip'
})

/** An RP2040/RP2350's on-die SRAM. The flash beside it is always `board` scope:
 *  these chips have none of their own, so every byte is the module's. */
const rpSram = (bytes: number, chip: string): BoardSize => ({
  bytes,
  source: `Raspberry Pi ${chip} datasheet`,
  scope: 'chip'
})

/** One board Snakie knows about and upstream does not. */
export interface OverlayBoard {
  /** Upstream's id if it ever adds this board — so the step-aside can match. */
  id: string
  vendor: string
  product: string
  port: string
  mcu: string
  features: string[]
  /** The maker's own product page: the source every size below is checked at. */
  url: string
  /** esptool write offset, or null where the board is not flashed that way. */
  flashOffset: string | null
  flash: BoardSize | null
  /** A second flash chip beside the MCU, where the maker states its size (#897). */
  externalFlash?: BoardSize | null
  ram: BoardSize | null
  psram: BoardSize | null
  /** Confirmed against circuitpython.org's published catalogue, or null. */
  circuitPythonBoardId: string | null
  /** The upstream board whose build this borrows, or null when none fits. */
  donorBoardId: string | null
  /** The exact upstream build name, e.g. `ESP32_GENERIC-SPIRAM`. */
  donorBuild: string | null
  /** Why that build, said on the card. */
  why: string
  /** The `board-profiles.ts` entry carrying this board's flashing mechanics. */
  profileId?: string
}

/**
 * The curated set.
 *
 * Deliberately small. Every entry is a claim about somebody's hardware that
 * Snakie will act on, so the bar is a maker's own page open in front of me, not
 * a plausible-looking slug. The candidates that did not clear that bar are in
 * the issue rather than here.
 *
 * THE SECOND BATCH (#936) BROUGHT A HAZARD THE FIRST DID NOT. The Adafruit ESP32
 * entries above borrow a generic build because there is a right one to borrow.
 * Most of what follows is RP2040/RP2350, where a generic Pico build runs on
 * nearly every board — and running is not the same as being right. "It booted,
 * so it was the correct firmware" is exactly the reasoning that cost a week on
 * the Feather V2.
 *
 * So a donor is offered only where the MAKER'S OWN PAGE says the board is
 * spec-identical to the donor — Cytron's does, and is the only one here that
 * does. Where the maker publishes its own build, the entry says so and points
 * there, the way the micro:bit v2 entry does. `PIMORONI_PICOLIPO2` is the case
 * that settles it: an RP2350B with 16 MB of flash and 8 MB of PSRAM, against a
 * Pico 2 build that is an RP2350A with 4 MB and none. It would boot, and leave
 * most of the board switched off.
 *
 * One more rule, quieter but easy to break: `features` feed the gallery's filter
 * facets. `USB C` where upstream writes `USB-C` fails nothing and silently
 * splits one facet in two, so the tests hold every string here to upstream's own
 * vocabulary.
 */
export const OVERLAY_BOARDS: OverlayBoard[] = [
  {
    // The board this whole epic is about.
    id: 'ADAFRUIT_FEATHER_ESP32_V2',
    vendor: 'Adafruit',
    product: 'ESP32 Feather V2',
    port: 'esp32',
    mcu: 'esp32',
    features: ['BLE', 'WiFi'],
    url: 'https://www.adafruit.com/product/5400',
    // The original ESP32 — the one chip whose offset is not 0x0.
    flashOffset: '0x1000',
    flash: { bytes: 8 * MiB, source: 'adafruit.com/product/5400', scope: 'board' },
    ram: espressifSram(520 * KiB, 'ESP32'),
    psram: { bytes: 2 * MiB, source: 'adafruit.com/product/5400', scope: 'board' },
    circuitPythonBoardId: 'adafruit_feather_esp32_v2',
    donorBoardId: 'ESP32_GENERIC',
    donorBuild: 'ESP32_GENERIC-SPIRAM',
    why:
      'MicroPython publishes no build under this board’s name. Its 2 MB of PSRAM is only ' +
      'initialised by the SPIRAM variant of the generic ESP32 build, so that is the one ' +
      'to flash — the plain build runs and leaves the PSRAM switched off.',
    profileId: 'adafruit-feather-esp32-v2'
  },
  {
    // Adafruit 5323 — the 8 MB / NO PSRAM one. Adafruit sells three ESP32-S3
    // Feathers and they do not take the same build; this entry is only the one
    // whose page says "8MB Flash No PSRAM".
    id: 'ADAFRUIT_FEATHER_ESP32S3',
    vendor: 'Adafruit',
    product: 'Feather ESP32-S3 (8 MB, no PSRAM)',
    port: 'esp32',
    mcu: 'esp32s3',
    features: [
      'BLE',
      'WiFi',
      'External Flash',
      'USB-C',
      'Feather',
      'JST-SH',
      'RGB LED',
      'Battery Charging',
      'Dual-core'
    ],
    url: 'https://www.adafruit.com/product/5323',
    flashOffset: '0x0',
    flash: { bytes: 8 * MiB, source: 'adafruit.com/product/5323', scope: 'board' },
    ram: espressifSram(512 * KiB, 'ESP32-S3'),
    // Stated absent on the product page, not merely unlisted — which is what
    // decides the build below.
    psram: null,
    circuitPythonBoardId: 'adafruit_feather_esp32s3_nopsram',
    donorBoardId: 'ESP32_GENERIC_S3',
    donorBuild: 'ESP32_GENERIC_S3',
    why:
      'MicroPython publishes no build under this board’s name. This model has no PSRAM, so ' +
      'the STANDARD generic ESP32-S3 build is the right one — the SPIRAM_OCT variant would ' +
      'print a PSRAM initialisation error at every boot. The 4 MB / 2 MB PSRAM Feather is a ' +
      'different board and takes a different build.'
  },
  {
    id: 'ADAFRUIT_HUZZAH32_FEATHER',
    vendor: 'Adafruit',
    product: 'HUZZAH32 – ESP32 Feather',
    port: 'esp32',
    mcu: 'esp32',
    features: ['BLE', 'WiFi'],
    url: 'https://www.adafruit.com/product/3405',
    flashOffset: '0x1000',
    flash: { bytes: 4 * MiB, source: 'adafruit.com/product/3405', scope: 'board' },
    ram: espressifSram(520 * KiB, 'ESP32'),
    // No PSRAM on the WROOM32 module — stated, because the V2 above has some and
    // the two boards are one letter apart in a list.
    psram: null,
    circuitPythonBoardId: 'adafruit_feather_huzzah32',
    donorBoardId: 'ESP32_GENERIC',
    donorBuild: 'ESP32_GENERIC',
    why:
      'MicroPython publishes no build under this board’s name. It is a plain ESP32-WROOM-32 ' +
      'with no PSRAM, so the standard generic ESP32 build is the right one — NOT the SPIRAM ' +
      'variant its V2 successor needs.'
  },
  {
    id: 'ADAFRUIT_QTPY_ESP32C3',
    vendor: 'Adafruit',
    product: 'QT Py ESP32-C3',
    port: 'esp32',
    mcu: 'esp32c3',
    features: ['BLE', 'WiFi'],
    url: 'https://www.adafruit.com/product/5405',
    flashOffset: '0x0',
    flash: { bytes: 4 * MiB, source: 'adafruit.com/product/5405', scope: 'board' },
    ram: espressifSram(400 * KiB, 'ESP32-C3'),
    psram: null,
    circuitPythonBoardId: 'adafruit_qtpy_esp32c3',
    donorBoardId: 'ESP32_GENERIC_C3',
    donorBuild: 'ESP32_GENERIC_C3',
    why: 'MicroPython publishes no build under this board’s name; the generic ESP32-C3 build runs on it.'
  },
  {
    id: 'ADAFRUIT_QTPY_ESP32S3',
    vendor: 'Adafruit',
    product: 'QT Py ESP32-S3 (no PSRAM)',
    port: 'esp32',
    mcu: 'esp32s3',
    features: ['BLE', 'WiFi'],
    url: 'https://www.adafruit.com/product/5426',
    flashOffset: '0x0',
    flash: { bytes: 8 * MiB, source: 'adafruit.com/product/5426', scope: 'board' },
    ram: espressifSram(512 * KiB, 'ESP32-S3'),
    psram: null,
    circuitPythonBoardId: 'adafruit_qtpy_esp32s3_nopsram',
    donorBoardId: 'ESP32_GENERIC_S3',
    donorBuild: 'ESP32_GENERIC_S3',
    why:
      'MicroPython publishes no build under this board’s name. This variant has no PSRAM, so ' +
      'the STANDARD generic ESP32-S3 build is the right one — the SPIRAM_OCT variant would ' +
      'print a PSRAM initialisation error at every boot.'
  },
  {
    // Upstream's `MICROBIT` is the nRF51 v1, and the gallery showing only that
    // is worse than showing nothing: it is the wrong board for almost everyone
    // holding a micro:bit, and its firmware will not run on a v2.
    id: 'MICROBIT_V2',
    vendor: 'BBC',
    product: 'micro:bit v2',
    port: 'nrf',
    mcu: 'nrf52',
    features: ['BLE'],
    url: 'https://tech.microbit.org/hardware/',
    flashOffset: null,
    flash: { bytes: 512 * KiB, source: 'tech.microbit.org/hardware (nRF52833)', scope: 'board' },
    ram: { bytes: 128 * KiB, source: 'tech.microbit.org/hardware (nRF52833)', scope: 'board' },
    psram: null,
    circuitPythonBoardId: 'microbit_v2',
    // No donor: MicroPython for the micro:bit is a separate project with its own
    // releases, so there is no micropython.org build to borrow and pretending
    // otherwise would hand someone an nRF51 image for an nRF52833 board.
    donorBoardId: null,
    donorBuild: null,
    why:
      'MicroPython for the micro:bit v2 is published by the micro:bit Foundation, not by ' +
      'micropython.org, so there is no build here to flash. Get it from python.microbit.org.',
    profileId: 'microbit-v2'
  },
  {
    // Cytron's own page states the board is spec-identical to a Pico — same
    // RP2040, same 264 KB, same 2 MB — and that MicroPython for the Pico/RP2040
    // is a supported way to use it. That is a maker's endorsement of the generic
    // build, which is the bar for offering one here.
    id: 'CYTRON_MAKER_PI_RP2040',
    vendor: 'Cytron',
    product: 'Maker Pi RP2040',
    port: 'rp2',
    mcu: 'rp2040',
    features: ['External Flash', 'RGB LED', 'Dual-core', 'Battery Charging'],
    url: 'https://www.cytron.io/p-maker-pi-rp2040-simplifying-robotics-with-raspberry-pi-rp2040',
    // An RP2 board is flashed by dragging a .uf2 onto its bootloader drive, so
    // there is no esptool offset to write at.
    flashOffset: null,
    flash: { bytes: 2 * MiB, source: 'cytron.io Maker Pi RP2040 specifications', scope: 'board' },
    ram: rpSram(264 * KiB, 'RP2040'),
    psram: null,
    circuitPythonBoardId: 'cytron_maker_pi_rp2040',
    donorBoardId: 'RPI_PICO',
    donorBuild: 'RPI_PICO',
    why:
      'MicroPython publishes no build under this board’s name. Cytron states it carries the ' +
      'same RP2040, the same 264 KB of RAM and the same 2 MB of flash as a Pico, so the Pico ' +
      'build is the one to flash. The board ships with CircuitPython on it, so flashing ' +
      'MicroPython replaces what is already there.'
  },
  {
    // Pimoroni publishes a MicroPython build for each of the four boards below,
    // with that board's own library baked in — `servo`, `motor`, `picographics`.
    // Their pages send you there, so that is what these entries say, and none of
    // them borrows a Pico build: a Servo 2040 running stock MicroPython is a
    // board with no `servo` module, which is the entire reason someone bought it.
    id: 'PIMORONI_TINY2350',
    vendor: 'Pimoroni',
    product: 'Tiny 2350',
    port: 'rp2',
    mcu: 'rp2350',
    features: ['External Flash', 'USB-C', 'RGB LED', 'Dual-core', 'JST-SH'],
    url: 'https://shop.pimoroni.com/products/tiny-2350',
    flashOffset: null,
    flash: { bytes: 4 * MiB, source: 'shop.pimoroni.com/products/tiny-2350', scope: 'board' },
    ram: rpSram(520 * KiB, 'RP2350'),
    psram: null,
    circuitPythonBoardId: 'pimoroni_tiny2350',
    donorBoardId: null,
    donorBuild: null,
    why:
      'MicroPython publishes no build under this board’s name. Pimoroni publishes its own, ' +
      'with the board’s RGB LED and Qw/ST libraries included — get it from ' +
      'github.com/pimoroni/pimoroni-pico/releases.'
  },
  {
    id: 'PIMORONI_SERVO2040',
    vendor: 'Pimoroni',
    product: 'Servo 2040',
    port: 'rp2',
    mcu: 'rp2040',
    features: ['External Flash', 'USB-C', 'RGB LED', 'Dual-core', 'JST-SH'],
    url: 'https://shop.pimoroni.com/products/servo-2040',
    flashOffset: null,
    flash: { bytes: 2 * MiB, source: 'shop.pimoroni.com/products/servo-2040', scope: 'board' },
    ram: rpSram(264 * KiB, 'RP2040'),
    psram: null,
    circuitPythonBoardId: 'pimoroni_servo2040',
    donorBoardId: null,
    donorBuild: null,
    why:
      'MicroPython publishes no build under this board’s name. Pimoroni publishes its own, ' +
      'and it is the one that carries the `servo` module this board exists to run — get it ' +
      'from github.com/pimoroni/pimoroni-pico/releases.'
  },
  {
    id: 'PIMORONI_MOTOR2040',
    vendor: 'Pimoroni',
    product: 'Motor 2040',
    port: 'rp2',
    mcu: 'rp2040',
    features: ['External Flash', 'USB-C', 'RGB LED', 'Dual-core', 'JST-SH'],
    url: 'https://shop.pimoroni.com/products/motor-2040',
    flashOffset: null,
    flash: { bytes: 2 * MiB, source: 'shop.pimoroni.com/products/motor-2040', scope: 'board' },
    ram: rpSram(264 * KiB, 'RP2040'),
    psram: null,
    circuitPythonBoardId: 'pimoroni_motor2040',
    donorBoardId: null,
    donorBuild: null,
    why:
      'MicroPython publishes no build under this board’s name. Pimoroni publishes its own, ' +
      'and it is the one that carries the `motor` and encoder modules this board exists to ' +
      'run — get it from github.com/pimoroni/pimoroni-pico/releases.'
  },
  {
    // The PSRAM board, and the reason none of the RP2350 entries borrows a Pico
    // 2 build: this is an RP2350B with 16 MB of flash and 8 MB of PSRAM, and the
    // Pico 2 build is an RP2350A with 4 MB and no PSRAM support. Flashing it
    // would run, and quietly leave 12 MB of flash and all 8 MB of PSRAM switched
    // off — which is, exactly, the Feather V2 story this file was opened for.
    id: 'PIMORONI_PICOLIPO2',
    vendor: 'Pimoroni',
    product: 'Pico LiPo 2',
    port: 'rp2',
    mcu: 'rp2350',
    features: [
      'External Flash',
      'External RAM',
      'USB-C',
      'Battery Charging',
      'Dual-core',
      'JST-SH'
    ],
    url: 'https://shop.pimoroni.com/en-us/products/pimoroni-pico-lipo-2',
    flashOffset: null,
    flash: {
      bytes: 16 * MiB,
      source: 'shop.pimoroni.com/products/pimoroni-pico-lipo-2',
      scope: 'board'
    },
    ram: rpSram(520 * KiB, 'RP2350'),
    psram: {
      bytes: 8 * MiB,
      source: 'shop.pimoroni.com/products/pimoroni-pico-lipo-2',
      scope: 'board'
    },
    // circuitpython.org lists the original Pico LiPo (4 MB and 16 MB RP2040
    // builds) and no Pico LiPo 2 at all — checked, not inferred from the slug.
    circuitPythonBoardId: null,
    donorBoardId: null,
    donorBuild: null,
    why:
      'MicroPython publishes no build under this board’s name, and no upstream build fits it: ' +
      'this is an RP2350B with 16 MB of flash and 8 MB of PSRAM, where the Pico 2 build is an ' +
      'RP2350A with 4 MB and no PSRAM. Flashing that would run and leave most of the board ' +
      'switched off. Pimoroni’s own build is at github.com/pimoroni/pico-lipo.'
  },
  {
    id: 'PIMORONI_PICOLIPO2_XL_W',
    vendor: 'Pimoroni',
    product: 'Pico LiPo 2 XL W',
    port: 'rp2',
    mcu: 'rp2350',
    features: [
      'External Flash',
      'External RAM',
      'USB-C',
      'Battery Charging',
      'Dual-core',
      'JST-SH',
      'WiFi',
      'BLE'
    ],
    url: 'https://shop.pimoroni.com/en-us/products/pimoroni-pico-lipo-2-xl-w',
    flashOffset: null,
    flash: {
      bytes: 16 * MiB,
      source: 'shop.pimoroni.com/products/pimoroni-pico-lipo-2-xl-w',
      scope: 'board'
    },
    ram: rpSram(520 * KiB, 'RP2350'),
    psram: {
      bytes: 8 * MiB,
      source: 'shop.pimoroni.com/products/pimoroni-pico-lipo-2-xl-w',
      scope: 'board'
    },
    circuitPythonBoardId: null,
    donorBoardId: null,
    donorBuild: null,
    why:
      'MicroPython publishes no build under this board’s name, and no upstream build fits it: ' +
      'an RP2350B with 16 MB of flash, 8 MB of PSRAM and a Raspberry Pi RM2 radio, none of ' +
      'which the Pico 2 build knows about. Pimoroni’s own build is at ' +
      'github.com/pimoroni/pico-lipo.'
  }
]

/**
 * One overlay record as a gallery board, with its borrowed build resolved.
 *
 * The build is matched by its exact upstream NAME rather than by variant, so a
 * donor that stops publishing that variant yields a board with no builds and a
 * card that says so — which is the truth — rather than silently falling back to
 * the plain build, which is the original bug.
 */
function toIndexedBoard(entry: OverlayBoard, upstream: readonly IndexedBoard[]): IndexedBoard {
  const donor = entry.donorBoardId ? upstream.find((b) => b.id === entry.donorBoardId) : undefined
  const borrowed = donor ? newestBuilds(donor).filter((b) => b.build === entry.donorBuild) : []
  const runtimes: IndexedBoard['runtimes'] = []
  if (borrowed.length > 0) runtimes.push('micropython')
  if (entry.circuitPythonBoardId) runtimes.push('circuitpython')
  return {
    id: entry.id,
    port: entry.port,
    vendor: entry.vendor,
    product: entry.product,
    mcu: entry.mcu,
    features: entry.features,
    notes: [],
    url: entry.url,
    // Upstream's variant descriptions belong to the donor, not to this board.
    variants: {},
    flashOffset: entry.flashOffset,
    // No photo: these boards have no entry in micropython.org's media, so the
    // card draws its initials rather than borrowing the donor's picture — a
    // generic DevKit photo on an Adafruit card would be a lie in the one place
    // people look first.
    image: null,
    thumb: null,
    builds: borrowed,
    flash: entry.flash,
    externalFlash: entry.externalFlash ?? null,
    ram: entry.ram,
    psram: entry.psram,
    runtimes,
    circuitPythonBoardId: entry.circuitPythonBoardId,
    origin: 'snakie',
    substitute: { boardId: entry.donorBoardId, build: entry.donorBuild, why: entry.why }
  }
}

/**
 * The overlay entries that still have a job to do.
 *
 * An entry whose id upstream has since published is dropped: the generated
 * document is better than a hand-written one the moment it exists, and a
 * catalogue that lists the same board twice is a bug report waiting to happen.
 */
export function overlayEntries(upstream: readonly IndexedBoard[]): IndexedBoard[] {
  const known = new Set(upstream.map((b) => b.id))
  return OVERLAY_BOARDS.filter((e) => !known.has(e.id)).map((e) => toIndexedBoard(e, upstream))
}

/** Upstream's catalogue plus the overlay — what the gallery actually shows. */
export function withOverlay(upstream: readonly IndexedBoard[]): IndexedBoard[] {
  return [...upstream, ...overlayEntries(upstream)]
}
