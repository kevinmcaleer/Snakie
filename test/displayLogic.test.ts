import { describe, it, expect } from 'vitest'
import {
  DISPLAY_GEOMETRIES,
  base64ToBytes,
  blankGrid,
  buildScreenPayload,
  decodeB64Bits,
  decodeFramebuffer,
  decodeRleBits,
  encodeRowToken,
  findScreenPinsInCode,
  fitLine,
  fpsFromIntervalMs,
  geometryById,
  i2cBlockForPins,
  i2cPinsValid,
  layoutText,
  readingToView,
  screenAddrPayload,
  screenPinsPayload,
  screenSpiPayload,
  setScreenPinsInCode,
  spiBlockForPins,
  spiPinsValid
} from '../src/renderer/src/components/display-logic'
import type { ScreenTelemetry } from '../src/renderer/src/components/instrument-telemetry'

/**
 * The load-bearing test: the framebuffer decode MUST mirror the device
 * `micropython/instruments.py::screen_fb` packing exactly —
 *   b64: base64 of the raw 1-bpp buffer, ROW-MAJOR, MSB-first within each byte,
 *        so pixel (x,y) is bit `y*w + x`.
 *   rle: `<count>x<0|1>` runs joined by commas, expanded row-major.
 */

describe('base64ToBytes (DOM-free, no atob)', () => {
  it('decodes the docs example "AAEC" to [0,1,2]', () => {
    // docs/instruments-library.md shows `SNK SCR 0x3C fb 8 8 b64 AAEC`.
    expect(base64ToBytes('AAEC')).toEqual([0, 1, 2])
  })

  it('decodes a known 3-byte group "/wAA" (0xFF,0x00,0x00)', () => {
    expect(base64ToBytes('/wAA')).toEqual([0xff, 0x00, 0x00])
  })

  it('ignores padding and stray whitespace', () => {
    expect(base64ToBytes('SA==')).toEqual([0x48])
    expect(base64ToBytes('/w AA')).toEqual([0xff, 0x00, 0x00])
  })

  it('never throws on garbage', () => {
    expect(() => base64ToBytes('@@@!')).not.toThrow()
    expect(base64ToBytes('')).toEqual([])
  })
})

describe('decodeB64Bits — MSB-first, row-major', () => {
  it('reads bit i = byte[i>>3], bit 7-(i&7)', () => {
    // byte 0x81 = 1000_0001 -> bit indices 0 and 7 set (MSB-first).
    const bits = decodeB64Bits('gQ==', 8) // 0x81 -> base64 "gQ=="
    expect(bits).toEqual([true, false, false, false, false, false, false, true])
  })

  it('pads missing bits with OFF when the payload is short', () => {
    const bits = decodeB64Bits('AA==', 16) // one byte 0x00, ask for 16 bits
    expect(bits.length).toBe(16)
    expect(bits.every((b) => b === false)).toBe(true)
  })
})

describe('decodeFramebuffer — b64 (matches screen_fb packing)', () => {
  it('decodes an 8×8 frame with the whole top row lit', () => {
    // bytes [0xFF,0,0,0,0,0,0,0] -> top row (y=0) all on, rest off.
    const grid = decodeFramebuffer({ w: 8, h: 8, encoding: 'b64', data: '/wAAAAAAAAA=' })
    expect(grid.w).toBe(8)
    expect(grid.h).toBe(8)
    expect(grid.pixels[0]).toEqual(new Array(8).fill(true))
    for (let y = 1; y < 8; y++) {
      expect(grid.pixels[y]).toEqual(new Array(8).fill(false))
    }
  })

  it('decodes a 4×2 frame: pixels (1,0) and (0,1) lit', () => {
    // idx1=(x1,y0) -> bit6, idx4=(x0,y1) -> bit3 -> byte 0b0100_1000 = 0x48.
    const grid = decodeFramebuffer({ w: 4, h: 2, encoding: 'b64', data: 'SA==' })
    expect(grid.pixels[0]).toEqual([false, true, false, false])
    expect(grid.pixels[1]).toEqual([true, false, false, false])
  })

  it('blank grid for an unknown encoding', () => {
    const grid = decodeFramebuffer({ w: 4, h: 2, encoding: 'xyz', data: 'whatever' })
    expect(grid.pixels.flat().every((b) => b === false)).toBe(true)
  })
})

describe('decodeRleBits / decodeFramebuffer — rle', () => {
  it('expands <count>x<0|1> runs row-major', () => {
    // 4x2 = 8 px: 3 on, 5 off.
    expect(decodeRleBits('3x1,5x0', 8)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false
    ])
  })

  it('lays runs into the w×h grid', () => {
    const grid = decodeFramebuffer({ w: 4, h: 2, encoding: 'rle', data: '3x1,5x0' })
    expect(grid.pixels[0]).toEqual([true, true, true, false])
    expect(grid.pixels[1]).toEqual([false, false, false, false])
  })

  it('skips bad tokens and pads short runs with OFF', () => {
    expect(decodeRleBits('2x1,bad,', 6)).toEqual([true, true, false, false, false, false])
  })
})

describe('blankGrid', () => {
  it('is an all-OFF w×h grid', () => {
    const g = blankGrid(3, 2)
    expect(g.w).toBe(3)
    expect(g.h).toBe(2)
    expect(g.pixels).toEqual([
      [false, false, false],
      [false, false, false]
    ])
  })
})

describe('layoutText — fixed character grid', () => {
  it('pads/truncates to exactly cols × rows', () => {
    const grid = layoutText(['Hi', 'a long line here'], 8, 3)
    expect(grid.cols).toBe(8)
    expect(grid.rows).toBe(3)
    expect(grid.lines).toEqual(['Hi      ', 'a long l', '        '])
    grid.lines.forEach((l) => expect(l.length).toBe(8))
  })

  it('handles missing input as all blank rows', () => {
    const grid = layoutText(undefined, 4, 2)
    expect(grid.lines).toEqual(['    ', '    '])
  })
})

describe('fitLine', () => {
  it('pads short strings', () => {
    expect(fitLine('ab', 5)).toBe('ab   ')
  })
  it('truncates long strings', () => {
    expect(fitLine('abcdef', 3)).toBe('abc')
  })
})

describe('encodeRowToken — spaces to _ (matches device _scr_token)', () => {
  it('encodes spaces as underscores', () => {
    expect(encodeRowToken('Hello world')).toBe('Hello_world')
  })
})

describe('buildScreenPayload — screen control grammar', () => {
  it('builds `text <row> …` with spaces encoded as _', () => {
    expect(buildScreenPayload(['Hello world', 'Line 2'])).toBe('text Hello_world Line_2')
  })

  it('prefixes addr= when an address is supplied', () => {
    expect(buildScreenPayload(['Hi'], { addr: '0x3C' })).toBe('addr=0x3C text Hi')
  })

  it('fits rows to cols when cols given (char LCD push)', () => {
    expect(buildScreenPayload(['Hello world'], { cols: 5 })).toBe('text Hello')
  })

  it('clears with a bare `text` for no rows', () => {
    expect(buildScreenPayload([])).toBe('text')
  })

  it('round-trips with the telemetry SCR text grammar', () => {
    // The payload after a fictional addr mirrors `SNK SCR <addr> text Hello_world`.
    const payload = buildScreenPayload(['Hello world'])
    expect(`SNK SCR 0x3C ${payload}`).toBe('SNK SCR 0x3C text Hello_world')
  })
})

describe('readingToView', () => {
  it('reduces a framebuffer reading to a pixel view', () => {
    const r: ScreenTelemetry = {
      kind: 'scr',
      addr: '0x3C',
      framebuffer: { w: 4, h: 2, encoding: 'rle', data: '3x1,5x0' }
    }
    const view = readingToView(r)
    expect(view?.mode).toBe('pixels')
    if (view?.mode === 'pixels') {
      expect(view.grid.pixels[0]).toEqual([true, true, true, false])
      expect(view.addr).toBe('0x3C')
    }
  })

  it('reduces a text reading to a text view', () => {
    const r: ScreenTelemetry = { kind: 'scr', addr: '0x3C', rows: ['Hello world', 'Line 2'] }
    const view = readingToView(r)
    expect(view).toEqual({ mode: 'text', rows: ['Hello world', 'Line 2'], addr: '0x3C' })
  })

  it('returns null for an empty reading', () => {
    expect(readingToView({ kind: 'scr', addr: '0x3C' })).toBeNull()
  })
})

describe('geometries', () => {
  it('exposes the configured OLED + LCD sizes', () => {
    const ids = DISPLAY_GEOMETRIES.map((g) => g.id)
    expect(ids).toContain('oled-128x64')
    expect(ids).toContain('oled-128x32')
    expect(ids).toContain('lcd-16x2')
    expect(ids).toContain('lcd-20x4')
  })

  it('exposes the ST7789 SPI TFT variants (240×240 + others)', () => {
    const spi = DISPLAY_GEOMETRIES.filter((g) => g.bus === 'spi')
    expect(spi.map((g) => g.id)).toEqual([
      'tft-240x240',
      'tft-240x320',
      'tft-135x240',
      'tft-170x320'
    ])
    // Every SPI geometry is an ST7789 pixel display with real px dimensions.
    for (const g of spi) {
      expect(g.driver).toBe('st7789')
      expect(g.type).toBe('pixel')
      expect(g.w).toBeGreaterThan(0)
      expect(g.h).toBeGreaterThan(0)
    }
    expect(geometryById('tft-240x240').w).toBe(240)
    expect(geometryById('tft-240x320').h).toBe(320)
  })

  it('tags the existing OLED/LCD geometries as the I²C bus', () => {
    for (const g of DISPLAY_GEOMETRIES.filter((g) => g.id.startsWith('oled') || g.id.startsWith('lcd'))) {
      expect(g.bus).toBe('i2c')
    }
  })

  it('looks up by id and falls back to the default', () => {
    expect(geometryById('lcd-16x2').cols).toBe(16)
    expect(geometryById('nope').id).toBe(DISPLAY_GEOMETRIES[0].id)
  })
})

describe('fpsFromIntervalMs', () => {
  it('computes fps from an interval', () => {
    expect(fpsFromIntervalMs(100)).toBe('10.0')
    expect(fpsFromIntervalMs(1000)).toBe('1.0')
  })
  it('rounds high fps to an integer', () => {
    expect(fpsFromIntervalMs(5)).toBe('200')
  })
  it('returns a dash for non-positive/non-finite intervals', () => {
    expect(fpsFromIntervalMs(0)).toBe('——')
    expect(fpsFromIntervalMs(NaN)).toBe('——')
  })
})

describe('i2cBlockForPins (RP2040 I²C pin mux — matches _i2c_block_for_pins)', () => {
  it('returns block 0 for a valid I2C0 pair', () => {
    // SDA∈{0,4,8,12,16,20}, SCL∈{1,5,9,13,17,21}.
    expect(i2cBlockForPins(0, 1)).toBe(0)
    expect(i2cBlockForPins(4, 5)).toBe(0)
    expect(i2cBlockForPins(20, 21)).toBe(0)
    // Any SDA + any SCL WITHIN the block is valid.
    expect(i2cBlockForPins(0, 13)).toBe(0)
  })
  it('returns block 1 for a valid I2C1 pair', () => {
    // SDA∈{2,6,10,14,18,26}, SCL∈{3,7,11,15,19,27}.
    expect(i2cBlockForPins(2, 3)).toBe(1)
    expect(i2cBlockForPins(6, 7)).toBe(1)
    expect(i2cBlockForPins(26, 27)).toBe(1)
    expect(i2cBlockForPins(14, 3)).toBe(1)
  })
  it('returns null for a cross-block pair', () => {
    expect(i2cBlockForPins(0, 3)).toBeNull() // SDA b0, SCL b1
    expect(i2cBlockForPins(2, 1)).toBeNull() // SDA b1, SCL b0
    expect(i2cBlockForPins(1, 0)).toBeNull() // roles swapped
  })
  it('returns null for an unknown / non-I²C pin', () => {
    expect(i2cBlockForPins(28, 22)).toBeNull()
    expect(i2cBlockForPins(22, 23)).toBeNull()
  })
})

describe('i2cPinsValid', () => {
  it('is true only for a valid pair', () => {
    expect(i2cPinsValid(0, 1)).toBe(true)
    expect(i2cPinsValid(2, 3)).toBe(true)
    expect(i2cPinsValid(0, 3)).toBe(false)
    expect(i2cPinsValid(7, 7)).toBe(false)
  })
})

describe('screenPinsPayload (retarget the I²C SDA/SCL pins)', () => {
  it('builds a `pins <sda> <scl>` payload', () => {
    expect(screenPinsPayload(0, 1)).toBe('pins 0 1')
  })
  it('rounds + clamps each pin to a whole non-negative GPIO', () => {
    expect(screenPinsPayload(2.7, 4.2)).toBe('pins 3 4')
    expect(screenPinsPayload(-1, -5)).toBe('pins 0 0')
  })
  it('coerces non-finite pins to 0', () => {
    expect(screenPinsPayload(NaN, Infinity)).toBe('pins 0 0')
  })
})

describe('screenAddrPayload (set the I²C address)', () => {
  it('normalises a 0xNN address to a clean lowercase literal', () => {
    expect(screenAddrPayload('0x3C')).toBe('addr 0x3c')
    expect(screenAddrPayload('0X3D')).toBe('addr 0x3d')
  })
  it('accepts a bare hex address (a missing 0x prefix is added)', () => {
    expect(screenAddrPayload('3C')).toBe('addr 0x3c')
    expect(screenAddrPayload('60')).toBe('addr 0x60') // a bare token is parsed as hex
  })
  it('falls back to 0x3c on a bad address', () => {
    expect(screenAddrPayload('')).toBe('addr 0x3c')
    expect(screenAddrPayload('zz')).toBe('addr 0x3c')
  })
})

describe('findScreenPinsInCode (read declared SCREEN_SDA / SCREEN_SCL)', () => {
  it('reads UPPERCASE constants (the demo form)', () => {
    expect(findScreenPinsInCode('SCREEN_SDA = 0\nSCREEN_SCL = 1')).toEqual({ sda: 0, scl: 1 })
  })
  it('reads the lowercase kwarg form, whitespace-tolerant', () => {
    expect(findScreenPinsInCode('inst.start(screen_sda=2,  screen_scl = 3)')).toEqual({
      sda: 2,
      scl: 3
    })
  })
  it('returns the FIRST match per role', () => {
    expect(findScreenPinsInCode('SCREEN_SDA=0\nSCREEN_SDA=8\nSCREEN_SCL=1')).toEqual({
      sda: 0,
      scl: 1
    })
  })
  it('returns null for a role the code declares no numeric value for', () => {
    expect(findScreenPinsInCode('SCREEN_SDA = 0')).toEqual({ sda: 0, scl: null })
    expect(findScreenPinsInCode('screen_scl=SCREEN_SCL')).toEqual({ sda: null, scl: null })
    expect(findScreenPinsInCode('print("no pins here")')).toEqual({ sda: null, scl: null })
    expect(findScreenPinsInCode('')).toEqual({ sda: null, scl: null })
  })
})

describe('setScreenPinsInCode (one-click sync of both pins)', () => {
  it('rewrites both UPPERCASE constants, preserving spacing', () => {
    expect(setScreenPinsInCode('SCREEN_SDA = 0\nSCREEN_SCL = 1', 4, 5)).toBe(
      'SCREEN_SDA = 4\nSCREEN_SCL = 5'
    )
  })
  it('rewrites the lowercase kwarg form', () => {
    expect(setScreenPinsInCode('inst.start(screen_sda=0, screen_scl=1)', 2, 3)).toBe(
      'inst.start(screen_sda=2, screen_scl=3)'
    )
  })
  it('only the FIRST match of each role is rewritten', () => {
    expect(setScreenPinsInCode('SCREEN_SDA=0\nSCREEN_SDA=8\nSCREEN_SCL=1', 4, 5)).toBe(
      'SCREEN_SDA=4\nSCREEN_SDA=8\nSCREEN_SCL=5'
    )
  })
  it('leaves a role with no numeric match untouched', () => {
    expect(setScreenPinsInCode('SCREEN_SDA = 0', 4, 5)).toBe('SCREEN_SDA = 4')
    expect(setScreenPinsInCode('no pins here', 4, 5)).toBe('no pins here')
  })
  it('rounds + clamps each new pin', () => {
    expect(setScreenPinsInCode('SCREEN_SDA=0\nSCREEN_SCL=0', 2.7, -1)).toBe(
      'SCREEN_SDA=3\nSCREEN_SCL=0'
    )
  })
  it('round-trips with findScreenPinsInCode', () => {
    const updated = setScreenPinsInCode('SCREEN_SDA = 0\nSCREEN_SCL = 1', 26, 27)
    expect(findScreenPinsInCode(updated)).toEqual({ sda: 26, scl: 27 })
  })
})

describe('spiBlockForPins (RP2040 SPI pin mux — matches _spi_block_for_pins)', () => {
  it('resolves SPI0 SCK/MOSI pairs to block 0', () => {
    expect(spiBlockForPins(2, 3)).toBe(0)
    expect(spiBlockForPins(6, 7)).toBe(0)
    expect(spiBlockForPins(18, 19)).toBe(0)
    expect(spiBlockForPins(22, 23)).toBe(0)
  })
  it('resolves SPI1 SCK/MOSI pairs to block 1', () => {
    expect(spiBlockForPins(10, 11)).toBe(1)
    expect(spiBlockForPins(14, 15)).toBe(1)
    expect(spiBlockForPins(26, 27)).toBe(1)
  })
  it('rejects cross-block, role-swapped, and unknown pins', () => {
    expect(spiBlockForPins(18, 11)).toBeNull() // SCK b0, MOSI b1
    expect(spiBlockForPins(10, 19)).toBeNull() // SCK b1, MOSI b0
    expect(spiBlockForPins(19, 18)).toBeNull() // roles swapped
    expect(spiBlockForPins(0, 1)).toBeNull() // I²C pins, not SPI
    expect(spiBlockForPins(99, 3)).toBeNull()
  })
  it('spiPinsValid mirrors the block lookup', () => {
    expect(spiPinsValid(18, 19)).toBe(true)
    expect(spiPinsValid(18, 11)).toBe(false)
  })
})

describe('screenSpiPayload (retarget an ST7789 SPI TFT)', () => {
  it('emits `spi <sck> <mosi> <dc> <rst> <cs> <w> <h>`', () => {
    expect(screenSpiPayload(18, 19, 16, 20, 17, 240, 240)).toBe('spi 18 19 16 20 17 240 240')
  })
  it('passes cs = -1 straight through (a tied chip-select)', () => {
    expect(screenSpiPayload(18, 19, 16, 20, -1, 240, 320)).toBe('spi 18 19 16 20 -1 240 320')
  })
  it('rounds + clamps the GPIO pins (cs stays tied for any negative)', () => {
    expect(screenSpiPayload(18.6, 19.2, 16, 20, -5, 135, 240)).toBe('spi 19 19 16 20 -1 135 240')
  })
  it('floors dimensions to at least 1×1 on a bad size', () => {
    expect(screenSpiPayload(18, 19, 16, 20, 17, 0, NaN)).toBe('spi 18 19 16 20 17 1 1')
  })
})
