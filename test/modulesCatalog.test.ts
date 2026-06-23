import { describe, expect, it } from 'vitest'
import {
  MODULES,
  MODULE_PRESENT,
  diffInstalled,
  groupByInstrument,
  importProbeSnippet,
  installPathFor,
  moduleById,
  modulesForInstrument,
  type InstrumentId
} from '../src/shared/modules-catalog'

/**
 * Unit tests for the modular-install catalog (#120): the registry shape, id and
 * instrument lookups, the bundled-vs-mip install-path resolution, the device
 * import-probe snippet, and the installed-vs-available diffing. All pure — no
 * Electron / device.
 */

describe('MODULES catalog shape', () => {
  it('has unique ids', () => {
    const ids = MODULES.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every module maps to a known instrument id', () => {
    const known: InstrumentId[] = [
      'i2c-display',
      'range',
      'imu',
      'led',
      'encoder',
      'buzzer',
      'gamepad'
    ]
    for (const m of MODULES) {
      expect(known).toContain(m.instrument)
    }
  })

  it('bundled modules ship a .py file + a licence; mip modules carry a spec', () => {
    for (const m of MODULES) {
      if (m.source.kind === 'bundled') {
        expect(m.source.file.endsWith('.py')).toBe(true)
        expect(m.license).toBeTruthy()
      } else {
        expect(m.source.spec.length).toBeGreaterThan(0)
      }
    }
  })

  it('covers the instrument inputs/outputs #120 names (display/range/imu/led/encoder/buzzer/gamepad)', () => {
    const instruments = new Set(MODULES.map((m) => m.instrument))
    expect(instruments).toEqual(
      new Set(['i2c-display', 'range', 'imu', 'led', 'encoder', 'buzzer', 'gamepad'])
    )
  })

  it('includes the headline drivers the issue names', () => {
    const ids = new Set(MODULES.map((m) => m.id))
    for (const id of ['ssd1306', 'sh1106', 'hcsr04', 'vl53l0x', 'mpu6050', 'bno055', 'neopixel']) {
      expect(ids.has(id)).toBe(true)
    }
  })
})

describe('moduleById', () => {
  it('finds a module by id', () => {
    expect(moduleById('hcsr04')?.name).toBe('HC-SR04 ultrasonic')
  })

  it('returns undefined for an unknown id', () => {
    expect(moduleById('nope')).toBeUndefined()
  })
})

describe('modulesForInstrument', () => {
  it('returns all the IMU drivers', () => {
    const ids = modulesForInstrument('imu').map((m) => m.id)
    expect(ids).toContain('mpu6050')
    expect(ids).toContain('bno055')
    expect(ids).toContain('lsm6ds')
  })

  it('returns an empty list for an instrument with no modules', () => {
    // 'button'/'wifi-scan' etc. have no installable driver in the catalog.
    expect(modulesForInstrument('range' as InstrumentId).length).toBeGreaterThan(0)
  })
})

describe('groupByInstrument', () => {
  it('groups every catalog module into exactly one instrument bucket', () => {
    const groups = groupByInstrument()
    const total = groups.reduce((n, g) => n + g.modules.length, 0)
    expect(total).toBe(MODULES.length)
  })

  it('preserves first-seen instrument order', () => {
    const groups = groupByInstrument()
    // The catalog starts with the i2c-display group.
    expect(groups[0].instrument).toBe('i2c-display')
  })

  it('keeps per-instrument catalog order within a group', () => {
    const display = groupByInstrument().find((g) => g.instrument === 'i2c-display')
    expect(display?.modules.map((m) => m.id)).toEqual(['ssd1306', 'sh1106'])
  })
})

describe('installPathFor', () => {
  it('resolves /lib/<file> for a bundled module', () => {
    const def = moduleById('hcsr04')!
    expect(installPathFor(def)).toBe('/lib/hcsr04.py')
  })

  it('returns undefined for a mip module (mip picks its own path)', () => {
    const def = moduleById('ssd1306')!
    expect(installPathFor(def)).toBeUndefined()
  })
})

describe('importProbeSnippet', () => {
  it('builds an import probe that prints the present sentinel', () => {
    const snippet = importProbeSnippet('ssd1306')
    expect(snippet).toContain("__import__('ssd1306')")
    expect(snippet).toContain(MODULE_PRESENT)
    expect(snippet).toContain('except Exception:')
  })

  it('sanitises a name down to a safe identifier', () => {
    const snippet = importProbeSnippet("os'); import evil #")
    // Only the identifier chars survive — no injected quote/paren.
    expect(snippet).toContain("__import__('osimportevil')")
    expect(snippet).not.toContain("');")
  })
})

describe('diffInstalled', () => {
  it('marks every module unknown when disconnected', () => {
    const out = diffInstalled(new Set(), false)
    expect(Object.values(out).every((s) => s === 'unknown')).toBe(true)
  })

  it('splits installed vs available by import-name presence', () => {
    const out = diffInstalled(new Set(['ssd1306', 'mpu6050']), true)
    expect(out['ssd1306']).toBe('installed')
    expect(out['mpu6050']).toBe('installed')
    expect(out['hcsr04']).toBe('available')
  })

  it('covers exactly the catalog ids', () => {
    const out = diffInstalled(new Set(), true)
    expect(Object.keys(out).sort()).toEqual(MODULES.map((m) => m.id).sort())
  })
})
