import { describe, it, expect } from 'vitest'
import { duplicateSelection } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * Duplicate (#661) — the ONE implementation behind both the canvas mini-toolbar's
 * ⧉ buttons and the Ctrl/Cmd+D shortcut.
 */
const PART = {
  id: 'p',
  name: 'P',
  headers: [{ edge: 'left', pins: [{ name: 'SCL', type: 'io', capabilities: ['i2c'], x: 0.1, y: 0.2 }] }],
  shapes: [{ kind: 'rect', x: 0.2, y: 0.2, w: 0.2, h: 0.1, fill: '#111' }],
  labels: [{ text: 'U1', x: 0.5, y: 0.5 }],
  mountingHoles: [{ x: 0.1, y: 0.1, diameter: 2 }],
  connectors: [
    {
      kind: 'qwiic',
      group: 'g1',
      x: 0.5,
      y: 0.5,
      pins: [
        { name: 'GND', type: 'gnd' },
        { name: 'SDA', type: 'io' }
      ]
    }
  ],
  groups: [{ id: 'g1', name: 'Port' }]
} as unknown as PartDefinition

describe('duplicateSelection (#661)', () => {
  it('returns null for a selection with nothing to duplicate', () => {
    expect(duplicateSelection(PART, null)).toBeNull()
    expect(duplicateSelection(PART, { type: 'image' })).toBeNull()
    expect(duplicateSelection(PART, { type: 'shape', index: 99 })).toBeNull()
  })

  it('copies a shape, offset, and selects the copy', () => {
    const r = duplicateSelection(PART, { type: 'shape', index: 0 })!
    expect(r.part.shapes).toHaveLength(2)
    expect(r.part.shapes![1].x).toBeCloseTo(0.24)
    expect(r.part.shapes![1].y).toBeCloseTo(0.24)
    expect(r.selection).toEqual({ type: 'shape', index: 1 })
    // The source is untouched — the helper is pure.
    expect(PART.shapes).toHaveLength(1)
  })

  it('copies a label and a mounting hole', () => {
    expect(duplicateSelection(PART, { type: 'label', index: 0 })!.part.labels).toHaveLength(2)
    const h = duplicateSelection(PART, { type: 'hole', index: 0 })!
    expect(h.part.mountingHoles).toHaveLength(2)
    expect(h.part.mountingHoles![1].diameter).toBe(2)
  })

  it('clamps the offset so a copy near the edge stays on the board', () => {
    const edge = { ...PART, labels: [{ text: 'x', x: 0.99, y: 0.99 }] } as PartDefinition
    const r = duplicateSelection(edge, { type: 'label', index: 0 })!
    expect(r.part.labels![1].x).toBe(1)
    expect(r.part.labels![1].y).toBe(1)
  })

  it('makes a duplicated connector standalone, not a member of the original group', () => {
    // Inheriting the group would make dragging the original drag its own copy.
    const r = duplicateSelection(PART, { type: 'connector', index: 0 })!
    expect(r.part.connectors![1].group).toBeUndefined()
    expect(r.part.connectors![0].group).toBe('g1')
  })

  it('renames a duplicated connector"s contacts so wire endpoints stay unambiguous', () => {
    const r = duplicateSelection(PART, { type: 'connector', index: 0 })!
    expect(r.part.connectors![1].pins.map((p) => p.name)).toEqual(['GND2', 'SDA2'])
  })

  it('renames a duplicated pin for the same reason', () => {
    const r = duplicateSelection(PART, { type: 'pin', hi: 0, pi: 0 })!
    const pins = r.part.headers[0].pins
    expect(pins).toHaveLength(2)
    expect(pins[0].name).toBe('SCL')
    expect(pins[1].name).toBe('SCL2')
    expect(pins[1].x).toBeCloseTo(0.14)
    expect(r.selection).toEqual({ type: 'pin', hi: 0, pi: 1 })
  })

  it('deep-copies a pin"s capabilities rather than sharing the array', () => {
    const r = duplicateSelection(PART, { type: 'pin', hi: 0, pi: 0 })!
    const pins = r.part.headers[0].pins
    expect(pins[1].capabilities).toEqual(['i2c'])
    expect(pins[1].capabilities).not.toBe(pins[0].capabilities)
  })

  it('places a duplicated pin from its RESOLVED position when it has no x/y', () => {
    // A legacy pin is positioned from its edge; copying `src.x` would leave the
    // duplicate with no position at all.
    const legacy = {
      ...PART,
      headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io' }] }]
    } as unknown as PartDefinition
    const r = duplicateSelection(legacy, { type: 'pin', hi: 0, pi: 0 })!
    const copy = r.part.headers[0].pins[1]
    expect(copy.x).toBeGreaterThan(0)
    expect(copy.y).toBeGreaterThan(0)
  })
})
