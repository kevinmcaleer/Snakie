/**
 * Firmware-version detection — MicroPython (#173) and CircuitPython (#757).
 *
 * Pure helpers (no IO) so they're unit-testable: work out what a board is
 * running, find the newest stable build its runtime publishes for it, and decide
 * whether an update is available. The catalog fetch + the device connection live
 * in the caller (StatusBar).
 *
 * The two runtimes are found out about in genuinely different ways, and the
 * difference is not cosmetic:
 *
 *  - **MicroPython** is read from the REPL boot banner in the console buffer,
 *    and matched to the catalog by CHIP FAMILY, because a MicroPython build
 *    serves every board on that chip. That path is unchanged.
 *  - **CircuitPython** is read from the session's own {@link RuntimeInfo} — the
 *    dialect probe already asked (#752) — and matched by **Board ID**, because
 *    CircuitPython builds are per board. No board id, no offer: there is no
 *    "near enough" build to fall back to.
 *
 * Neither ever offers a pre-release. Both runtimes publish them in the same
 * catalog as their stable builds.
 */
import type { RuntimeInfo } from '../../../shared/dialect'
import {
  findBoardBuilds,
  isStableRelease,
  bareVersion,
  newestStableVersion,
  type FirmwareRuntime
} from '../../../shared/firmware-runtime'
import { isNewerVersion } from '../../../shared/version-compare'
import type { FirmwareCatalog } from '../../../preload/index.d'

/**
 * An available firmware update, named by the runtime it is FOR.
 *
 * The runtime is carried rather than assumed so the prompt can say which Python
 * it is offering — telling a CircuitPython user that MicroPython 1.28 is
 * available would be nonsense, and the old prompt was hard-coded to say exactly
 * that.
 */
export interface FirmwareUpdate {
  runtime: FirmwareRuntime
  /** What the board is running now. */
  current: string
  /** The newest stable build available for it. */
  latest: string
  /** CircuitPython only: the board id the build was matched on. */
  boardId?: string
}

/**
 * The MOST-RECENT `MicroPython v…` banner line in `text` — the currently
 * connected device's. The console buffer accumulates across connections, so an
 * earlier device's banner (e.g. a micro:bit unplugged just before) still sits
 * near the top; matching the LAST occurrence is what keeps the firmware check
 * tracking the live device instead of a stale one. Null if no banner present.
 */
export function lastMicropythonBanner(text: string): string | null {
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--)
    if (/MicroPython\s+v?\d/i.test(lines[i])) return lines[i]
  return null
}

/**
 * Parse the MicroPython version (e.g. `1.22.2`) from a REPL boot banner such as
 * `MicroPython v1.22.2 on 2024-... ; Raspberry Pi Pico W with RP2040`. Reads the
 * MOST-RECENT banner (see {@link lastMicropythonBanner}) so a stale earlier
 * device's version can't win. Returns the bare `MAJOR.MINOR[.PATCH]` string, or
 * null if no banner is present.
 */
export function micropythonVersionFromBanner(text: string): string | null {
  const banner = lastMicropythonBanner(text)
  const m = banner ? /MicroPython\s+v?(\d+\.\d+(?:\.\d+)?)/i.exec(banner) : null
  return m ? m[1] : null
}

/**
 * Map a device-identifying banner to the firmware CATALOG family it belongs to
 * (a coarse key: `rp2` | `esp32` | `esp8266` | `nrf`), or null if unrecognised.
 * The banner's trailing board description names the MCU — `… with RP2040`,
 * `… with ESP32`, `micro:bit v2 … with nRF52833`.
 *
 * This is the load-bearing fix for the cross-family bug: micro:bit (`nrf*`) has
 * its OWN version line (2.x) that is unrelated to mainline MicroPython (1.x), so
 * the "latest" lookup MUST be scoped to the device's family — otherwise a Pico
 * (rp2) on 1.28.0 is wrongly told a micro:bit's 2.1.2 is a newer build.
 *
 * Pass the most-recent banner line ({@link lastMicropythonBanner}); running this
 * over the whole console buffer would re-match a previous device's MCU token.
 */
export function firmwareFamilyFromBanner(text: string | null): string | null {
  const t = (text ?? '').toLowerCase()
  if (/micro:?bit|nrf5\d/.test(t)) return 'nrf'
  if (/rp2040|rp2350/.test(t)) return 'rp2'
  if (/esp8266/.test(t)) return 'esp8266'
  if (/esp32/.test(t)) return 'esp32'
  return null
}

/** Whether a catalog family id belongs to the coarse banner family `key`. */
function familyInKey(catalogFamily: string, key: string): boolean {
  const fam = String(catalogFamily ?? '').toLowerCase()
  if (key === 'nrf') return fam.startsWith('nrf')
  if (key === 'esp32') return fam.startsWith('esp32') // esp32, -s2, -s3, -c3, …
  return fam === key
}

/**
 * The newest STABLE MicroPython version in the catalog. When `family` (a coarse
 * key from {@link firmwareFamilyFromBanner}) is given, the search is SCOPED to
 * that family — within a port MicroPython releases are version-aligned, so the
 * family max is the right "latest for this device". Without a family it falls
 * back to the catalog-wide max (legacy behaviour). Null if the catalog has none.
 *
 * Scoping matters because the catalog mixes version lines: micro:bit (`nrf*`)
 * ships 2.x while mainline ports ship 1.x, so a catalog-wide max would surface a
 * micro:bit build as "newest" for an unrelated rp2/esp device.
 */
export function latestCatalogVersion(
  catalog: FirmwareCatalog | null | undefined,
  family?: string | null
): string | null {
  let best: string | null = null
  for (const fam of catalog?.families ?? []) {
    if (family && !familyInKey(fam.family, family)) continue
    for (const model of fam.models ?? [])
      for (const variant of model.variants ?? [])
        for (const v of variant.versions ?? []) {
          if (!isStableRelease(v.version)) continue
          const ver = bareVersion(v.version)
          if (best === null || isNewerVersion(ver, best)) best = ver
        }
  }
  return best
}

/**
 * Whether a newer MicroPython than the device's `deviceVersion` is available in
 * the catalog FOR THE DEVICE'S OWN FAMILY (`family` from
 * {@link firmwareFamilyFromBanner}). Returns the {current, latest} pair when so,
 * else null. Comparing only within the family is what prevents a cross-family
 * false positive (e.g. micro:bit 2.1.2 offered to a Pico on 1.28.0).
 */
export function newerFirmware(
  deviceVersion: string | null,
  catalog: FirmwareCatalog | null | undefined,
  family?: string | null
): { current: string; latest: string } | null {
  if (!deviceVersion) return null
  const latest = latestCatalogVersion(catalog, family)
  return latest && isNewerVersion(latest, deviceVersion) ? { current: deviceVersion, latest } : null
}

/**
 * Decide the firmware-update notification from the raw console text — the single,
 * unit-testable source of truth the StatusBar uses. Returns the {current, latest}
 * pair only when we can CONFIDENTLY identify both the device version AND its board
 * family from the most-recent banner; otherwise null.
 *
 * Returning null when the family is unknown is the fix for the cross-family RACE
 * (issue: a Pico wrongly offered the micro:bit's 2.x): the boot banner arrives
 * over serial in CHUNKS, and `MicroPython v1.28.0 …` lands before `… with RP2040`,
 * so a check that fired on the partial line saw no MCU token, fell back to the
 * catalog-wide max, and surfaced a micro:bit build. By requiring a known family
 * here (and never falling back to the global max in the live path), a partial or
 * unidentifiable banner yields NO notification rather than a wrong cross-family
 * one — and the caller simply re-checks as more banner text arrives.
 */
export function firmwareUpdateFromConsole(
  consoleText: string,
  catalog: FirmwareCatalog | null | undefined
): { current: string; latest: string } | null {
  const banner = lastMicropythonBanner(consoleText)
  if (!banner) return null
  const version = micropythonVersionFromBanner(banner)
  const family = firmwareFamilyFromBanner(banner)
  if (!version || !family) return null // partial banner / unidentified board — wait
  return newerFirmware(version, catalog, family)
}

/**
 * Whether a newer stable CircuitPython exists for the board this session is
 * talking to (#757).
 *
 * Matched on the **Board ID** — CircuitPython builds are per board, so the
 * board's own build is the only honest comparison. Everything about this is
 * deliberately strict, because the alternative to "no offer" is offering a
 * firmware that will leave the board with the wrong pins:
 *
 *  - not CircuitPython ⇒ null (a MicroPython board is the other path's job).
 *  - no board id ⇒ null. `boot_out.txt` is how the id is known, and it is only
 *    read when a CIRCUITPY drive was unambiguously paired to this port (#753).
 *    Without it we know the version but not the board, which is not enough.
 *  - the board id is not in the catalog ⇒ null. No build exists to offer.
 *  - the running version isn't a version (a branch name, a blank) ⇒ null, via
 *    {@link isNewerVersion}'s guard.
 *  - only pre-release builds are newer ⇒ null. CircuitPython publishes its
 *    alphas and betas here, and an alpha is never an update.
 */
export function circuitPythonUpdate(
  runtime: RuntimeInfo | null | undefined,
  catalog: FirmwareCatalog | null | undefined
): FirmwareUpdate | null {
  if (!runtime || runtime.dialect !== 'circuitpython') return null
  const current = runtime.version ? bareVersion(runtime.version) : ''
  const boardId = runtime.boardId
  if (!current || !boardId) return null

  // Every build published for THIS board — a board may appear twice (a `.uf2`
  // and a `.bin`), and both carry the same versions, so the newest across them
  // is the board's newest.
  const builds = findBoardBuilds(catalog, boardId)
  if (builds.length === 0) return null

  let latest: string | null = null
  for (const build of builds) {
    const newest = newestStableVersion(build.variant.versions, isNewerVersion)
    if (!newest) continue
    const version = bareVersion(newest.version)
    if (latest === null || isNewerVersion(version, latest)) latest = version
  }
  if (!latest || !isNewerVersion(latest, current)) return null
  return { runtime: 'circuitpython', current, latest, boardId }
}

/**
 * How each runtime writes a version. MicroPython says `v1.28.0`, everywhere
 * from its banner to its download page; CircuitPython says `10.2.1`, with no
 * `v`. Small, but the prompt is the one place a user checks a version against
 * what their board printed, and `vSomething` a board never said reads as a
 * different thing entirely.
 */
export function displayVersion(runtime: FirmwareRuntime, version: string): string {
  return runtime === 'micropython' ? `v${bareVersion(version)}` : bareVersion(version)
}

/**
 * The MicroPython path, wrapped to carry its runtime like the CircuitPython one
 * does, so the caller holds one shape and the prompt can name what it offers.
 */
export function microPythonUpdate(
  consoleText: string,
  catalog: FirmwareCatalog | null | undefined
): FirmwareUpdate | null {
  const found = firmwareUpdateFromConsole(consoleText, catalog)
  return found ? { runtime: 'micropython', ...found } : null
}
