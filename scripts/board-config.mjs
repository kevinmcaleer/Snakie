/**
 * READING SIZES OUT OF MICROPYTHON'S OWN PER-BOARD BUILD CONFIGURATION (#897).
 * =============================================================================
 *
 * `board.json` publishes no flash size and no RAM size — but the files BESIDE it
 * often do, because the firmware cannot be built without them. `ports/mimxrt/
 * boards/TEENSY41/mpconfigboard.mk` says `MICROPY_HW_FLASH_SIZE = 0x800000`
 * because that is the QSPI part on the board; `ports/rp2/boards/SEEED_XIAO_RP2350
 * /mpconfigboard.cmake` names a pico-sdk board whose header states the same thing.
 * Those are better than a product page: they are what the firmware people
 * actually flash was compiled against, and they cite a path anyone can open.
 *
 * SO THIS IS SEVERAL SMALL READERS, ONE PER PORT — NOT ONE PARSER.
 * Each port answers a different question in a different file, and the ways they
 * go wrong are different too. A single "find a number that looks like a size"
 * pass over all of them would find plenty, and some of them would be lies:
 *
 *   - **rp2** — see {@link readRp2}. `MICROPY_HW_FLASH_STORAGE_BYTES` is the
 *     FILESYSTEM partition, not the part (RPI_PICO reports 1441792 on a 2 MB
 *     chip), and half these boards borrow another board's pico-sdk header.
 *   - **stm32 / nrf / samd / renesas-ra** — the file names the CHIP, not a size.
 *     The size then comes from the silicon vendor's datasheet, via
 *     `MCU_MEMORY` in `board-specs.mjs`.
 *   - **esp32** — almost nothing. Three boards of the 45 set a flash size; the
 *     rest inherit shared `sdkconfig` fragments that do not mention one.
 *   - **mimxrt** — the one port where the board file states the external flash
 *     outright, because there is no internal flash to fall back on.
 *
 * Pure text-in, facts-out, so `test/boardSpecs.test.ts` feeds them the awkward
 * real files rather than diffing generated output.
 */

/** Which files this port's reader wants, relative to the board's directory. */
export const PORT_CONFIG_FILES = {
  stm32: ['mpconfigboard.h', 'mpconfigboard.mk'],
  nrf: ['mpconfigboard.mk'],
  samd: ['mpconfigboard.mk'],
  'renesas-ra': ['mpconfigboard.h'],
  mimxrt: ['mpconfigboard.mk'],
  esp32: ['sdkconfig.board'],
  rp2: ['mpconfigboard.cmake']
}

/**
 * A C/CMake/Make size expression as bytes: `(8 * 1024 * 1024)`, `0x800000`, `16`.
 *
 * Deliberately arithmetic-only and deliberately tiny. Anything with a symbol in
 * it — `PICO_FLASH_SIZE_BYTES - (1024 * 1024)`, which several boards write —
 * returns null rather than being resolved, because resolving it means knowing
 * what the symbol was, and being wrong about that is how you publish a firmware
 * reservation as a flash size.
 */
export function sizeExpression(text) {
  const s = String(text ?? '')
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*$/, '')
    .replace(/#.*$/, '')
    .trim()
  if (!s || !/^[-+*()\s\w]+$/.test(s)) return null
  // A bare identifier, or any letter that is not part of a hex literal, means a
  // symbol we cannot resolve here.
  if (/[g-wyzG-WYZ]/.test(s.replace(/0[xX][0-9a-fA-F]+/g, ''))) return null
  let total = 0
  for (const term of s.replace(/[()]/g, '').split('+')) {
    if (term.includes('-')) return null
    let product = 1
    for (const factor of term.split('*')) {
      const n = Number(factor.trim())
      if (!Number.isFinite(n)) return null
      product *= n
    }
    total += product
  }
  return Number.isSafeInteger(total) && total > 0 ? total : null
}

const line = (text, re) => re.exec(text ?? '')?.[1]?.trim() ?? null

/**
 * The chip an stm32 board carries, said twice.
 *
 * `mpconfigboard.h`'s `MICROPY_HW_MCU_NAME` is the BOARD's statement and the
 * `.mk`'s `CMSIS_MCU` is the BUILD's, and neither is reliably the better one:
 *
 *   - the Espruino Pico builds with `STM32F401xE` and names itself
 *     `STM32F401CD`, which is the part it actually has — 384 KB of flash, not
 *     the 512 KB the build's memory map allows for. The board wins.
 *   - the HydraBus builds with `STM32F405xx` and names itself `STM32F4`, which
 *     is not a part at all. The build wins.
 *
 * So both are reported and the caller tries them in order — a name that is too
 * vague to be in the memory table simply falls through to the other one, which
 * is the same "say nothing rather than guess" rule one level down.
 */
export function readStm32(files) {
  return {
    part: line(files['mpconfigboard.h'], /MICROPY_HW_MCU_NAME\s+"([^"]+)"/),
    partAlso: line(files['mpconfigboard.mk'], /^CMSIS_MCU\s*=\s*(\S+)/m)
  }
}

/** Renesas names the chip in the same place, and has no `CMSIS_MCU` fallback. */
export function readRenesasRa(files) {
  return { part: line(files['mpconfigboard.h'], /MICROPY_HW_MCU_NAME\s+"([^"]+)"/) }
}

/** SAM D names the exact part, ordering suffix and all: `SAMD51J19A`. */
export function readSamd(files) {
  return { part: line(files['mpconfigboard.mk'], /^CMSIS_MCU\s*=\s*(\S+)/m) }
}

/** A linker-script size: `512K`, `1M`, `0x80000`, `262144`. */
export function linkerSize(text) {
  const m = /^\s*(0[xX][0-9a-fA-F]+|\d+)\s*([KMG])?\s*$/.exec(String(text ?? ''))
  if (!m) return null
  const scale = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 }[m[2]] ?? 1
  const n = Number(m[1]) * scale
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** The top-level `boards/*.ld` scripts an nrf board's makefile pulls in. */
export function nrfMemoryScriptsFor(files) {
  const out = []
  for (const m of (files['mpconfigboard.mk'] ?? '').matchAll(/boards\/([A-Za-z0-9_.]+\.ld)\b/g)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

/**
 * Nordic: the sub-variant, and the memory map the board is actually linked for.
 *
 * `MCU_SUB_VARIANT` alone is not a part. `nrf52832` is sold as the 512 KB/64 KB
 * QFAA and the 256 KB/32 KB QFAB — a factor of two apart on both axes — and
 * `nrf51822` has three configurations. On the strength of that name, 22 of the
 * 23 nrf boards would have to say nothing at all.
 *
 * They do not have to, because each board's makefile names the memory map it
 * links against: `LD_FILES += boards/nrf52832_512k_64k.ld`, whose first two
 * lines are `_flash_size = 512K;` and `_ram_size = 64K;`. That is a statement
 * about THIS board — a 512 KB image will not fit a QFAB, so a board built this
 * way carries the QFAA — and it is one file away for anyone checking.
 *
 * Only a script defining BOTH sizes counts, which is what separates the memory
 * map from the bootloader and softdevice scripts listed beside it; and only if
 * exactly one does, so a board pulling in two never has one picked for it.
 */
export function readNrf(files, { boardId, nrfScripts = {} } = {}) {
  const part = line(files['mpconfigboard.mk'], /^MCU_SUB_VARIANT\s*=\s*(\S+)/m)
  const found = []
  for (const [name, text] of Object.entries(nrfScripts)) {
    const flash = linkerSize(line(text, /^\s*_flash_size\s*=\s*([^;]+);/m))
    const sram = linkerSize(line(text, /^\s*_ram_size\s*=\s*([^;]+);/m))
    if (flash && sram) found.push({ flash, sram, source: `MicroPython ports/nrf/boards/${name}` })
  }
  if (found.length !== 1) return { part }
  return { part, chipMemory: found[0], nrfSubVariant: part, boardId }
}

/**
 * i.MX RT: the one port that states its own sizes.
 *
 * These chips have no usable internal flash, so the board file has to name the
 * QSPI part's size for the firmware to link at all — which makes
 * `MICROPY_HW_FLASH_SIZE` a statement about THIS board's flash chip, not a
 * partition and not a family default. `MICROPY_HW_SDRAM_SIZE` is the same for
 * external SDRAM where the board has any.
 */
export function readMimxrt(files, { boardId } = {}) {
  const mk = files['mpconfigboard.mk']
  const at = `MicroPython ports/mimxrt/boards/${boardId}/mpconfigboard.mk`
  const flash = sizeExpression(line(mk, /^MICROPY_HW_FLASH_SIZE\s*\??=\s*(.+)$/m))
  const externalRam = sizeExpression(line(mk, /^MICROPY_HW_SDRAM_SIZE\s*\??=\s*(.+)$/m))
  return {
    part: line(mk, /^MCU_SERIES\s*=\s*(\S+)/m),
    flash,
    flashSource: flash ? `${at} (MICROPY_HW_FLASH_SIZE)` : null,
    externalRam,
    externalRamSource: externalRam ? `${at} (MICROPY_HW_SDRAM_SIZE)` : null
  }
}

/**
 * esp32: the little that `sdkconfig.board` says.
 *
 * Three of the 45 esp32 boards set `CONFIG_ESPTOOLPY_FLASHSIZE_<n>MB=y`; the
 * rest inherit shared fragments that set no size, so there is nothing per-board
 * to read and this returns null for them. That is the honest answer — the size
 * for those comes from the maker's page or not at all.
 *
 * The `=y` matters: boards that list the other sizes commented out or empty
 * (`CONFIG_ESPTOOLPY_FLASHSIZE_4MB=`) are saying which one is NOT selected.
 */
export function readEsp32(files, { boardId } = {}) {
  const m = /^CONFIG_ESPTOOLPY_FLASHSIZE_(\d+)MB=y\s*$/m.exec(files['sdkconfig.board'] ?? '')
  if (!m) return { flash: null, flashSource: null }
  return {
    flash: Number(m[1]) * 1024 * 1024,
    flashSource: `MicroPython ports/esp32/boards/${boardId}/sdkconfig.board (CONFIG_ESPTOOLPY_FLASHSIZE)`
  }
}

/** Case- and separator-insensitive, so `weact_studio_rp2350b_core` meets `WEACTSTUDIO_RP2350B_CORE`. */
const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * What an rp2 board's `mpconfigboard.cmake` says about its flash — carefully.
 *
 * The RP2040 and RP2350 have no internal flash at all, so the size is entirely a
 * property of the module, and pico-sdk's board headers state it as
 * `PICO_FLASH_SIZE_BYTES`. That is Raspberry Pi publishing a figure about
 * somebody's board, which is as good a source as the maker's own page.
 *
 * THE TRAP, and the reason this is fifty lines rather than five: MicroPython
 * frequently points a board at ANOTHER board's header, because it only needs the
 * pin definitions to be close enough. `CYTRON_MOTION_2350_PRO` sets
 * `PICO_BOARD "pico2"`, and `W5500_EVB_PICO` sets the W5100S board's header.
 * Reading the flash size out of those gives you Raspberry Pi's figure for a
 * Raspberry Pi board, correctly, about the wrong board.
 *
 * So a header only counts when it is THIS board's:
 *
 *   1. the board's own `mpconfigboard.cmake` sets `PICO_FLASH_SIZE_BYTES`
 *      outright — nobody writes that about someone else's board;
 *   2. the header is shipped inside the board's own directory in MicroPython's
 *      tree — same argument;
 *   3. the pico-sdk header's name IS this board's name, ignoring case and
 *      punctuation.
 *
 * Anything else returns null and falls through to curation. `RPI_PICO` → `pico`
 * fails rule 3 and that is fine: the Picos are curated from raspberrypi.com,
 * which is a better citation than a header anyway, and the two agree.
 *
 * Returns the claim plus WHERE it came from, because the caller has to print
 * that beside the number.
 */
export function readRp2(files, { boardId, ownHeaders = {}, picoSdkHeaders = {} } = {}) {
  const cmake = files['mpconfigboard.cmake'] ?? ''
  const picoBoard = line(cmake, /set\(\s*PICO_BOARD\s+"?([A-Za-z0-9_]+)"?\s*\)/)
  const storage = sizeExpression(line(cmake, /set\(\s*MICROPY_HW_FLASH_STORAGE_BYTES\s+(\d+)\s*\)/))

  let flash = sizeExpression(line(cmake, /set\(\s*PICO_FLASH_SIZE_BYTES\s+([^)]+)\)/))
  let from = flash ? `MicroPython ports/rp2/boards/${boardId}/mpconfigboard.cmake` : null

  if (!flash) {
    for (const [name, text] of Object.entries(ownHeaders)) {
      const size = sizeExpression(line(text, /#define\s+PICO_FLASH_SIZE_BYTES\s+(.+)$/m))
      if (size) {
        flash = size
        from = `MicroPython ports/rp2/boards/${boardId}/${name}`
        break
      }
    }
  }
  if (!flash && picoBoard && norm(picoBoard) === norm(boardId)) {
    const size = sizeExpression(
      line(picoSdkHeaders[picoBoard], /#define\s+PICO_FLASH_SIZE_BYTES\s+(.+)$/m)
    )
    if (size) {
      flash = size
      from = `Raspberry Pi pico-sdk src/boards/include/boards/${picoBoard}.h`
    }
  }

  // A last guard that costs nothing: the filesystem cannot be bigger than the
  // flash it lives in. If it is, the header has been paired with the wrong
  // board and the number is not about this one.
  if (flash && storage && storage >= flash) return { flash: null, flashSource: null, picoBoard }

  return { flash, flashSource: flash ? `${from} (PICO_FLASH_SIZE_BYTES)` : null, picoBoard }
}

/** The pico-sdk header this board would need fetching, or null. */
export function picoSdkBoardFor(files, boardId) {
  const picoBoard = line(files['mpconfigboard.cmake'] ?? '', /set\(\s*PICO_BOARD\s+"?([A-Za-z0-9_]+)"?\s*\)/)
  return picoBoard && norm(picoBoard) === norm(boardId) ? picoBoard : null
}

/** Dispatch to the right reader. Ports with no reader simply say nothing. */
export function readBoardConfig(port, files, options = {}) {
  switch (port) {
    case 'stm32':
      return readStm32(files)
    case 'renesas-ra':
      return readRenesasRa(files)
    case 'samd':
      return readSamd(files)
    case 'nrf':
      return readNrf(files, options)
    case 'mimxrt':
      return readMimxrt(files, options)
    case 'esp32':
      return readEsp32(files, options)
    case 'rp2':
      return readRp2(files, options)
    default:
      return {}
  }
}
