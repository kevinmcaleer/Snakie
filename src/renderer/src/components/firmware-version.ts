/**
 * MicroPython firmware-version detection (#173).
 *
 * Pure helpers (no IO) so they're unit-testable: read the device's running
 * MicroPython version from its REPL boot banner, find the newest stable version
 * the firmware catalog offers, and decide whether an update is available. The
 * catalog fetch + the device connection live in the caller (StatusBar).
 */
import { compareVersions, isNewer } from '../../../shared/part-registry'
import type { FirmwareCatalog } from '../../../preload/index.d'

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

/** A stable `MAJOR.MINOR[.PATCH]` release, or null for preview/nightly/date tags. */
function stableVersion(v: string): string | null {
  const m = /^v?(\d+\.\d+(?:\.\d+)?)$/.exec(String(v ?? '').trim())
  return m ? m[1] : null
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
          const ver = stableVersion(v.version)
          if (ver && (best === null || compareVersions(ver, best) > 0)) best = ver
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
  return latest && isNewer(latest, deviceVersion) ? { current: deviceVersion, latest } : null
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
