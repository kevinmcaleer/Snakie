import { describe, it, expect } from 'vitest'
import {
  micropythonVersionFromBanner,
  latestCatalogVersion,
  newerFirmware
} from '../src/renderer/src/components/firmware-version'
import type { FirmwareCatalog } from '../src/main/firmware/types'

const catalog = (versions: string[]): FirmwareCatalog => ({
  families: [
    {
      family: 'rp2',
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
})
