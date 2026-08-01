import { describe, it, expect } from 'vitest'
import {
  connectorContacts,
  resolvedContacts,
  resolvedPins,
  allResolvedPins
} from '../src/renderer/src/components/part-editor.util'
import { flattenPartPins } from '../src/shared/netlist'
import type { PartDefinition } from '../src/shared/part'

/**
 * Resolving connector contacts to board positions (#672) — the step everything
 * else in epic #671 stands on.
 */
const board = (over: Record<string, unknown> = {}): PartDefinition =>
  ({
    id: 'p',
    name: 'P',
    dimensions: { width: 50, height: 25 }, // deliberately NON-square
    headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', x: 0.1, y: 0.1 }] }],
    connectors: [
      {
        kind: 'dupont',
        x: 0.5,
        y: 0.5,
        pins: [
          { name: 'SIG', type: 'io' },
          { name: 'V+', type: 'pwr' },
          { name: 'GND', type: 'gnd' }
        ],
        ...over
      }
    ]
  }) as unknown as PartDefinition

describe('connectorContacts (#672)', () => {
  it('gives one position per contact, spread across the housing', () => {
    const pts = connectorContacts(board(), board().connectors![0])
    expect(pts).toHaveLength(3)
    expect(pts[0].x).toBeLessThan(pts[1].x)
    expect(pts[1].x).toBeLessThan(pts[2].x)
  })

  it('centres the spread on the housing', () => {
    const pts = connectorContacts(board(), board().connectors![0])
    expect(pts[1].x).toBeCloseTo(0.5, 6) // middle contact sits on the body centre
    expect(pts.every((p) => p.y === 0.5)).toBe(true)
  })

  it('rotates about the housing centre', () => {
    const part = board({ rotation: 90 })
    const pts = connectorContacts(part, part.connectors![0])
    // Turned 90°, the row becomes a column: x constant, y spread.
    expect(pts.every((p) => Math.abs(p.x - 0.5) < 1e-9)).toBe(true)
    expect(pts[0].y).toBeLessThan(pts[2].y)
  })

  it('normalises PER AXIS, so a non-square board does not shear the housing', () => {
    // 50x25mm: the same mm offset is twice as large a fraction of the height.
    const flat = board()
    const turned = board({ rotation: 90 })
    const dx = Math.abs(connectorContacts(flat, flat.connectors![0])[0].x - 0.5)
    const dy = Math.abs(connectorContacts(turned, turned.connectors![0])[0].y - 0.5)
    expect(dy / dx).toBeCloseTo(50 / 25, 5)
  })

  it('keeps contacts on the board', () => {
    const part = board({ x: 0.99, y: 0.99 })
    for (const p of connectorContacts(part, part.connectors![0])) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(1)
      expect(p.y).toBeLessThanOrEqual(1)
    }
  })

  it('still resolves a part with no dimensions', () => {
    const part = { ...board(), dimensions: undefined } as unknown as PartDefinition
    const pts = connectorContacts(part, part.connectors![0])
    expect(pts).toHaveLength(3)
    expect(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('resolvedContacts / allResolvedPins (#672)', () => {
  it('addresses each contact back to its connector', () => {
    const rc = resolvedContacts(board())
    expect(rc.map((c) => [c.ci, c.cpi])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2]
    ])
    expect(rc.map((c) => c.pin.name)).toEqual(['SIG', 'V+', 'GND'])
  })

  it('leaves resolvedPins UNCHANGED — its flat index is a stored identity', () => {
    // Appending contacts to that list would silently redefine every pin ref.
    const rp = resolvedPins(board())
    expect(rp).toHaveLength(1)
    expect(rp[0].pin.name).toBe('GP0')
  })

  it('allResolvedPins offers both, header pins first', () => {
    const all = allResolvedPins(board())
    expect(all.map((p) => p.pin.name)).toEqual(['GP0', 'SIG', 'V+', 'GND'])
  })

  it('is empty for a part with no connectors', () => {
    const bare = { ...board(), connectors: undefined } as unknown as PartDefinition
    expect(resolvedContacts(bare)).toEqual([])
  })
})

/**
 * `flattenPartPins` (shared/netlist) assigns each pin its endpoint `#index` by
 * POSITION: headers in order, then connectors. `allResolvedPins` is the positional
 * twin of that list — so if the two ever disagree, endpoint `#3` starts pointing at
 * a different pin's coordinates than the one it names. Pin them together.
 */
describe('allResolvedPins agrees with the endpoint order (#672)', () => {
  const rich = {
    id: 'p',
    name: 'P',
    dimensions: { width: 40, height: 20 },
    headers: [
      { edge: 'left', pins: [{ name: 'A1', type: 'io', x: 0.1, y: 0.2 }, { name: 'A2', type: 'io', x: 0.1, y: 0.4 }] },
      { edge: 'right', pins: [{ name: 'B1', type: 'io', x: 0.9, y: 0.2 }] }
    ],
    connectors: [
      { kind: 'qwiic', x: 0.5, y: 0.3, pins: [{ name: 'GND', type: 'gnd' }, { name: 'VCC', type: 'pwr' }] },
      { kind: 'dupont', x: 0.5, y: 0.7, pins: [{ name: 'SIG', type: 'io' }] }
    ]
  } as unknown as PartDefinition

  it('lists the same pins, in the same order', () => {
    expect(allResolvedPins(rich).map((p) => p.pin.name)).toEqual(
      flattenPartPins(rich).map((p) => p.name)
    )
  })

  it('so a flat index addresses the same pin in both', () => {
    const flat = flattenPartPins(rich)
    const resolved = allResolvedPins(rich)
    flat.forEach((pin, i) => expect(resolved[i].pin).toBe(pin))
  })
})
