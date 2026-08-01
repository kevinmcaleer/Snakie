import { describe, it, expect } from 'vitest'
import { duplicateGroup, groupMembers, housedGroupConnectors } from '../src/renderer/src/components/part-editor.util'
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
