import { describe, it, expect } from 'vitest'
import { pruneEmptyGroups, normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * A group with nothing in it is dead weight (#690).
 *
 * Reported after deleting some servo headers: their groups stayed in the Layers
 * panel and couldn't be removed. Selecting an empty group selects nothing, so
 * pressing Delete on it appears to do nothing at all — the entry has to go when
 * its last member does.
 */
const part = (over: Record<string, unknown>): PartDefinition =>
  ({ id: 'p', name: 'P', headers: [], ...over }) as unknown as PartDefinition

describe('pruneEmptyGroups (#690)', () => {
  it('drops a group nothing references', () => {
    const p = part({
      headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', x: 0.9, y: 0.5 }] }],
      groups: [{ id: 'servo-1', name: 'Servo 1', housing: { kind: 'dupont', x: 0.2, y: 0.2 } }]
    })
    expect(pruneEmptyGroups(p)).toBeUndefined()
  })

  it('keeps a group that still has a member', () => {
    const p = part({
      headers: [{ edge: 'left', pins: [{ name: 'S1', type: 'io', group: 'servo-1', x: 0.2, y: 0.1 }] }],
      groups: [{ id: 'servo-1', name: 'Servo 1' }]
    })
    expect(pruneEmptyGroups(p)?.map((g) => g.id)).toEqual(['servo-1'])
  })

  it('counts EVERY groupable kind, not just pins/shapes/labels', () => {
    for (const [key, item] of [
      ['connectors', { kind: 'qwiic', x: 0.5, y: 0.5, group: 'g', pins: [] }],
      ['onboardLeds', { kind: 'single', x: 0.5, y: 0.5, group: 'g' }],
      ['buttons', { label: 'B', x: 0.5, y: 0.5, group: 'g' }],
      ['mountingHoles', { x: 0.5, y: 0.5, diameter: 2, group: 'g' }]
    ] as [string, unknown][]) {
      const p = part({ [key]: [item], groups: [{ id: 'g' }] })
      expect(pruneEmptyGroups(p)?.map((x) => x.id), key).toEqual(['g'])
    }
  })

  it('keeps an ancestor of a surviving group', () => {
    const p = part({
      headers: [{ edge: 'left', pins: [{ name: 'S1', type: 'io', group: 'inner', x: 0.2, y: 0.1 }] }],
      groups: [{ id: 'outer' }, { id: 'inner', parent: 'outer' }]
    })
    expect(pruneEmptyGroups(p)?.map((g) => g.id).sort()).toEqual(['inner', 'outer'])
  })

  it('drops a parent whose only child was empty too', () => {
    const p = part({ groups: [{ id: 'outer' }, { id: 'inner', parent: 'outer' }] })
    expect(pruneEmptyGroups(p)).toBeUndefined()
  })

  it('keeps the housing on a group it keeps', () => {
    const p = part({
      headers: [{ edge: 'left', pins: [{ name: 'S1', type: 'io', group: 'g', x: 0.2, y: 0.1 }] }],
      groups: [{ id: 'g', housing: { kind: 'dupont', x: 0.2, y: 0.2, rotation: 90 } }]
    })
    expect(pruneEmptyGroups(p)?.[0].housing).toEqual({ kind: 'dupont', x: 0.2, y: 0.2, rotation: 90 })
  })

  it('validates the housing rather than passing it through', () => {
    // This runs from normalisePart, so an untrusted housing must be coerced here
    // or the whitelist has a hole.
    const p = part({
      headers: [{ edge: 'left', pins: [{ name: 'S1', type: 'io', group: 'g', x: 0.2, y: 0.1 }] }],
      groups: [{ id: 'g', housing: { kind: 'nonsense', x: 'a', y: 0.2 } }]
    })
    expect(pruneEmptyGroups(p)?.[0].housing).toBeUndefined()
  })

  it('normalisePart still prunes, through the same helper', () => {
    const p = part({
      headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', x: 0.9, y: 0.5 }] }],
      groups: [{ id: 'orphan' }]
    })
    expect(normalisePart(p).groups).toBeUndefined()
  })
})
