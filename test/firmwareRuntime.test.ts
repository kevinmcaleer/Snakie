import { describe, expect, it } from 'vitest'
import {
  bareVersion,
  boardIdFromDownloadUrl,
  boardIdFromInfoUrl,
  downloadKind,
  findBoardBuilds,
  firmwareRuntimeForDialect,
  flashTargetForDownload,
  isStableRelease,
  isVendorUf2Family,
  newestStableVersion,
  sameBoardId,
  variantBoardId
} from '../src/shared/firmware-runtime'
import { isNewerVersion } from '../src/shared/version-compare'
import { buildCatalog } from '../src/main/firmware/catalog'
import type { FirmwareCatalog } from '../src/main/firmware/types'

/**
 * The CircuitPython half of the flash dialog (#756): which runtime is being
 * flashed, how a download's EXTENSION decides the flash mechanism, and how a
 * board's Board ID is matched to its own build.
 *
 * The URL shapes asserted here were verified (2026-08) against the live
 * `thonny/thonny` CircuitPython catalogs and a HEAD of a real
 * `downloads.circuitpython.org` build — the strings are the published contract,
 * not a guess.
 */

/** A real record from `circuitpython-variants-uf2.json`, trimmed. */
const CP_PICO = {
  vendor: 'Raspberry Pi',
  model: 'Pico',
  family: 'rp2',
  info_url: 'https://circuitpython.org/board/raspberry_pi_pico/',
  downloads: [
    {
      version: '10.2.1',
      url: 'https://downloads.circuitpython.org/bin/raspberry_pi_pico/en_US/adafruit-circuitpython-raspberry_pi_pico-en_US-10.2.1.uf2'
    },
    {
      version: '10.3.0-alpha.1',
      url: 'https://downloads.circuitpython.org/bin/raspberry_pi_pico/en_US/adafruit-circuitpython-raspberry_pi_pico-en_US-10.3.0-alpha.1.uf2'
    },
    {
      version: '9.2.9',
      url: 'https://downloads.circuitpython.org/bin/raspberry_pi_pico/en_US/adafruit-circuitpython-raspberry_pi_pico-en_US-9.2.9.uf2'
    }
  ]
}

/** The Pico W — same chip, DIFFERENT board, different build. */
const CP_PICO_W = {
  ...CP_PICO,
  model: 'Pico W',
  info_url: 'https://circuitpython.org/board/raspberry_pi_pico_w/',
  downloads: [
    {
      version: '10.2.1',
      url: 'https://downloads.circuitpython.org/bin/raspberry_pi_pico_w/en_US/adafruit-circuitpython-raspberry_pi_pico_w-en_US-10.2.1.uf2'
    }
  ]
}

/** An ESP32-S3 board, which CircuitPython publishes BOTH ways. */
const CP_XIAO_S3_UF2 = {
  vendor: 'Seeed Studio',
  model: 'Seeed Studio XIAO ESP32S3',
  family: 'esp32s3',
  info_url: 'https://circuitpython.org/board/seeed_xiao_esp32s3/',
  downloads: [
    {
      version: '10.2.1',
      url: 'https://downloads.circuitpython.org/bin/seeed_xiao_esp32s3/en_US/adafruit-circuitpython-seeed_xiao_esp32s3-en_US-10.2.1.uf2'
    }
  ]
}
const CP_XIAO_S3_BIN = {
  ...CP_XIAO_S3_UF2,
  downloads: [
    {
      version: '10.2.1',
      url: 'https://downloads.circuitpython.org/bin/seeed_xiao_esp32s3/en_US/adafruit-circuitpython-seeed_xiao_esp32s3-en_US-10.2.1.bin'
    }
  ]
}

describe('firmwareRuntimeForDialect', () => {
  it('maps a known dialect to the runtime to flash', () => {
    expect(firmwareRuntimeForDialect('circuitpython')).toBe('circuitpython')
    expect(firmwareRuntimeForDialect('micropython')).toBe('micropython')
  })

  it('yields null — never a guess — when the board never said', () => {
    expect(firmwareRuntimeForDialect('unknown')).toBeNull()
    expect(firmwareRuntimeForDialect(undefined)).toBeNull()
    expect(firmwareRuntimeForDialect(null)).toBeNull()
  })
})

describe('downloadKind', () => {
  it('reads the mechanism off the extension', () => {
    expect(downloadKind('https://x/fw.uf2')).toBe('uf2')
    expect(downloadKind('https://x/fw.bin')).toBe('bin')
    expect(downloadKind('https://x/fw.hex')).toBe('hex')
  })

  it("matches CircuitPython's `.combined.hex` micro:bit build", () => {
    expect(
      downloadKind(
        'https://downloads.circuitpython.org/bin/microbit_v2/en_US/adafruit-circuitpython-microbit_v2-en_US-10.2.1.combined.hex'
      )
    ).toBe('hex')
  })

  it('tolerates a query string, case and padding; rejects a non-firmware file', () => {
    expect(downloadKind('  https://x/FW.UF2?token=1 ')).toBe('uf2')
    expect(downloadKind('https://x/readme.txt')).toBeNull()
    expect(downloadKind('')).toBeNull()
  })
})

describe('flashTargetForDownload', () => {
  // The property that matters: for any family, the URL's extension — not the
  // family — decides which flash mechanism is used.
  it('sends every .uf2 down the drive-copy path, whatever the family says', () => {
    for (const family of ['rp2', 'esp32s3', 'esp32s2', 'samd51', 'nrf52', 'mimxrt10xx']) {
      expect(flashTargetForDownload(family, 'https://x/fw.uf2').board).toBe('rp2040')
    }
  })

  it('sends every .hex down the DAPLink drive-copy path', () => {
    expect(flashTargetForDownload('nrf52', 'https://x/fw.combined.hex').board).toBe('microbit')
  })

  it('keeps the per-chip esptool offset for a .bin', () => {
    expect(flashTargetForDownload('esp32', 'https://x/fw.bin')).toEqual({
      board: 'esp32',
      offset: '0x1000'
    })
    expect(flashTargetForDownload('esp32s2', 'https://x/fw.bin')).toEqual({
      board: 'esp32',
      offset: '0x1000'
    })
    expect(flashTargetForDownload('esp32s3', 'https://x/fw.bin')).toEqual({
      board: 'esp32',
      offset: '0x0'
    })
    expect(flashTargetForDownload('esp8266', 'https://x/fw.bin')).toEqual({
      board: 'esp8266',
      offset: '0x0'
    })
  })

  it('is the whole point on a board published BOTH ways (the same S3, two mechanisms)', () => {
    const uf2 = CP_XIAO_S3_UF2.downloads[0].url
    const bin = CP_XIAO_S3_BIN.downloads[0].url
    expect(flashTargetForDownload('esp32s3', uf2).board).toBe('rp2040') // drive copy
    expect(flashTargetForDownload('esp32s3', bin).board).toBe('esp32') // esptool
  })

  it('falls back to the family when the URL names no mechanism', () => {
    expect(flashTargetForDownload('rp2', '')).toEqual({ board: 'rp2040' })
  })
})

describe('isVendorUf2Family', () => {
  it('flags the families whose bootloader volume is NOT RPI-RP2', () => {
    for (const f of ['samd21', 'samd51', 'same51', 'same54', 'mimxrt10xx', 'nrf52']) {
      expect(isVendorUf2Family(f)).toBe(true)
    }
  })
  it('does not flag rp2 (its volume IS RPI-RP2) or an ESP family', () => {
    expect(isVendorUf2Family('rp2')).toBe(false)
    expect(isVendorUf2Family('esp32s3')).toBe(false)
    expect(isVendorUf2Family('')).toBe(false)
  })
})

describe('board ids', () => {
  it('reads the board id out of a downloads.circuitpython.org URL', () => {
    expect(boardIdFromDownloadUrl(CP_PICO.downloads[0].url)).toBe('raspberry_pi_pico')
    expect(boardIdFromDownloadUrl(CP_PICO_W.downloads[0].url)).toBe('raspberry_pi_pico_w')
  })

  it('reads it out of a circuitpython.org board page URL', () => {
    expect(boardIdFromInfoUrl('https://circuitpython.org/board/adafruit_feather_rp2040/')).toBe(
      'adafruit_feather_rp2040'
    )
  })

  it('yields null for a MicroPython URL, so a MicroPython catalog has no board ids', () => {
    expect(
      boardIdFromDownloadUrl('https://micropython.org/resources/firmware/RPI_PICO-v1.28.0.uf2')
    ).toBeNull()
    expect(boardIdFromInfoUrl('https://micropython.org/download/RPI_PICO/')).toBeNull()
  })

  it('compares case-insensitively but never collapses two different boards', () => {
    expect(sameBoardId('Seeed_XIAO_nRF52840_Sense', 'seeed_xiao_nrf52840_sense')).toBe(true)
    // The mistake worth preventing: a Pico W is not a Pico.
    expect(sameBoardId('raspberry_pi_pico', 'raspberry_pi_pico_w')).toBe(false)
    expect(sameBoardId('raspberry_pi_pico', undefined)).toBe(false)
  })

  it('prefers the info URL but falls back to a download URL', () => {
    const withInfo = buildCatalog([CP_PICO]).families[0].models[0].variants[0]
    expect(variantBoardId(withInfo)).toBe('raspberry_pi_pico')

    const noInfo = buildCatalog([{ ...CP_PICO, info_url: undefined }]).families[0].models[0]
      .variants[0]
    expect(variantBoardId(noInfo)).toBe('raspberry_pi_pico')
  })
})

describe('findBoardBuilds', () => {
  const catalog = buildCatalog([CP_PICO, CP_PICO_W, CP_XIAO_S3_UF2, CP_XIAO_S3_BIN])

  it('finds the build for exactly that board', () => {
    const found = findBoardBuilds(catalog, 'raspberry_pi_pico')
    expect(found).toHaveLength(1)
    expect(found[0].model.label).toBe('Raspberry Pi Pico')
    expect(found[0].family).toBe('rp2')
  })

  it('does NOT return a near-miss (a Pico W build for a Pico)', () => {
    const found = findBoardBuilds(catalog, 'raspberry_pi_pico')
    expect(found.every((b) => b.model.model !== 'Pico W')).toBe(true)
  })

  it('returns BOTH mechanisms for a board published as .uf2 and .bin', () => {
    const found = findBoardBuilds(catalog, 'seeed_xiao_esp32s3')
    expect(found).toHaveLength(2)
    const boards = found.map((b) => flashTargetForDownload(b.family, b.variant.versions[0].url).board)
    expect(new Set(boards)).toEqual(new Set(['rp2040', 'esp32']))
  })

  it('offers NOTHING rather than guessing when the board id is unknown or absent', () => {
    expect(findBoardBuilds(catalog, 'a_board_that_does_not_exist')).toEqual([])
    expect(findBoardBuilds(catalog, '')).toEqual([])
    expect(findBoardBuilds(catalog, undefined)).toEqual([])
    expect(findBoardBuilds(null, 'raspberry_pi_pico')).toEqual([])
  })
})

describe('stable releases', () => {
  it('accepts both runtimes’ stable version spellings', () => {
    expect(isStableRelease('v1.28.0')).toBe(true) // MicroPython
    expect(isStableRelease('10.2.1')).toBe(true) // CircuitPython
    expect(isStableRelease('2.1.2')).toBe(true) // micro:bit MicroPython
  })

  it('rejects every pre-release / nightly either runtime publishes', () => {
    expect(isStableRelease('10.3.0-alpha.1')).toBe(false)
    expect(isStableRelease('10.3.0-beta.2')).toBe(false)
    expect(isStableRelease('1.24.0-preview.42.gabcdef')).toBe(false)
    expect(isStableRelease('20240105-unstable')).toBe(false)
    expect(isStableRelease('')).toBe(false)
  })

  it('strips a leading v so the two runtimes compare on the same footing', () => {
    expect(bareVersion('v1.28.0')).toBe('1.28.0')
    expect(bareVersion('10.2.1')).toBe('10.2.1')
  })

  it('picks the newest STABLE build, never the alpha that sorts above it', () => {
    const versions = buildCatalog([CP_PICO]).families[0].models[0].variants[0].versions
    // The catalog literally lists 10.3.0-alpha.1 between the two stable builds.
    expect(versions.map((v) => v.version)).toContain('10.3.0-alpha.1')
    expect(newestStableVersion(versions, isNewerVersion)?.version).toBe('10.2.1')
  })

  it('is null when a variant has only pre-releases', () => {
    expect(
      newestStableVersion([{ version: '10.3.0-alpha.1', url: 'https://x/a.uf2' }], isNewerVersion)
    ).toBeNull()
    expect(newestStableVersion([], isNewerVersion)).toBeNull()
    expect(newestStableVersion(undefined, isNewerVersion)).toBeNull()
  })

  it('does not trust the published order — it compares', () => {
    const shuffled: FirmwareCatalog['families'][0]['models'][0]['variants'][0]['versions'] = [
      { version: '9.2.9', url: 'https://x/9.uf2' },
      { version: '10.2.1', url: 'https://x/10.uf2' },
      { version: '10.1.0', url: 'https://x/101.uf2' }
    ]
    expect(newestStableVersion(shuffled, isNewerVersion)?.version).toBe('10.2.1')
  })
})
