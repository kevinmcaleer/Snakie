/**
 * WHICH PYTHON YOU ARE FLASHING (#756, #757 — epic #209).
 * =============================================================================
 *
 * The flash dialog was MicroPython-only, top to bottom: one catalog, one set of
 * labels, and a download URL documented as "the `.uf2` file on micropython.org".
 * CircuitPython is published the same way — Thonny curates the identical
 * `{vendor, model, family, info_url, downloads:[{version,url}]}` records — but
 * from a different place, and keyed differently:
 *
 *  - **MicroPython** builds are per **chip family**. One `ESP32_GENERIC_S3` build
 *    runs on every S3 board.
 *  - **CircuitPython** builds are per **board**. `raspberry_pi_pico` and
 *    `raspberry_pi_pico_w` are different files, and flashing one to the other is
 *    a board that boots with the wrong pins.
 *
 * That difference is the whole reason this module exists. A CircuitPython board
 * names itself — `boot_out.txt` carries a `Board ID:` line (#753, parsed by
 * `dialect.ts`), and the download URL carries that same id — so a board can be
 * matched to its exact build. When the id CANNOT be established we return null
 * and the caller offers nothing: a guessed `.uf2` flashes without complaint and
 * leaves a board that needs re-flashing before it will talk again.
 *
 * Everything here is pure and dependency-free (type-only imports), so main, the
 * preload and the renderer all read the same rules and the rules are testable
 * without a board, a network or a DOM.
 *
 * VERIFIED (2026-08) against the published data rather than inferred:
 *  - `raw.githubusercontent.com/thonny/thonny/master/data/circuitpython-variants-{uf2,esptool,daplink}.json`
 *    return 487 / 241 / 2 entries in the schema above.
 *  - every `downloads[].url` in them is
 *    `https://downloads.circuitpython.org/bin/<board_id>/<locale>/adafruit-circuitpython-<board_id>-<locale>-<version>.<ext>`,
 *    and every `info_url` is `https://circuitpython.org/board/<board_id>/`.
 *  - a HEAD of one such URL returns 200 with a 1.8 MB `binary/octet-stream`.
 */
import type { Dialect } from './dialect'
import type {
  BoardType,
  FirmwareCatalog,
  FirmwareModel,
  FirmwareVariant,
  FirmwareVersion
} from '../main/firmware/types'

/** A Python runtime we can put onto a board. */
export type FirmwareRuntime = 'micropython' | 'circuitpython'

/** Both runtimes, in the order the dialog offers them. */
export const FIRMWARE_RUNTIMES: readonly FirmwareRuntime[] = ['micropython', 'circuitpython']

/** How each runtime is named in the UI. */
export const FIRMWARE_RUNTIME_LABEL: Record<FirmwareRuntime, string> = {
  micropython: 'MicroPython',
  circuitpython: 'CircuitPython'
}

/**
 * Where each runtime's builds actually come from. Named in the dialog because
 * "Download firmware" tells nobody whose binary is about to be written to their
 * board.
 */
export const FIRMWARE_RUNTIME_HOST: Record<FirmwareRuntime, string> = {
  micropython: 'micropython.org',
  circuitpython: 'circuitpython.org'
}

/**
 * A glyph per runtime for the dialog's Runtime picker — a `<path d>` string drawn
 * in a 24×24 box and stroked in `currentColor`, which is exactly the idiom the
 * instrument registry uses (`INSTRUMENTS[].icon`), so this doesn't become a
 * one-off icon language.
 *
 * These are deliberately NOT the MicroPython or CircuitPython marks. Those are
 * the projects' trademarks and redrawing them into our chrome opens a licensing
 * question we have no need to open; these are plain original glyphs in the app's
 * own line style. Each keys off the half of the name that DIFFERS, because that
 * is the only thing separating the two choices:
 *
 *  - **Micro**Python → a microcontroller: a chip body with its die and two legs
 *    down each side. A compact, centred mass.
 *  - **Circuit**Python → PCB routing: two traces stepping up at the 45° a router
 *    uses, with a round pad at each end of the lower one. An open diagonal sweep.
 *
 * Mass vs. sweep is what keeps them apart at 16px, where finer detail is gone —
 * checked by rendering both at 16/18/24px rather than assumed. Legs shorter than
 * ~3 units and a third leg per side both blur into the body at that size.
 * They ride ALONGSIDE the text labels, never instead of them: picking the wrong
 * one here flashes the wrong firmware, so the words stay.
 */
export const FIRMWARE_RUNTIME_ICON: Record<FirmwareRuntime, string> = {
  // chip body · die · two legs down each side
  micropython:
    'M6.5 6.5 h11 v11 h-11 Z M9.5 9.5 h5 v5 h-5 Z ' +
    'M3 9.5 h3.5 M3 14.5 h3.5 M17.5 9.5 h3.5 M17.5 14.5 h3.5',
  // pad · trace · pad, with a second trace routed parallel above
  circuitpython:
    'M5 19 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 ' +
    'M7 19 h2.5 l4 -4 h2.5 ' +
    'M18 15 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 ' +
    'M4 11 h3.5 l4 -4 h5'
}

/**
 * The runtime to flash for a session's {@link Dialect}, or null when the board
 * never said what it runs. Null is not "assume MicroPython" — assuming is the
 * habit this epic exists to remove — it is "leave the choice where it was".
 */
export function firmwareRuntimeForDialect(
  dialect: Dialect | null | undefined
): FirmwareRuntime | null {
  return dialect === 'micropython' || dialect === 'circuitpython' ? dialect : null
}

// ---------------------------------------------------------------------------
// How a download reaches the board
// ---------------------------------------------------------------------------

/** How a firmware file is written to a board, decided by its extension. */
export type DownloadKind = 'uf2' | 'bin' | 'hex'

/** Short label for a {@link DownloadKind}, for disambiguating a Version list. */
export const DOWNLOAD_KIND_LABEL: Record<DownloadKind, string> = {
  uf2: 'UF2',
  bin: 'esptool .bin',
  hex: '.hex'
}

/**
 * Which mechanism a download URL implies, or null when it is not firmware.
 *
 * The extension, not the family, is what decides — and on CircuitPython that
 * matters: an ESP32-S2/S3 board is published in BOTH the UF2 catalog and the
 * esptool one, the same version, the same board. Deciding by family would hand a
 * `.uf2` to esptool, which writes the container verbatim, reports success, and
 * leaves the board dead (the same failure `firmwareFileIssue` guards for local
 * files).
 *
 * `.combined.hex` (CircuitPython's micro:bit build) ends in `.hex` and is
 * matched as such.
 */
export function downloadKind(url: string): DownloadKind | null {
  const lower = url.trim().toLowerCase().split('?')[0]
  if (lower.endsWith('.uf2')) return 'uf2'
  if (lower.endsWith('.bin')) return 'bin'
  if (lower.endsWith('.hex')) return 'hex'
  return null
}

/**
 * Second-stage bootloader offset per ESP chip, for anything that is not 0x0.
 *
 * Espressif moved the bootloader to 0x0 from the S3 onwards; the original ESP32
 * and the S2 keep it at 0x1000. Anything absent here is 0x0.
 */
const ESP_BOOTLOADER_OFFSET: Record<string, string> = {
  esp32: '0x1000',
  esp32s2: '0x1000'
}

/**
 * Per-chip flash target for a catalog `family` (issue #125). Maps Thonny's
 * `family` to the flasher's {@link BoardType} dispatch plus the esptool
 * `write_flash` offset (per-chip; the WRONG offset fails the flash):
 *
 *  - `rp2*` → `rp2040`, no offset (UF2 copy doesn't use one).
 *  - `nrf*` / `microbit` → `microbit`, no offset (drive copy).
 *  - `esp8266` → `esp8266`, `0x0`.
 *  - every other `esp*` (`esp32`, `esp32s2/s3`, `esp32c2/c3/c5/c6`, `esp32p4`)
 *    → `esp32`; offset `0x1000` for the original `esp32`, `0x0` for the rest.
 *  - the SAMD / SAME / i.MX RT families CircuitPython adds (`samd21`, `samd51`,
 *    `same51`, `same54`, `mimxrt10xx`) are UF2 drive copies like `rp2` — their
 *    bootloader volume is named by the vendor (`FEATHERBOOT`, `QTPY_BOOT`,
 *    `ARDUINO`, …) rather than `RPI-RP2`, but the mechanism is identical.
 *
 * Note the RESULT is the flash MECHANISM, not a claim about the chip: a SAMD51
 * Feather reports `rp2040` here because that is the drive-copy branch of
 * {@link flash}. Prefer {@link flashTargetForDownload} where a URL is in hand.
 */
export function flashTargetForFamily(family: string): { board: BoardType; offset?: string } {
  const fam = family.trim().toLowerCase()
  if (fam.startsWith('rp2')) return { board: 'rp2040' }
  // BBC micro:bit: Thonny tags v1 as `nrf51`, v2 as `nrf52`; both flash by
  // copying a `.hex` to the MICROBIT drive (no esptool offset).
  if (fam.startsWith('nrf') || fam === 'microbit') return { board: 'microbit' }
  if (fam === 'esp8266') return { board: 'esp8266', offset: '0x0' }
  if (fam.startsWith('esp')) {
    // The second-stage bootloader offset is per CHIP, and it is not a simple
    // "original vs the rest": the ESP32-S2 shares the original ESP32's 0x1000,
    // while the S3 and every RISC-V part are 0x0. Getting it wrong flashes
    // cleanly and leaves the board dead, so the exceptions are listed rather
    // than inferred.
    return { board: 'esp32', offset: ESP_BOOTLOADER_OFFSET[fam] ?? '0x0' }
  }
  // Unknown families: assume a UF2 copy (no esptool offset) rather than guess.
  return { board: 'rp2040' }
}

/**
 * The flash target for a specific DOWNLOAD — the family decides the esptool
 * offset, the file extension decides the mechanism.
 *
 * This is the one to use once a version is picked. `family` alone is ambiguous
 * on CircuitPython, where the same ESP32-S3 board is published as both a `.uf2`
 * (copied to its bootloader drive) and a `.bin` (written by esptool), and as
 * both a `.uf2` and a `.combined.hex` on `nrf52`. A URL is never ambiguous.
 */
export function flashTargetForDownload(
  family: string,
  url: string
): { board: BoardType; offset?: string } {
  const kind = downloadKind(url)
  const byFamily = flashTargetForFamily(family)
  if (kind === 'uf2') return { board: 'rp2040' }
  if (kind === 'hex') return { board: 'microbit' }
  if (kind === 'bin') {
    // An esptool write needs an ESP offset. A `.bin` under a non-ESP family is
    // not something we know how to place, so fall back to the family's own
    // answer rather than inventing an address.
    return byFamily.board === 'esp32' || byFamily.board === 'esp8266'
      ? byFamily
      : { board: 'esp32', offset: ESP_BOOTLOADER_OFFSET[family.trim().toLowerCase()] ?? '0x0' }
  }
  return byFamily
}

/**
 * Families whose UF2 bootloader volume is NOT `RPI-RP2` — every vendor names its
 * own (`FEATHERBOOT`, `QTPY_BOOT`, `ARDUINO`, `METR051BOOT`, …). Used only to
 * word the drive picker honestly; detection itself goes by the `INFO_UF2.TXT`
 * marker the UF2 spec defines, which is vendor-neutral.
 */
export function isVendorUf2Family(family: string): boolean {
  const fam = family.trim().toLowerCase()
  if (!fam || fam.startsWith('rp2')) return false
  return (
    fam.startsWith('samd') ||
    fam.startsWith('same') ||
    fam.startsWith('mimxrt') ||
    fam.startsWith('nrf5')
  )
}

// ---------------------------------------------------------------------------
// Board ID — matching a CircuitPython board to its own build
// ---------------------------------------------------------------------------

/**
 * The CircuitPython Board ID in a `downloads.circuitpython.org` URL.
 *
 * Shape verified against the published catalogs:
 *   `https://downloads.circuitpython.org/bin/<board_id>/<locale>/adafruit-circuitpython-<board_id>-<locale>-<version>.<ext>`
 *
 * Null for anything that is not one of those URLs — a micropython.org build, a
 * mirror, a hand-typed link — so a MicroPython catalog never yields a board id.
 */
export function boardIdFromDownloadUrl(url: string): string | null {
  const m = /^https?:\/\/downloads\.circuitpython\.org\/bin\/([^/?#]+)\//i.exec(url.trim())
  return m ? m[1] : null
}

/**
 * The CircuitPython Board ID in a `circuitpython.org/board/<board_id>/` info
 * page URL — the `info_url` every CircuitPython catalog entry carries.
 */
export function boardIdFromInfoUrl(url: string): string | null {
  const m = /^https?:\/\/(?:www\.)?circuitpython\.org\/board\/([^/?#]+)/i.exec(url.trim())
  return m ? m[1] : null
}

/**
 * The Board ID a catalog variant builds for, or null when it isn't a
 * CircuitPython entry at all.
 *
 * The info URL is preferred because it is one value for the whole variant; the
 * download URLs are the fallback for an entry published without one. Both encode
 * the same id.
 */
export function variantBoardId(variant: FirmwareVariant): string | null {
  if (variant.infoUrl) {
    const fromInfo = boardIdFromInfoUrl(variant.infoUrl)
    if (fromInfo) return fromInfo
  }
  for (const v of variant.versions) {
    const fromUrl = boardIdFromDownloadUrl(v.url)
    if (fromUrl) return fromUrl
  }
  return null
}

/**
 * Are these the same Board ID? Compared case-insensitively because the catalog
 * is not consistent about it (`Seeed_XIAO_nRF52840_Sense` sits among 486
 * lower-case ids), and `boot_out.txt` prints whatever the build was named.
 * Nothing else is normalised: `raspberry_pi_pico` and `raspberry_pi_pico_w` are
 * DIFFERENT boards and must never collapse into one another.
 */
export function sameBoardId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Where a board's build sits in the catalog cascade. */
export interface FirmwareBoardBuild {
  family: string
  model: FirmwareModel
  variant: FirmwareVariant
}

/**
 * Find every catalog entry built for `boardId`.
 *
 * More than one is normal, not an error: an ESP32-S3 board is published as a
 * `.uf2` and as a `.bin`, so it appears under one family twice. The caller picks
 * by mechanism.
 *
 * An empty/absent id yields an empty list — "we could not establish the board"
 * is a legitimate answer, and the caller must then offer nothing rather than
 * guess a build.
 */
export function findBoardBuilds(
  catalog: FirmwareCatalog | null | undefined,
  boardId: string | null | undefined
): FirmwareBoardBuild[] {
  if (!boardId || !boardId.trim()) return []
  const out: FirmwareBoardBuild[] = []
  for (const family of catalog?.families ?? []) {
    for (const model of family.models ?? []) {
      for (const variant of model.variants ?? []) {
        if (sameBoardId(variantBoardId(variant), boardId)) {
          out.push({ family: family.family, model, variant })
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/**
 * A stable `MAJOR.MINOR[.PATCH]` release — `v1.28.0`, `10.2.1`.
 *
 * False for everything else the catalogs carry: CircuitPython publishes its
 * alphas and betas (`10.3.0-alpha.1`) alongside stable builds, and MicroPython
 * publishes previews and date-tagged nightlies (`1.24.0-preview.42.gabcdef`,
 * `20240105-unstable`). None of those may ever be offered as an update.
 */
export function isStableRelease(version: string): boolean {
  return /^v?\d+\.\d+(?:\.\d+)?$/.test(String(version ?? '').trim())
}

/** The version string with any leading `v` removed, for comparing. */
export function bareVersion(version: string): string {
  return String(version ?? '').trim().replace(/^v/i, '')
}

/**
 * The newest STABLE build in `versions`, or null when there is none.
 *
 * The catalogs publish newest-first, but that is a convention rather than a
 * guarantee, so this compares rather than trusting the order.
 */
export function newestStableVersion(
  versions: readonly FirmwareVersion[] | undefined,
  isNewer: (a: string, b: string) => boolean
): FirmwareVersion | null {
  let best: FirmwareVersion | null = null
  for (const v of versions ?? []) {
    if (!isStableRelease(v.version)) continue
    if (best === null || isNewer(bareVersion(v.version), bareVersion(best.version))) best = v
  }
  return best
}
