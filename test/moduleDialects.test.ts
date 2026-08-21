import { describe, expect, it } from 'vitest'
import {
  MODULES,
  moduleDialect,
  modulesForDialect,
  type ModuleDef
} from '../src/shared/modules-catalog'
import { bundleFailureMessage, bundleInstallNote } from '../src/shared/install-messages'

/**
 * ONE CATALOG, TWO RUNTIMES (#758, epic #209).
 *
 * The module catalog now holds MicroPython drivers and CircuitPython bundle
 * libraries side by side, and they are not interchangeable: an Adafruit `.mpy`
 * cannot import on MicroPython, and a `machine`-based stub cannot run on
 * CircuitPython. So the property that matters is that the two halves never leak
 * into each other's board — an INSTALL button that can only fail is worse than
 * no button.
 */

const bundleModules = (): ModuleDef[] => MODULES.filter((m) => m.source.kind === 'bundle')

describe('moduleDialect', () => {
  it('files a source kind under the runtime that can run it', () => {
    for (const m of MODULES) {
      expect(moduleDialect(m)).toBe(m.source.kind === 'bundle' ? 'circuitpython' : 'micropython')
    }
  })

  it('the catalog has real drivers on both sides', () => {
    // Guards against the filter quietly becoming a no-op if the CircuitPython
    // half were ever removed — the tests below would all still pass.
    expect(bundleModules().length).toBeGreaterThan(0)
    expect(MODULES.length).toBeGreaterThan(bundleModules().length)
  })
})

describe('modulesForDialect', () => {
  it('never offers a board the other runtime’s drivers', () => {
    for (const dialect of ['micropython', 'circuitpython'] as const) {
      const shown = modulesForDialect(dialect)
      expect(shown.length).toBeGreaterThan(0)
      expect(shown.every((m) => moduleDialect(m) === dialect)).toBe(true)
    }
  })

  it('splits the catalog exactly — nothing hidden from both, nothing shown twice', () => {
    const micro = modulesForDialect('micropython').map((m) => m.id)
    const circuit = modulesForDialect('circuitpython').map((m) => m.id)
    expect([...micro, ...circuit].sort()).toEqual(MODULES.map((m) => m.id).sort())
  })

  it('shows everything when there is no board to be wrong about', () => {
    // Disconnected, or a runtime that didn't identify itself: there is no wrong
    // answer to hide, and browsing the whole catalog is how a user decides what
    // to buy.
    for (const dialect of [undefined, null, 'unknown' as const]) {
      expect(modulesForDialect(dialect)).toHaveLength(MODULES.length)
    }
  })

  it('keeps catalog order, so the manager’s groups do not reshuffle on connect', () => {
    const shown = modulesForDialect('micropython').map((m) => m.id)
    const expected = MODULES.filter((m) => moduleDialect(m) === 'micropython').map((m) => m.id)
    expect(shown).toEqual(expected)
  })

  it('returns a fresh array — the catalog is not the UI’s to mutate', () => {
    const all = modulesForDialect(undefined)
    all.pop()
    expect(modulesForDialect(undefined)).toHaveLength(MODULES.length)
  })
})

describe('what a failed bundle install says', () => {
  it('tells a board that is too old to UPDATE, not to copy files by hand', () => {
    // The one failure unique to this route: `.mpy` is published per
    // CircuitPython major, so "copy it in yourself" would be useless advice —
    // there is no version of the file that would work.
    const message = bundleFailureMessage({
      name: 'HC-SR04 ultrasonic (CircuitPython)',
      module: 'adafruit_hcsr04',
      kind: 'unsupported',
      detail: 'the Adafruit bundle released 2026-08-20 ships libraries for CircuitPython 9 and 10, and this board runs CircuitPython 8'
    })
    expect(message).toMatch(/Update CircuitPython on the board/)
    expect(message).toContain('adafruit_hcsr04')
    expect(message).toContain('CircuitPython 8')
  })

  it('always fits on one line — the banners show only the last one', () => {
    for (const kind of ['network', 'not-found', 'unsupported', 'malformed', 'too-big'] as const) {
      const message = bundleFailureMessage({
        name: 'X',
        module: 'adafruit_x',
        kind,
        detail: 'something\nwith\nnewlines'
      })
      expect(message.split('\n')).toHaveLength(1)
      expect(message).toMatch(/^Couldn't install X:/)
    }
  })

  it('names where CircuitPython libraries come from, every time', () => {
    const message = bundleFailureMessage({
      name: 'X',
      module: 'adafruit_x',
      kind: 'network',
      detail: 'offline'
    })
    expect(message).toContain('Adafruit CircuitPython Library Bundle')
  })
})

describe('what a successful bundle install says', () => {
  it('names the CircuitPython version the files were built for', () => {
    const note = bundleInstallNote({
      name: 'MPU-6050 IMU (CircuitPython)',
      modules: ['adafruit_bus_device', 'adafruit_register', 'adafruit_mpu6050'],
      fileCount: 7,
      major: 9,
      target: '/lib'
    })
    expect(note).toContain('CircuitPython 9')
    expect(note).toContain('7 files')
    expect(note).toContain('/lib')
  })

  it('names the dependencies that came along, but not the library itself', () => {
    // Asking for one driver and getting seven files needs explaining — but
    // listing the driver among its own dependencies would just be confusing.
    const note = bundleInstallNote({
      name: 'MPU-6050 IMU (CircuitPython)',
      modules: ['adafruit_bus_device', 'adafruit_register', 'adafruit_mpu6050'],
      fileCount: 7,
      major: 9,
      target: '/lib'
    })
    expect(note).toContain('adafruit_bus_device, adafruit_register')
    expect(note).not.toMatch(/dependencies[^—]*adafruit_mpu6050/)
  })

  it('mentions dependencies only when there were some', () => {
    const alone = bundleInstallNote({
      name: 'HC-SR04',
      modules: ['adafruit_hcsr04'],
      fileCount: 1,
      major: 10,
      target: '/lib'
    })
    expect(alone).not.toMatch(/dependenc/)
    expect(alone).toContain('1 file')
  })
})
