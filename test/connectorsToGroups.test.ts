import { describe, it, expect } from 'vitest'
import {
  connectorsToHousedGroups,
  housedGroupConnectors,
  normalisePart,
  resolvedPins
} from '../src/renderer/src/components/part-editor.util'
import { flattenPartPins } from '../src/shared/netlist'
import { connectorFit } from '../src/renderer/src/components/cable'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import type { PartDefinition } from '../src/shared/part'

/**
 * Converting stored connectors into housed groups (#677).
 *
 * A contact in `connectors[]` is a second-class pin — not selectable, not
 * marquee-able, editable only through the connector's own editor. As a header pin
 * in a housed group it is simply a pin.
 */
const PART = {
  id: 'p',
  name: 'P',
  dimensions: { width: 40, height: 20 },
  headers: [
    {
      edge: 'left',
      pins: [
        { name: 'GP0', type: 'io', x: 0.9, y: 0.4 },
        { name: 'GP1', type: 'io', x: 0.9, y: 0.6 }
      ]
    }
  ],
  connectors: [
    {
      kind: 'qwiic',
      x: 0.3,
      y: 0.3,
      label: 'QW',
      pins: [
        { name: 'GND', type: 'gnd' },
        { name: 'VCC', type: 'pwr' },
        { name: 'SDA', type: 'io', capabilities: ['i2c'], signals: { i2c: 'SDA' } },
        { name: 'SCL', type: 'io', capabilities: ['i2c'], signals: { i2c: 'SCL' } }
      ]
    },
    { kind: 'dupont', x: 0.6, y: 0.8, rotation: 90, pins: [
      { name: 'SIG', type: 'io' },
      { name: 'V+', type: 'pwr' },
      { name: 'G', type: 'gnd' }
    ] }
  ]
} as unknown as PartDefinition

const converted = { ...PART, ...connectorsToHousedGroups(PART)! } as PartDefinition

describe('connectorsToHousedGroups (#677)', () => {
  it('empties connectors[] and adds a housed group for each', () => {
    expect(converted.connectors).toBeUndefined()
    expect(converted.groups?.filter((g) => g.housing)).toHaveLength(2)
  })

  it('PRESERVES the flattened endpoint order exactly', () => {
    // That order is the authoritative wire endpoint index — the whole reason this
    // converts every connector at once rather than one at a time.
    expect(flattenPartPins(converted).map((p) => p.name)).toEqual(
      flattenPartPins(PART).map((p) => p.name)
    )
  })

  it('makes the contacts ordinary, resolvable pins', () => {
    // The point of the exercise: `resolvedPins` is what selection and the pin
    // inspector work from, and contacts were invisible to it.
    const names = resolvedPins(converted).map((r) => r.pin.name)
    expect(names).toContain('SDA')
    expect(names).toContain('SIG')
    expect(resolvedPins(PART).map((r) => r.pin.name)).not.toContain('SDA')
  })

  it('keeps each contact where it was already drawn', () => {
    const sda = resolvedPins(converted).find((r) => r.pin.name === 'SDA')!
    expect(sda.x).toBeGreaterThan(0)
    expect(sda.y).toBeCloseTo(0.3, 6) // the QWIIC's own y
  })

  it('carries the housing over, so it is still a connector a lead can plug into', () => {
    const housed = housedGroupConnectors(converted)
    expect(housed.map((h) => h.conn.kind).sort()).toEqual(['dupont', 'qwiic'])
    const lead = { kind: 'dupont', x: 0.5, y: 0.5, pins: [
      { name: 'Signal', type: 'io' }, { name: 'VCC', type: 'pwr' }, { name: 'GND', type: 'gnd' }
    ] } as unknown as (typeof housed)[0]['conn']
    const servo = housed.find((h) => h.conn.kind === 'dupont')!.conn
    expect(connectorFit(lead, servo).ok).toBe(true)
  })

  it('keeps the variant, rotation and label on the housing', () => {
    const dup = converted.groups!.find((g) => g.housing?.kind === 'dupont')!
    expect(dup.housing?.rotation).toBe(90)
    const qw = converted.groups!.find((g) => g.housing?.kind === 'qwiic')!
    expect(qw.housing?.label).toBe('QW')
  })

  it('keeps capabilities and signals — the fields the old editor could not reach', () => {
    const sda = converted.headers[0].pins.find((p) => p.name === 'SDA')!
    expect(sda.capabilities).toEqual(['i2c'])
    expect(sda.signals).toEqual({ i2c: 'SDA' })
  })

  it('names each group readably when the connector had no label', () => {
    expect(converted.groups?.find((g) => g.housing?.kind === 'dupont')?.name).toBe('Servo header')
  })

  it('round-trips through parts.yml with the order intact', () => {
    const back = partFromYaml(partToYaml(normalisePart(converted)))
    expect(flattenPartPins(back).map((p) => p.name)).toEqual(flattenPartPins(PART).map((p) => p.name))
    expect(back.groups?.filter((g) => g.housing)).toHaveLength(2)
  })

  it('is null for a part with no stored connectors, and pure', () => {
    expect(connectorsToHousedGroups({ ...PART, connectors: undefined } as PartDefinition)).toBeNull()
    const before = JSON.stringify(PART)
    connectorsToHousedGroups(PART)
    expect(JSON.stringify(PART)).toBe(before)
  })
})
