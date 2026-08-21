import { describe, it, expect } from 'vitest'
import {
  circuitPythonUpdate,
  displayVersion,
  lastMicropythonBanner,
  micropythonVersionFromBanner,
  firmwareFamilyFromBanner,
  latestCatalogVersion,
  microPythonUpdate,
  newerFirmware,
  firmwareUpdateFromConsole
} from '../src/renderer/src/components/firmware-version'
import { buildCatalog } from '../src/main/firmware/catalog'
import { parseBootOut } from '../src/shared/dialect'
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

describe('firmwareUpdateFromConsole (cross-family race, 0.15.1)', () => {
  const pico = (ver, board = 'Raspberry Pi Pico with RP2040') =>
    `MicroPython v${ver} on 2026-04-06; ${board}`

  it('returns null for a PARTIAL banner (version arrived, MCU token has not)', () => {
    // The boot banner streams in chunks; this is the chunk before "… with RP2040".
    // The OLD bug fell back to the catalog-wide max here and offered 2.1.2.
    const partial = 'MicroPython v1.28.0 on 2026-04-06; Raspberry Pi Pico'
    expect(firmwareFamilyFromBanner(partial)).toBeNull() // no MCU token yet
    expect(firmwareUpdateFromConsole(partial, mixedCatalog)).toBeNull()
  })

  it('does NOT offer a micro:bit build to a Pico once the banner is complete', () => {
    expect(firmwareUpdateFromConsole(pico('1.28.0'), mixedCatalog)).toBeNull()
  })

  it('offers the rp2 update to a Pico that is behind', () => {
    expect(firmwareUpdateFromConsole(pico('1.26.0'), mixedCatalog)).toEqual({
      current: '1.26.0',
      latest: '1.28.0'
    })
  })

  it('offers the micro:bit its OWN 2.x update', () => {
    const mb = 'MicroPython v2.1.1 on 2024-01-01; micro:bit v2 with nRF52833'
    expect(firmwareUpdateFromConsole(mb, mixedCatalog)).toEqual({ current: '2.1.1', latest: '2.1.2' })
  })

  it('uses the LAST banner (ignores a previous device left in the buffer)', () => {
    const buffer = [
      'MicroPython v2.1.1 on 2024; micro:bit v2 with nRF52833', // unplugged micro:bit
      '>>> ',
      pico('1.26.0') // the live Pico, behind
    ].join('\r\n')
    expect(firmwareUpdateFromConsole(buffer, mixedCatalog)).toEqual({ current: '1.26.0', latest: '1.28.0' })
  })

  it('returns null with no banner', () => {
    expect(firmwareUpdateFromConsole('>>> print(1)\n1\n', mixedCatalog)).toBeNull()
    expect(firmwareUpdateFromConsole('', mixedCatalog)).toBeNull()
  })

  it('names its runtime, so the prompt can say which Python it means', () => {
    expect(microPythonUpdate(pico('1.26.0'), mixedCatalog)).toEqual({
      runtime: 'micropython',
      current: '1.26.0',
      latest: '1.28.0'
    })
    expect(microPythonUpdate(pico('1.28.0'), mixedCatalog)).toBeNull()
  })
})

/**
 * A NEWER CIRCUITPYTHON, OFFERED ONCE (#757).
 *
 * Matched on the Board ID rather than the chip family, because CircuitPython
 * builds are per board. Every "null" case below is a case where offering
 * something would mean guessing which board this is — and the cost of guessing
 * is a board that boots with another board's pin map.
 */
describe('circuitPythonUpdate', () => {
  /** The catalog exactly as `buildCatalog` hands it to the renderer. */
  const catalog = buildCatalog([
    {
      vendor: 'Adafruit',
      model: 'Feather RP2040',
      family: 'rp2',
      info_url: 'https://circuitpython.org/board/adafruit_feather_rp2040/',
      downloads: [
        { version: '10.2.1', url: 'https://downloads.circuitpython.org/bin/adafruit_feather_rp2040/en_US/adafruit-circuitpython-adafruit_feather_rp2040-en_US-10.2.1.uf2' },
        { version: '10.3.0-alpha.1', url: 'https://downloads.circuitpython.org/bin/adafruit_feather_rp2040/en_US/adafruit-circuitpython-adafruit_feather_rp2040-en_US-10.3.0-alpha.1.uf2' },
        { version: '9.2.9', url: 'https://downloads.circuitpython.org/bin/adafruit_feather_rp2040/en_US/adafruit-circuitpython-adafruit_feather_rp2040-en_US-9.2.9.uf2' }
      ]
    },
    {
      // A board whose newest published build is OLDER — a board on 10.x must not
      // be offered this one just because it is also CircuitPython.
      vendor: 'Raspberry Pi',
      model: 'Pico',
      family: 'rp2',
      info_url: 'https://circuitpython.org/board/raspberry_pi_pico/',
      downloads: [
        { version: '9.2.9', url: 'https://downloads.circuitpython.org/bin/raspberry_pi_pico/en_US/adafruit-circuitpython-raspberry_pi_pico-en_US-9.2.9.uf2' }
      ]
    }
  ])

  /** What #753 actually reads off the drive, parsed by the real parser. */
  const bootOut = (version: string, boardId = 'adafruit_feather_rp2040'): string =>
    `Adafruit CircuitPython ${version} on 2026-08-18; Adafruit Feather RP2040 with rp2040\r\nBoard ID:${boardId}\r\nUID:E661640843373E2A\r\n`

  it('offers the newest stable build for the board it actually is', () => {
    const runtime = parseBootOut(bootOut('9.2.9'))
    expect(circuitPythonUpdate(runtime, catalog)).toEqual({
      runtime: 'circuitpython',
      current: '9.2.9',
      latest: '10.2.1',
      boardId: 'adafruit_feather_rp2040'
    })
  })

  it('says nothing to a board already on the newest stable', () => {
    expect(circuitPythonUpdate(parseBootOut(bootOut('10.2.1')), catalog)).toBeNull()
  })

  it('NEVER offers a pre-release over a stable build', () => {
    // 10.3.0-alpha.1 IS newer than 10.2.1 by semver, and it is right there in
    // the same catalog entry. It must still not be offered.
    const offer = circuitPythonUpdate(parseBootOut(bootOut('10.2.1')), catalog)
    expect(offer).toBeNull()
    const behind = circuitPythonUpdate(parseBootOut(bootOut('9.2.9')), catalog)
    expect(behind?.latest).toBe('10.2.1')
    // …and a board already running the alpha is not told to "update" to 10.2.1.
    expect(circuitPythonUpdate(parseBootOut(bootOut('10.3.0-alpha.1')), catalog)).toBeNull()
  })

  it('offers NOTHING when the board id could not be established', () => {
    // A CircuitPython board whose drive was ambiguous (#753) — version known,
    // board not. There is no near-enough build to fall back to.
    expect(
      circuitPythonUpdate({ dialect: 'circuitpython', version: '9.2.9' }, catalog)
    ).toBeNull()
  })

  it('offers nothing for a board the catalog does not publish', () => {
    expect(circuitPythonUpdate(parseBootOut(bootOut('9.2.9', 'some_kickstarter_board')), catalog)).toBeNull()
  })

  it('does not cross boards — a Feather is never offered the Pico’s build', () => {
    // The Pico's newest is 9.2.9; a Feather on 10.2.1 must hear nothing, which a
    // catalog-wide "newest CircuitPython" would get wrong in the other direction.
    expect(circuitPythonUpdate(parseBootOut(bootOut('10.2.1')), catalog)).toBeNull()
    const pico = parseBootOut(bootOut('9.2.8', 'raspberry_pi_pico'))
    expect(circuitPythonUpdate(pico, catalog)).toEqual({
      runtime: 'circuitpython',
      current: '9.2.8',
      latest: '9.2.9',
      boardId: 'raspberry_pi_pico'
    })
  })

  it('is not the MicroPython path’s job, and vice versa', () => {
    const mp = { dialect: 'micropython' as const, version: '1.20.0', boardId: 'raspberry_pi_pico' }
    expect(circuitPythonUpdate(mp, catalog)).toBeNull()
    expect(circuitPythonUpdate(null, catalog)).toBeNull()
    expect(circuitPythonUpdate(undefined, catalog)).toBeNull()
  })

  it('offers nothing when the running "version" is not a version', () => {
    // The vendor-build case: a branch name where the version goes.
    const odd = { dialect: 'circuitpython' as const, version: 'sherlock-v1.24', boardId: 'adafruit_feather_rp2040' }
    expect(circuitPythonUpdate(odd, catalog)).toBeNull()
  })

  it('degrades to null rather than throwing on an empty/absent catalog', () => {
    expect(circuitPythonUpdate(parseBootOut(bootOut('9.2.9')), { families: [] })).toBeNull()
    expect(circuitPythonUpdate(parseBootOut(bootOut('9.2.9')), null)).toBeNull()
  })
})

describe('displayVersion', () => {
  it('writes each runtime’s version the way that runtime does', () => {
    expect(displayVersion('micropython', '1.28.0')).toBe('v1.28.0')
    expect(displayVersion('circuitpython', '10.2.1')).toBe('10.2.1')
  })
  it('never doubles a leading v', () => {
    expect(displayVersion('micropython', 'v1.28.0')).toBe('v1.28.0')
  })
})
