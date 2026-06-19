import { describe, expect, it } from 'vitest'
import { buildCatalog } from '../src/main/firmware/catalog'
import { fileNameFromUrl } from '../src/main/firmware/download'

/**
 * Unit tests for the firmware-catalog reshaping (issue #64). `buildCatalog`
 * turns Thonny's flat `micropython-variants-uf2.json` array into the
 * Family → Model → Variant → Version cascade the flash dialog renders, and is
 * the load-bearing pure logic worth pinning. `fileNameFromUrl` derives the temp
 * download filename.
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

  it('skips entries with no family/model or no .uf2 downloads', () => {
    const cat = buildCatalog([
      { family: 'rp2', model: 'X', downloads: [{ version: 'v1', url: 'https://x/firmware.bin' }] },
      { family: 'rp2', downloads: [{ version: 'v1', url: 'https://x/y.uf2' }] },
      { family: '', model: 'Z', downloads: [{ version: 'v1', url: 'https://x/z.uf2' }] }
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
})

describe('fileNameFromUrl', () => {
  it('extracts the .uf2 basename from a URL', () => {
    expect(fileNameFromUrl('https://micropython.org/resources/firmware/RPI_PICO-v1.28.0.uf2')).toBe(
      'RPI_PICO-v1.28.0.uf2'
    )
  })

  it('drops a query string', () => {
    expect(fileNameFromUrl('https://x/y/FW-v1.uf2?token=abc')).toBe('FW-v1.uf2')
  })

  it('falls back to a generated name when the URL has no .uf2 basename', () => {
    expect(fileNameFromUrl('https://x/y/')).toMatch(/^micropython-\d+\.uf2$/)
    expect(fileNameFromUrl('not a url')).toMatch(/^micropython-\d+\.uf2$/)
  })
})
