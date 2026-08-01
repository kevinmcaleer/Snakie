import { describe, it, expect } from 'vitest'
import {
  housedGroupConnectors,
  housingGeometry,
  withGroupHousing
} from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * A housing follows the pins it holds (#696).
 *
 * Position and rotation used to be stored on the group, so every operation that
 * moved the pads had to remember to update them — and none did. Dragging,
 * aligning or rotating a housed group left its shell behind. They are derived
 * now, so there is no second copy to go stale, for ANY connector kind.
 */
const part = (pins: { x: number; y: number }[], housing: Record<string, unknown>): PartDefinition =>
  ({
    id: 'p',
    name: 'P',
    headers: [
      {
        edge: 'left',
        pins: pins.map((p, i) => ({ name: `P${i + 1}`, type: 'io', group: 'g', ...p }))
      }
    ],
    groups: [{ id: 'g', housing: { kind: 'qwiic', ...housing } }]
  }) as unknown as PartDefinition

describe('housingGeometry (#696)', () => {
  it('centres on the pins', () => {
    expect(housingGeometry([{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }])).toMatchObject({ x: 0.30000000000000004, y: 0.5 })
  })

  it('stands on end for a column, lies flat for a row', () => {
    expect(housingGeometry([{ x: 0.2, y: 0.1 }, { x: 0.2, y: 0.5 }]).rotation).toBe(90)
    expect(housingGeometry([{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }]).rotation).toBeUndefined()
  })
})

describe('the shell follows its pads, whatever moved them (#696)', () => {
  it('uses the pins position, not the stale stored one', () => {
    // The stored housing says one thing; the pins have since moved elsewhere.
    const p = part([{ x: 0.7, y: 0.4 }, { x: 0.9, y: 0.4 }], { x: 0.1, y: 0.1 })
    const [h] = housedGroupConnectors(p)
    expect(h.conn.x).toBeCloseTo(0.8, 6)
    expect(h.conn.y).toBeCloseTo(0.4, 6)
  })

  it('re-derives the ROTATION when the pads become a column', () => {
    // The reported bug: the pads turn, the shell keeps its old orientation.
    const p = part([{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }], { x: 0.5, y: 0.4 })
    expect(housedGroupConnectors(p)[0].conn.rotation).toBe(90)
  })

  it('drops a stale rotation when the pads become a row', () => {
    const p = part([{ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }], { x: 0.4, y: 0.5, rotation: 90 })
    expect(housedGroupConnectors(p)[0].conn.rotation).toBeUndefined()
  })

  it('holds for EVERY connector kind, not just the one reported', () => {
    for (const kind of ['qwiic', 'grove', 'jst', 'dupont', 'terminal'] as const) {
      const p = part([{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }], { kind, x: 0.1, y: 0.1 })
      const [h] = housedGroupConnectors(p)
      expect(h.conn.rotation, kind).toBe(90)
      expect(h.conn.x, kind).toBeCloseTo(0.5, 6)
    }
  })

  it('falls back to the stored position when no pin has one', () => {
    const p = {
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', group: 'g' }] }],
      groups: [{ id: 'g', housing: { kind: 'qwiic', x: 0.25, y: 0.75, rotation: 90 } }]
    } as unknown as PartDefinition
    const [h] = housedGroupConnectors(p)
    expect(h.conn.x).toBe(0.25)
    expect(h.conn.rotation).toBe(90)
  })

  it('authoring uses the same maths as rendering, so they cannot disagree', () => {
    const p = part([{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }], { x: 0, y: 0 })
    const stored = withGroupHousing(p, 'g', 'qwiic').groups!.find((g) => g.id === 'g')!.housing!
    const [h] = housedGroupConnectors({ ...p, ...withGroupHousing(p, 'g', 'qwiic') } as PartDefinition)
    expect([stored.x, stored.y, stored.rotation]).toEqual([h.conn.x, h.conn.y, h.conn.rotation])
  })
})
