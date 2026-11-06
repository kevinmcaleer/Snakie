import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { partFromYaml } from '../src/shared/part-yaml'
import { buildNetlist, flattenPartPins } from '../src/shared/netlist'
import type { PartDefinition } from '../src/shared/part'
import type { RobotDefinition } from '../src/shared/robot'
import { partToBoardDefinition } from '../src/renderer/src/components/part-editor.util'

const CATALOG = resolve(__dirname, '../examples/parts/kevsrobots-catalog')
const load = (id: string): PartDefinition =>
  partFromYaml(readFileSync(resolve(CATALOG, id, 'parts.yml'), 'utf8'))

const UNOS = ['arduino-uno-r3', 'arduino-uno-r4-minima', 'arduino-uno-r4-wifi', 'arduino-uno-q']

/** `id.pin#index` of the first pin with this name. */
const ep = (id: string, def: PartDefinition, name: string): string => {
  const i = flattenPartPins(def).findIndex((p) => p.name === name)
  expect(i, `${id} has ${name}`).toBeGreaterThanOrEqual(0)
  return `${id}.${name}#${i}`
}

describe.each([
  ['fundumoto-motor-shield', [['SERVO', 'D9'], ['PING_TRIG', 'D7'], ['PING_ECHO', 'D8'], ['RGB_R', 'D3'], ['SENSOR_A0', 'A0'], ['SERVO_GND', 'GND']]],
  ['arduino-motor-shield-rev3', [['OUT5', 'D5'], ['OUT6', 'D6'], ['IN2', 'A2'], ['IN3', 'A3'], ['TWI_A_SDA', 'SDA'], ['MOTOR_VIN', 'VIN'], ['MOTOR_GND', 'GND']]]
] as [string, [string, string][]][])('%s (kevsrobots catalog UNO shield)', (id, HEADERS) => {
  const shield = load(id)
  it('is an UNO shield, and every UNO has a socket for it', () => {
    expect(shield.footprint).toBe('uno-shield')
    expect(shield.mounts ?? []).toEqual([])
    for (const id of UNOS) {
      expect(load(id).mounts, id).toEqual([expect.objectContaining({ id: 'shield', footprint: 'uno-shield' })])
    }
  })

  it('repeats the UNO R3 headers, by name, where the UNO has them', () => {
    const uno = load('arduino-uno-r3')
    const unoPins = flattenPartPins(uno)
    const stack = shield.headers[0].pins
    expect(stack.map((p) => p.name)).toEqual(unoPins.map((p) => p.name))
    // Same place in mm once both boards are centred on each other.
    stack.forEach((p, i) => {
      const u = unoPins[i]
      expect((p.x! - 0.5) * shield.dimensions!.width).toBeCloseTo((u.x! - 0.5) * 53.34, 1)
      expect((p.y! - 0.5) * shield.dimensions!.height).toBeCloseTo((u.y! - 0.5) * 68.58, 1)
    })
  })

  it('only rails pins that exist', () => {
    const names = new Set(flattenPartPins(shield).map((p) => p.name))
    for (const rail of shield.rails ?? []) for (const pin of rail.pins) expect(names, `${rail.name}: ${pin}`).toContain(pin)
  })

  it('wires its headers to an UNO placed as a part, once seated on it', () => {
    const uno = load('arduino-uno-r3')
    const defs = new Map<string, PartDefinition>([
      ['shield', shield],
      ['uno', uno]
    ])
    const robot: RobotDefinition = {
      parts: [
        { id: 'uno', lib: 'kevsrobots-catalog', part: 'arduino-uno-r3' },
        { id: 'shield', lib: 'kevsrobots-catalog', part: id, mountedOn: 'uno', mount: 'shield' }
      ],
      connections: []
    }
    const nl = buildNetlist(robot, null, defs)
    for (const [own, unoPin] of HEADERS) {
      expect(nl.nodeOf[ep('shield', shield, own)], `${own} ↔ ${unoPin}`).toBe(nl.nodeOf[ep('uno', uno, unoPin)])
    }
  })

  it('wires its headers to the UNO that is the board, once seated on it', () => {
    const uno = load('arduino-uno-r3')
    const board = partToBoardDefinition(uno)
    const robot: RobotDefinition = {
      board: 'arduino-uno-r3',
      parts: [{ id: 'shield', lib: 'kevsrobots-catalog', part: id, mountedOn: 'board', mount: 'shield' }],
      connections: []
    }
    const nl = buildNetlist(robot, board, new Map([['shield', shield]]))
    for (const [own, unoPin] of HEADERS) {
      expect(nl.nodeOf[ep('shield', shield, own)], `${own} ↔ ${unoPin}`).toBe(nl.nodeOf[ep('board', uno, unoPin)])
    }
    // Not seated: nothing joins.
    const loose = buildNetlist({ ...robot, parts: [{ ...robot.parts[0], mountedOn: undefined, mount: undefined }] }, board, new Map([['shield', shield]]))
    expect(loose.edges.filter((e) => e.id.startsWith('mount:'))).toEqual([])
  })
})
