import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOARD_PROFILES, profilesForChip } from '../src/shared/board-profiles'
import { siblingBuildUrl } from '../src/shared/firmware-runtime'

/**
 * A board profile's `preferredBuild` must reach the download.
 *
 * The Adafruit ESP32 Feather V2 profile has named `ESP32_GENERIC-SPIRAM` since
 * it was written, and the flash dialog ignored it: the recommendation was read
 * only from the board's own esptool report, so unless you had pressed Detect
 * AND identification had succeeded, the PLAIN build was downloaded — on a board
 * that needs the SPIRAM one. Reported as "the recommended download file works
 * fine — if we suggest this why not just make that download automatically".
 */
const UI = readFileSync(
  join(__dirname, '..', 'src/renderer/src/components/FirmwareFlasher.tsx'),
  'utf-8'
)

describe('preferredBuild reaches the flash', () => {
  it('the dialog reads the profile, not only the board’s self-report', () => {
    const m = /const suggestedBuild = useMemo\(([\s\S]*?)\)\n/.exec(UI)
    expect(m, 'suggestedBuild not found').toBeTruthy()
    expect(m![1], 'the profile’s preferredBuild is ignored').toContain('preferredBuild')
  })

  it('prefers the profile over the self-report', () => {
    // The profile is authored and checked by a human, and is available the
    // moment a board is selected — no interrogation needed.
    const m = /const suggestedBuild = useMemo\(([\s\S]*?)\)\n/.exec(UI)!
    const body = m[1]
    expect(body.indexOf('preferredBuild')).toBeLessThan(body.indexOf('suggestedBuildFor'))
  })
})

describe('the Feather V2 end to end', () => {
  const feather = profilesForChip('ESP32-PICO-V3-02')[0]

  it('names the build that actually boots this board', () => {
    expect(feather?.preferredBuild?.name).toBe('ESP32_GENERIC-SPIRAM')
  })

  it('that name derives a real download from the catalog’s URL', () => {
    const catalog = 'https://micropython.org/resources/firmware/ESP32_GENERIC-20260406-v1.28.0.bin'
    expect(siblingBuildUrl(catalog, feather!.preferredBuild!.name)).toBe(
      'https://micropython.org/resources/firmware/ESP32_GENERIC-SPIRAM-20260406-v1.28.0.bin'
    )
  })

  it('no longer tells the user to go and fetch it by hand', () => {
    // The copy predated Snakie being able to download it.
    expect(feather?.preferredBuild?.why).not.toMatch(/Local file/i)
  })
})

describe('every profile that names a build names a usable one', () => {
  it.each(BOARD_PROFILES.filter((p) => p.preferredBuild).map((p) => [p.id, p] as const))(
    '%s',
    (_id, p) => {
      const name = p.preferredBuild!.name
      // It has to survive the URL derivation, or the recommendation is a
      // dead end that cannot be downloaded.
      const catalog = `https://micropython.org/resources/firmware/${p.chipFamily.toUpperCase()}-20260406-v1.28.0.bin`
      expect(siblingBuildUrl(catalog, name), `${name} cannot form a URL`).toBeTruthy()
      expect(p.preferredBuild!.why.length, 'a recommendation needs a reason').toBeGreaterThan(20)
    }
  )
})
