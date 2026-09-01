import { describe, it, expect } from 'vitest'
import {
  describeIdentity,
  parseEsptoolIdentity,
  suggestedBuildFor
} from '../src/shared/esptool-identify'

/**
 * Interrogating the board before flashing it.
 *
 * The sample below is verbatim `esptool v5.3.0 flash-id` output from the
 * Adafruit ESP32 Feather V2 that prompted this — including the line that
 * matters most, `Embedded PSRAM`, which is the only reliable way to know that
 * ESP32_GENERIC-SPIRAM is the build this board wants. Nothing in the firmware
 * catalog carries that fact.
 */
const FEATHER_V2 = `Connected to ESP32 on /dev/tty.usbserial-51850332091:
Chip type:          ESP32-PICO-V3-02 (revision v3.0)
Features:           Wi-Fi, BT, Dual Core + LP Core, 240MHz, Embedded Flash, Embedded PSRAM, Vref calibration in eFuse, Coding Scheme None
Crystal frequency:  40MHz
MAC:                e8:9f:6d:26:93:20

Flash Memory Information:
=========================
Manufacturer: 68
Device: 4017
Detected flash size: 8MB
Flash voltage set by a strapping pin: 3.3V`

const PLAIN_ESP32 = `Chip type:          ESP32-D0WD-V3 (revision v3.1)
Features:           Wi-Fi, BT, Dual Core, 240MHz, Vref calibration in eFuse, Coding Scheme None
MAC:                24:6f:28:11:22:33
Detected flash size: 4MB`

describe('parseEsptoolIdentity', () => {
  it('reads the real Feather V2 output', () => {
    const id = parseEsptoolIdentity(FEATHER_V2)
    expect(id.chip).toBe('ESP32-PICO-V3-02')
    expect(id.revision).toBe('v3.0')
    expect(id.family).toBe('esp32')
    expect(id.flashSize).toBe('8MB')
    expect(id.mac).toBe('e8:9f:6d:26:93:20')
    expect(id.psram).toBe(true)
  })

  it('does not see PSRAM where there is none', () => {
    const id = parseEsptoolIdentity(PLAIN_ESP32)
    expect(id.psram).toBe(false)
    expect(id.chip).toBe('ESP32-D0WD-V3')
    expect(id.family).toBe('esp32')
  })

  it('does not let a PICO or WROOM module name change the family', () => {
    // The module name describes what is around the die, not the die.
    for (const c of ['ESP32-PICO-V3-02', 'ESP32-D0WDQ6', 'ESP32-WROOM-32E']) {
      expect(parseEsptoolIdentity(`Chip type: ${c}`).family, c).toBe('esp32')
    }
  })

  it('does not let the ESP32 rule swallow the S3 and the RISC-V parts', () => {
    // Longest-first matching: "ESP32-S3" must not be read as plain "ESP32",
    // which would pre-select a 0x1000 offset for a chip that needs 0x0.
    expect(parseEsptoolIdentity('Chip type: ESP32-S3 (QFN56)').family).toBe('esp32s3')
    expect(parseEsptoolIdentity('Chip type: ESP32-S2').family).toBe('esp32s2')
    expect(parseEsptoolIdentity('Chip type: ESP32-C3').family).toBe('esp32c3')
    expect(parseEsptoolIdentity('Chip type: ESP32-C6').family).toBe('esp32c6')
  })

  it('leaves everything unknown rather than guessing, on output it cannot read', () => {
    for (const s of ['', 'Connecting....', 'A fatal error occurred: Failed to connect']) {
      expect(parseEsptoolIdentity(s)).toEqual({})
    }
  })
})

describe('suggestedBuildFor', () => {
  it('recommends the SPIRAM build for a PSRAM esp32 — the reported case', () => {
    const s = suggestedBuildFor(parseEsptoolIdentity(FEATHER_V2))
    expect(s?.name).toBe('ESP32_GENERIC-SPIRAM')
    expect(s?.why).toMatch(/PSRAM/)
    // ...and is honest that the plain build still works.
    expect(s?.why).toMatch(/runs fine|leaves the PSRAM/i)
  })

  it('says nothing for an esp32 without PSRAM', () => {
    expect(suggestedBuildFor(parseEsptoolIdentity(PLAIN_ESP32))).toBeNull()
  })

  it('deliberately says nothing for an S3, even with PSRAM', () => {
    // The S3 is a three-way choice (plain / SPIRAM / SPIRAM_OCT) that turns on
    // the RAM's bus width, which flash-id does not report. A wrong guess sends
    // someone to a build that boots with a PSRAM error.
    const s3 = parseEsptoolIdentity('Chip type: ESP32-S3\nFeatures: Wi-Fi, BT, PSRAM')
    expect(s3.psram).toBe(true)
    expect(suggestedBuildFor(s3)).toBeNull()
  })

  it('says nothing when the board was never identified', () => {
    expect(suggestedBuildFor({})).toBeNull()
  })
})

describe('describeIdentity', () => {
  it('summarises what the user would want to see', () => {
    expect(describeIdentity(parseEsptoolIdentity(FEATHER_V2)))
      .toBe('ESP32-PICO-V3-02 · 8MB flash · PSRAM')
  })

  it('omits what it does not know instead of printing blanks', () => {
    expect(describeIdentity({ chip: 'ESP32' })).toBe('ESP32')
    expect(describeIdentity({})).toBe('')
  })
})
