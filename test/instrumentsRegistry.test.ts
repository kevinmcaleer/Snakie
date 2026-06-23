import { describe, it, expect } from 'vitest'
import {
  INSTRUMENTS,
  PIN_IDS,
  SINGLETON_IDS,
  defaultVisibility,
  deriveInUse,
  filterPalette,
  groupInstruments,
  instrumentById,
  isVisible,
  normaliseVisibility,
  type InstrumentDef
} from '../src/renderer/src/components/instruments-registry'

describe('INSTRUMENTS registry shape', () => {
  it('every def has a unique id', () => {
    const ids = INSTRUMENTS.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every def has the required fields populated', () => {
    for (const d of INSTRUMENTS) {
      expect(d.id).toBeTruthy()
      expect(d.name).toBeTruthy()
      expect(d.accent).toMatch(/^#|rgb/)
      expect(d.border).toMatch(/rgba|#/)
      expect(d.icon).toBeTruthy()
      expect(['input', 'output', 'both']).toContain(d.group)
      expect(['pin', 'singleton']).toContain(d.kind)
      expect(d.description).toBeTruthy()
    }
  })

  it('keeps scope/meter as pin-kind and plotter + new ones as singletons', () => {
    expect(instrumentById('scope')?.kind).toBe('pin')
    expect(instrumentById('meter')?.kind).toBe('pin')
    expect(instrumentById('plotter')?.kind).toBe('singleton')
    expect(PIN_IDS).toEqual(['scope', 'meter'])
  })

  it('lists every new placeholder id as a singleton', () => {
    for (const id of [
      'gamepad',
      'range',
      'imu',
      'led',
      'button',
      'buzzer',
      'encoder',
      'i2c-display',
      'wifi-scan',
      'bluetooth',
      'i2c-detect'
    ]) {
      expect(SINGLETON_IDS).toContain(id)
      expect(instrumentById(id)?.kind).toBe('singleton')
    }
  })

  it('carries the handoff accents for the existing real bodies', () => {
    expect(instrumentById('scope')?.accent).toBe('#86ffb6')
    expect(instrumentById('meter')?.accent).toBe('#5fe0c8')
    expect(instrumentById('plotter')?.accent).toBe('#7fc4f0')
  })

  it('returns undefined for an unknown id', () => {
    expect(instrumentById('nope')).toBeUndefined()
  })
})

describe('groupInstruments', () => {
  it('splits the registry into input vs output and places both-kind into inputs by default', () => {
    const { input, output } = groupInstruments()
    const inIds = input.map((d) => d.id)
    const outIds = output.map((d) => d.id)
    // Inputs
    expect(inIds).toContain('scope')
    expect(inIds).toContain('meter')
    expect(inIds).toContain('range')
    // Outputs
    expect(outIds).toContain('led')
    expect(outIds).toContain('buzzer')
    expect(outIds).toContain('gamepad')
    // both-kind (I²C display) lands in inputs by default
    expect(inIds).toContain('i2c-display')
    expect(outIds).not.toContain('i2c-display')
  })

  it('honours an override placing both-kind into outputs', () => {
    const { input, output } = groupInstruments(INSTRUMENTS, 'output')
    expect(output.map((d) => d.id)).toContain('i2c-display')
    expect(input.map((d) => d.id)).not.toContain('i2c-display')
  })

  it('partitions every def exactly once', () => {
    const { input, output } = groupInstruments()
    expect(input.length + output.length).toBe(INSTRUMENTS.length)
  })

  it('groups an arbitrary subset', () => {
    const subset: InstrumentDef[] = [instrumentById('led')!, instrumentById('range')!]
    const { input, output } = groupInstruments(subset)
    expect(input.map((d) => d.id)).toEqual(['range'])
    expect(output.map((d) => d.id)).toEqual(['led'])
  })
})

describe('deriveInUse', () => {
  it('marks scope+meter from PWM/ADC pins parsed in the source', () => {
    const src = 'from machine import Pin, PWM, ADC\nled = PWM(Pin(16))\npot = ADC(Pin(26))'
    const inUse = deriveInUse(src, true)
    expect(inUse.has('scope')).toBe(true)
    expect(inUse.has('meter')).toBe(true)
  })

  it('marks the I²C instruments from an I2C() constructor', () => {
    const src = 'from machine import I2C, Pin\ni2c = I2C(0, sda=Pin(0), scl=Pin(1))'
    const inUse = deriveInUse(src, true)
    expect(inUse.has('i2c-detect')).toBe(true)
    expect(inUse.has('i2c-display')).toBe(true)
  })

  it('marks an instrument from a cheap driver/import hint with no parse-pins signal', () => {
    const src = 'from mpu6050 import MPU6050\nimu = MPU6050(i2c)'
    const inUse = deriveInUse(src, true)
    expect(inUse.has('imu')).toBe(true)
  })

  it('marks the range instrument from an ultrasonic driver hint', () => {
    const src = 'from hcsr04 import HCSR04\nsensor = HCSR04(trigger=3, echo=2)'
    expect(deriveInUse(src, true).has('range')).toBe(true)
  })

  it('returns an empty set for non-python or empty source', () => {
    expect(deriveInUse('', true).size).toBe(0)
    expect(deriveInUse('led = PWM(Pin(16))', false).size).toBe(0)
  })

  it('does not mark instruments the code never references', () => {
    const src = 'x = 1\nprint(x)'
    const inUse = deriveInUse(src, true)
    expect(inUse.has('imu')).toBe(false)
    expect(inUse.has('scope')).toBe(false)
  })
})

describe('defaultVisibility', () => {
  it('shows in-use singletons and always shows the plotter; hides the rest', () => {
    const vis = defaultVisibility(new Set(['imu']))
    expect(vis['imu']).toBe(true)
    expect(vis['plotter']).toBe(true)
    expect(vis['gamepad']).toBe(false)
    expect(vis['led']).toBe(false)
  })

  it('covers exactly the singleton ids (no pin-kind keys)', () => {
    const vis = defaultVisibility(new Set())
    expect(Object.keys(vis).sort()).toEqual([...SINGLETON_IDS].sort())
    expect(vis['scope']).toBeUndefined()
    expect(vis['meter']).toBeUndefined()
  })

  it('keeps the plotter visible even when nothing is in use', () => {
    expect(defaultVisibility(new Set())['plotter']).toBe(true)
  })
})

describe('filterPalette', () => {
  it('returns everything for an empty query', () => {
    expect(filterPalette('')).toHaveLength(INSTRUMENTS.length)
    expect(filterPalette('   ')).toHaveLength(INSTRUMENTS.length)
  })

  it('matches on the instrument name (case-insensitive)', () => {
    const r = filterPalette('GAMEPAD')
    expect(r.map((d) => d.id)).toEqual(['gamepad'])
  })

  it('matches on the description', () => {
    const r = filterPalette('voltage')
    expect(r.map((d) => d.id)).toContain('meter')
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterPalette('zzznomatch')).toHaveLength(0)
  })

  it('preserves registry order in the result', () => {
    const r = filterPalette('i')
    const order = r.map((d) => INSTRUMENTS.indexOf(d))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})

describe('isVisible', () => {
  it('treats a missing key as hidden', () => {
    expect(isVisible({}, 'plotter')).toBe(false)
    expect(isVisible({ plotter: false }, 'plotter')).toBe(false)
    expect(isVisible({ plotter: true }, 'plotter')).toBe(true)
  })
})

describe('normaliseVisibility', () => {
  it('covers exactly the registry ids (pin kinds + singletons)', () => {
    const vis = normaliseVisibility(undefined, defaultVisibility(new Set()))
    const expected = [...PIN_IDS, ...SINGLETON_IDS].sort()
    expect(Object.keys(vis).sort()).toEqual(expected)
  })

  it('migrates the OLD {scope,meter,plotter} shape without wiping the new ids', () => {
    const old = { scope: false, meter: false, plotter: true }
    const vis = normaliseVisibility(old, defaultVisibility(new Set(['imu'])))
    expect(vis['plotter']).toBe(true)
    expect(vis['scope']).toBe(false)
    expect(vis['meter']).toBe(false)
    // A new id absent from the old value falls back to the in-use default.
    expect(vis['imu']).toBe(true)
    expect(vis['gamepad']).toBe(false)
  })

  it('honours an explicit persisted boolean over the default', () => {
    const vis = normaliseVisibility({ gamepad: true }, defaultVisibility(new Set()))
    expect(vis['gamepad']).toBe(true)
    // plotter keeps its always-on default when not explicitly set
    expect(vis['plotter']).toBe(true)
  })

  it('defaults pin kinds to hidden', () => {
    const vis = normaliseVisibility({}, defaultVisibility(new Set()))
    expect(vis['scope']).toBe(false)
    expect(vis['meter']).toBe(false)
  })
})
