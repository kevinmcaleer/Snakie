import { describe, it, expect } from 'vitest'
import { groupMembers, groupTreeIds } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * Group membership across EVERY groupable kind (#665).
 *
 * `groupMembers` used to enumerate pins, shapes and labels only — so a group whose
 * members were connectors, LEDs, buttons or holes resolved to nothing: clicking it
 * in the Layers panel selected nothing, and dragging a member moved only that one.
 */
const PART = {
  id: 'p',
  name: 'P',
  headers: [{ edge: 'left', pins: [{ name: 'S1', type: 'io', group: 'g', x: 0.1, y: 0.1 }] }],
  shapes: [{ kind: 'rect', x: 0.2, y: 0.2, w: 0.1, h: 0.1, group: 'g' }],
  labels: [{ text: 'L', x: 0.3, y: 0.3, group: 'g' }],
  connectors: [{ kind: 'dupont', x: 0.4, y: 0.4, group: 'g', pins: [] }],
  onboardLeds: [{ kind: 'single', x: 0.5, y: 0.5, group: 'g' }],
  buttons: [{ label: 'B', x: 0.6, y: 0.6, group: 'g' }],
  mountingHoles: [{ x: 0.7, y: 0.7, diameter: 2, group: 'g' }],
  groups: [{ id: 'g', name: 'Everything' }]
} as unknown as PartDefinition

describe('groupMembers covers every groupable kind (#665)', () => {
  const ids = new Set(['g'])

  it('finds a member of each kind', () => {
    const kinds = groupMembers(PART, ids).map((m) => m.kind).sort()
    expect(kinds).toEqual(['button', 'connector', 'hole', 'label', 'led', 'pin', 'shape'])
  })

  it('ignores items in other groups or no group', () => {
    const other = {
      ...PART,
      connectors: [{ kind: 'dupont', x: 0.4, y: 0.4, group: 'other', pins: [] }],
      buttons: [{ label: 'B', x: 0.6, y: 0.6 }]
    } as unknown as PartDefinition
    const kinds = groupMembers(other, ids).map((m) => m.kind)
    expect(kinds).not.toContain('connector')
    expect(kinds).not.toContain('button')
  })

  it('follows nesting, so a supergroup gathers its children"s members', () => {
    const nested = {
      ...PART,
      connectors: [{ kind: 'dupont', x: 0.4, y: 0.4, group: 'inner', pins: [] }],
      groups: [{ id: 'g' }, { id: 'inner', parent: 'g' }]
    } as unknown as PartDefinition
    const tree = groupTreeIds(nested.groups, 'g')
    expect(groupMembers(nested, tree).map((m) => m.kind)).toContain('connector')
  })

  it('reports the index the canvas addresses each kind by', () => {
    const byKind = Object.fromEntries(
      groupMembers(PART, ids).map((m) => [m.kind, m.kind === 'pin' ? m.pi : m.index])
    )
    expect(byKind).toMatchObject({ connector: 0, led: 0, button: 0, hole: 0, shape: 0, label: 0, pin: 0 })
  })
})
