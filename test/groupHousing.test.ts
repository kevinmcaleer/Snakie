import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  allConnectors,
  connectorEndpointIndices,
  housedGroupConnectors,
  normalisePart,
  withGroupHousing
} from '../src/renderer/src/components/part-editor.util'
import { coerceGroupHousing } from '../src/shared/part'
import { flattenPartPins } from '../src/shared/netlist'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { connectorFit } from '../src/renderer/src/components/cable'
import type { PartDefinition } from '../src/shared/part'

/**
 * A connector as a group of pins with a housing (#673).
 *
 * The pins stay ordinary pins in `headers[]` — which is the whole point. A wiring
 * endpoint is `<key>.<name>#<index>` where the FLATTENED index is authoritative,
 * so moving pins between arrays would silently rewire every saved design.
 */
const trio = (n: number, gid: string): unknown[] => [
  { name: `S${n}`, type: 'io', capabilities: ['pwm'], x: 0.2, y: 0.1, group: gid },
  { name: `V${n}`, type: 'pwr', x: 0.2, y: 0.2, group: gid },
  { name: `G${n}`, type: 'gnd', x: 0.2, y: 0.3, group: gid }
]

const PART = {
  id: 'p',
  name: 'P',
  dimensions: { width: 40, height: 20 },
  headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', x: 0.9, y: 0.5 }, ...trio(1, 'g1')] }],
  groups: [{ id: 'g1', name: 'Servo 1', housing: { kind: 'dupont', x: 0.2, y: 0.2, rotation: 90 } }]
} as unknown as PartDefinition

describe('coerceGroupHousing (#673)', () => {
  it('validates the variant against the housing kind', () => {
    expect(coerceGroupHousing({ kind: 'jst', variant: 'xh', x: 0.5, y: 0.5 })?.variant).toBe('xh')
    expect(coerceGroupHousing({ kind: 'jst', variant: 'i2c', x: 0.5, y: 0.5 })?.variant).toBeUndefined()
    expect(coerceGroupHousing({ kind: 'grove', variant: 'i2c', x: 0.5, y: 0.5 })?.variant).toBe('i2c')
  })

  it('needs a position, and quantises rotation', () => {
    expect(coerceGroupHousing({ kind: 'dupont' })).toBeUndefined()
    expect(coerceGroupHousing({ kind: 'dupont', x: 0.5, y: 0.5, rotation: 87 })?.rotation).toBe(90)
    expect(coerceGroupHousing({ kind: 'dupont', x: 0.5, y: 0.5, rotation: 0 })?.rotation).toBeUndefined()
  })

  it('rejects junk rather than inventing a housing', () => {
    expect(coerceGroupHousing(null)).toBeUndefined()
    expect(coerceGroupHousing('dupont')).toBeUndefined()
    expect(coerceGroupHousing({ kind: 'dupont', x: 'a', y: 0.5 })).toBeUndefined()
  })
})

describe('housedGroupConnectors (#673)', () => {
  it('presents a housed group as an ordinary connector', () => {
    const [h] = housedGroupConnectors(PART)
    expect(h.gid).toBe('g1')
    expect(h.conn.kind).toBe('dupont')
    expect(h.conn.rotation).toBe(90)
    expect(h.conn.pins.map((p) => p.name)).toEqual(['S1', 'V1', 'G1'])
  })

  it('orders contacts by group membership — the order a lead pairs on', () => {
    const [h] = housedGroupConnectors(PART)
    expect(h.conn.pins.map((p) => p.type)).toEqual(['io', 'pwr', 'gnd'])
  })

  it('ignores groups with no housing, and housings with no pins', () => {
    const plain = { ...PART, groups: [{ id: 'g1', name: 'Servo 1' }] } as unknown as PartDefinition
    expect(housedGroupConnectors(plain)).toEqual([])
    const empty = { ...PART, groups: [{ id: 'gX', housing: { kind: 'dupont', x: 0.5, y: 0.5 } }] } as unknown as PartDefinition
    expect(housedGroupConnectors(empty)).toEqual([])
  })

  it('allConnectors offers stored connectors AND housed groups', () => {
    const both = {
      ...PART,
      connectors: [{ kind: 'qwiic', x: 0.7, y: 0.7, pins: [{ name: 'SDA', type: 'io' }] }]
    } as unknown as PartDefinition
    expect(allConnectors(both).map((c) => c.kind)).toEqual(['qwiic', 'dupont'])
  })

  it('a housed group can take a lead, like any other connector', () => {
    const [h] = housedGroupConnectors(PART)
    const lead = {
      kind: 'dupont',
      x: 0.5,
      y: 0.5,
      pins: [
        { name: 'Signal', type: 'io' },
        { name: 'VCC', type: 'pwr' },
        { name: 'GND', type: 'gnd' }
      ]
    } as unknown as (typeof h)['conn']
    const fit = connectorFit(lead, h.conn)
    expect(fit.ok).toBe(true)
    expect(fit.pairs).toHaveLength(3)
  })
})

describe('adding a housing does not disturb saved wiring (#673)', () => {
  it('leaves the flattened endpoint order byte-identical', () => {
    // The flattened index IS the wiring endpoint. Naming a group the pins are
    // already in must move nothing.
    const without = { ...PART, groups: [{ id: 'g1', name: 'Servo 1' }] } as unknown as PartDefinition
    expect(flattenPartPins(PART).map((p) => p.name)).toEqual(flattenPartPins(without).map((p) => p.name))
  })

  it('round-trips the housing through parts.yml', () => {
    const back = partFromYaml(partToYaml(normalisePart(PART)))
    expect(back.groups?.[0].housing).toEqual({ kind: 'dupont', x: 0.2, y: 0.2, rotation: 90 })
    expect(flattenPartPins(back).map((p) => p.name)).toEqual(flattenPartPins(PART).map((p) => p.name))
  })

  it('survives the editor normaliser too — both whitelists, one coercer', () => {
    expect(normalisePart(PART).groups?.[0].housing?.kind).toBe('dupont')
  })
})

/** servo2040's headers, converted the safe way (#675). */
describe('servo2040 ships housed servo headers (#675)', () => {
  const part = partFromYaml(
    readFileSync('examples/parts/snakie-standard/servo2040/parts.yml', 'utf8')
  )

  it('every 3-pin trio has a housing, so a servo lead can cable to it', () => {
    const housed = (part.groups ?? []).filter((g) => g.housing)
    expect(housed).toHaveLength(24)
    expect(housed.every((g) => g.housing?.kind === 'dupont')).toBe(true)
  })

  it('presents them as connectors a lead can fit', () => {
    const conns = housedGroupConnectors(part)
    expect(conns).toHaveLength(24)
    expect(conns.every((c) => c.conn.pins.length === 3)).toBe(true)
    const lead = {
      kind: 'dupont',
      x: 0.5,
      y: 0.5,
      pins: [
        { name: 'Signal', type: 'io' },
        { name: 'VCC', type: 'pwr' },
        { name: 'GND', type: 'gnd' }
      ]
    } as unknown as (typeof conns)[0]['conn']
    expect(connectorFit(lead, conns[0].conn).ok).toBe(true)
  })

  it('did NOT move a single pin — saved designs keep their wiring', () => {
    // 92 header pins + the QWIIC's 4 contacts, in that order, exactly as before.
    expect(part.headers.reduce((n, h) => n + h.pins.length, 0)).toBe(92)
    expect(part.connectors).toHaveLength(1)
    expect(flattenPartPins(part)).toHaveLength(96)
  })
})

/** Endpoint indices resolve for BOTH connector shapes (#673). */
describe('connectorEndpointIndices (#673)', () => {
  const mixed = {
    id: 'p',
    name: 'P',
    dimensions: { width: 40, height: 20 },
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'GP0', type: 'io', x: 0.9, y: 0.5 },
          ...trio(1, 'g1'),
          { name: 'GP1', type: 'io', x: 0.9, y: 0.7 }
        ]
      }
    ],
    connectors: [
      { kind: 'qwiic', x: 0.7, y: 0.7, pins: [{ name: 'SDA', type: 'io' }, { name: 'SCL', type: 'io' }] }
    ],
    groups: [{ id: 'g1', housing: { kind: 'dupont', x: 0.2, y: 0.2 } }]
  } as unknown as PartDefinition

  it('gives a stored connector its contiguous block after the header pins', () => {
    const qwiic = mixed.connectors![0]
    // 5 header pins, so the QWIIC's contacts are 5 and 6.
    expect(connectorEndpointIndices(mixed, qwiic)).toEqual([5, 6])
  })

  it('gives a housed group the indices its pins ALREADY have', () => {
    const [h] = housedGroupConnectors(mixed)
    // The trio sits at header positions 1..3 — not appended at the end.
    expect(connectorEndpointIndices(mixed, h.conn)).toEqual([1, 2, 3])
  })

  it('agrees with the authoritative flattened order', () => {
    const flat = flattenPartPins(mixed)
    for (const conn of allConnectors(mixed)) {
      connectorEndpointIndices(mixed, conn).forEach((idx, i) => {
        expect(flat[idx]).toBe(conn.pins[i])
      })
    }
  })
})

/** "Make this group a connector" (#673). */
describe('withGroupHousing (#673)', () => {
  it('centres the housing on the group"s own pins — no placement step', () => {
    const { groups } = withGroupHousing(PART, 'g1', 'dupont')
    const h = groups!.find((g) => g.id === 'g1')!.housing!
    expect(h.kind).toBe('dupont')
    expect(h.x).toBeCloseTo(0.2, 6)
    expect(h.y).toBeCloseTo(0.2, 6) // mean of 0.1 / 0.2 / 0.3
  })

  it('stands the housing on end when the pads run in a column', () => {
    const { groups } = withGroupHousing(PART, 'g1', 'dupont')
    expect(groups!.find((g) => g.id === 'g1')!.housing!.rotation).toBe(90)
  })

  it('lies flat when they run in a row', () => {
    const row = {
      ...PART,
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'A', type: 'io', x: 0.1, y: 0.5, group: 'g1' },
            { name: 'B', type: 'pwr', x: 0.3, y: 0.5, group: 'g1' }
          ]
        }
      ]
    } as unknown as PartDefinition
    expect(withGroupHousing(row, 'g1', 'dupont').groups![0].housing!.rotation).toBeUndefined()
  })

  it('removes the housing with null, leaving an ordinary group', () => {
    const housed = { ...PART, ...withGroupHousing(PART, 'g1', 'qwiic') } as PartDefinition
    const { groups } = withGroupHousing(housed, 'g1', null)
    expect(groups!.find((g) => g.id === 'g1')!.housing).toBeUndefined()
  })

  it('moves no pins either way — saved wiring is untouched', () => {
    const housed = { ...PART, ...withGroupHousing(PART, 'g1', 'qwiic') } as PartDefinition
    expect(flattenPartPins(housed).map((p) => p.name)).toEqual(flattenPartPins(PART).map((p) => p.name))
  })

  it('does nothing for a group with no positioned pins', () => {
    const empty = { ...PART, headers: [{ edge: 'left', pins: [] }] } as unknown as PartDefinition
    expect(withGroupHousing(empty, 'g1', 'dupont')).toEqual({})
  })
})
