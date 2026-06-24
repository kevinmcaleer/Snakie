import { describe, expect, it } from 'vitest'
import { buildCatalog, flashTargetForFamily } from '../src/main/firmware/catalog'
import { fileNameFromUrl } from '../src/main/firmware/download'

/**
 * Unit tests for the firmware-catalog reshaping (issues #64, #125).
 * `buildCatalog` turns Thonny's flat UF2 (`.uf2`) + esptool (`.bin`) variant
 * arrays into the Family → Model → Variant → Version cascade the flash dialog
 * renders, and is the load-bearing pure logic worth pinning.
 * `flashTargetForFamily` maps a catalog family to its flash `{ board, offset }`
 * (the per-chip esptool offset must be exact). `fileNameFromUrl` derives the
 * temp download filename.
 */

const SAMPLE = [
  {
    vendor: 'Raspberry Pi',
    model: 'Pico',
    family: 'rp2',
    title: 'Pico',
    info_url: 'https://micropython.org/download/RPI_PICO/',
    popular: true,
    downloads: [
      { version: 'v1.28.0', url: 'https://micropython.org/resources/firmware/RPI_PICO-v1.28.0.uf2' },
      { version: 'v1.27.0', url: 'https://micropython.org/resources/firmware/RPI_PICO-v1.27.0.uf2' }
    ]
  },
  {
    vendor: 'Raspberry Pi',
    model: 'Pico 2',
    family: 'rp2',
    title: 'Pico 2',
    downloads: [
      { version: 'v1.28.0', url: 'https://micropython.org/resources/firmware/RPI_PICO2-v1.28.0.uf2' }
    ]
  },
  {
    vendor: 'Espressif',
    model: 'ESP32',
    family: 'esp32',
    title: 'ESP32 (SPIRAM)',
    downloads: [
      { version: 'v1.28.0', url: 'https://micropython.org/resources/firmware/ESP32_SPIRAM-v1.28.0.uf2' }
    ]
  }
]

describe('buildCatalog', () => {
  it('groups entries into Family → Model → Variant → Version', () => {
    const cat = buildCatalog(SAMPLE)
    // Families sorted alphabetically: esp32 before rp2.
    expect(cat.families.map((f) => f.family)).toEqual(['esp32', 'rp2'])

    const rp2 = cat.families.find((f) => f.family === 'rp2')!
    expect(rp2.models.map((m) => m.label)).toEqual(['Raspberry Pi Pico', 'Raspberry Pi Pico 2'])

    const pico = rp2.models.find((m) => m.model === 'Pico')!
    expect(pico.variants).toHaveLength(1)
    expect(pico.variants[0].title).toBe('Pico')
    expect(pico.variants[0].popular).toBe(true)
    // Versions preserved in source order (newest first as published).
    expect(pico.variants[0].versions.map((v) => v.version)).toEqual(['v1.28.0', 'v1.27.0'])
    expect(pico.variants[0].versions[0].url).toContain('RPI_PICO-v1.28.0.uf2')
  })

  it('skips entries with no family/model or no flashable (.uf2/.bin) downloads', () => {
    const cat = buildCatalog([
      // A non-firmware extension (not .uf2 / .bin) is skipped.
      { family: 'rp2', model: 'X', downloads: [{ version: 'v1', url: 'https://x/firmware.zip' }] },
      // Missing model.
      { family: 'rp2', downloads: [{ version: 'v1', url: 'https://x/y.uf2' }] },
      // Missing family.
      { family: '', model: 'Z', downloads: [{ version: 'v1', url: 'https://x/z.bin' }] }
    ])
    expect(cat.families).toHaveLength(0)
  })

  it('merges multiple entries sharing a model into separate variants by title', () => {
    const cat = buildCatalog([
      {
        vendor: 'V',
        model: 'M',
        family: 'rp2',
        title: 'Std',
        downloads: [{ version: 'v1', url: 'https://x/std.uf2' }]
      },
      {
        vendor: 'V',
        model: 'M',
        family: 'rp2',
        title: 'RISC-V',
        downloads: [{ version: 'v1', url: 'https://x/riscv.uf2' }]
      }
    ])
    const m = cat.families[0].models[0]
    expect(m.variants.map((v) => v.title)).toEqual(['RISC-V', 'Std'])
  })

  it('returns an empty catalog for non-array input', () => {
    expect(buildCatalog(null).families).toEqual([])
    expect(buildCatalog({}).families).toEqual([])
    expect(buildCatalog('nope').families).toEqual([])
  })

  // --- issue #125: ESP `.bin` catalog + merging two sources + dedupe ---

  it('keeps `.bin` (esptool) downloads and builds the esp families', () => {
    const cat = buildCatalog([
      {
        vendor: 'Espressif',
        model: 'ESP32',
        family: 'esp32',
        title: 'ESP32 / WROOM',
        downloads: [{ version: 'v1.28.0', url: 'https://micropython.org/.../ESP32_GENERIC-v1.28.0.bin' }]
      },
      {
        vendor: 'Espressif',
        model: 'ESP32-S3',
        family: 'esp32s3',
        title: 'ESP32-S3',
        downloads: [{ version: 'v1.28.0', url: 'https://micropython.org/.../ESP32_S3-v1.28.0.bin' }]
      }
    ])
    expect(cat.families.map((f) => f.family)).toEqual(['esp32', 'esp32s3'])
    const esp32 = cat.families.find((f) => f.family === 'esp32')!
    expect(esp32.models[0].variants[0].versions[0].url).toMatch(/\.bin$/)
  })

  it('merges the UF2 (.uf2) and esptool (.bin) source arrays into one cascade', () => {
    // Mirrors `fetchFirmwareCatalog` concatenating the two raw arrays.
    const uf2 = [
      {
        vendor: 'Raspberry Pi',
        model: 'Pico',
        family: 'rp2',
        downloads: [{ version: 'v1.28.0', url: 'https://x/RPI_PICO-v1.28.0.uf2' }]
      }
    ]
    const esptool = [
      {
        vendor: 'Espressif',
        model: 'ESP32',
        family: 'esp32',
        downloads: [{ version: 'v1.28.0', url: 'https://x/ESP32-v1.28.0.bin' }]
      }
    ]
    const cat = buildCatalog([...uf2, ...esptool])
    expect(cat.families.map((f) => f.family)).toEqual(['esp32', 'rp2'])
  })

  it('de-dupes versions by url within a variant when sources overlap', () => {
    const dup = {
      vendor: 'Espressif',
      model: 'ESP32',
      family: 'esp32',
      title: 'ESP32',
      downloads: [
        { version: 'v1.28.0', url: 'https://x/ESP32-v1.28.0.bin' },
        { version: 'v1.27.0', url: 'https://x/ESP32-v1.27.0.bin' }
      ]
    }
    // The exact same entry appears in both merged arrays.
    const cat = buildCatalog([dup, { ...dup }])
    const variant = cat.families[0].models[0].variants[0]
    expect(variant.versions.map((v) => v.url)).toEqual([
      'https://x/ESP32-v1.28.0.bin',
      'https://x/ESP32-v1.27.0.bin'
    ])
  })
})

describe('flashTargetForFamily', () => {
  it('maps esp32 to esp32 board at 0x1000', () => {
    expect(flashTargetForFamily('esp32')).toEqual({ board: 'esp32', offset: '0x1000' })
  })

  it('maps every other esp32* chip to esp32 board at 0x0', () => {
    for (const fam of ['esp32s2', 'esp32s3', 'esp32c2', 'esp32c3', 'esp32c5', 'esp32c6', 'esp32p4']) {
      expect(flashTargetForFamily(fam)).toEqual({ board: 'esp32', offset: '0x0' })
    }
  })

  it('maps esp8266 to esp8266 board at 0x0', () => {
    expect(flashTargetForFamily('esp8266')).toEqual({ board: 'esp8266', offset: '0x0' })
  })

  it('maps rp2 to rp2040 board with NO offset (UF2 copy)', () => {
    const target = flashTargetForFamily('rp2')
    expect(target.board).toBe('rp2040')
    expect(target.offset).toBeUndefined()
  })

  it('treats an unknown family as a UF2 copy (rp2040, no offset)', () => {
    expect(flashTargetForFamily('mimxrt')).toEqual({ board: 'rp2040' })
  })

  it('is case/whitespace tolerant', () => {
    expect(flashTargetForFamily('  ESP32  ')).toEqual({ board: 'esp32', offset: '0x1000' })
  })
})

describe('fileNameFromUrl', () => {
  it('extracts the .uf2 basename from a URL', () => {
    expect(fileNameFromUrl('https://micropython.org/resources/firmware/RPI_PICO-v1.28.0.uf2')).toBe(
      'RPI_PICO-v1.28.0.uf2'
    )
  })

  it('extracts the .bin basename from a URL (issue #125)', () => {
    expect(
      fileNameFromUrl('https://micropython.org/resources/firmware/ESP32_GENERIC-v1.28.0.bin')
    ).toBe('ESP32_GENERIC-v1.28.0.bin')
  })

  it('drops a query string', () => {
    expect(fileNameFromUrl('https://x/y/FW-v1.uf2?token=abc')).toBe('FW-v1.uf2')
    expect(fileNameFromUrl('https://x/y/FW-v1.bin?token=abc')).toBe('FW-v1.bin')
  })

  it('falls back to a generated .bin name when the URL has no firmware basename', () => {
    expect(fileNameFromUrl('https://x/y/')).toMatch(/^micropython-\d+\.bin$/)
    expect(fileNameFromUrl('not a url')).toMatch(/^micropython-\d+\.bin$/)
  })
})
