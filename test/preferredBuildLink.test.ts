import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogBuildForBoard, siblingBuildUrl } from '../src/shared/firmware-runtime'

/**
 * Reaching a board's recommended build without a catalog selection (#885).
 *
 * The bug: the recommended-build path was gated on `selVersionUrl`, the version
 * the user picks out of the Family/Model/Version dropdowns. That gate excluded
 * exactly the boards `preferredBuild` exists for. An Adafruit ESP32 Feather V2
 * has no entry in the catalog at all — its owner opens the Model list, does not
 * find their board, and never makes a selection — so the derivation never ran,
 * and the dialog fell back to a link to a download page **headed "ESP32 /
 * WROOM"** that lists the plain build first. The advice said SPIRAM; the link
 * offered the opposite. That board then ran for a week with its 2 MB of PSRAM
 * switched off.
 */

const FIRMWARE = 'https://micropython.org/resources/firmware'

/** Real rows from Thonny's `micropython-variants-esptool.json`, newest first. */
const ESP32_FAMILY_URLS = [
  `${FIRMWARE}/ESP32_GENERIC-20260406-v1.28.0.bin`,
  `${FIRMWARE}/ESP32_GENERIC-20251209-v1.27.0.bin`,
  `${FIRMWARE}/SPARKFUN_IOT_REDBOARD_ESP32-20260406-v1.28.0.bin`,
  `${FIRMWARE}/LILYGO_TTGO_LORA32-20260406-v1.28.0.bin`
]

describe('finding a starting point with nothing selected', () => {
  it('finds a build of the same board', () => {
    expect(catalogBuildForBoard(ESP32_FAMILY_URLS, 'ESP32_GENERIC-SPIRAM')).toBe(
      `${FIRMWARE}/ESP32_GENERIC-20260406-v1.28.0.bin`
    )
  })

  it('takes the NEWEST, so the recommendation matches the version on offer', () => {
    // The catalog serves newest-first; recommending a build two releases behind
    // what the same dialog would otherwise flash would be its own small bug.
    expect(catalogBuildForBoard(ESP32_FAMILY_URLS, 'ESP32_GENERIC-SPIRAM')).toContain('v1.28.0')
  })

  it('does not wander onto another vendor sharing the model name', () => {
    // "ESP32 / WROOM" holds Espressif's board AND SparkFun's. Only the filename
    // says which board a build is for — deriving a Feather V2 recommendation
    // from a SparkFun binary would be worse than the page link it replaces.
    const picked = catalogBuildForBoard(ESP32_FAMILY_URLS, 'ESP32_GENERIC-SPIRAM')
    expect(picked).not.toContain('SPARKFUN')
    expect(picked).not.toContain('LILYGO')
  })

  it('handles a board name that itself contains a hyphen or underscore', () => {
    const urls = [`${FIRMWARE}/ESP32_GENERIC_S3-20260406-v1.28.0.bin`]
    expect(catalogBuildForBoard(urls, 'ESP32_GENERIC_S3-SPIRAM_OCT')).toBe(urls[0])
  })

  it('says nothing when the board is absent from the family', () => {
    expect(catalogBuildForBoard(ESP32_FAMILY_URLS, 'ESP32_GENERIC_C6-SPIRAM')).toBeNull()
  })

  it('says nothing for a build name with no variant to strip', () => {
    // `ESP32_GENERIC` is not a variant OF anything, so there is no sibling.
    expect(catalogBuildForBoard(ESP32_FAMILY_URLS, 'ESP32_GENERIC')).toBeNull()
  })
})

describe('the URL it produces is the one that actually exists', () => {
  it('rewrites the board token and keeps the release', () => {
    const base = catalogBuildForBoard(ESP32_FAMILY_URLS, 'ESP32_GENERIC-SPIRAM')
    // Verified against micropython.org: this file resolves 200.
    expect(siblingBuildUrl(base!, 'ESP32_GENERIC-SPIRAM')).toBe(
      `${FIRMWARE}/ESP32_GENERIC-SPIRAM-20260406-v1.28.0.bin`
    )
  })

  it('works for the octal-PSRAM S3 case too', () => {
    const base = `${FIRMWARE}/ESP32_GENERIC_S3-20260406-v1.28.0.bin`
    expect(siblingBuildUrl(base, 'ESP32_GENERIC_S3-SPIRAM_OCT')).toBe(
      `${FIRMWARE}/ESP32_GENERIC_S3-SPIRAM_OCT-20260406-v1.28.0.bin`
    )
  })
})

describe('the dialog', () => {
  const tsx = readFileSync('src/renderer/src/components/FirmwareFlasher.tsx', 'utf8')

  it('no longer requires a catalog selection to find the recommended build', () => {
    // The gate that caused this: `if (!name || !selVersionUrl) return`.
    expect(tsx).toContain('selVersionUrl || catalogBuildForBoard(')
  })

  it('lets Flash run on the recommended build alone', () => {
    // `haveFirmware` gated on `selVersionUrl`, so even once the build was found
    // the button stayed disabled for a board with nothing selectable.
    expect(tsx).toContain('usingCatalog ? flashUrl.length > 0')
  })

  it('stops sending the user to a page once it has the file', () => {
    expect(tsx).toContain('will download it when you press Flash')
  })

  it('warns which build to pick when it still has to send them away', () => {
    // That page is headed "ESP32 / WROOM" and offers the plain build first.
    expect(tsx).toContain('not the plain build at')
  })
})

describe('links in this dialog are readable', () => {
  const css = readFileSync('src/renderer/src/components/FirmwareFlasher.css', 'utf8')

  it('styles a plain anchor, not only the button dressed as one', () => {
    // The anchor had NO colour rule at all, in a stylesheet whose own header
    // says every foreground here must come from the dialog's palette — so it
    // fell through to the browser default: dark blue on a #1f2430 panel.
    expect(css).toContain('.firmware-hint a')
  })

  it('does not take the link colour from the theme', () => {
    const block = css.slice(css.indexOf('.firmware-link,'), css.indexOf('.firmware-link:hover'))
    expect(block).not.toContain('var(--accent)')
    expect(block).toMatch(/color:\s*#[0-9a-f]{6}/i)
  })

  it('gives keyboard focus something visible', () => {
    expect(css).toContain('.firmware-hint a:focus-visible')
  })
})
