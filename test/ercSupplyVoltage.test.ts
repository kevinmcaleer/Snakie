import { describe, it, expect } from 'vitest'
import { runErc } from '../src/shared/erc'
import { coerceElectrical } from '../src/shared/part-yaml'
import type { Netlist } from '../src/shared/netlist'
import type { PartDefinition } from '../src/shared/part'

/**
 * "This part is on the wrong rail" (#687).
 *
 * The model described amps only, so the sim knew a servo drew 100 mA and had no
 * idea it wanted 4.8–6 V — the commonest way to destroy a breakout, and invisible.
 */
const part = (operatingV?: [number, number]): PartDefinition =>
  ({
    id: 'sensor',
    name: 'Sensor',
    headers: [],
    electrical: { model: 'consumer', currentDrawA: 0.01, ...(operatingV ? { operatingV } : {}) }
  }) as unknown as PartDefinition

const net = (rail: string): Netlist =>
  ({
    nodes: [
      {
        id: 'n1',
        kind: 'power',
        rail,
        terminals: [{ key: 'sensor', name: 'VCC', role: 'pwr', rail }]
      }
    ],
    edges: []
  }) as unknown as Netlist

const run = (rail: string, range?: [number, number]): ReturnType<typeof runErc> =>
  runErc(net(rail), new Map([['sensor', part(range)]]))

describe('supply voltage ERC (#687)', () => {
  it('errors when a 3.3V part is on a 5V rail', () => {
    const [issue] = run('5V', [3, 3.6])
    expect(issue.rule).toBe('supply-over-voltage')
    expect(issue.severity).toBe('error')
    expect(issue.message).toContain('5V')
    expect(issue.message).toContain('3–3.6 V')
    expect(issue.parts).toEqual(['sensor'])
  })

  it('warns — not errors — when the rail is too LOW', () => {
    // Under-voltage misbehaves or browns out; it does not destroy the part.
    const [issue] = run('3V3', [4.8, 6])
    expect(issue.rule).toBe('supply-under-voltage')
    expect(issue.severity).toBe('warning')
  })

  it('says nothing when the rail is inside the range', () => {
    expect(run('3V3', [3, 5.5])).toEqual([])
    expect(run('5V', [3, 5.5])).toEqual([])
  })

  it('says nothing when the part declares no range', () => {
    expect(run('5V', undefined)).toEqual([])
  })

  it('says nothing on a rail whose voltage is unknown', () => {
    // Guessing at an unlabelled net would train people to ignore the rule.
    expect(run('VMOTOR', [3, 3.6])).toEqual([])
  })

  it('reports a part once per node, not once per terminal', () => {
    const n = {
      nodes: [
        {
          id: 'n1',
          kind: 'power',
          rail: '5V',
          terminals: [
            { key: 'sensor', name: 'VCC', role: 'pwr', rail: '5V' },
            { key: 'sensor', name: 'VDD', role: 'pwr', rail: '5V' }
          ]
        }
      ],
      edges: []
    } as unknown as Netlist
    expect(runErc(n, new Map([['sensor', part([3, 3.6])]]))).toHaveLength(1)
  })
})

describe('operatingV persistence (#687)', () => {
  it('round-trips a valid range', () => {
    expect(coerceElectrical({ model: 'consumer', operatingV: [3, 5.5] })?.operatingV).toEqual([3, 5.5])
  })

  it('drops a malformed one rather than storing something unusable', () => {
    for (const bad of [[5, 3], ['a', 5], [3], 3, null, [0, 5]]) {
      expect(coerceElectrical({ model: 'consumer', operatingV: bad })?.operatingV, String(bad)).toBeUndefined()
    }
  })

  it('is distinct from supplyRange, which means an adjustable source"s range', () => {
    const el = coerceElectrical({ model: 'consumer', operatingV: [3, 5.5], supplyRange: [0, 30] })
    expect(el?.operatingV).toEqual([3, 5.5])
    expect(el?.supplyRange).toEqual([0, 30])
  })
})
