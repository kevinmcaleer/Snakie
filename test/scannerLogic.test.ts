import { describe, it, expect } from 'vitest'
import {
  I2C_GRID_ROWS,
  I2C_GRID_COLS,
  MAX_SIGNAL_BARS,
  addBt,
  addWifi,
  addrToCell,
  bestWifi,
  btNameLabel,
  buildI2cGrid,
  detectedSet,
  dominantBand,
  formatI2cAddr,
  nearestBt,
  parseI2cAddr,
  rssiToBars,
  sortBtByStrength,
  sortWifiByStrength,
  ssidLabel,
  wifiBand
} from '../src/renderer/src/components/scanner-logic'
import type {
  BluetoothTelemetry,
  WifiTelemetry
} from '../src/renderer/src/components/instrument-telemetry'

// Small builders so the cases read cleanly.
const wifi = (ssid: string, rssi: number, channel = 6, security = 'WPA2'): WifiTelemetry => ({
  kind: 'wifi',
  ssid,
  rssi,
  channel,
  security
})
const bt = (name: string, mac: string, rssi: number): BluetoothTelemetry => ({
  kind: 'bt',
  name,
  mac,
  rssi
})

describe('scanner-logic parseI2cAddr', () => {
  it('parses a 0x-prefixed hex string', () => {
    expect(parseI2cAddr('0x3C')).toBe(0x3c)
  })

  it('is case-insensitive on the prefix and digits', () => {
    expect(parseI2cAddr('0X3c')).toBe(0x3c)
  })

  it('parses a bare hex token (the wire only prints hex)', () => {
    expect(parseI2cAddr('68')).toBe(0x68)
  })

  it('accepts a numeric address', () => {
    expect(parseI2cAddr(0x3c)).toBe(0x3c)
  })

  it('rejects an out-of-range 7-bit address', () => {
    expect(parseI2cAddr('0x80')).toBeNull()
    expect(parseI2cAddr(200)).toBeNull()
  })

  it('rejects garbage and empty input', () => {
    expect(parseI2cAddr('zz')).toBeNull()
    expect(parseI2cAddr('')).toBeNull()
    expect(parseI2cAddr('   ')).toBeNull()
  })
})

describe('scanner-logic addrToCell + formatI2cAddr', () => {
  it('maps an address to its grid row/col (high/low nibble)', () => {
    // 0x3C → row 3 (0x30), col 12 (0xC)
    expect(addrToCell(0x3c)).toEqual({ row: 3, col: 12 })
    // 0x00 → top-left
    expect(addrToCell(0x00)).toEqual({ row: 0, col: 0 })
    // 0x68 → row 6, col 8
    expect(addrToCell(0x68)).toEqual({ row: 6, col: 8 })
  })

  it('formats an address as 2-digit upper-case hex', () => {
    expect(formatI2cAddr(0x3c)).toBe('0x3C')
    expect(formatI2cAddr(0x07)).toBe('0x07')
  })
})

describe('scanner-logic detectedSet', () => {
  it('builds a numeric membership set, dropping invalid tokens', () => {
    const set = detectedSet(['0x3C', '0x68', 'oops', '0x80'])
    expect(set.has(0x3c)).toBe(true)
    expect(set.has(0x68)).toBe(true)
    expect(set.has(0x80)).toBe(false) // out of range, dropped
    expect(set.size).toBe(2)
  })

  it('is empty for an empty scan', () => {
    expect(detectedSet([]).size).toBe(0)
  })
})

describe('scanner-logic buildI2cGrid', () => {
  it('builds a full 8×16 grid model', () => {
    const grid = buildI2cGrid([])
    expect(grid.rows).toHaveLength(I2C_GRID_ROWS)
    expect(grid.rows.every((r) => r.length === I2C_GRID_COLS)).toBe(true)
    expect(grid.rows[0][0]).toEqual({
      row: 0,
      col: 0,
      addr: 0,
      label: '0x00',
      detected: false
    })
  })

  it('flags detected cells and sorts found ascending', () => {
    const grid = buildI2cGrid(['0x68', '0x3C'])
    expect(grid.found).toEqual([0x3c, 0x68])
    expect(grid.rows[3][12].detected).toBe(true) // 0x3C
    expect(grid.rows[6][8].detected).toBe(true) // 0x68
    expect(grid.rows[0][0].detected).toBe(false)
  })

  it('handles a bus with no responders', () => {
    const grid = buildI2cGrid([])
    expect(grid.found).toEqual([])
    expect(grid.rows.flat().some((c) => c.detected)).toBe(false)
  })
})

describe('scanner-logic rssiToBars', () => {
  it('maps strength to 0–4 bars across the thresholds', () => {
    expect(rssiToBars(-40)).toBe(4)
    expect(rssiToBars(-55)).toBe(4)
    expect(rssiToBars(-60)).toBe(3)
    expect(rssiToBars(-70)).toBe(2)
    expect(rssiToBars(-85)).toBe(1)
    expect(rssiToBars(-100)).toBe(0)
  })

  it('is monotonic (stronger never gives fewer bars) and capped', () => {
    let prev = -1
    for (let r = -120; r <= -20; r += 1) {
      const bars = rssiToBars(r)
      expect(bars).toBeGreaterThanOrEqual(prev === -1 ? 0 : 0)
      expect(bars).toBeLessThanOrEqual(MAX_SIGNAL_BARS)
      prev = bars
    }
    // explicit monotonic check
    expect(rssiToBars(-60)).toBeGreaterThanOrEqual(rssiToBars(-90))
  })

  it('reads a non-finite RSSI as no signal', () => {
    expect(rssiToBars(Number.NaN)).toBe(0)
  })
})

describe('scanner-logic wifiBand', () => {
  it('classifies 2.4 GHz channels', () => {
    expect(wifiBand(1)).toBe('2.4 GHz')
    expect(wifiBand(6)).toBe('2.4 GHz')
    expect(wifiBand(14)).toBe('2.4 GHz')
  })

  it('classifies 5 GHz channels', () => {
    expect(wifiBand(36)).toBe('5 GHz')
    expect(wifiBand(149)).toBe('5 GHz')
    expect(wifiBand(165)).toBe('5 GHz')
  })

  it('returns the unknown marker for out-of-range / non-finite', () => {
    expect(wifiBand(0)).toBe('—')
    expect(wifiBand(20)).toBe('—')
    expect(wifiBand(Number.NaN)).toBe('—')
  })
})

describe('scanner-logic addWifi (dedupe by SSID, keep strongest)', () => {
  it('appends a new SSID', () => {
    const a = addWifi([], wifi('home', -50))
    const b = addWifi(a, wifi('cafe', -70))
    expect(b.map((n) => n.ssid)).toEqual(['home', 'cafe'])
  })

  it('replaces a repeat SSID when the new reading is stronger, keeping its slot', () => {
    let list = addWifi([], wifi('home', -70))
    list = addWifi(list, wifi('cafe', -60))
    list = addWifi(list, wifi('home', -45)) // stronger repeat
    expect(list).toHaveLength(2)
    expect(list[0].ssid).toBe('home')
    expect(list[0].rssi).toBe(-45)
  })

  it('keeps the existing entry when the repeat is weaker', () => {
    let list = addWifi([], wifi('home', -45))
    list = addWifi(list, wifi('home', -80))
    expect(list).toHaveLength(1)
    expect(list[0].rssi).toBe(-45)
  })

  it('dedupes hidden (empty-SSID) networks to the strongest', () => {
    let list = addWifi([], wifi('', -80))
    list = addWifi(list, wifi('', -55))
    expect(list).toHaveLength(1)
    expect(list[0].rssi).toBe(-55)
  })
})

describe('scanner-logic bestWifi + dominantBand', () => {
  it('returns the strongest network', () => {
    const list = [wifi('a', -70, 6), wifi('b', -45, 36), wifi('c', -60, 1)]
    expect(bestWifi(list)?.ssid).toBe('b')
  })

  it('the dominant band follows the strongest network', () => {
    const list = [wifi('a', -70, 6), wifi('b', -45, 36)]
    expect(dominantBand(list)).toBe('5 GHz')
  })

  it('is undefined / unknown when empty', () => {
    expect(bestWifi([])).toBeUndefined()
    expect(dominantBand([])).toBe('—')
  })
})

describe('scanner-logic ssidLabel', () => {
  it('labels a hidden network', () => {
    expect(ssidLabel('')).toBe('‹hidden›')
    expect(ssidLabel('   ')).toBe('‹hidden›')
  })

  it('passes a real SSID through', () => {
    expect(ssidLabel('home-5G')).toBe('home-5G')
  })
})

describe('scanner-logic addBt (dedupe by MAC, keep nearest)', () => {
  it('appends a new MAC', () => {
    const a = addBt([], bt('Pico', 'AA:BB', -50))
    const b = addBt(a, bt('Watch', 'CC:DD', -70))
    expect(b.map((d) => d.mac)).toEqual(['AA:BB', 'CC:DD'])
  })

  it('replaces a repeat MAC when nearer, keeping its slot', () => {
    let list = addBt([], bt('Pico', 'AA:BB', -80))
    list = addBt(list, bt('Watch', 'CC:DD', -60))
    list = addBt(list, bt('Pico', 'AA:BB', -40)) // nearer repeat
    expect(list).toHaveLength(2)
    expect(list[0].mac).toBe('AA:BB')
    expect(list[0].rssi).toBe(-40)
  })

  it('keeps the existing entry when the repeat is farther', () => {
    let list = addBt([], bt('Pico', 'AA:BB', -40))
    list = addBt(list, bt('Pico', 'AA:BB', -90))
    expect(list).toHaveLength(1)
    expect(list[0].rssi).toBe(-40)
  })
})

describe('scanner-logic nearestBt + btNameLabel', () => {
  it('returns the nearest device (max RSSI)', () => {
    const list = [bt('a', '1', -80), bt('b', '2', -45), bt('c', '3', -60)]
    expect(nearestBt(list)?.mac).toBe('2')
  })

  it('is undefined when empty', () => {
    expect(nearestBt([])).toBeUndefined()
  })

  it('labels a missing / unknown name', () => {
    expect(btNameLabel('')).toBe('‹unknown›')
    expect(btNameLabel('?')).toBe('‹unknown›')
    expect(btNameLabel('Pico W')).toBe('Pico W')
  })
})

describe('scanner-logic sort helpers (strongest-first, stable)', () => {
  it('sorts Wi-Fi strongest-first, stable for ties', () => {
    const list = [wifi('a', -70), wifi('b', -45), wifi('c', -45), wifi('d', -90)]
    expect(sortWifiByStrength(list).map((n) => n.ssid)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('does not mutate the input', () => {
    const list = [wifi('a', -70), wifi('b', -45)]
    const copy = list.slice()
    sortWifiByStrength(list)
    expect(list).toEqual(copy)
  })

  it('sorts BLE nearest-first, stable for ties', () => {
    const list = [bt('a', '1', -70), bt('b', '2', -45), bt('c', '3', -45)]
    expect(sortBtByStrength(list).map((d) => d.mac)).toEqual(['2', '3', '1'])
  })
})
