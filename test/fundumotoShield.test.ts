import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { partFromYaml } from '../src/shared/part-yaml'
import { buildNetlist, flattenPartPins } from '../src/shared/netlist'
import type { PartDefinition } from '../src/shared/part'
import type { RobotDefinition } from '../src/shared/robot'

const CATALOG = resolve(__dirname, '../examples/parts/kevsrobots-catalog')
const load = (id: string): PartDefinition =>
  partFromYaml(readFileSync(resolve(CATALOG, id, 'parts.yml'), 'utf8'))

const shield = load('fundumoto-motor-shield')
const UNOS = ['arduino-uno-r3', 'arduino-uno-r4-minima', 'arduino-uno-r4-wifi', 'arduino-uno-q']

/** `id.pin#index` of the first pin with this name. */
const ep = (id: string, def: PartDefinition, name: string): string => {
  const i = flattenPartPins(def).findIndex((p) => p.name === name)
  expect(i, `${id} has ${name}`).toBeGreaterThanOrEqual(0)
  return `${id}.${name}#${i}`
}

describe('FunduMoto L298P motor shield (kevsrobots catalog)', () => {
  it('has a UNO mount that seats the board underneath', () => {
    expect(shield.mounts).toHaveLength(1)
    expect(shield.mounts?.[0]).toMatchObject({ id: 'uno', footprint: 'uno', under: true })
  })

  it('docks every UNO by footprint name', () => {
    for (const id of UNOS) expect(load(id).footprint, id).toBe('uno')
  })

  it('carries the UNO pins up through its stacking headers', () => {
    const derived = flattenPartPins(shield).filter((p) => p.derived === 'uno')
    expect(derived).toHaveLength(32)
    expect(derived.map((p) => p.name)).toEqual(expect.arrayContaining(['D9', 'D10', 'A0', '5V', 'GND', 'VIN']))
  })

  it('names its own pins uniquely and keeps them on the board', () => {
    const own = flattenPartPins(shield).filter((p) => !p.derived)
    expect(new Set(own.map((p) => p.name)).size).toBe(own.length)
    for (const p of own) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(1)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(1)
    }
  })

  it('only rails pins that exist', () => {
    const names = new Set(flattenPartPins(shield).map((p) => p.name))
    for (const rail of shield.rails ?? []) for (const pin of rail.pins) expect(names, `${rail.name}: ${pin}`).toContain(pin)
  })

  it('wires the servo, ping and RGB headers through to the UNO underneath', () => {
    const uno = load('arduino-uno-r3')
    const defs = new Map<string, PartDefinition>([
      ['shield', shield],
      ['uno', uno]
    ])
    const robot: RobotDefinition = {
      parts: [
        { id: 'shield', lib: 'kevsrobots-catalog', part: 'fundumoto-motor-shield' },
        { id: 'uno', lib: 'kevsrobots-catalog', part: 'arduino-uno-r3', mountedOn: 'shield', mount: 'uno' }
      ],
      connections: []
    }
    const nl = buildNetlist(robot, null, defs)
    for (const [own, unoPin] of [
      ['SERVO', 'D9'],
      ['PING_TRIG', 'D7'],
      ['PING_ECHO', 'D8'],
      ['RGB_R', 'D3'],
      ['SENSOR_A0', 'A0'],
      ['SERVO_GND', 'GND']
    ]) {
      expect(nl.nodeOf[ep('shield', shield, own)], own).toBeDefined()
      expect(nl.nodeOf[ep('shield', shield, own)], `${own} ↔ ${unoPin}`).toBe(nl.nodeOf[ep('uno', uno, unoPin)])
    }
  })
})
