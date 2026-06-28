import { describe, it, expect } from 'vitest'
import {
  lastMicropythonBanner,
  micropythonVersionFromBanner,
  firmwareFamilyFromBanner,
  latestCatalogVersion,
  newerFirmware
} from '../src/renderer/src/components/firmware-version'
import type { FirmwareCatalog } from '../src/main/firmware/types'

const catalog = (versions: string[], family = 'rp2'): FirmwareCatalog => ({
  families: [
    {
      family,
      models: [
        {
          vendor: 'Raspberry Pi',
          model: 'Pico',
          label: 'Raspberry Pi Pico',
          variants: [{ title: 'Pico', versions: versions.map((v) => ({ version: v, url: `x/${v}.uf2` })) }]
        }
      ]
    }
  ]
})

/** A multi-family catalog: mainline rp2 (1.x) alongside micro:bit nrf52 (2.x). */
const mixedCatalog: FirmwareCatalog = {
  families: [
    catalog(['v1.28.0', 'v1.27.0']).families[0],
    catalog(['2.1.2', '2.1.1'], 'nrf52').families[0]
  ]
}

describe('micropythonVersionFromBanner', () => {
  it('parses the version from a boot banner', () => {
    expect(
      micropythonVersionFromBanner('MicroPython v1.22.2 on 2024-02-01; Raspberry Pi Pico W with RP2040')
    ).toBe('1.22.2')
    expect(micropythonVersionFromBanner('MicroPython v1.24 on 2024-...')).toBe('1.24')
  })
  it('returns null when there is no banner', () => {
    expect(micropythonVersionFromBanner('>>> print(1)\n1\n')).toBeNull()
    expect(micropythonVersionFromBanner('')).toBeNull()
  })
  it('reads the MOST-RECENT banner, not a stale earlier one', () => {
    // A micro:bit was plugged in first, then a Pico — both banners are in the
    // console buffer. The live device (Pico, last) must win (issue: stale popup).
    const buffer = [
      'MicroPython v1.18 on 2022-01-01; micro:bit v2.0 with nRF52833',
      '>>> ',
      'MicroPython v1.28.0 on 2026-04-06; Raspberry Pi Pico W with RP2040'
    ].join('\r\n')
    expect(micropythonVersionFromBanner(buffer)).toBe('1.28.0')
  })
})

describe('lastMicropythonBanner', () => {
  it('returns the last banner LINE', () => {
    const buffer = 'MicroPython v1.18 on 2022; micro:bit\r\nout\r\nMicroPython v1.28.0 on 2026; Pico with RP2040'
    expect(lastMicropythonBanner(buffer)).toBe('MicroPython v1.28.0 on 2026; Pico with RP2040')
  })
  it('is null without a banner', () => {
    expect(lastMicropythonBanner('>>> 1')).toBeNull()
    expect(lastMicropythonBanner('')).toBeNull()
  })
})

describe('firmwareFamilyFromBanner', () => {
  it('classifies an rp2 device by its MCU token', () => {
    expect(firmwareFamilyFromBanner('MicroPython v1.28.0 on 2026; Raspberry Pi Pico W with RP2040')).toBe('rp2')
    expect(firmwareFamilyFromBanner('... Raspberry Pi Pico 2 with RP2350')).toBe('rp2')
  })
  it('classifies a micro:bit / nrf device', () => {
    expect(firmwareFamilyFromBanner('MicroPython v2.1.2 on 2024; micro:bit v2 with nRF52833')).toBe('nrf')
    expect(firmwareFamilyFromBanner('... with nRF51822')).toBe('nrf')
  })
  it('classifies esp32 / esp8266', () => {
    expect(firmwareFamilyFromBanner('MicroPython v1.28.0 on 2026; ESP32 module with ESP32')).toBe('esp32')
    expect(firmwareFamilyFromBanner('... with ESP8266')).toBe('esp8266')
  })
  it('returns null for an unrecognised / empty banner', () => {
    expect(firmwareFamilyFromBanner('MicroPython v1.28.0 on 2026; Some Board')).toBeNull()
    expect(firmwareFamilyFromBanner(null)).toBeNull()
  })
})

describe('latestCatalogVersion', () => {
  it('returns the newest STABLE version across the catalog', () => {
    expect(latestCatalogVersion(catalog(['v1.22.0', 'v1.23.0', 'v1.21.0']))).toBe('1.23.0')
  })
  it('ignores preview / nightly / date-tagged builds', () => {
    expect(latestCatalogVersion(catalog(['v1.23.0', '1.24.0-preview.42.gabcdef', '20240105-unstable']))).toBe('1.23.0')
  })
  it('is null for an empty catalog', () => {
    expect(latestCatalogVersion({ families: [] })).toBeNull()
    expect(latestCatalogVersion(null)).toBeNull()
  })
  it('scopes to the given family (rp2 ignores the micro:bit nrf 2.x line)', () => {
    expect(latestCatalogVersion(mixedCatalog, 'rp2')).toBe('1.28.0')
    expect(latestCatalogVersion(mixedCatalog, 'nrf')).toBe('2.1.2')
  })
  it('matches every esp32* sub-family under the esp32 key', () => {
    const cat = { families: [catalog(['v1.28.0'], 'esp32s3').families[0]] }
    expect(latestCatalogVersion(cat, 'esp32')).toBe('1.28.0')
  })
  it('without a family falls back to the catalog-wide max (legacy)', () => {
    expect(latestCatalogVersion(mixedCatalog)).toBe('2.1.2')
  })
})

describe('newerFirmware', () => {
  it('reports an update when the catalog has a newer stable build', () => {
    expect(newerFirmware('1.22.0', catalog(['v1.23.0']))).toEqual({ current: '1.22.0', latest: '1.23.0' })
  })
  it('returns null when the device is already current (or ahead)', () => {
    expect(newerFirmware('1.23.0', catalog(['v1.23.0']))).toBeNull()
    expect(newerFirmware('1.24.0', catalog(['v1.23.0']))).toBeNull()
  })
  it('returns null with no device version or empty catalog', () => {
    expect(newerFirmware(null, catalog(['v1.23.0']))).toBeNull()
    expect(newerFirmware('1.22.0', { families: [] })).toBeNull()
  })

  // Regression: a Pico on 1.28.0 must NOT be offered a micro:bit's 2.1.2.
  it('does not cross families (Pico stays on its rp2 line)', () => {
    expect(newerFirmware('1.28.0', mixedCatalog, 'rp2')).toBeNull()
    // ...while the micro:bit itself still sees its own 2.x update.
    expect(newerFirmware('1.18', mixedCatalog, 'nrf')).toEqual({ current: '1.18', latest: '2.1.2' })
    // And the unscoped (legacy) call is exactly what produced the bug.
    expect(newerFirmware('1.28.0', mixedCatalog)).toEqual({ current: '1.28.0', latest: '2.1.2' })
  })
})
