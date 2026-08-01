import { describe, it, expect } from 'vitest'
import {
  isPowerLed,
  partSupplyVoltage,
  powerLedState,
  POWER_LED_MIN_V
} from '../src/shared/power-led'
import { partFromYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import { onboardLedLabel } from '../src/renderer/src/components/part-body'
import type { OnboardLed, PartDefinition, PartElectrical } from '../src/shared/part'

const el = (operatingV?: [number, number]): PartElectrical =>
  ({ model: 'consumer', operatingV }) as PartElectrical

describe('powerLedState (#698)', () => {
  it('is UNKNOWN with nothing solved — it never claims a part is unpowered', () => {
    // The state that stops this feature lying. No source and no electrical models
    // means no solve, and a dark LED would assert a fact we do not have.
    expect(powerLedState(undefined)).toBe('unknown')
    expect(powerLedState(Number.NaN)).toBe('unknown')
  })

  it('lights at or above the range the part is designed for', () => {
    expect(powerLedState(5, el([4.8, 6]))).toBe('lit')
    expect(powerLedState(4.8, el([4.8, 6]))).toBe('lit') // exactly at the minimum
    expect(powerLedState(3.3, el([4.8, 6]))).toBe('dark') // browned out
  })

  it('still lights when OVER-volted — the part has power, and is dying of it', () => {
    // Dark would read as "not connected", which is the opposite of the problem.
    // Naming the over-voltage is the ERC's job (#687).
    expect(powerLedState(9, el([2.3, 5.5]))).toBe('lit')
  })

  it('falls back to a plain LED-visibility threshold with no declared range', () => {
    expect(powerLedState(POWER_LED_MIN_V, el())).toBe('lit')
    expect(powerLedState(POWER_LED_MIN_V - 0.1, el())).toBe('dark')
    expect(powerLedState(3.3)).toBe('lit') // no electrical block at all
    expect(powerLedState(0)).toBe('dark')
  })
})

describe('partSupplyVoltage (#698)', () => {
  const pins = [
    { net: 'vcc', endpoint: 'p1.VCC#0' },
    { net: 'gnd', endpoint: 'p1.GND#1' },
    { net: 'signal', endpoint: 'p1.SDA#2' }
  ]

  it('measures the power pin against the part OWN ground', () => {
    // Not against 0 V: a shifted ground reference would otherwise read a voltage
    // the part never actually sees across itself.
    const v = new Map([
      ['p1.VCC#0', 5],
      ['p1.GND#1', 1.2]
    ])
    expect(partSupplyVoltage(pins, v)).toBeCloseTo(3.8, 6)
  })

  it('assumes 0 V ground when the part has no solved ground pin', () => {
    expect(partSupplyVoltage(pins, new Map([['p1.VCC#0', 3.3]]))).toBeCloseTo(3.3, 6)
  })

  it('takes the HIGHEST power pin — a board is powered by its input rail', () => {
    // A regulator board exposes its 3V3 output as a pwr pin too; being fed 5 V is
    // what makes it powered.
    const many = [
      { net: 'vcc', endpoint: 'a.3V3#0' },
      { net: 'vcc', endpoint: 'a.VIN#1' }
    ]
    const v = new Map([
      ['a.3V3#0', 3.3],
      ['a.VIN#1', 5]
    ])
    expect(partSupplyVoltage(many, v)).toBeCloseTo(5, 6)
  })

  it('is undefined when no power pin reaches a solved node', () => {
    // An unwired pin produces no node at all, so there is no entry to find. The
    // CALLER decides what that means — after a successful solve it is a real 0 V.
    expect(partSupplyVoltage(pins, new Map([['p1.SDA#2', 3.3]]))).toBeUndefined()
    expect(partSupplyVoltage([], new Map())).toBeUndefined()
  })

  it('reads 0 V for a part wired to a dead rail', () => {
    // The case the feature exists for: connected, but nothing is driving it.
    const v = new Map([
      ['p1.VCC#0', 0],
      ['p1.GND#1', 0]
    ])
    expect(powerLedState(partSupplyVoltage(pins, v), el([3, 5]))).toBe('dark')
  })
})

describe('the power kind survives both whitelists (#698)', () => {
  // `parts.yml` coercion and `normalisePart` each rebuild a part field by field, so
  // a new field or kind must be added to BOTH or it is silently dropped on save.
  const yaml = `id: demo
name: Demo
onboardLeds:
  - { kind: power, label: PWR, color: '#d24a3a', x: 0.8, y: 0.1 }
  - { kind: single, gpio: 25, x: 0.2, y: 0.1 }
`

  it('parses from parts.yml', () => {
    const part = partFromYaml(yaml) as PartDefinition
    expect(part.onboardLeds?.[0].kind).toBe('power')
    expect(part.onboardLeds?.[0].color).toBe('#d24a3a')
    expect(part.onboardLeds?.[1].kind).toBe('single')
  })

  it('survives a normalise (the editor save path)', () => {
    const part = partFromYaml(yaml) as PartDefinition
    const out = normalisePart(part)
    expect(out.onboardLeds?.[0].kind).toBe('power')
    expect(out.onboardLeds?.[0].color).toBe('#d24a3a')
  })

  it('drops a GPIO on a power LED — nothing drives it', () => {
    const part = partFromYaml(`id: d
name: D
onboardLeds:
  - { kind: power, gpio: 25, x: 0.5, y: 0.5 }
`) as PartDefinition
    expect(part.onboardLeds?.[0].gpio).toBeUndefined()
    expect(normalisePart(part).onboardLeds?.[0].gpio).toBeUndefined()
  })
})

describe('isPowerLed + its silk label (#698)', () => {
  it('is a declared kind, never inferred from a missing GPIO', () => {
    // `grove-led-bar` has TEN GPIO-less `single` LEDs driven by its own chip, and
    // the XIAO RP2350 has one that is really the user LED — inference would light
    // all of them. Only the author knows which LED is the indicator.
    expect(isPowerLed({ kind: 'power' })).toBe(true)
    expect(isPowerLed({ kind: 'single' })).toBe(false)
    expect(isPowerLed({ kind: 'neopixel' })).toBe(false)
  })

  it('labels itself PWR, with no GPIO to name', () => {
    expect(onboardLedLabel({ kind: 'power', x: 0, y: 0 } as OnboardLed)).toBe('PWR')
    expect(onboardLedLabel({ kind: 'power', label: 'Power', x: 0, y: 0 } as OnboardLed)).toBe('Power')
    expect(onboardLedLabel({ kind: 'single', gpio: 25, x: 0, y: 0 } as OnboardLed)).toBe('LED · GP25')
  })
})
