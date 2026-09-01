import { describe, it, expect } from 'vitest'
import { siblingBuildUrl } from '../src/shared/firmware-runtime'

/**
 * #833 — reaching a build the catalog does not offer.
 *
 * Identifying a board can tell you it has PSRAM and that ESP32_GENERIC-SPIRAM is
 * the build that uses it. Thonny's catalog has no variants for that family, so
 * the dialog could name the build and then leave the user to open a browser,
 * find it, download it, and come back with a file picker — for a file whose
 * address is entirely derivable from the one already selected.
 */
const MP = 'https://micropython.org/resources/firmware/ESP32_GENERIC-20260406-v1.28.0.bin'

describe('siblingBuildUrl', () => {
  it('derives the SPIRAM build from the plain one — the reported case', () => {
    expect(siblingBuildUrl(MP, 'ESP32_GENERIC-SPIRAM')).toBe(
      'https://micropython.org/resources/firmware/ESP32_GENERIC-SPIRAM-20260406-v1.28.0.bin'
    )
  })

  it('keeps the SAME release — it swaps the build, never the version', () => {
    // Silently moving someone to a different version while they think they are
    // choosing a variant would be its own bug.
    const out = siblingBuildUrl(MP, 'ESP32_GENERIC-SPIRAM') ?? ''
    expect(out).toContain('20260406-v1.28.0')
  })

  it('is a no-op when the URL is already the build asked for', () => {
    expect(siblingBuildUrl(MP, 'ESP32_GENERIC')).toBe(MP)
  })

  it('handles a board name containing hyphens', () => {
    // The 8-digit date is what makes the board token unambiguous.
    const u = 'https://micropython.org/resources/firmware/ESP32_GENERIC_S3-SPIRAM_OCT-20260406-v1.28.0.bin'
    expect(siblingBuildUrl(u, 'ESP32_GENERIC_S3')).toBe(
      'https://micropython.org/resources/firmware/ESP32_GENERIC_S3-20260406-v1.28.0.bin'
    )
  })

  it('refuses to reshape anyone else’s URLs', () => {
    // CircuitPython names builds completely differently, and a mirror makes no
    // promise about layout. Guessing there would produce a confident 404.
    for (const u of [
      'https://downloads.circuitpython.org/bin/adafruit_feather_esp32_v2/en_GB/adafruit-circuitpython-adafruit_feather_esp32_v2-en_GB-10.2.1.bin',
      'https://example.com/mirror/ESP32_GENERIC-20260406-v1.28.0.bin',
      'file:///local/ESP32_GENERIC-20260406-v1.28.0.bin'
    ]) {
      expect(siblingBuildUrl(u, 'ESP32_GENERIC-SPIRAM'), u).toBeNull()
    }
  })

  it('refuses a URL that is not the documented shape', () => {
    for (const u of [
      'https://micropython.org/resources/firmware/firmware.bin',
      'https://micropython.org/resources/firmware/ESP32_GENERIC-v1.28.0.bin',
      'not a url',
      ''
    ]) {
      expect(siblingBuildUrl(u, 'ESP32_GENERIC-SPIRAM'), u).toBeNull()
    }
  })

  it('refuses a build name that could not be a filename', () => {
    // The name reaches a URL path; anything odd must not be interpolated.
    for (const n of ['', '   ', '../../etc/passwd', 'a/b', 'x y']) {
      expect(siblingBuildUrl(MP, n), n).toBeNull()
    }
  })
})
