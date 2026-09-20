import { describe, it, expect } from 'vitest'
import {
  baseName,
  moduleNamesFrom,
  onModuleScan,
  requestModuleScan
} from '../src/renderer/src/lib/blocks/module-scan'

/**
 * THE BLOCKS DRAWER'S SCAN BUTTON, PURE HALF (#1048). The Modules PANEL's own
 * scanner (`lib/module-scan.ts`) is tested in `moduleScan.test.ts`.
 */
describe('which files are modules', () => {
  it('turns .py and .mpy files into module names, sorted and de-duplicated', () => {
    expect(moduleNamesFrom(['ssd1306.py', 'range_finder.py', 'neopixel.mpy', 'ssd1306.py'])).toEqual([
      'neopixel',
      'range_finder',
      'ssd1306'
    ])
  })

  it('skips entry points, private files, non-modules and the program itself', () => {
    expect(
      moduleNamesFrom(
        ['main.py', 'boot.py', 'code.py', '_secret.py', 'notes.txt', 'my-lib.py', 'lib', 'sensor.py'],
        ['sensor']
      )
    ).toEqual([])
  })

  it('the file name out of a path, either way round', () => {
    expect(baseName('/home/kev/project/sensor.py')).toBe('sensor.py')
    expect(baseName('C:\\Users\\kev\\sensor.py')).toBe('sensor.py')
  })
})

describe('the bus', () => {
  it('carries a press to every listener until it unsubscribes', () => {
    let count = 0
    const off = onModuleScan(() => {
      count += 1
    })
    requestModuleScan()
    off()
    requestModuleScan()
    expect(count).toBe(1)
  })
})
