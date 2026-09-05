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
 * FOUR SOURCES, IN DESCENDING ORDER OF COVERAGE AND ASCENDING ORDER OF EFFORT:
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
 *  2. **The exact chip, where upstream's build config names one** — {@link
 *     CHIP_MEMORY}, read by `board-config.mjs`. This is what raised #897 from
 *     "five boards have a flash size" to most of the catalogue: `ports/stm32/
 *     boards/NUCLEO_F401RE/mpconfigboard.h` says `STM32F401xE`, and ST says that
 *     part has 512 KB of flash and 96 KB of SRAM. On every port whose MCU has
 *     internal flash — stm32, nrf, samd, renesas-ra — the flash IS the chip's,
 *     so naming the chip names the flash.
 *
 *     Same rule as (1) about ambiguity, one level finer: a key that does not pin
 *     the memory down is absent rather than averaged. `nrf52832` ships in two
 *     memory configurations, so it has an SRAM figure and no flash figure.
 *
 *  3. **Sizes upstream states outright**, also via `board-config.mjs` — i.MX RT's
 *     `MICROPY_HW_FLASH_SIZE`, esp32's `CONFIG_ESPTOOLPY_FLASHSIZE`, rp2's
 *     pico-sdk board headers. Only on the ports whose parts have no internal
 *     flash, which is exactly why those ports have to say it.
 *
 *  4. **Curated boards** — {@link CURATED_BOARDS} — from the manufacturer `url`
 *     each board already carries. Per-vendor work with a review step, not one
 *     parser: those pages have no common structure, and guessing sends someone
 *     to a board that cannot hold their program. This table holds what the first
 *     three cannot reach: every ESP32 module's flash, the second flash chip so
 *     many boards add beside the MCU, and PSRAM sizes.
 *
 * WHERE THEY DISAGREE. They mostly do not, and the agreement is worth having:
 * upstream's pinned pico-sdk, SparkFun's product pages and SparkFun's own docs
 * independently give the same 16 MB for six RP2350 boards. Where a curated
 * figure and a derived one would collide, the DERIVED one wins and the curated
 * entry is deleted rather than left to shadow it — a table that silently
 * overrides a mechanically-refreshed figure is a table that goes stale in
 * secret. What curation adds is the fields nothing else publishes.
 *
 * A NOTE ON WHAT LOOKS LIKE A SHORTCUT AND IS NOT. `ports/rp2/boards/<BOARD>/
 * mpconfigboard.cmake` carries `MICROPY_HW_FLASH_STORAGE_BYTES`, which is
 * tempting and wrong: it is the size of the FILESYSTEM partition, not of the
 * flash. RPI_PICO sets 1441792 on a 2 MB part; RPI_PICO2 sets 3145728 on a 4 MB
 * one, with the arithmetic in a comment. Deriving flash from it means guessing
 * the firmware reservation, which varies. Likewise `ports/esp32/boards/<BOARD>/
 * sdkconfig.board` mostly does not set a flash size at all — the boards inherit
 * shared `sdkconfig` fragments — so 3 of the 45 esp32 boards have one to read.
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
  esp32h2: { bytes: 320 * KiB, source: 'Espressif ESP32-H2 datasheet (HP SRAM)' },
  esp32p4: { bytes: 768 * KiB, source: 'Espressif ESP32-P4 datasheet (HP SRAM)' }
  // esp8266 is deliberately absent, and now for a reason rather than a doubt:
  // Espressif's current datasheet states no total RAM figure at all. The only
  // quantity it gives is software-dependent — "RAM size < 50 kB … according to
  // our current version of SDK … under the Station mode" — and the 32K/80K split
  // everyone quotes traces to a dead BBS wiki page, not to any Espressif
  // document. One board, and no honest number to put on it.
  //
  // esp32h2 was absent for the same doubt and is now here: the datasheet and the
  // technical reference manual agree at 320 KB HP SRAM, and differ only in
  // whether they add the 4 KB of LP memory, which is listed on its own line.
}

/**
 * Flash and SRAM for an exact chip, from the silicon vendor's own datasheet.
 *
 * Keyed by the string upstream's build configuration writes, so a reader can go
 * from `ports/stm32/boards/NUCLEO_F401RE/mpconfigboard.h` to a row here without
 * a translation step. Upstream writes the same part several ways — `STM32F405RG`
 * in one board's header and `STM32F405xx` in another's makefile — so both appear
 * as keys, and `board-config.mjs` hands over both for the lookup to try in turn.
 *
 * FLASH IS `chip` SCOPE HERE, and that is the point. On these parts it is on the
 * die, so it is a fact about every board carrying one — and a board may well add
 * a second flash chip beside it, which is `externalFlash` and is nothing to do
 * with this table.
 *
 * A KEY THAT DOES NOT PIN THE MEMORY DOWN CARRIES NO `flash`:
 *
 *   - `nrf52832` is sold as the 512 KB/64 KB QFAA and the 256 KB/32 KB QFAB, so
 *     it has an SRAM figure only — and `nrf51822`, worse, spans three.
 *   - `STM32F407` names four parts between 512 KB and 1 MB; its SRAM is 192 KB
 *     on all of them. Same for `STM32F413`, `STM32F429`, `STM32F746`.
 *
 * Those rows are the ones most likely to be "improved" by somebody filling in a
 * plausible number. They are blank on purpose. Where the BOARD settles it,
 * {@link BOARD_MCU_PART} names the exact part instead.
 */
export const CHIP_MEMORY = {
  // --- ST, exact parts -----------------------------------------------------
  // Figures from ST's own STM32CubeMX MCU database (STMicroelectronics/
  // STM32_open_pin_data, which is what CubeMX ships), cross-checked region by
  // region against Zephyr's device trees — the address-mapped breakdown is the
  // only way to add these up safely, because CubeMX's own `<Ram>` field means
  // different things in different families: on the F405 it EXCLUDES the 64 KB
  // CCM, on the F746 it INCLUDES the 64 KB DTCM, and on the H723 it includes
  // the TCM and the backup RAM both.
  //
  // TWO THINGS ARE EXCLUDED THROUGHOUT, and the same way every time:
  //   - backup SRAM (4 KB on most F4/F7/H7, 2 KB on U5). It is a separate power
  //     domain and nobody's program lives in it.
  //   - the F7 family's 16 KB instruction TCM. ST's own headline leaves it out
  //     ("320 Kbytes … + 16 Kbytes of instruction TCM RAM"), MicroPython puts
  //     nothing in it, and counting it would make every F7 board look 16 KB
  //     roomier than it is.
  // The H7's TCM is NOT excluded, because ST counts it in its own headline
  // ("up to 1 Mbyte of RAM … including 192 Kbytes of TCM RAM").
  STM32F091RC: { flash: 256 * KiB, sram: 32 * KiB, source: 'ST STM32F091RC (CubeMX MCU database)' },
  STM32F091xC: { flash: 256 * KiB, sram: 32 * KiB, source: 'ST STM32F091xC (CubeMX MCU database)' },
  STM32F401CD: { flash: 384 * KiB, sram: 96 * KiB, source: 'ST STM32F401CD (CubeMX MCU database)' },
  STM32F401RE: { flash: 512 * KiB, sram: 96 * KiB, source: 'ST STM32F401RE (CubeMX MCU database)' },
  STM32F401xE: { flash: 512 * KiB, sram: 96 * KiB, source: 'ST STM32F401xE (CubeMX MCU database)' },
  STM32F405RG: { flash: 1 * MiB, sram: 192 * KiB, source: 'ST STM32F405RG (CubeMX MCU database)' },
  STM32F405xx: { flash: 1 * MiB, sram: 192 * KiB, source: 'ST STM32F405 (CubeMX MCU database)' },
  STM32F407VE: { flash: 512 * KiB, sram: 192 * KiB, source: 'ST STM32F407VE (CubeMX MCU database)' },
  STM32F407VG: { flash: 1 * MiB, sram: 192 * KiB, source: 'ST STM32F407VG (CubeMX MCU database)' },
  STM32F407ZG: { flash: 1 * MiB, sram: 192 * KiB, source: 'ST STM32F407ZG (CubeMX MCU database)' },
  STM32F411CE: { flash: 512 * KiB, sram: 128 * KiB, source: 'ST STM32F411CE (CubeMX MCU database)' },
  STM32F411RE: { flash: 512 * KiB, sram: 128 * KiB, source: 'ST STM32F411RE (CubeMX MCU database)' },
  STM32F411xE: { flash: 512 * KiB, sram: 128 * KiB, source: 'ST STM32F411xE (CubeMX MCU database)' },
  STM32F412RE: { flash: 512 * KiB, sram: 256 * KiB, source: 'ST STM32F412RE (CubeMX MCU database)' },
  STM32F412ZG: { flash: 1 * MiB, sram: 256 * KiB, source: 'ST STM32F412ZG (CubeMX MCU database)' },
  STM32F413ZH: { flash: 1536 * KiB, sram: 320 * KiB, source: 'ST STM32F413ZH (CubeMX MCU database)' },
  STM32F427VI: { flash: 2 * MiB, sram: 256 * KiB, source: 'ST STM32F427VI (CubeMX MCU database)' },
  STM32F429ZG: { flash: 1 * MiB, sram: 256 * KiB, source: 'ST STM32F429ZG (CubeMX MCU database)' },
  STM32F429ZI: { flash: 2 * MiB, sram: 256 * KiB, source: 'ST STM32F429ZI (CubeMX MCU database)' },
  STM32F439ZI: { flash: 2 * MiB, sram: 256 * KiB, source: 'ST STM32F439ZI (CubeMX MCU database)' },
  STM32F446RE: { flash: 512 * KiB, sram: 128 * KiB, source: 'ST STM32F446RE (CubeMX MCU database)' },
  STM32F469NI: { flash: 2 * MiB, sram: 384 * KiB, source: 'ST STM32F469NI (CubeMX MCU database)' },
  STM32F722IE: { flash: 512 * KiB, sram: 256 * KiB, source: 'ST STM32F722IE (CubeMX MCU database)' },
  STM32F722ZE: { flash: 512 * KiB, sram: 256 * KiB, source: 'ST STM32F722ZE (CubeMX MCU database)' },
  STM32F733IE: { flash: 512 * KiB, sram: 256 * KiB, source: 'ST STM32F733IE (CubeMX MCU database)' },
  STM32F746NG: { flash: 1 * MiB, sram: 320 * KiB, source: 'ST STM32F746NG (CubeMX MCU database)' },
  STM32F746ZG: { flash: 1 * MiB, sram: 320 * KiB, source: 'ST STM32F746ZG (CubeMX MCU database)' },
  STM32F756ZG: { flash: 1 * MiB, sram: 320 * KiB, source: 'ST STM32F756ZG (CubeMX MCU database)' },
  STM32F767II: { flash: 2 * MiB, sram: 512 * KiB, source: 'ST STM32F767II (CubeMX MCU database)' },
  STM32F767ZI: { flash: 2 * MiB, sram: 512 * KiB, source: 'ST STM32F767ZI (CubeMX MCU database)' },
  STM32F769NI: { flash: 2 * MiB, sram: 512 * KiB, source: 'ST STM32F769NI (CubeMX MCU database)' },
  STM32G0B1xE: { flash: 512 * KiB, sram: 144 * KiB, source: 'ST STM32G0B1xE (CubeMX MCU database)' },
  STM32G474RE: { flash: 512 * KiB, sram: 128 * KiB, source: 'ST STM32G474RE (CubeMX MCU database)' },
  STM32H563ZI: { flash: 2 * MiB, sram: 640 * KiB, source: 'ST STM32H563ZI (CubeMX MCU database)' },
  STM32H573II: { flash: 2 * MiB, sram: 640 * KiB, source: 'ST STM32H573II (CubeMX MCU database)' },
  STM32H723VG: { flash: 1 * MiB, sram: 560 * KiB, source: 'ST STM32H723VG (CubeMX MCU database)' },
  STM32H723ZG: { flash: 1 * MiB, sram: 560 * KiB, source: 'ST STM32H723ZG (CubeMX MCU database)' },
  STM32H743VI: { flash: 2 * MiB, sram: 1056 * KiB, source: 'ST STM32H743VI (CubeMX MCU database)' },
  STM32H743ZI: { flash: 2 * MiB, sram: 1056 * KiB, source: 'ST STM32H743ZI (CubeMX MCU database)' },
  STM32H747XI: { flash: 2 * MiB, sram: 1056 * KiB, source: 'ST STM32H747XI (CubeMX MCU database)' },
  STM32H753ZI: { flash: 2 * MiB, sram: 1056 * KiB, source: 'ST STM32H753ZI (CubeMX MCU database)' },
  // 1376, not the 1424 in ST's own CubeMX database: ST's datasheet text says
  // "approximately 1.4 Mbyte … including 192 Kbytes of TCM RAM, 1.18 Mbytes of
  // user SRAM", which is 1376, and Zephyr's mapped regions sum to the same.
  STM32H7A3ZI: { flash: 2 * MiB, sram: 1376 * KiB, source: 'ST STM32H7A3ZI datasheet (192 KB TCM + 1.18 MB user SRAM)' },
  STM32H7B3LI: { flash: 2 * MiB, sram: 1376 * KiB, source: 'ST STM32H7B3LI datasheet (192 KB TCM + 1.18 MB user SRAM)' },
  STM32L072CZ: { flash: 192 * KiB, sram: 20 * KiB, source: 'ST STM32L072CZ (CubeMX MCU database)' },
  STM32L073RZ: { flash: 192 * KiB, sram: 20 * KiB, source: 'ST STM32L073RZ (CubeMX MCU database)' },
  STM32L152xE: { flash: 512 * KiB, sram: 80 * KiB, source: 'ST STM32L152xE (CubeMX MCU database)' },
  STM32L432KC: { flash: 256 * KiB, sram: 64 * KiB, source: 'ST STM32L432KC (CubeMX MCU database)' },
  STM32L452RE: { flash: 512 * KiB, sram: 160 * KiB, source: 'ST STM32L452RE (CubeMX MCU database)' },
  STM32L475VG: { flash: 1 * MiB, sram: 128 * KiB, source: 'ST STM32L475VG (CubeMX MCU database)' },
  STM32L476RG: { flash: 1 * MiB, sram: 128 * KiB, source: 'ST STM32L476RG (CubeMX MCU database)' },
  STM32L476VG: { flash: 1 * MiB, sram: 128 * KiB, source: 'ST STM32L476VG (CubeMX MCU database)' },
  STM32L496ZG: { flash: 1 * MiB, sram: 320 * KiB, source: 'ST STM32L496ZG (CubeMX MCU database)' },
  STM32L4A6ZG: { flash: 1 * MiB, sram: 320 * KiB, source: 'ST STM32L4A6ZG (CubeMX MCU database)' },
  // The STM32N6 has no internal user flash at all — CubeMX says `<Flash>0`,
  // Zephyr defines no flash node, and code runs from external XSPI.
  STM32N657X0: { sram: 4200 * KiB, source: 'ST STM32N657X0 (CubeMX MCU database; no internal flash)' },
  STM32N657xx: { sram: 4200 * KiB, source: 'ST STM32N657 (CubeMX MCU database; no internal flash)' },
  STM32U585CI: { flash: 2 * MiB, sram: 784 * KiB, source: 'ST STM32U585CI (CubeMX MCU database)' },
  STM32U5A5ZJ: { flash: 4 * MiB, sram: 2512 * KiB, source: 'ST STM32U5A5ZJ (CubeMX MCU database)' },
  // Silicon figures. With the BLE coprocessor loaded, roughly 876 KB of the
  // flash and 222 KB of the SRAM are left to the application — but that depends
  // on which stack is flashed, so the chip's own numbers are what is published.
  STM32WB55CG: { flash: 1 * MiB, sram: 256 * KiB, source: 'ST STM32WB55CG (CubeMX MCU database)' },
  STM32WB55RG: { flash: 1 * MiB, sram: 256 * KiB, source: 'ST STM32WB55RG (CubeMX MCU database)' },
  // Shared between the M4 and the M0+ radio stack; there is no second bank.
  STM32WL55JC: { flash: 256 * KiB, sram: 64 * KiB, source: 'ST STM32WL55JC (CubeMX MCU database)' },

  // --- ST, names that stop short of a part ---------------------------------
  // SRAM is constant across each of these lines and the flash is not, so they
  // carry one figure and not the other. `STM32F407` is four parts between
  // 512 KB and 1 MB; `STM32F413` is 1 MB and 1.5 MB; and so on.
  STM32F407: { sram: 192 * KiB, source: 'ST STM32F407 line (CubeMX MCU database)' },
  STM32F407xx: { sram: 192 * KiB, source: 'ST STM32F407 line (CubeMX MCU database)' },
  STM32F411: { sram: 128 * KiB, source: 'ST STM32F411 line (CubeMX MCU database)' },
  STM32F412Rx: { sram: 256 * KiB, source: 'ST STM32F412 line (CubeMX MCU database)' },
  STM32F412Zx: { sram: 256 * KiB, source: 'ST STM32F412 line (CubeMX MCU database)' },
  STM32F413: { sram: 320 * KiB, source: 'ST STM32F413 line (CubeMX MCU database)' },
  STM32F413xx: { sram: 320 * KiB, source: 'ST STM32F413 line (CubeMX MCU database)' },
  STM32F427xx: { sram: 256 * KiB, source: 'ST STM32F427 line (CubeMX MCU database)' },
  STM32F429: { sram: 256 * KiB, source: 'ST STM32F429 line (CubeMX MCU database)' },
  STM32F429xx: { sram: 256 * KiB, source: 'ST STM32F429 line (CubeMX MCU database)' },
  STM32F439: { sram: 256 * KiB, source: 'ST STM32F439 line (CubeMX MCU database)' },
  STM32F439xx: { sram: 256 * KiB, source: 'ST STM32F439 line (CubeMX MCU database)' },
  STM32F446xx: { sram: 128 * KiB, source: 'ST STM32F446 line (CubeMX MCU database)' },
  STM32F469: { sram: 384 * KiB, source: 'ST STM32F469 line (CubeMX MCU database)' },
  STM32F469xx: { sram: 384 * KiB, source: 'ST STM32F469 line (CubeMX MCU database)' },
  STM32F722: { sram: 256 * KiB, source: 'ST STM32F722 line (CubeMX MCU database)' },
  STM32F722xx: { sram: 256 * KiB, source: 'ST STM32F722 line (CubeMX MCU database)' },
  STM32F733xx: { sram: 256 * KiB, source: 'ST STM32F733 line (CubeMX MCU database)' },
  STM32F746: { sram: 320 * KiB, source: 'ST STM32F746 line (CubeMX MCU database)' },
  STM32F746xx: { sram: 320 * KiB, source: 'ST STM32F746 line (CubeMX MCU database)' },
  STM32F756: { sram: 320 * KiB, source: 'ST STM32F756 line (CubeMX MCU database)' },
  STM32F756xx: { sram: 320 * KiB, source: 'ST STM32F756 line (CubeMX MCU database)' },
  STM32F767: { sram: 512 * KiB, source: 'ST STM32F767 line (CubeMX MCU database)' },
  STM32F767xx: { sram: 512 * KiB, source: 'ST STM32F767 line (CubeMX MCU database)' },
  STM32F769: { sram: 512 * KiB, source: 'ST STM32F769 line (CubeMX MCU database)' },
  STM32F769xx: { sram: 512 * KiB, source: 'ST STM32F769 line (CubeMX MCU database)' },
  STM32G474: { sram: 128 * KiB, source: 'ST STM32G474 line (CubeMX MCU database)' },
  STM32G474xx: { sram: 128 * KiB, source: 'ST STM32G474 line (CubeMX MCU database)' },
  STM32H573xx: { sram: 640 * KiB, source: 'ST STM32H573 line (CubeMX MCU database)' },
  STM32H723xx: { sram: 560 * KiB, source: 'ST STM32H723 line (CubeMX MCU database)' },
  STM32H743: { sram: 1056 * KiB, source: 'ST STM32H743 line (CubeMX MCU database)' },
  STM32H743xx: { sram: 1056 * KiB, source: 'ST STM32H743 line (CubeMX MCU database)' },
  STM32H747: { sram: 1056 * KiB, source: 'ST STM32H747 line (CubeMX MCU database)' },
  STM32H747xx: { sram: 1056 * KiB, source: 'ST STM32H747 line (CubeMX MCU database)' },
  STM32H753: { sram: 1056 * KiB, source: 'ST STM32H753 line (CubeMX MCU database)' },
  STM32H753xx: { sram: 1056 * KiB, source: 'ST STM32H753 line (CubeMX MCU database)' },
  STM32H7A3xx: { sram: 1376 * KiB, source: 'ST STM32H7A3 line datasheet' },
  STM32H7B3xx: { sram: 1376 * KiB, source: 'ST STM32H7B3 line datasheet' },
  STM32L072xx: { sram: 20 * KiB, source: 'ST STM32L072 line (CubeMX MCU database)' },
  STM32L073xx: { sram: 20 * KiB, source: 'ST STM32L073 line (CubeMX MCU database)' },
  STM32L432xx: { sram: 64 * KiB, source: 'ST STM32L432 line (CubeMX MCU database)' },
  STM32L452xx: { sram: 160 * KiB, source: 'ST STM32L452 line (CubeMX MCU database)' },
  STM32L475: { sram: 128 * KiB, source: 'ST STM32L475 line (CubeMX MCU database)' },
  STM32L475xx: { sram: 128 * KiB, source: 'ST STM32L475 line (CubeMX MCU database)' },
  STM32L476: { sram: 128 * KiB, source: 'ST STM32L476 line (CubeMX MCU database)' },
  STM32L476xx: { sram: 128 * KiB, source: 'ST STM32L476 line (CubeMX MCU database)' },
  STM32L496: { sram: 320 * KiB, source: 'ST STM32L496 line (CubeMX MCU database)' },
  STM32L496xx: { sram: 320 * KiB, source: 'ST STM32L496 line (CubeMX MCU database)' },
  STM32L4A6xx: { sram: 320 * KiB, source: 'ST STM32L4A6 line (CubeMX MCU database)' },
  STM32U585xx: { sram: 784 * KiB, source: 'ST STM32U585 line (CubeMX MCU database)' },
  STM32U5A5xx: { sram: 2512 * KiB, source: 'ST STM32U5A5 line (CubeMX MCU database)' },
  STM32WB55xx: { sram: 256 * KiB, source: 'ST STM32WB55 line (CubeMX MCU database)' },
  STM32WL55xx: { sram: 64 * KiB, source: 'ST STM32WL55 line (CubeMX MCU database)' },

  // --- Nordic --------------------------------------------------------------
  // The -F / -B ordering suffixes on these change access-port protection, not
  // memory, so the bare name settles both figures.
  nrf52840: { flash: 1 * MiB, sram: 256 * KiB, source: 'Nordic nRF52840 product specification' },
  nrf52833: { flash: 512 * KiB, sram: 128 * KiB, source: 'Nordic nRF52833 product specification' },
  nrf9160: { flash: 1 * MiB, sram: 256 * KiB, source: 'Nordic nRF9160 product specification' },
  // nrf52832 and nrf51822 are absent, and it costs 14 boards. Nordic's own
  // page prints the nRF52832 as "512/256 KB Flash, 64/32 KB RAM" — the QFAA and
  // the QFAB, a factor of two apart on BOTH axes — and the nRF51822 is worse at
  // three variants, one of which exists only on IC revision 3. Upstream's
  // `MCU_SUB_VARIANT` stops at the sub-variant, so there is nothing here that
  // knows which one is on the board.

  // --- Microchip SAM D -----------------------------------------------------
  // The ordering code carries the size: 18 = 256 KB, 19 = 512 KB, 20 = 1 MB.
  SAMD21E18A: { flash: 256 * KiB, sram: 32 * KiB, source: 'Microchip SAM D21/DA1 datasheet DS40001882G' },
  SAMD21G18A: { flash: 256 * KiB, sram: 32 * KiB, source: 'Microchip SAM D21/DA1 datasheet DS40001882G' },
  SAMD21J18A: { flash: 256 * KiB, sram: 32 * KiB, source: 'Microchip SAM D21/DA1 datasheet DS40001882G' },
  // 192 KB and 256 KB, NOT 200 and 264: Microchip prints these as "192/8", and
  // the 8 KB is backup RAM in its own power domain, not contiguous system SRAM.
  SAMD51G19A: { flash: 512 * KiB, sram: 192 * KiB, source: 'Microchip SAM D5x/E5x datasheet DS60001507' },
  SAMD51J19A: { flash: 512 * KiB, sram: 192 * KiB, source: 'Microchip SAM D5x/E5x datasheet DS60001507' },
  SAMD51P19A: { flash: 512 * KiB, sram: 192 * KiB, source: 'Microchip SAM D5x/E5x datasheet DS60001507' },
  SAMD51J20A: { flash: 1 * MiB, sram: 256 * KiB, source: 'Microchip SAM D5x/E5x datasheet DS60001507' },
  SAMD51P20A: { flash: 1 * MiB, sram: 256 * KiB, source: 'Microchip SAM D5x/E5x datasheet DS60001507' },

  // --- Renesas RA ----------------------------------------------------------
  // Upstream names the GROUP (`RA6M2`), not the part, and for the RA6 groups the
  // group spans several flash sizes — RA6M2 is 512 KB to 1 MB, RA6M5 is 1 MB to
  // 2 MB — while the SRAM is constant across each. So those two carry SRAM only.
  RA4M1: { flash: 256 * KiB, sram: 32 * KiB, source: 'Renesas RA4M1 group datasheet' },
  RA4W1: { flash: 512 * KiB, sram: 96 * KiB, source: 'Renesas RA4W1 group datasheet' },
  RA6M1: { flash: 512 * KiB, sram: 256 * KiB, source: 'Renesas RA6M1 group datasheet' },
  RA6M2: { sram: 384 * KiB, source: 'Renesas RA6M2 group datasheet' },
  RA6M5: { sram: 512 * KiB, source: 'Renesas RA6M5 group datasheet' },

  // --- NXP i.MX RT ---------------------------------------------------------
  // No internal flash on any of these but the RT1064, whose 4 MB is a
  // co-packaged QSPI die rather than on-die — and which upstream's
  // `MICROPY_HW_FLASH_SIZE` states anyway, so it is not repeated here. SRAM
  // totals come from each datasheet's "On-chip RAM (…)" line, not from the
  // "up to 512 kB TCM" marketing line, which is half the total on the RT1062.
  MIMXRT1011: { sram: 128 * KiB, source: 'NXP i.MX RT1010 datasheet IMXRT1010CEC' },
  MIMXRT1021: { sram: 256 * KiB, source: 'NXP i.MX RT1020 datasheet IMXRT1020CEC' },
  MIMXRT1052: { sram: 512 * KiB, source: 'NXP i.MX RT1050 datasheet IMXRT1050CEC' },
  MIMXRT1062: { sram: 1 * MiB, source: 'NXP i.MX RT1060 datasheet IMXRT1060CEC' },
  MIMXRT1064: { sram: 1 * MiB, source: 'NXP i.MX RT1064 datasheet IMXRT1064CEC' },
  MIMXRT1176: { sram: 2 * MiB, source: 'NXP i.MX RT1170 datasheet IMXRT1170CEC' },
  // MIMXRT1015 is absent: I did not find NXP's own on-chip RAM figure for it.

  // --- One-off parts, reached through BOARD_MCU_PART ------------------------
  AE722F80F55D5: {
    flash: 5.5 * MiB,
    sram: 13.5 * MiB,
    source: 'Alif Ensemble E7 datasheet ADTS0005 (MRAM / SRAM)'
  },
  PSE846GPS2DBZC4: {
    flash: 512 * KiB,
    // 6 MB total, not the 5120 KB in the ordering table: that column is System
    // SRAM alone and omits the 1 MB in the low-power CPU subsystem.
    sram: 6 * MiB,
    source: 'Infineon PSOC Edge E8x datasheet 002-37630 (RRAM / total SRAM)'
  }
}

/**
 * The exact part a board carries, where upstream's own name is too vague.
 *
 * `ports/stm32/boards/OLIMEX_E407/mpconfigboard.h` says `STM32F407`, which does
 * not settle the flash; Olimex's page says `STM32F407ZGT6`, which does. Only
 * boards where the maker names the full part are here, and the entry cites them.
 */
export const BOARD_MCU_PART = {
  OLIMEX_E407: { part: 'STM32F407ZG', source: 'olimex.com STM32-E407 (STM32F407ZGT6)' },
  OLIMEX_H407: { part: 'STM32F407ZG', source: 'olimex.com STM32-H407 (STM32F407ZGT6)' },

  // ST names a Nucleo after the exact part on it — NUCLEO-F746ZG carries an
  // STM32F746ZGT6 — so for these the board's own name is the missing suffix.
  // Applied ONLY where the id carries a full pin-count-and-flash suffix, which
  // is why the Discovery boards are not here: `STM32F7DISC` names no part.
  NUCLEO_F412ZG: { part: 'STM32F412ZG', source: 'ST NUCLEO-F412ZG' },
  NUCLEO_F413ZH: { part: 'STM32F413ZH', source: 'ST NUCLEO-F413ZH' },
  NUCLEO_F429ZI: { part: 'STM32F429ZI', source: 'ST NUCLEO-F429ZI' },
  NUCLEO_F446RE: { part: 'STM32F446RE', source: 'ST NUCLEO-F446RE' },
  NUCLEO_F722ZE: { part: 'STM32F722ZE', source: 'ST NUCLEO-F722ZE' },
  NUCLEO_F746ZG: { part: 'STM32F746ZG', source: 'ST NUCLEO-F746ZG' },
  NUCLEO_F756ZG: { part: 'STM32F756ZG', source: 'ST NUCLEO-F756ZG' },
  NUCLEO_F767ZI: { part: 'STM32F767ZI', source: 'ST NUCLEO-F767ZI' },
  NUCLEO_G474RE: { part: 'STM32G474RE', source: 'ST NUCLEO-G474RE' },
  NUCLEO_H743ZI: { part: 'STM32H743ZI', source: 'ST NUCLEO-H743ZI' },
  NUCLEO_H743ZI2: { part: 'STM32H743ZI', source: 'ST NUCLEO-H743ZI2' },
  NUCLEO_H753ZI: { part: 'STM32H753ZI', source: 'ST NUCLEO-H753ZI' },

  // Arduino's four H7 boards, where upstream stops at "STM32H747" and Arduino
  // names the part and its 2 MB outright.
  ARDUINO_GIGA: { part: 'STM32H747XI', source: 'docs.arduino.cc/hardware/giga-r1-wifi' },
  ARDUINO_NICLA_VISION: { part: 'STM32H747XI', source: 'docs.arduino.cc/hardware/nicla-vision' },
  ARDUINO_OPTA: { part: 'STM32H747XI', source: 'docs.arduino.cc/hardware/opta' },
  ARDUINO_PORTENTA_H7: { part: 'STM32H747XI', source: 'docs.arduino.cc/hardware/portenta-h7' },

  // Two ports with a single board each and no reader of their own; upstream's
  // `board.json` names the part in `mcu`, which is the whole configuration
  // these ports would otherwise need one for.
  ALIF_ENSEMBLE: { part: 'AE722F80F55D5', source: 'board.json mcu = AE722F80F55D5XX' },
  KIT_PSE84_AI: { part: 'PSE846GPS2DBZC4', source: 'board.json mcu = PSE846GPS2DBZC4' }
}

/**
 * Boards whose sizes are stated by a source I have actually read.
 *
 * Seeded from `src/shared/board-profiles.ts`, which has carried some of these by
 * hand since #756 ("8 MB flash, 2 MB PSRAM" on the Feather V2), plus the makers'
 * own documentation for the rest.
 *
 * WHAT BELONGS HERE. Only what the derived sources cannot reach, because a
 * curated figure that shadows a mechanically-refreshed one goes stale in secret:
 *
 *   - `flash` for the boards whose MCU has no internal flash and whose build
 *     configuration does not state a size — which is most of the ESP32 catalogue;
 *   - `externalFlash`, the second flash chip beside the MCU, which nothing but
 *     the maker publishes;
 *   - `psram`.
 *
 * `psram: null` is a CLAIM, not a gap — it says the board has none — and is set
 * only where the maker says so.
 *
 * WHAT DOES NOT BELONG HERE: a board sold in more than one memory size. The
 * Pico LiPo is a 4 MB board and a 16 MB board under one name, and so are the
 * Tiny 2040, the RP2040-Plus, the WeAct RP2040 CoreBoard and the ESP32-POE.
 * Half those owners would be told the wrong thing, so they are told nothing —
 * their `variants` already say "16 MiB Flash" where upstream models it.
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
  },

  // --- Adafruit ------------------------------------------------------------
  // Every one of these adds an SPI flash chip beside a microcontroller that
  // already has its own, and says both figures on the product page. Not on the
  // list: the QT Py SAMD21, whose "Optional SOIC-8 SPI Flash chip on bottom" is
  // a bare pad, and the Trinket M0 and NeoKey Trinkey, which have neither.
  ADAFRUIT_F405_EXPRESS: { externalFlash: { bytes: 2 * MiB, source: 'adafruit.com/product/4382' } },
  ADAFRUIT_FEATHER_M0_EXPRESS: {
    externalFlash: { bytes: 2 * MiB, source: 'adafruit.com/product/3403' }
  },
  ADAFRUIT_FEATHER_M4_EXPRESS: {
    externalFlash: { bytes: 2 * MiB, source: 'adafruit.com/product/3857' }
  },
  // FEATHER52 is deliberately absent — see WITHHELD. Upstream's `board.json`
  // points at one Adafruit product and its build config describes another, so
  // there is no page whose figures are safe to put under that name.
  ADAFRUIT_FEATHER_RP2040: { flash: { bytes: 8 * MiB, source: 'adafruit.com/product/4884' } },
  ADAFRUIT_ITSYBITSY_M0_EXPRESS: {
    externalFlash: { bytes: 2 * MiB, source: 'adafruit.com/product/3727' }
  },
  ADAFRUIT_ITSYBITSY_M4_EXPRESS: {
    externalFlash: { bytes: 2 * MiB, source: 'adafruit.com/product/3800' }
  },
  ADAFRUIT_ITSYBITSY_RP2040: { flash: { bytes: 8 * MiB, source: 'adafruit.com/product/4888' } },
  ADAFRUIT_METRO_M4_EXPRESS: {
    externalFlash: { bytes: 2 * MiB, source: 'adafruit.com/product/4000' }
  },
  ADAFRUIT_QTPY_RP2040: { flash: { bytes: 8 * MiB, source: 'adafruit.com/product/4900' } },
  // The Feather RP2350 is sold as "No PSRAM" and "With 8MB PSRAM" on one page,
  // so it gets its flash from upstream's header and no PSRAM figure at all.

  // --- SparkFun ------------------------------------------------------------
  SPARKFUN_IOTNODE_LORAWAN_RP2350: {
    psram: { bytes: 8 * MiB, source: 'docs.sparkfun.com/SparkFun_IoT_Node_LoRaWAN' }
  },
  SPARKFUN_IOTREDBOARD_RP2350: {
    psram: { bytes: 8 * MiB, source: 'sparkfun.com/sparkfun-iot-redboard-rp2350.html' }
  },
  SPARKFUN_MICROMOD_STM32: {
    externalFlash: {
      bytes: 16 * MiB,
      source: 'learn.sparkfun.com micromod-stm32-processor-hookup-guide (128 Mbit)'
    }
  },
  SPARKFUN_PROMICRO: { flash: { bytes: 16 * MiB, source: 'sparkfun.com/sparkfun-pro-micro-rp2040.html' } },
  SPARKFUN_PROMICRO_RP2350: {
    psram: { bytes: 8 * MiB, source: 'sparkfun.com/sparkfun-pro-micro-rp2350.html' }
  },
  SPARKFUN_REDBOARD_TURBO: {
    externalFlash: { bytes: 4 * MiB, source: 'learn.sparkfun.com redboard-turbo-hookup-guide' }
  },
  SPARKFUN_SAMD51_THING_PLUS: {
    // SparkFun writes "4Mb", lower-case b, and means it: the fitted part is an
    // AT25SF041, four MEGABIT. Reading that as 4 MB overstates the board by 8×,
    // which is the single worst mistake available anywhere in this file.
    externalFlash: {
      bytes: 512 * KiB,
      source: 'learn.sparkfun.com samd51-thing-plus-hookup-guide (4 Mbit, AT25SF041)'
    }
  },
  SPARKFUN_THINGPLUS: {
    flash: { bytes: 16 * MiB, source: 'sparkfun.com/sparkfun-thing-plus-rp2040.html' }
  },
  SPARKFUN_THINGPLUS_ESP32C5: {
    flash: { bytes: 8 * MiB, source: 'sparkfun.com/sparkfun-thing-plus-esp32-c5.html' },
    psram: { bytes: 8 * MiB, source: 'sparkfun.com/sparkfun-thing-plus-esp32-c5.html' }
  },
  SPARKFUN_THINGPLUS_RP2350: {
    psram: { bytes: 8 * MiB, source: 'sparkfun.com/sparkfun-thing-plus-rp2350.html' }
  },
  SPARKFUN_XRP_CONTROLLER: {
    psram: { bytes: 8 * MiB, source: 'sparkfun.com/…xrp-controller.html' }
  },
  SPARKFUN_XRP_CONTROLLER_BETA: {
    // A Pico W on a carrier board, and SparkFun lists the Pico W's own figure.
    flash: { bytes: 2 * MiB, source: 'sparkfun.com/…xrp-controller-beta.html (it carries a Pico W)' }
  },
  // Not on the list: the IoT RedBoard ESP32, whose only published figure is the
  // WROOM module family's "4/8/16 MB" range, which is not a statement about it.

  // --- Unexpected Maker ----------------------------------------------------
  // The one vendor here that publishes flash AND PSRAM for its whole range, on
  // per-board microsites and again in a PSRAM table that agrees with them.
  UM_FEATHERS2: {
    flash: { bytes: 16 * MiB, source: 'feathers2.io' },
    psram: { bytes: 8 * MiB, source: 'feathers2.io' }
  },
  // The FeatherS2 Neo is discontinued and no maker page states its flash; the
  // PSRAM table still does, so it gets one figure and not the other.
  UM_FEATHERS2NEO: { psram: { bytes: 2 * MiB, source: 'help.unexpectedmaker.com PSRAM table' } },
  UM_FEATHERS3: {
    flash: { bytes: 16 * MiB, source: 'esp32s3.com/feathers3.html' },
    psram: { bytes: 8 * MiB, source: 'esp32s3.com/feathers3.html' }
  },
  UM_FEATHERS3NEO: {
    flash: { bytes: 8 * MiB, source: 'esp32s3.com/feathers3neo.html' },
    psram: { bytes: 2 * MiB, source: 'esp32s3.com/feathers3neo.html' }
  },
  UM_NANOS3: {
    flash: { bytes: 8 * MiB, source: 'esp32s3.com/nanos3.html' },
    psram: { bytes: 8 * MiB, source: 'esp32s3.com/nanos3.html' }
  },
  UM_OMGS3: {
    flash: { bytes: 8 * MiB, source: 'esp32s3.com/omgs3.html' },
    psram: { bytes: 2 * MiB, source: 'esp32s3.com/omgs3.html' }
  },
  UM_PROS3: {
    flash: { bytes: 16 * MiB, source: 'esp32s3.com/pros3.html' },
    psram: { bytes: 8 * MiB, source: 'esp32s3.com/pros3.html' }
  },
  UM_RGBTOUCH_MINI: {
    flash: { bytes: 8 * MiB, source: 'unexpectedmaker.com shop, RGB Touch Mini' },
    psram: { bytes: 2 * MiB, source: 'unexpectedmaker.com shop, RGB Touch Mini' }
  },
  UM_TINYC6: { flash: { bytes: 8 * MiB, source: 'unexpectedmaker.com shop, TinyC6' } },
  UM_TINYPICO: {
    flash: { bytes: 4 * MiB, source: 'unexpectedmaker.com shop, TinyPICO' },
    psram: { bytes: 4 * MiB, source: 'unexpectedmaker.com shop, TinyPICO' }
  },
  UM_TINYS2: {
    flash: { bytes: 4 * MiB, source: 'unexpectedmaker.com shop, TinyS2' },
    psram: { bytes: 2 * MiB, source: 'unexpectedmaker.com shop, TinyS2' }
  },
  UM_TINYS3: {
    flash: { bytes: 8 * MiB, source: 'esp32s3.com/tinys3.html' },
    psram: { bytes: 8 * MiB, source: 'esp32s3.com/tinys3.html' }
  },
  UM_TINYWATCHS3: {
    flash: { bytes: 8 * MiB, source: 'help.unexpectedmaker.com/docs/products/tinywatch-s3' },
    psram: { bytes: 2 * MiB, source: 'help.unexpectedmaker.com/docs/products/tinywatch-s3' }
  },

  // --- Seeed Studio --------------------------------------------------------
  SEEED_WIO_TERMINAL: {
    externalFlash: { bytes: 4 * MiB, source: 'seeedstudio.com Wio-Terminal-p-4509' }
  },
  SEEED_XIAO_ESP32C3: { flash: { bytes: 4 * MiB, source: 'seeedstudio.com Seeed-XIAO-ESP32C3-p-5431' } },
  SEEED_XIAO_ESP32C5: {
    flash: { bytes: 8 * MiB, source: 'wiki.seeedstudio.com/xiao_esp32c5_getting_started' },
    psram: { bytes: 8 * MiB, source: 'wiki.seeedstudio.com/xiao_esp32c5_getting_started' }
  },
  SEEED_XIAO_ESP32C6: {
    flash: { bytes: 4 * MiB, source: 'seeedstudio.com Seeed-Studio-XIAO-ESP32C6-p-5884' }
  },
  SEEED_XIAO_NRF52: {
    externalFlash: {
      bytes: 2 * MiB,
      source: 'seeedstudio.com Seeed-XIAO-BLE-Sense-nRF52840-p-5253'
    }
  },

  // --- Waveshare -----------------------------------------------------------
  WAVESHARE_RP2040_LCD_0_96: {
    flash: { bytes: 2 * MiB, source: 'waveshare.com/product/rp2040-lcd-0.96.htm (W25Q16)' }
  },
  WAVESHARE_ESP32_S3_PICO: {
    flash: { bytes: 16 * MiB, source: 'waveshare.com/ESP32-S3-Pico.htm (W25Q128)' },
    psram: { bytes: 2 * MiB, source: 'waveshare.com/ESP32-S3-Pico.htm (in the ESP32-S3R2 package)' }
  },
  // The RP2040-Plus is a 4 MB board and a 16 MB board; the RP2350B Core's PSRAM
  // is 0, 2 or 8 MB depending on the SKU. Both say nothing rather than half of it.

  // --- Arduino -------------------------------------------------------------
  ARDUINO_GIGA: {
    externalFlash: { bytes: 16 * MiB, source: 'docs.arduino.cc/hardware/giga-r1-wifi (AT25SF128A)' },
    psram: { bytes: 8 * MiB, source: 'docs.arduino.cc/hardware/giga-r1-wifi (AS4C4M16SA SDRAM)' }
  },
  ARDUINO_NANO_ESP32: {
    psram: { bytes: 8 * MiB, source: 'docs.arduino.cc/hardware/nano-esp32 (in the NORA-W106 module)' }
  },
  ARDUINO_NANO_RP2040_CONNECT: {
    flash: { bytes: 16 * MiB, source: 'docs.arduino.cc/hardware/nano-rp2040-connect (AT25SF128A)' }
  },
  ARDUINO_NICLA_VISION: {
    externalFlash: { bytes: 16 * MiB, source: 'docs.arduino.cc/hardware/nicla-vision (AT25QL128A)' }
  },
  ARDUINO_OPTA: {
    externalFlash: { bytes: 16 * MiB, source: 'docs.arduino.cc/hardware/opta' }
    // Arduino's spec card calls the H747's own 1 MB of SRAM "SDRAM: 1 MB"; the
    // datasheet table on the same page calls it "1 MB of RAM". No SDRAM figure.
  },
  ARDUINO_PORTENTA_C33: {
    // The RA6M5 group spans 1 MB to 2 MB, so {@link CHIP_MEMORY} will not name a
    // flash size for it; Arduino names this board's.
    flash: { bytes: 2 * MiB, source: 'docs.arduino.cc/hardware/portenta-c33' },
    externalFlash: { bytes: 16 * MiB, source: 'docs.arduino.cc/hardware/portenta-c33 (MX25L12833F)' }
  },
  ARDUINO_PORTENTA_H7: {
    externalFlash: { bytes: 16 * MiB, source: 'docs.arduino.cc/hardware/portenta-h7' },
    psram: { bytes: 8 * MiB, source: 'docs.arduino.cc/hardware/portenta-h7 (SDRAM)' }
  },

  // --- M5Stack -------------------------------------------------------------
  M5STACK_ATOM: { flash: { bytes: 4 * MiB, source: 'docs.m5stack.com/en/core/ATOM Matrix' } },
  M5STACK_ATOMS3_LITE: { flash: { bytes: 8 * MiB, source: 'docs.m5stack.com/en/core/AtomS3 Lite' } },
  M5STACK_NANOC6: { flash: { bytes: 4 * MiB, source: 'docs.m5stack.com/en/core/M5NanoC6' } },
  M5STACK_NANOH2: { flash: { bytes: 4 * MiB, source: 'docs.m5stack.com/en/core/NanoH2' } },

  // --- Wemos / LOLIN -------------------------------------------------------
  LOLIN_C3_MINI: { flash: { bytes: 4 * MiB, source: 'wemos.cc/en/latest/c3/c3_mini.html' } },
  LOLIN_S2_MINI: {
    flash: { bytes: 4 * MiB, source: 'wemos.cc/en/latest/s2/s2_mini.html' },
    psram: { bytes: 2 * MiB, source: 'wemos.cc/en/latest/s2/s2_mini.html' }
  },
  LOLIN_S2_PICO: {
    flash: { bytes: 4 * MiB, source: 'wemos.cc/en/latest/s2/s2_pico.html' },
    psram: { bytes: 2 * MiB, source: 'wemos.cc/en/latest/s2/s2_pico.html' }
  },

  // --- Everyone else -------------------------------------------------------
  CYTRON_MOTION_2350_PRO: {
    flash: { bytes: 2 * MiB, source: 'cytron.io/p-motion-2350-pro' }
  },
  LILYGO_TTGO_LORA32: { flash: { bytes: 4 * MiB, source: 'lilygo.cc/products/lora3 (V1.6.1)' } },
  OLIMEX_ESP32_POE: {
    flash: { bytes: 4 * MiB, source: 'olimex.com ESP32-POE user manual (WROOM-32E)' }
  },
  POLOLU_3PI_2040_ROBOT: { flash: { bytes: 16 * MiB, source: 'pololu.com/docs/0J86/6.1' } },
  POLOLU_ZUMO_2040_ROBOT: { flash: { bytes: 16 * MiB, source: 'pololu.com/docs/0J87/1' } },
  PYBD_SF2: {
    externalFlash: {
      bytes: 4 * MiB,
      source: 'store.micropython.org PYBD-SF2 (2 MiB XIP + 2 MiB filesystem)'
    }
  },
  PYBD_SF3: {
    externalFlash: {
      bytes: 4 * MiB,
      source: 'store.micropython.org PYBD-SF3 (2 MiB XIP + 2 MiB filesystem)'
    }
  },
  PYBD_SF6: {
    externalFlash: {
      bytes: 4 * MiB,
      source: 'store.micropython.org PYBD-SF6 (2 MiB XIP + 2 MiB filesystem)'
    }
  },
  SOLDERED_NULA_MINI: { flash: { bytes: 4 * MiB, source: 'soldered.com/product/nula-mini-esp32-c6' } },
  W5100S_EVB_PICO: { flash: { bytes: 2 * MiB, source: 'docs.wiznet.io W5100S-EVB-Pico' } },
  W5500_EVB_PICO: { flash: { bytes: 2 * MiB, source: 'docs.wiznet.io W5500-EVB-Pico' } },
  WEACTSTUDIO_MINI_STM32H723: {
    externalFlash: {
      bytes: 16 * MiB,
      source: 'github.com/WeActStudio/WeActStudio.MiniSTM32H723 (8 MB SPI + 8 MB OSPI)'
    }
  },
  WEACTSTUDIO_MINI_STM32H743: {
    externalFlash: {
      bytes: 16 * MiB,
      source: 'github.com/WeActStudio/MiniSTM32H7xx (8 MB SPI + 8 MB QSPI)'
    }
  }
}

/**
 * Figures a derived source offers and this module refuses to publish.
 *
 * Rare, and each one is a real disagreement rather than a doubt. The Werkzeug is
 * the clearest: Machdyne's page says "Update March 2025: Werkzeug now has 4MB
 * flash instead of 1MB", and upstream still builds it against the 1 MB header —
 * so both numbers are right, for different boards with the same name, and either
 * one alone is wrong for half the people reading it.
 *
 * Withholding is deliberately noisy in the diff: `why` has to be written down.
 */
export const WITHHELD = {
  MACHDYNE_WERKZEUG: {
    fields: ['flash'],
    why:
      'Machdyne: "Update March 2025: Werkzeug now has 4MB flash instead of 1MB". Upstream ' +
      'still builds against the 1 MB pico-sdk header. Both numbers are right, for different ' +
      'boards sold under one name.'
  },
  SIL_WESP32: {
    fields: ['flash'],
    why:
      'wesp32.com states 16 MB from revision 7 and 4 MB before it; upstream builds against ' +
      '8 MB. Three figures, one board name, and no way to tell which one is in the hand.'
  },
  FEATHER52: {
    fields: ['flash', 'ram'],
    why:
      'Upstream’s own entry disagrees with itself: `board.json` calls this the "Feather ' +
      'nRF52840 Express" and links adafruit.com/product/4062, while the build beside it is ' +
      '`MCU_SUB_VARIANT = nrf52832`, `-DNRF52832_XXAA` and "Bluefruit nRF52 Feather" — which ' +
      'is product 3406, a different board with half the flash and a quarter of the RAM. ' +
      'Publishing either figure puts it under the other board’s name.'
  }
}

/** A curated size, or null. Curated figures are always about the board. */
const boardSize = (size) => (size ? { ...size, scope: 'board' } : null)

/** A datasheet figure for the chip, which is a fact about every board using it. */
const chipSize = (bytes, source) => (bytes ? { bytes, source, scope: 'chip' } : null)

/**
 * A chip name reduced to what identifies its memory.
 *
 * ST's ordering code is fixed-width up to and including the flash-size letter:
 * `STM32` + family + line + pin-count letter + flash letter is eleven
 * characters, and everything after it — `T6`, `H6Q`, `VT6` — is package,
 * temperature range and options, none of which changes a byte of memory. So
 * `STM32H7B3LIH6Q` and `STM32H723ZGT6` are looked up as `STM32H7B3LI` and
 * `STM32H723ZG`, and the table does not have to carry a row per package.
 *
 * Names SHORTER than that — `STM32F407`, `STM32F4` — are left alone, and are
 * exactly the ones the table answers with SRAM and no flash.
 */
export function chipKey(name) {
  const s = String(name ?? '')
  return s.startsWith('STM32') && s.length > 11 ? s.slice(0, 11) : s
}

/**
 * The chip row for this board.
 *
 * The board's own name first, then the build's, then whatever the port's reader
 * worked out directly — which on nrf is the memory map the board is linked
 * against, and is the only thing that tells an nRF52832 QFAA from a QFAB.
 */
function chipMemoryFor(board, config) {
  for (const key of [BOARD_MCU_PART[board.id]?.part, config.part, config.partAlso]) {
    if (key && CHIP_MEMORY[chipKey(key)]) return CHIP_MEMORY[chipKey(key)]
  }
  return config.chipMemory ?? null
}

/**
 * The sizes to publish for one board, or nulls where nothing is known.
 *
 * `config` is what `board-config.mjs` read out of upstream's tree for this board.
 * The order below is the precedence argued for at the top of this file: what
 * upstream states outright, then what the chip settles, then curation — and
 * nothing is invented at any step.
 */
export function specsForBoard(board, config = {}) {
  const curated = CURATED_BOARDS[board.id] ?? {}
  const withheld = WITHHELD[board.id]?.fields ?? []
  const chip = chipMemoryFor(board, config)
  const family = MCU_SRAM[board.mcu]

  // Flash the board states, then flash the chip has, then flash a maker states.
  let flash = null
  if (config.flash && config.flashSource) {
    flash = { bytes: config.flash, source: config.flashSource, scope: 'board' }
  } else if (chip?.flash) {
    flash = chipSize(chip.flash, chip.source)
  } else {
    flash = boardSize(curated.flash)
  }

  const psram = config.externalRam && config.externalRamSource
    ? { bytes: config.externalRam, source: config.externalRamSource, scope: 'board' }
    : boardSize(curated.psram)

  const out = {
    flash,
    externalFlash: boardSize(curated.externalFlash),
    ram: chip?.sram ? chipSize(chip.sram, chip.source) : family ? { ...family, scope: 'chip' } : null,
    psram
  }
  for (const field of withheld) out[field] = null
  return out
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
