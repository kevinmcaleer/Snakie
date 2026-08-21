import { describe, it, expect } from 'vitest'
import {
  ALL_MODULES,
  classMembersFor,
  crossDialectHints,
  detailFor,
  memberScope,
  modulesByNameFor,
  modulesFor
} from '../src/renderer/src/components/dialect-symbols'
import { inScope } from '../src/shared/dialect-api'
import type { Dialect } from '../src/shared/dialect'

const KNOWN: Dialect[] = ['micropython', 'circuitpython']
const names = (d: Dialect): string[] => modulesFor(d).map((m) => m.name)

/**
 * The completion catalogue, per runtime (#763, epic #209).
 *
 * The acceptance criterion for the issue is behavioural — a CircuitPython user
 * is never taught the MicroPython API — so these tests are about what CAN and
 * CANNOT be suggested, not about the contents of any one entry.
 */
describe('modulesFor — one catalogue per runtime', () => {
  it('never offers a module to the runtime that does not have it', () => {
    for (const d of KNOWN) {
      for (const mod of modulesFor(d)) {
        expect(inScope(mod.scope, d), `${mod.name} offered to ${d}`).toBe(true)
      }
    }
  })

  it('keeps `machine` away from CircuitPython and `digitalio` away from MicroPython', () => {
    // The headline failure: `from machine import Pin` suggested to somebody
    // holding a CircuitPython board.
    expect(names('circuitpython')).not.toContain('machine')
    expect(names('circuitpython')).not.toContain('mip')
    expect(names('circuitpython')).toContain('digitalio')
    expect(names('micropython')).not.toContain('digitalio')
    expect(names('micropython')).not.toContain('busio')
    expect(names('micropython')).toContain('machine')
  })

  it('offers the CircuitPython modules a beginner reaches for first', () => {
    const cp = names('circuitpython')
    for (const m of ['board', 'digitalio', 'analogio', 'pwmio', 'busio']) {
      expect(cp, `${m} missing from the CircuitPython catalogue`).toContain(m)
    }
  })

  it('gives plain-Python modules to both runtimes, from a single entry', () => {
    for (const m of ['time', 'math', 'json', 'os', 'sys', 'struct', 'random', 'gc']) {
      expect(names('micropython'), m).toContain(m)
      expect(names('circuitpython'), m).toContain(m)
    }
    // One definition per module name in every runtime's list — a duplicate would
    // silently shadow in `modulesByNameFor` and give a runtime the other's
    // members. Checked for `unknown` too, which sees both catalogues at once, so
    // a module present on both must be ONE entry scoped `'both'`, not two.
    for (const d of [...KNOWN, 'unknown' as Dialect]) {
      const listed = names(d)
      expect(new Set(listed).size, `duplicate module name for ${d}`).toBe(listed.length)
    }
    expect(ALL_MODULES.length).toBeGreaterThan(names('micropython').length)
  })

  it('shows an unestablished runtime both catalogues, hiding nothing', () => {
    const unknown = new Set(names('unknown'))
    for (const d of KNOWN) for (const n of names(d)) expect(unknown.has(n), n).toBe(true)
  })
})

describe('member scoping — the modules that exist on both but differ inside', () => {
  const membersOf = (d: Dialect, mod: string): string[] =>
    (modulesByNameFor(d)[mod]?.members ?? []).map((m) => m.name)

  it('splits `time` by member, not by module', () => {
    // `time` survives the module filter on both runtimes; half its MicroPython
    // surface does not exist on CircuitPython, and an AttributeError at the
    // first delay is exactly the experience this prevents.
    expect(membersOf('micropython', 'time')).toContain('sleep_ms')
    expect(membersOf('circuitpython', 'time')).not.toContain('sleep_ms')
    expect(membersOf('circuitpython', 'time')).not.toContain('ticks_ms')
    expect(membersOf('circuitpython', 'time')).toContain('monotonic')
    expect(membersOf('micropython', 'time')).not.toContain('monotonic')
    // `sleep` is the same call on both, so it must survive everywhere.
    for (const d of [...KNOWN, 'unknown' as Dialect]) {
      expect(membersOf(d, 'time'), `sleep on ${d}`).toContain('sleep')
    }
  })

  it('a member with no scope of its own inherits the module’s', () => {
    expect(memberScope({ name: 'x', kind: 'function' }, 'circuitpython')).toBe('circuitpython')
    expect(memberScope({ name: 'x', kind: 'function', scope: 'both' }, 'micropython')).toBe('both')
  })

  it('every member offered is one the runtime actually has', () => {
    for (const d of KNOWN) {
      for (const mod of modulesFor(d)) {
        for (const m of mod.members ?? []) {
          expect(inScope(memberScope(m, mod.scope), d), `${mod.name}.${m.name} on ${d}`).toBe(true)
        }
      }
    }
  })
})

describe('classMembersFor — the two I2C classes with the same name', () => {
  it('gives CircuitPython the lock and MicroPython none of it', () => {
    const cp = classMembersFor('circuitpython').I2C.map((m) => m.name)
    const mp = classMembersFor('micropython').I2C.map((m) => m.name)
    expect(cp).toContain('try_lock')
    expect(cp).toContain('unlock')
    expect(mp).not.toContain('try_lock')
  })

  it('offers only the right runtime’s pin class', () => {
    expect(Object.keys(classMembersFor('circuitpython'))).not.toContain('Pin')
    expect(Object.keys(classMembersFor('circuitpython'))).toContain('DigitalInOut')
    expect(Object.keys(classMembersFor('micropython'))).toContain('Pin')
    expect(Object.keys(classMembersFor('micropython'))).not.toContain('DigitalInOut')
  })

  it('merges the same-named classes for an unestablished runtime, without duplicates', () => {
    const merged = classMembersFor('unknown').I2C.map((m) => m.name)
    expect(merged).toContain('try_lock') // CircuitPython's
    expect(merged).toContain('readfrom') // MicroPython's
    expect(new Set(merged).size).toBe(merged.length)
  })
})

describe('detailFor — nothing is passed off as universal', () => {
  it('tags dialect-specific entries only when the runtime is unknown', () => {
    expect(detailFor('Hardware control', 'micropython', 'unknown')).toBe(
      'MicroPython · Hardware control'
    )
    expect(detailFor('Digital pins', 'circuitpython', 'unknown')).toBe('CircuitPython · Digital pins')
    expect(detailFor('Hardware control', 'micropython', 'micropython')).toBe('Hardware control')
    expect(detailFor('Time and delays', 'both', 'unknown')).toBe('Time and delays')
  })

  it('every dialect-specific suggestion is labelled when both are on screen', () => {
    for (const mod of modulesFor('unknown')) {
      const detail = detailFor(mod.detail, mod.scope, 'unknown')
      if (mod.scope === 'both') continue
      expect(detail.startsWith('MicroPython · ') || detail.startsWith('CircuitPython · '), mod.name).toBe(
        true
      )
    }
  })
})

describe('crossDialectHints — catching the paste from the wrong tutorial', () => {
  it('warns a CircuitPython session about `machine` and `mip`', () => {
    const hints = crossDialectHints('circuitpython')
    const byName = Object.fromEntries(hints.map((h) => [h.name, h]))
    expect(Object.keys(byName)).toContain('machine')
    expect(byName.machine.detail).toContain('Not on CircuitPython')
    expect(byName.machine.doc).toContain('digitalio')
    expect(Object.keys(byName)).toContain('mip')
  })

  it('warns a MicroPython session about the CircuitPython modules', () => {
    const names = crossDialectHints('micropython').map((h) => h.name)
    expect(names).toContain('digitalio')
    expect(names).toContain('busio')
    expect(names).not.toContain('machine')
  })

  it('never warns about a module the runtime actually has', () => {
    for (const d of KNOWN) {
      const mine = new Set(modulesFor(d).map((m) => m.name))
      for (const h of crossDialectHints(d)) {
        expect(mine.has(h.name), `${h.name} warned about on ${d} but offered there too`).toBe(false)
      }
    }
  })

  it('says nothing when the runtime is not established', () => {
    expect(crossDialectHints('unknown')).toEqual([])
  })
})
