import { describe, it, expect } from 'vitest'
import { BOARD_PROFILES, profilesForChip } from '../src/shared/board-profiles'
import { parseEsptoolIdentity } from '../src/shared/esptool-identify'

/**
 * Identifying a board should SELECT it, not just describe it.
 *
 * The reported gap: the flash dialog ran detection and identification, learned
 * the board was an ESP32-PICO-V3-02 with PSRAM and 8 MB of flash, and still sat
 * on "Other / set up manually" — leaving the flash offset, the erase default and
 * the BOOT/RESET note to be got right by hand, from a list of fifteen entries.
 * The user's own summary: "If I can't do it via the UI, I doubt users will make
 * the right choices either."
 */
const FEATHER_V2 = `Chip type:          ESP32-PICO-V3-02 (revision v3.0)
Features:           Wi-Fi, BT, Dual Core + LP Core, 240MHz, Embedded Flash, Embedded PSRAM
Detected flash size: 8MB`

describe('profilesForChip', () => {
  it('resolves the reported board from what esptool printed', () => {
    const id = parseEsptoolIdentity(FEATHER_V2)
    const hits = profilesForChip(id.chip)
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('adafruit-feather-esp32-v2')
  })

  it('carries the settings that were being got right by hand', () => {
    const p = profilesForChip('ESP32-PICO-V3-02')[0]
    expect(p.offset).toBe('0x1000')
    expect(p.eraseByDefault).not.toBe(false)
    expect(p.notes).toMatch(/BOOT/)
  })

  it('is case- and whitespace-insensitive, since the banner varies', () => {
    for (const c of ['esp32-pico-v3-02', '  ESP32-PICO-V3-02  ', 'Esp32-Pico-V3-02']) {
      expect(profilesForChip(c), c).toHaveLength(1)
    }
  })

  it('says nothing for a chip no profile claims', () => {
    // The normal case: most ESP32 boards report a generic part that says
    // nothing about WHICH board it is, and inventing a match there would set
    // the wrong offset on a board that flashes cleanly and then does not boot.
    expect(profilesForChip('ESP32-D0WD-V3')).toEqual([])
    expect(profilesForChip('ESP32-S3')).toEqual([])
  })

  it('handles nothing at all without throwing', () => {
    expect(profilesForChip(undefined)).toEqual([])
    expect(profilesForChip('')).toEqual([])
    expect(profilesForChip('   ')).toEqual([])
  })

  it('returns EVERY claimant, so an ambiguous chip is a question not a guess', () => {
    // Two boards on one chip must not be resolved by taking the first: they can
    // differ in flash offset, and picking wrongly writes cleanly and leaves the
    // board dead. The UI offers the list instead.
    const claimed = BOARD_PROFILES.flatMap((p) => p.matchChip ?? [])
    const dupes = claimed.filter((c, i) => claimed.indexOf(c) !== i)
    for (const c of dupes) {
      expect(profilesForChip(c).length).toBeGreaterThan(1)
    }
  })

  it('every declared matchChip actually resolves to its own profile', () => {
    // Guards a typo in the table: a chip string that matches nothing is dead
    // weight that looks like it works.
    for (const p of BOARD_PROFILES) {
      for (const c of p.matchChip ?? []) {
        expect(profilesForChip(c).map((x) => x.id), `${p.id} claims ${c}`).toContain(p.id)
      }
    }
  })
})
