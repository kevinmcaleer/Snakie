import { describe, it, expect } from 'vitest'
import { buildNetlist } from '../src/shared/netlist'
import { runErc, ercSummary } from '../src/shared/erc'
import type { BoardDefinition } from '../src/shared/board'
import type { PartDefinition } from '../src/shared/part'
import type { RobotConnection, RobotDefinition } from '../src/shared/robot'

const BOARD: BoardDefinition = {
  id: 'testmcu', name: 'Test MCU', mcu: 'RP2040', pcbColor: '#0f5a2e', aspect: 0.6,
  headers: [
    { edge: 'left', pins: [
      { label: '5V', type: 'vcc' }, { label: 'GND', type: 'gnd' }, { label: '3V3', type: 'vcc' },
      { label: 'GP4', type: 'gpio', gpio: 4 }, { label: 'GP5', type: 'gpio', gpio: 5 }
    ] }
  ]
}

function part(id: string, model: PartDefinition['electrical'], pins: PartDefinition['headers'][number]['pins']): PartDefinition {
  return { id, name: id, headers: [{ edge: 'left', pins }], electrical: model }
}
const LED = (id: string): PartDefinition =>
  part(id, { model: 'led', vf: 2 }, [{ name: 'A', type: 'io' }, { name: 'K', type: 'gnd' }])
const RES = (id: string): PartDefinition =>
  part(id, { model: 'resistor', resistanceOhms: 330 }, [{ name: '1', type: 'io' }, { name: '2', type: 'io' }])
const SENSOR = (id: string): PartDefinition =>
  part(id, { model: 'consumer', currentDrawA: 0.02 }, [
    { name: 'VIN', type: 'pwr' }, { name: 'GND', type: 'gnd' },
    { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c'] }, { name: 'SCL', type: 'io', gpio: 5, capabilities: ['i2c'] }
  ])

const ep = (k: string, p: string, i: number): string => `${k}.${p}#${i}`
const w = (id: string, from: string, to: string): RobotConnection => ({ id, from, to })
const robot = (connections: RobotConnection[]): RobotDefinition => ({ parts: [], connections })
const erc = (conns: RobotConnection[], defs: [string, PartDefinition][]): ReturnType<typeof runErc> => {
  const map = new Map(defs)
  return runErc(buildNetlist(robot(conns), BOARD, map), map)
}

describe('ERC — shorts + rail conflicts', () => {
  it('flags 3V3 wired straight to GND as a dead short (error)', () => {
    const issues = erc([w('bad', ep('board', '3V3', 2), ep('board', 'GND', 1))], [])
    const short = issues.find((i) => i.rule === 'vcc-gnd-short')
    expect(short).toBeDefined()
    expect(short!.severity).toBe('error')
    expect(short!.message).toContain('3V3')
  })

  it('flags 5V wired to 3V3 as a rail conflict (error)', () => {
    const issues = erc([w('mix', ep('board', '5V', 0), ep('board', '3V3', 2))], [])
    const conflict = issues.find((i) => i.rule === 'rail-conflict')
    expect(conflict).toBeDefined()
    expect(conflict!.severity).toBe('error')
    expect(conflict!.message).toMatch(/5V|3V3/)
  })

  it('does NOT flag generic supply labels (V+, VCC) sharing a 5V rail (no false positive)', () => {
    // A battery's V+, a device's VCC and the board's 5V are the SAME supply — wiring
    // them together is correct. Only KNOWN, different voltages (5V ↔ 3V3) conflict.
    const BAT = part('bat', { model: 'source', supplyV: 6, terminals: { positive: 'V+', negative: 'GND' } }, [
      { name: 'V+', type: 'pwr' },
      { name: 'GND', type: 'gnd' }
    ])
    const DEV = part('dev', { model: 'consumer', currentDrawA: 0.1, terminals: { positive: 'VCC', negative: 'GND' } }, [
      { name: 'VCC', type: 'pwr' },
      { name: 'GND', type: 'gnd' }
    ])
    const issues = erc(
      [w('a', ep('bat', 'V+', 0), ep('board', '5V', 0)), w('b', ep('dev', 'VCC', 0), ep('board', '5V', 0))],
      [
        ['bat', BAT],
        ['dev', DEV]
      ]
    )
    expect(issues.find((i) => i.rule === 'rail-conflict')).toBeUndefined()
  })

  it('a clean GPIO→resistor→LED→GND circuit raises no short/conflict', () => {
    const issues = erc(
      [
        w('a', ep('board', 'GP4', 3), ep('r', '1', 0)),
        w('b', ep('r', '2', 1), ep('led', 'A', 0)),
        w('c', ep('led', 'K', 1), ep('board', 'GND', 1))
      ],
      [['r', RES('r')], ['led', LED('led')]]
    )
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
  })
})

describe('ERC — LED current-limiting resistor', () => {
  it('warns when an LED is driven with no series resistor', () => {
    const issues = erc(
      [w('a', ep('board', 'GP4', 3), ep('led', 'A', 0)), w('b', ep('led', 'K', 1), ep('board', 'GND', 1))],
      [['led', LED('led')]]
    )
    const led = issues.find((i) => i.rule === 'led-no-resistor')
    expect(led).toBeDefined()
    expect(led!.severity).toBe('warning')
    expect(led!.parts).toContain('led')
  })

  it('does NOT warn when a series resistor shares the LED node', () => {
    const issues = erc(
      [
        w('a', ep('board', 'GP4', 3), ep('r', '1', 0)),
        w('b', ep('r', '2', 1), ep('led', 'A', 0)),
        w('c', ep('led', 'K', 1), ep('board', 'GND', 1))
      ],
      [['r', RES('r')], ['led', LED('led')]]
    )
    expect(issues.some((i) => i.rule === 'led-no-resistor')).toBe(false)
  })
})

describe('ERC — I2C pull-ups', () => {
  it('advises (info) when an I2C bus has no pull-up resistors', () => {
    const issues = erc(
      [
        w('sda', ep('board', 'GP4', 3), ep('s', 'SDA', 2)),
        w('scl', ep('board', 'GP5', 4), ep('s', 'SCL', 3))
      ],
      [['s', SENSOR('s')]]
    )
    const pu = issues.find((i) => i.rule === 'i2c-no-pullups')
    expect(pu).toBeDefined()
    expect(pu!.severity).toBe('info')
  })

  it('is silent when pull-up resistors to 3V3 are present on the bus', () => {
    // SDA — r1 — 3V3, plus the SDA wire to the sensor. r1 shares the SDA node and 3V3.
    const issues = erc(
      [
        w('sda', ep('board', 'GP4', 3), ep('s', 'SDA', 2)),
        w('scl', ep('board', 'GP5', 4), ep('s', 'SCL', 3)),
        w('pu1', ep('s', 'SDA', 2), ep('r1', '1', 0)),
        w('pu1b', ep('r1', '2', 1), ep('board', '3V3', 2)),
        w('pu2', ep('s', 'SCL', 3), ep('r2', '1', 0)),
        w('pu2b', ep('r2', '2', 1), ep('board', '3V3', 2))
      ],
      [['s', SENSOR('s')], ['r1', RES('r1')], ['r2', RES('r2')]]
    )
    expect(issues.some((i) => i.rule === 'i2c-no-pullups')).toBe(false)
  })
})

describe('ercSummary', () => {
  it('counts per severity and reports the worst present', () => {
    const issues = erc(
      [
        w('short', ep('board', '3V3', 2), ep('board', 'GND', 1)),
        w('a', ep('board', 'GP4', 3), ep('led', 'A', 0)),
        w('b', ep('led', 'K', 1), ep('board', 'GND', 1))
      ],
      [['led', LED('led')]]
    )
    const s = ercSummary(issues)
    expect(s.errors).toBeGreaterThanOrEqual(1)
    expect(s.warnings).toBeGreaterThanOrEqual(1)
    expect(s.worst).toBe('error')
    expect(s.total).toBe(issues.length)
  })

  it('an empty circuit is clean', () => {
    expect(ercSummary(erc([], []))).toEqual({ total: 0, errors: 0, warnings: 0, infos: 0, worst: null })
  })
})
