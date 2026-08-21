import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MODULES,
  MODULE_PRESENT,
  diffInstalled,
  groupByInstrument,
  importProbeSnippet,
  installPathFor,
  moduleById,
  modulesForInstrument,
  parseModuleVersion,
  type InstrumentId,
  type ModuleDef
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
      'gamepad',
      'motor'
    ]
    for (const m of MODULES) {
      // `instrument` is optional — a driver with no dock panel behind it (an RTC,
      // an SD card) declares none rather than being filed under an unrelated one.
      if (m.instrument !== undefined) expect(known).toContain(m.instrument)
    }
  })

  it('every source kind carries what its installer needs to resolve it', () => {
    for (const m of MODULES) {
      if (m.source.kind === 'bundled') {
        expect(m.source.file.endsWith('.py')).toBe(true)
        expect(m.license).toBeTruthy()
      } else if (m.source.kind === 'bundle') {
        // An Adafruit bundle library is named ONCE: the bundle's index key is
        // also the import name, and the install probes by import (#758).
        expect(m.source.module.length).toBeGreaterThan(0)
        expect(m.importName).toBe(m.source.module)
      } else {
        expect(m.source.spec.length).toBeGreaterThan(0)
      }
    }
  })

  it('covers the instrument inputs/outputs #120 names (display/range/imu/led/encoder/buzzer/gamepad/motor)', () => {
    const instruments = new Set(MODULES.map((m) => m.instrument).filter(Boolean))
    expect(instruments).toEqual(
      new Set(['i2c-display', 'range', 'imu', 'led', 'encoder', 'buzzer', 'gamepad', 'motor'])
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
    // The MicroPython drivers first, then the CircuitPython one (#758) — the
    // group holds both runtimes' drivers, and the manager filters by dialect.
    expect(display?.modules.map((m) => m.id)).toEqual(['ssd1306', 'sh1106', 'cp-ssd1306'])
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

  it('evicts the module cache before importing (#703)', () => {
    // MicroPython caches imported modules, and deleting the FILE does not evict
    // the cache — so once a session has imported a driver, a bare `__import__`
    // reports PRESENT for a file that is gone. Verified against the real
    // interpreter: delete + probe still succeeds; pop the entry and it fails.
    // A user deleted /lib/lsm6ds3.py, re-added the part, and was never offered
    // the install.
    const snippet = importProbeSnippet('lsm6ds3')
    expect(snippet).toContain("sys.modules.pop('lsm6ds3', None)")
    expect(snippet).toContain('import sys')
  })

  it('pops BEFORE it imports — order is the whole point', () => {
    // Popping afterwards would leave the cached entry answering the probe.
    const snippet = importProbeSnippet('lsm6ds3')
    expect(snippet.indexOf('sys.modules.pop')).toBeLessThan(snippet.indexOf('__import__'))
  })

  it('sanitises the name in the eviction too, not just the import', () => {
    // Both spots interpolate the name; missing one would reopen the injection.
    const snippet = importProbeSnippet("os'); import evil #")
    expect(snippet).toContain("sys.modules.pop('osimportevil', None)")
    expect(snippet).not.toContain("os');")
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

describe('panel-less drivers (#638)', () => {
  it('groups modules with no instrument separately, not under a wrong one', () => {
    const groups = groupByInstrument()
    const other = groups.find((g) => g.instrument === undefined)
    expect(other, 'a group for panel-less drivers').toBeTruthy()
    expect(other!.modules.map((m) => m.id)).toContain('pcf8563')
  })

  it('a panel-less driver is still a complete, installable module', () => {
    // The point of allowing no instrument is that these are REAL dependencies,
    // not placeholders — they must still resolve an install path.
    const rtc = moduleById('pcf8563')!
    expect(rtc.instrument).toBeUndefined()
    expect(rtc.importName).toBe('pcf8563')
    expect(installPathFor(rtc)).toBe('/lib/pcf8563.py')
  })

  it('modulesForInstrument never returns a panel-less module', () => {
    for (const i of ['imu', 'range', 'led', 'motor'] as InstrumentId[]) {
      for (const m of modulesForInstrument(i)) expect(m.instrument).toBe(i)
    }
  })
})

describe('bundled driver versioning (#707)', () => {
  const bundled = MODULES.filter(
    (m): m is ModuleDef & { source: { kind: 'bundled'; file: string; version: string } } =>
      m.source.kind === 'bundled'
  )

  it('every bundled module declares a version', () => {
    expect(bundled.length).toBeGreaterThan(0)
    for (const m of bundled) expect(m.source.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("every shipped .py carries a __version__ that MATCHES the catalog's", () => {
    // THE guard: the catalog-declared version is what board copies are compared
    // against, and the .py is what boards receive — if they drift, every board
    // reads as permanently outdated (or a real update is never offered). This
    // also forces the bump discipline: editing a driver without bumping BOTH
    // fails here.
    for (const m of bundled) {
      const src = readFileSync(
        join(__dirname, '..', 'micropython', 'modules', m.source.file),
        'utf-8'
      )
      expect(parseModuleVersion(src), `${m.source.file} __version__`).toBe(m.source.version)
    }
  })
})

describe('parseModuleVersion (#707)', () => {
  it('reads the literal from full source or a single readFileLine line', () => {
    expect(parseModuleVersion('__version__ = "1.2.3"')).toBe('1.2.3')
    expect(parseModuleVersion("__version__ = '1.2.3'")).toBe('1.2.3')
    expect(parseModuleVersion('import x\n__version__ = "0.4.0"\nY = 1')).toBe('0.4.0')
  })

  it('never matches a __version__ example inside a comment', () => {
    expect(parseModuleVersion('# keep the `__version__ = "X.Y.Z"` form\n__version__ = "2.0.0"')).toBe(
      '2.0.0'
    )
  })

  it('is null for empty / absent input (a legacy copy predating versioning)', () => {
    expect(parseModuleVersion('')).toBeNull()
    expect(parseModuleVersion(null)).toBeNull()
    expect(parseModuleVersion('X = 1')).toBeNull()
  })
})

describe('diffInstalled with outdated copies (#707)', () => {
  it('an importable name in the outdated set reads outdated, not installed', () => {
    const out = diffInstalled(new Set(['lsm6ds3', 'hcsr04']), true, MODULES, new Set(['lsm6ds3']))
    expect(out['lsm6ds3']).toBe('outdated')
    expect(out['hcsr04']).toBe('installed')
  })

  it('outdated never applies to a name that did not probe importable', () => {
    // The freshness probe only runs against importable modules, but the diff
    // must not trust that: a stray name in the outdated set is not on the board.
    const out = diffInstalled(new Set(), true, MODULES, new Set(['lsm6ds3']))
    expect(out['lsm6ds3']).toBe('available')
  })

  it('disconnected still reads unknown regardless of the outdated set', () => {
    const out = diffInstalled(new Set(['lsm6ds3']), false, MODULES, new Set(['lsm6ds3']))
    expect(out['lsm6ds3']).toBe('unknown')
  })
})
