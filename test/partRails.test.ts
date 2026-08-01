import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { buildNetlist, flattenPartPins } from '../src/shared/netlist'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * A part's own internal nets (#695).
 *
 * A PCA9685's `V+` terminal feeds all sixteen servo headers through a PCB trace
 * the netlist could not see, so a servo on a header read as unpowered even with
 * the terminal block wired to a battery.
 */
const driver = (withRail: boolean): PartDefinition =>
  ({
    id: 'pca9685',
    name: 'PCA9685',
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'V+', type: 'pwr', x: 0.1, y: 0.1 },
          { name: 'GND', type: 'gnd', x: 0.1, y: 0.2 },
          { name: 'V1', type: 'pwr', x: 0.5, y: 0.1 },
          { name: 'V2', type: 'pwr', x: 0.6, y: 0.1 }
        ]
      }
    ],
    ...(withRail ? { rails: [{ name: 'V+', pins: ['V+', 'V1', 'V2'] }] } : {})
  }) as unknown as PartDefinition

const robot = { parts: [{ id: 'pca9685' }], wires: [] } as never

const nodeOf = (nl: ReturnType<typeof buildNetlist>, name: string): string | undefined =>
  nl.nodes.find((n) => n.terminals.some((t) => t.name === name))?.id

describe('part internal rails (#695)', () => {
  it('joins the declared pins into ONE node', () => {
    const nl = buildNetlist(robot, null, new Map([['pca9685', driver(true)]]))
    const vplus = nodeOf(nl, 'V+')
    expect(vplus).toBeDefined()
    expect(nodeOf(nl, 'V1')).toBe(vplus)
    expect(nodeOf(nl, 'V2')).toBe(vplus)
  })

  it('leaves them unconnected without the declaration — the reported bug', () => {
    // Nothing registers an unwired pin, so without the rail the header power pins
    // are not on any node at all: a servo plugged in there reads as unpowered.
    const nl = buildNetlist(robot, null, new Map([['pca9685', driver(false)]]))
    expect(nodeOf(nl, 'V1')).toBeUndefined()
    expect(nodeOf(nl, 'V+')).toBeUndefined()
  })

  it('does NOT touch pins outside the rail', () => {
    // GND shares no rail with V+ — bonding by name or by role would be a short.
    const nl = buildNetlist(robot, null, new Map([['pca9685', driver(true)]]))
    expect(nodeOf(nl, 'GND')).not.toBe(nodeOf(nl, 'V+'))
  })

  it('records the bond as an internal edge, so the ERC can explain it', () => {
    const nl = buildNetlist(robot, null, new Map([['pca9685', driver(true)]]))
    const internal = nl.edges.filter((e) => e.internal && e.id.startsWith('part:rail:'))
    expect(internal.length).toBeGreaterThan(0)
  })

  it('ignores a rail naming pins the part does not have', () => {
    const bogus = { ...driver(false), rails: [{ name: 'X', pins: ['NOPE', 'ALSO_NOPE'] }] } as PartDefinition
    expect(() => buildNetlist(robot, null, new Map([['pca9685', bogus]]))).not.toThrow()
  })
})

describe('rails persistence (#695)', () => {
  it('round-trips through parts.yml and the editor normaliser', () => {
    const p = normalisePart(driver(true))
    expect(p.rails).toEqual([{ name: 'V+', pins: ['V+', 'V1', 'V2'] }])
    expect(partFromYaml(partToYaml(p)).rails).toEqual([{ name: 'V+', pins: ['V+', 'V1', 'V2'] }])
  })

  it('drops a rail that joins nothing', () => {
    for (const bad of [{ name: 'V', pins: ['only'] }, { name: '', pins: ['a', 'b'] }, { name: 'V' }]) {
      const p = normalisePart({ ...driver(false), rails: [bad] } as unknown as PartDefinition)
      expect(p.rails, JSON.stringify(bad)).toBeUndefined()
    }
  })

})

/** The bundled boards that pass power through now say so (#695). */
describe('bundled distribution boards declare their rails (#695)', () => {
  const load = (id: string): PartDefinition =>
    partFromYaml(readFileSync(`examples/parts/snakie-standard/${id}/parts.yml`, 'utf8'))

  it('pca9685 joins its V+ terminal to all sixteen servo headers', () => {
    const p = load('pca9685')
    const vplus = p.rails?.find((r) => r.name === 'V+')
    expect(vplus?.pins).toContain('V+')
    expect(vplus?.pins).toContain('V1')
    expect(vplus?.pins).toContain('V16')
    expect(vplus?.pins).toHaveLength(17)
  })

  it('and its grounds, without joining ground to V+', () => {
    const p = load('pca9685')
    const gnd = p.rails?.find((r) => r.name === 'GND')
    expect(gnd?.pins).toContain('G1')
    expect(gnd?.pins).not.toContain('V+')
  })

  it('servo2040 joins its 24 servo power pins', () => {
    expect(load('servo2040').rails?.find((r) => r.name === 'Servo V+')?.pins).toHaveLength(24)
  })

  it('a servo header is actually on the supply node now', () => {
    const p = load('pca9685')
    const nl = buildNetlist({ parts: [{ id: 'pca9685' }], wires: [] } as never, null, new Map([['pca9685', p]]))
    const at = (n: string): string | undefined =>
      nl.nodes.find((x) => x.terminals.some((t) => t.name === n))?.id
    expect(at('V1')).toBe(at('V+'))
    expect(at('G1')).toBe(at('GND'))
    expect(at('V1')).not.toBe(at('GND'))
  })

  it('leaves the pin ORDER untouched, so saved wiring is unaffected', () => {
    for (const id of ['pca9685', 'servo2040']) {
      const p = load(id)
      expect(flattenPartPins(p).length, id).toBeGreaterThan(0)
      expect(flattenPartPins(partFromYaml(partToYaml(normalisePart(p)))).map((x) => x.name)).toEqual(
        flattenPartPins(p).map((x) => x.name)
      )
    }
  })
})
