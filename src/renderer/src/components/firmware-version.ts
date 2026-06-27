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
 * Parse the MicroPython version (e.g. `1.22.2`) from a REPL boot banner such as
 * `MicroPython v1.22.2 on 2024-... ; Raspberry Pi Pico W with RP2040`. Returns
 * the bare `MAJOR.MINOR[.PATCH]` string, or null if no banner is present.
 */
export function micropythonVersionFromBanner(text: string): string | null {
  const m = /MicroPython\s+v?(\d+\.\d+(?:\.\d+)?)/i.exec(text ?? '')
  return m ? m[1] : null
}

/** A stable `MAJOR.MINOR[.PATCH]` release, or null for preview/nightly/date tags. */
function stableVersion(v: string): string | null {
  const m = /^v?(\d+\.\d+(?:\.\d+)?)$/.exec(String(v ?? '').trim())
  return m ? m[1] : null
}

/**
 * The newest STABLE MicroPython version anywhere in the catalog. MicroPython
 * releases are version-aligned across ports, so the catalog-wide max is a good
 * proxy for "the latest MicroPython release". Null if the catalog has none.
 */
export function latestCatalogVersion(catalog: FirmwareCatalog | null | undefined): string | null {
  let best: string | null = null
  for (const fam of catalog?.families ?? [])
    for (const model of fam.models ?? [])
      for (const variant of model.variants ?? [])
        for (const v of variant.versions ?? []) {
          const ver = stableVersion(v.version)
          if (ver && (best === null || compareVersions(ver, best) > 0)) best = ver
        }
  return best
}

/**
 * Whether a newer MicroPython than the device's `deviceVersion` is available in
 * the catalog. Returns the {current, latest} pair when so, else null.
 */
export function newerFirmware(
  deviceVersion: string | null,
  catalog: FirmwareCatalog | null | undefined
): { current: string; latest: string } | null {
  if (!deviceVersion) return null
  const latest = latestCatalogVersion(catalog)
  return latest && isNewer(latest, deviceVersion) ? { current: deviceVersion, latest } : null
}
