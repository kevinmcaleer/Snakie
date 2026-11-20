import { describe, expect, it } from 'vitest'
import { findMicroPythonBuilds, micropythonBoardFromUrl } from '../src/shared/firmware-runtime'
import { BOARD_PROFILES, boardProfile } from '../src/shared/board-profiles'
import { buildCatalog } from '../src/main/firmware/catalog'

/**
 * Naming a board in the flash dialog lands on THAT board's micropython.org
 * build, not just its chip family. A Pimoroni Tiny 2040 in BOOTSEL mode was not
 * in the Board list at all, and picking "Raspberry Pi Pico" left the user to
 * find the right file among every rp2 board in the catalog.
 *
 * Records below are real entries from Thonny's `micropython-variants-uf2.json`
 * (checked 2026-11), trimmed.
 */
const MP_PICO = {
  vendor: 'Raspberry Pi',
  model: 'Pico',
  family: 'rp2',
  title: 'Pico / Pico H',
  info_url: 'https://micropython.org/download/RPI_PICO',
  downloads: [
    { version: '1.29.0', url: 'https://micropython.org/resources/firmware/RPI_PICO-20260824-v1.29.0.uf2' }
  ]
}
/** Same Model, Pimoroni's own build — must never be chosen for you. */
const MP_PICO_PIMORONI = {
  ...MP_PICO,
  title: 'Pico / Pico H (with Pimoroni libraries)',
  info_url: undefined,
  downloads: [
    {
      version: '1.29.0-2',
      url: 'https://github.com/pimoroni/pimoroni-pico/releases/download/v1.29.0-2/pico-v1.29.0-2-pimoroni-micropython.uf2'
    }
  ]
}
const MP_PICO_W = {
  ...MP_PICO,
  model: 'Pico W',
  title: 'Pico W / Pico WH',
  info_url: 'https://micropython.org/download/RPI_PICO_W',
  downloads: [
    { version: '1.29.0', url: 'https://micropython.org/resources/firmware/RPI_PICO_W-20260824-v1.29.0.uf2' }
  ]
}
const MP_TINY2040 = {
  vendor: 'Pimoroni',
  model: 'Tiny2040',
  family: 'rp2',
  info_url: 'https://micropython.org/download/PIMORONI_TINY2040',
  downloads: [
    {
      version: '1.29.0',
      url: 'https://micropython.org/resources/firmware/PIMORONI_TINY2040-20260824-v1.29.0.uf2'
    },
    {
      version: '1.28.0',
      url: 'https://micropython.org/resources/firmware/PIMORONI_TINY2040-20260406-v1.28.0.uf2'
    }
  ]
}

describe('micropythonBoardFromUrl', () => {
  it('reads the BOARD name, bounded by the build date', () => {
    expect(micropythonBoardFromUrl(MP_TINY2040.downloads[0].url)).toBe('PIMORONI_TINY2040')
    expect(micropythonBoardFromUrl(MP_PICO_W.downloads[0].url)).toBe('RPI_PICO_W')
    expect(micropythonBoardFromUrl(MP_PICO.downloads[0].url)).toBe('RPI_PICO')
  })

  it('is null for anything that is not a micropython.org build', () => {
    expect(micropythonBoardFromUrl(MP_PICO_PIMORONI.downloads[0].url)).toBeNull()
    expect(micropythonBoardFromUrl('')).toBeNull()
  })
})

describe('findMicroPythonBuilds', () => {
  const catalog = buildCatalog([MP_PICO, MP_PICO_PIMORONI, MP_PICO_W, MP_TINY2040])

  it('finds the Tiny 2040 build', () => {
    const found = findMicroPythonBuilds(catalog, 'PIMORONI_TINY2040')
    expect(found).toHaveLength(1)
    expect(found[0].family).toBe('rp2')
    expect(found[0].variant.versions[0].url).toContain('PIMORONI_TINY2040-')
  })

  it('picks the micropython.org Pico build, not the Pico W one or Pimoroni\'s', () => {
    const found = findMicroPythonBuilds(catalog, 'RPI_PICO')
    expect(found).toHaveLength(1)
    expect(found[0].model.model).toBe('Pico')
    expect(found[0].variant.versions[0].url).toContain('micropython.org/resources/firmware/RPI_PICO-')
  })

  it('finds nothing for an empty or unknown board', () => {
    expect(findMicroPythonBuilds(catalog, '')).toEqual([])
    expect(findMicroPythonBuilds(catalog, undefined)).toEqual([])
    expect(findMicroPythonBuilds(catalog, 'PIMORONI_TINY2350')).toEqual([])
  })
})

describe('Pimoroni boards in the Board list', () => {
  it('offers the Tiny 2040 as a UF2 board with its micropython.org build', () => {
    const b = boardProfile('pimoroni-tiny-2040')!
    expect(b.method).toBe('uf2')
    expect(b.chipFamily).toBe('rp2')
    expect(b.micropythonBoard).toBe('PIMORONI_TINY2040')
    expect(b.circuitPythonBoardId).toBe('pimoroni_tiny2040')
  })

  it('offers the Pico LiPo and the Pico 2 W', () => {
    expect(boardProfile('pimoroni-pico-lipo')!.micropythonBoard).toBe('PIMORONI_PICOLIPO')
    expect(boardProfile('pico2-w')!.micropythonBoard).toBe('RPI_PICO2_W')
  })

  it('names every MicroPython board the way micropython.org does', () => {
    for (const b of BOARD_PROFILES.filter((p) => p.micropythonBoard)) {
      expect(b.micropythonBoard, b.id).toMatch(/^[A-Z0-9_]+$/)
    }
  })
})
