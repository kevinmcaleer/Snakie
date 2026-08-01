import { describe, it, expect } from 'vitest'
import {
  addRail,
  renameRail,
  removeRail,
  toggleRailPin,
  railHolding,
  normalisePart
} from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition, PartRail } from '../src/shared/part'

/**
 * The Rails table's edits (#706).
 *
 * A rail says "a PCB trace ties these pins together" — the only way the netlist
 * can know a PCA9685's V+ terminal feeds all sixteen servo headers. Until now they
 * could only be hand-authored in `parts.yml`.
 */
const rails = (): PartRail[] => [
  { name: 'V+', pins: ['V+', 'V1', 'V2'] },
  { name: 'GND', pins: ['GND', 'G1'] }
]

describe('rails table edits (#706)', () => {
  it('adds an empty rail, and renames one', () => {
    expect(addRail([], 'VBAT')).toEqual([{ name: 'VBAT', pins: [] }])
    expect(addRail(undefined, '')).toEqual([{ name: '', pins: [] }])
    expect(renameRail(rails(), 0, 'VCC')[0].name).toBe('VCC')
  })

  it('adds and removes a pin on a rail', () => {
    expect(toggleRailPin(rails(), 0, 'V3')[0].pins).toEqual(['V+', 'V1', 'V2', 'V3'])
    expect(toggleRailPin(rails(), 0, 'V1')[0].pins).toEqual(['V+', 'V2'])
  })

  it('moves a pin between rails rather than letting it sit on both', () => {
    // Two rails sharing a pin is ONE net described twice — the netlist would merge
    // them anyway, so the table must not be able to express the contradiction.
    const next = toggleRailPin(rails(), 1, 'V1')
    expect(next[1].pins).toContain('V1')
    expect(next[0].pins).not.toContain('V1')
  })

  it('removing a pin does not disturb the other rails', () => {
    // The move logic only reaches across when ADDING; a removal is local.
    const next = toggleRailPin(rails(), 0, 'V1')
    expect(next[1].pins).toEqual(['GND', 'G1'])
  })

  it('deletes a rail by index', () => {
    const next = removeRail(rails(), 0)
    expect(next).toHaveLength(1)
    expect(next[0].name).toBe('GND')
  })

  it('reports which rail already claims a pin', () => {
    expect(railHolding(rails(), 'G1')?.name).toBe('GND')
    expect(railHolding(rails(), 'SDA')).toBeUndefined()
    expect(railHolding(undefined, 'SDA')).toBeUndefined()
  })

  it('never mutates the array it was given', () => {
    // The editor's patch/undo is value-based, so an in-place edit would corrupt
    // the history rather than just look untidy.
    const before = rails()
    const snapshot = JSON.stringify(before)
    toggleRailPin(before, 0, 'V9')
    renameRail(before, 0, 'X')
    removeRail(before, 0)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('keeps a half-built rail while editing, and normalise prunes it on save', () => {
    // Deleting a one-pin rail as you build it would be worse than carrying it —
    // but a one-pin rail is not a net, so it must not survive to the file.
    const part = {
      id: 'demo',
      name: 'Demo',
      rails: [{ name: 'V+', pins: ['V+'] }]
    } as unknown as PartDefinition
    expect(part.rails).toHaveLength(1)
    expect(normalisePart(part).rails ?? []).toHaveLength(0)
  })

  it('survives a normalise once it is a real net', () => {
    const part = { id: 'demo', name: 'Demo', rails: rails() } as unknown as PartDefinition
    const out = normalisePart(part)
    expect(out.rails?.[0]).toEqual({ name: 'V+', pins: ['V+', 'V1', 'V2'] })
    expect(out.rails).toHaveLength(2)
  })
})
