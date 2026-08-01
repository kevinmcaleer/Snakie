import { describe, it, expect } from 'vitest'
import {
  duplicateGroup,
  groupMembers,
  groupTreeIds,
  housedGroupConnectors,
  itemGroupOf
} from '../src/renderer/src/components/part-editor.util'
import { flattenPartPins } from '../src/shared/netlist'
import type { PartDefinition } from '../src/shared/part'

/** Duplicating a whole group (#691) — a servo header should copy as a header. */
const PART = {
  id: 'p',
  name: 'P',
  dimensions: { width: 40, height: 20 },
  headers: [
    {
      edge: 'left',
      pins: [
        { name: 'GP0', type: 'io', x: 0.9, y: 0.5 },
        { name: 'S1', type: 'io', capabilities: ['pwm'], shape: 'octagonal', group: 'servo-1', x: 0.2, y: 0.1 },
        { name: 'V1', type: 'pwr', shape: 'octagonal', group: 'servo-1', x: 0.2, y: 0.2 },
        { name: 'G1', type: 'gnd', shape: 'octagonal', group: 'servo-1', x: 0.2, y: 0.3 }
      ]
    }
  ],
  groups: [{ id: 'servo-1', name: 'Servo 1', housing: { kind: 'dupont', x: 0.2, y: 0.2, rotation: 90 } }]
} as unknown as PartDefinition

describe('duplicateGroup (#691)', () => {
  const res = duplicateGroup(PART, 'servo-1')!
  const next = { ...PART, ...res.part } as PartDefinition

  it('copies every member into a new group', () => {
    expect(groupMembers(next, new Set([res.gid]))).toHaveLength(3)
  })

  it('carries the housing over, so a servo header copies AS a servo header', () => {
    const housed = housedGroupConnectors(next).find((h) => h.gid === res.gid)
    expect(housed?.conn.kind).toBe('dupont')
    expect(housed?.conn.pins).toHaveLength(3)
  })

  it('renames the copied pins, so wire endpoints stay unambiguous', () => {
    // A name IS an endpoint (`<part>.<name>`); two pins called S1 make it ambiguous.
    const names = next.headers[0].pins.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('S2')
  })

  it('offsets the copy so it is visibly its own', () => {
    const copy = next.headers[0].pins.filter((p) => p.group === res.gid)
    expect(copy[0].x).toBeGreaterThan(0.2)
    expect(copy[0].y).toBeGreaterThan(0.1)
  })

  it('keeps the original untouched', () => {
    const orig = next.headers[0].pins.filter((p) => p.group === 'servo-1')
    expect(orig.map((p) => p.name)).toEqual(['S1', 'V1', 'G1'])
    expect(orig[0].x).toBe(0.2)
  })

  it('APPENDS the copies, so existing wiring keeps its endpoint indices', () => {
    // The flattened index is the authoritative wire endpoint.
    const before = flattenPartPins(PART).map((p) => p.name)
    expect(flattenPartPins(next).map((p) => p.name).slice(0, before.length)).toEqual(before)
  })

  it('names the copy recognisably', () => {
    expect(next.groups?.find((g) => g.id === res.gid)?.name).toBe('Servo 1 copy')
  })

  it('returns null for a group with nothing in it', () => {
    const empty = { ...PART, groups: [{ id: 'gone' }] } as unknown as PartDefinition
    expect(duplicateGroup(empty, 'gone')).toBeNull()
  })

  it('is pure — the source part is unchanged', () => {
    const before = JSON.stringify(PART)
    duplicateGroup(PART, 'servo-1')
    expect(JSON.stringify(PART)).toBe(before)
  })
})

/**
 * A selected group lights up its MEMBERS too (#692).
 *
 * The panel has no access to the canvas's multi-selection, so it answers "is this
 * item in the selected group tree?" from the part instead — the same answer.
 */
describe('itemGroupOf (#692)', () => {
  const p = {
    id: 'p',
    name: 'P',
    headers: [{ edge: 'left', pins: [{ name: 'S1', type: 'io', group: 'g', x: 0.2, y: 0.1 }] }],
    shapes: [{ kind: 'rect', x: 0.3, y: 0.3, w: 0.1, h: 0.1, group: 'g' }],
    labels: [{ text: 'L', x: 0.4, y: 0.4 }],
    connectors: [{ kind: 'qwiic', x: 0.5, y: 0.5, group: 'g', pins: [] }],
    onboardLeds: [{ kind: 'single', x: 0.6, y: 0.6, group: 'g' }],
    buttons: [{ label: 'B', x: 0.7, y: 0.7, group: 'g' }],
    mountingHoles: [{ x: 0.8, y: 0.8, diameter: 2, group: 'g' }],
    groups: [{ id: 'g', name: 'Everything' }]
  } as unknown as PartDefinition

  it('finds the group for every addressable kind', () => {
    for (const k of ['shape', 'connector', 'led', 'button', 'hole'] as const) {
      expect(itemGroupOf(p, k, 0), k).toBe('g')
    }
  })

  it('is undefined for an ungrouped item, and out of range', () => {
    expect(itemGroupOf(p, 'label', 0)).toBeUndefined()
    expect(itemGroupOf(p, 'connector', 99)).toBeUndefined()
  })

  it('the whole tree resolves, so a nested member lights up with its ancestor', () => {
    const nested = {
      ...p,
      headers: [{ edge: 'left', pins: [{ name: 'S1', type: 'io', group: 'inner', x: 0.2, y: 0.1 }] }],
      groups: [{ id: 'outer' }, { id: 'inner', parent: 'outer' }]
    } as unknown as PartDefinition
    const ids = groupTreeIds(nested.groups, 'outer')
    expect(ids.has('inner')).toBe(true)
    expect(ids.has('outer')).toBe(true)
  })
})
