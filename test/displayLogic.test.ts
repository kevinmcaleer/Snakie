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
  fitLine,
  fpsFromIntervalMs,
  geometryById,
  layoutText,
  readingToView
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
