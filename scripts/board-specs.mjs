/**
 * WHERE THE BOARD INDEX'S FLASH, RAM AND RUNTIME FIGURES COME FROM (#897, #902).
 * =============================================================================
 *
 * `board.json` publishes no flash size and no RAM size. Its `features` list has
 * `External Flash` and `External RAM` as booleans and nothing else, so the two
 * numbers people most want when choosing a board are the two upstream does not
 * have. This module is the answer to "then where did that number come from?",
 * and every figure it emits carries a `source` saying so.
 *
 * THREE SOURCES, IN DESCENDING ORDER OF COVERAGE AND ASCENDING ORDER OF EFFORT:
 *
 *  1. **The chip's own SRAM**, from `mcu`. Exact, free, and correct for every
 *     part in the family — but it is the CHIP's figure, so it is marked
 *     `scope: 'chip'` and says nothing about the module. Every RP2040 has 264 KB
 *     of SRAM; RP2040 boards ship with 2 MB to 16 MB of flash.
 *
 *     Only families whose SRAM is genuinely fixed are listed. `stm32f4` covers
 *     the F401 at 96 KB and the F439 at 256 KB; `nrf52` covers the nRF52832 at
 *     64 KB and the nRF52840 at 256 KB; `samd21`, `samd51` and `mimxrt` are the
 *     same story. Those are ABSENT rather than averaged — a plausible wrong
 *     number is worse than a blank, because a blank gets checked.
 *
 *  2. **Curated boards**, where a maker's page or upstream's own build
 *     configuration states it outright. Small on purpose.
 *
 *  3. **The manufacturer `url` each board already carries.** That is the
 *     authoritative source for the rest and it is per-vendor work with a review
 *     step, not one parser: those pages have no common structure, and guessing
 *     sends someone to a board that cannot hold their program. Left to a
 *     follow-up, with the count of boards still unknown reported by the run.
 *
 * A NOTE ON WHAT LOOKS LIKE A SHORTCUT AND IS NOT. `ports/rp2/boards/<BOARD>/
 * mpconfigboard.cmake` carries `MICROPY_HW_FLASH_STORAGE_BYTES`, which is
 * tempting and wrong: it is the size of the FILESYSTEM partition, not of the
 * flash. RPI_PICO sets 1441792 on a 2 MB part; RPI_PICO2 sets 3145728 on a 4 MB
 * one, with the arithmetic in a comment. Deriving flash from it means guessing
 * the firmware reservation, which varies. Likewise `ports/esp32/boards/<BOARD>/
 * sdkconfig.board` mostly does not set a flash size at all — the boards inherit
 * shared `sdkconfig` fragments — so there is no per-board figure to read.
 *
 * Kept as `.mjs` beside the generator that uses it, and pure, so `test/
 * boardSpecs.test.ts` exercises the tables directly rather than diffing output.
 */

const KiB = 1024
const MiB = 1024 * 1024

/**
 * Built-in SRAM per chip family, for families where it is fixed across the part.
 *
 * `source` names the datasheet rather than a URL, because these outlive any
 * particular documentation URL and a reader can find them by that name.
 */
export const MCU_SRAM = {
  rp2040: { bytes: 264 * KiB, source: 'Raspberry Pi RP2040 datasheet' },
  rp2350: { bytes: 520 * KiB, source: 'Raspberry Pi RP2350 datasheet' },
  esp32: { bytes: 520 * KiB, source: 'Espressif ESP32 datasheet' },
  esp32s2: { bytes: 320 * KiB, source: 'Espressif ESP32-S2 datasheet' },
  esp32s3: { bytes: 512 * KiB, source: 'Espressif ESP32-S3 datasheet' },
  esp32c2: { bytes: 272 * KiB, source: 'Espressif ESP32-C2 datasheet' },
  esp32c3: { bytes: 400 * KiB, source: 'Espressif ESP32-C3 datasheet' },
  esp32c5: { bytes: 384 * KiB, source: 'Espressif ESP32-C5 datasheet (HP SRAM)' },
  esp32c6: { bytes: 512 * KiB, source: 'Espressif ESP32-C6 datasheet (HP SRAM)' },
  esp32p4: { bytes: 768 * KiB, source: 'Espressif ESP32-P4 datasheet (HP SRAM)' }
  // esp32h2 and esp8266 are deliberately absent: the published figures for both
  // disagree with each other often enough that I could not name one and stand
  // behind it. Two boards and one board respectively — not worth a wrong number.
}

/**
 * Boards whose sizes are stated by a source I have actually read.
 *
 * Seeded from `src/shared/board-profiles.ts`, which has carried some of these by
 * hand since #756 ("8 MB flash, 2 MB PSRAM" on the Feather V2), plus the makers'
 * own documentation for the rest. `flash` and `psram` are `board` scope; SRAM is
 * left to {@link MCU_SRAM} so one chip's figure lives in one place.
 *
 * `psram: null` is a CLAIM, not a gap — it says the board has none — and is set
 * only where the maker says so.
 */
export const CURATED_BOARDS = {
  RPI_PICO: {
    flash: { bytes: 2 * MiB, source: 'raspberrypi.com Pico series documentation' },
    psram: null
  },
  RPI_PICO_W: {
    flash: { bytes: 2 * MiB, source: 'raspberrypi.com Pico series documentation' },
    psram: null
  },
  RPI_PICO2: {
    flash: { bytes: 4 * MiB, source: 'raspberrypi.com Pico series documentation' },
    psram: null
  },
  RPI_PICO2_W: {
    flash: { bytes: 4 * MiB, source: 'raspberrypi.com Pico series documentation' },
    psram: null
  },
  SEEED_XIAO_ESP32S3: {
    // Upstream's own build configuration says it, in a comment above the
    // `sdkconfig.spiram_oct` it selects because of it — which is better than a
    // product page: it is what the firmware people flash is compiled for.
    flash: {
      bytes: 8 * MiB,
      source: 'MicroPython ports/esp32/boards/SEEED_XIAO_ESP32S3/mpconfigboard.cmake'
    },
    psram: {
      bytes: 8 * MiB,
      source: 'MicroPython ports/esp32/boards/SEEED_XIAO_ESP32S3/mpconfigboard.cmake'
    }
  }
}

/**
 * The flash / RAM / PSRAM to publish for one board, or nulls where nothing is
 * known. `board` beats `chip`, and nothing is invented.
 */
export function specsForBoard(board) {
  const curated = CURATED_BOARDS[board.id]
  const sram = MCU_SRAM[board.mcu]
  return {
    flash: curated?.flash ? { ...curated.flash, scope: 'board' } : null,
    ram: sram ? { ...sram, scope: 'chip' } : null,
    psram: curated?.psram ? { ...curated.psram, scope: 'board' } : null
  }
}

// ---------------------------------------------------------------------------
// Which runtimes a board has a published build for
// ---------------------------------------------------------------------------

/**
 * Thonny's curated CircuitPython catalogues — the same three files
 * `shared/firmware-runtime.ts` verified in 2026-08, and the same records Snakie
 * already flashes CircuitPython from. Fetched rather than vendored so a board
 * added there this month is matched next time this runs.
 */
export const CIRCUITPYTHON_CATALOGS = [
  'https://raw.githubusercontent.com/thonny/thonny/master/data/circuitpython-variants-uf2.json',
  'https://raw.githubusercontent.com/thonny/thonny/master/data/circuitpython-variants-esptool.json',
  'https://raw.githubusercontent.com/thonny/thonny/master/data/circuitpython-variants-daplink.json'
]

/** Case- and separator-insensitive, so `Pro Micro - RP2040` meets `pro_micro_rp2040`. */
const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Two lookups over the CircuitPython catalogue, and only two.
 *
 * MicroPython and CircuitPython name boards independently, so there is no
 * general mapping between them — but there are two joins that are facts rather
 * than guesses:
 *
 *   - **the same id.** `SEEED_XIAO_ESP32S3` lowercased IS CircuitPython's
 *     `seeed_xiao_esp32s3`. Their id namespaces are separately maintained, but
 *     an id that exists in CircuitPython's is unambiguously the board it names.
 *   - **the same maker and the same product name.** `Raspberry Pi` + `Pico 2 W`
 *     is one board, whoever is writing the catalogue.
 *
 * A vendor+model that resolves to more than one CircuitPython board is dropped
 * rather than resolved by picking one: flashing the wrong `.uf2` leaves a board
 * that needs re-flashing before it will talk again, so an ambiguous match is a
 * reason to say nothing. Everything past these two — fuzzy names, shared chips,
 * "it is probably the S3 one" — is guessing, and is not done.
 */
export function circuitPythonIndex(catalogs) {
  const byId = new Set()
  const byVendorModel = new Map()
  for (const entry of catalogs.flat()) {
    const m = /circuitpython\.org\/board\/([^/]+)\//.exec(entry?.info_url ?? '')
    if (!m) continue
    const id = m[1]
    byId.add(id)
    const key = `${norm(entry.vendor)}|${norm(entry.model)}`
    const seen = byVendorModel.get(key)
    if (seen === undefined) byVendorModel.set(key, id)
    else if (seen !== id) byVendorModel.set(key, null) // ambiguous ⇒ say nothing
  }
  return { byId, byVendorModel }
}

/** The board's CircuitPython id, or null when neither join lands. */
export function circuitPythonIdFor(board, index) {
  const lower = board.id.toLowerCase()
  if (index.byId.has(lower)) return lower
  return index.byVendorModel.get(`${norm(board.vendor)}|${norm(board.product)}`) ?? null
}

/**
 * The runtimes with a published, flashable build for this board.
 *
 * `micropython` iff something is actually published — three of the 225 sit in
 * upstream's tree with no download page. `circuitpython` iff an id was
 * confirmed; its absence means "not confirmed", which the gallery is careful to
 * say rather than rendering as "no".
 */
export function runtimesForBoard(board, circuitPythonBoardId) {
  const runtimes = []
  if (board.builds.length > 0) runtimes.push('micropython')
  if (circuitPythonBoardId) runtimes.push('circuitpython')
  return runtimes
}
