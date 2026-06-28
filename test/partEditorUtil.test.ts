import { describe, it, expect } from 'vitest'
import {
  addComponentOnTop,
  blankPart,
  boardPartFor,
  boardsFromLibraries,
  captureStyle,
  derivePinPosition,
  driverDeviceDirs,
  driverInstallMethod,
  insertPolygonPoint,
  isBoardPart,
  placedPartsNeedingDrivers,
  nearestCenter,
  nearestPolygonEdge,
  nextComponentZ,
  normalisePart,
  orderedComponents,
  pasteStyle,
  resolveBoards,
  partToBoardDefinition,
  pinNames,
  pinPositions,
  pinShapeOf,
  reorderComponent,
  resolvedPins,
  sanitisePartId,
  schematicSymbolLayout,
  snapToGrid,
  validatePart,
  withPinPositions,
  withShapesFromFeatures
} from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

describe('sanitisePartId', () => {
  it('lower-cases and keeps [a-z0-9-_], no path traversal', () => {
    expect(sanitisePartId('VL53L0X ToF')).toBe('vl53l0x-tof')
    expect(sanitisePartId('a/../b')).toBe('a-b')
    expect(sanitisePartId('!!!')).toBe('')
  })
})

describe('blankPart / validatePart', () => {
  it('produces a valid starter part', () => {
    const p = blankPart()
    expect(validatePart(p)).toBeNull()
    expect(p.headers.reduce((n, h) => n + h.pins.length, 0)).toBeGreaterThan(0)
  })

  it('rejects an empty part and a bad version', () => {
    expect(validatePart({ id: '', name: '', headers: [] })).toMatch(/name/i)
    expect(validatePart({ id: 'x', name: 'X', headers: [] })).toMatch(/pin/i)
    expect(
      validatePart({ ...blankPart(), version: 'not-a-version' })
    ).toMatch(/version/i)
  })

  it('flags a name that sanitises to an empty id (reachable on the raw part)', () => {
    // A name entirely outside [a-z0-9-_] would silently become "my-part" after
    // normalise; validatePart on the RAW part catches it first.
    expect(validatePart({ id: '!!!', name: '日本語', headers: blankPart().headers })).toMatch(/name/i)
  })

  it('counts only non-empty pin names (safe on un-normalised input)', () => {
    const part = {
      id: 'x',
      name: 'X',
      headers: [{ edge: 'left' as const, pins: [{ name: '  ', type: 'io' as const }] }]
    }
    expect(validatePart(part)).toMatch(/pin/i)
  })
})

describe('normalisePart', () => {
  it('defaults pin type to io, drops gpio/caps on non-io pins, prunes empties', () => {
    const messy: PartDefinition = {
      id: 'My Thing!!',
      name: '  Spaces  ',
      tags: ['', ' a ', 'b'],
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'GND', type: 'gnd', gpio: 9, capabilities: ['adc'] },
            { name: '', type: 'io' }, // dropped (no name)
            { name: 'GP2', type: 'io', gpio: 2, capabilities: ['pwm', 'pwm', 'digital'] }
          ]
        },
        { edge: 'right', pins: [] } // dropped (no pins)
      ]
    }
    const n = normalisePart(messy)
    expect(n.id).toBe('my-thing')
    expect(n.name).toBe('Spaces')
    expect(n.tags).toEqual(['a', 'b'])
    expect(n.headers).toHaveLength(1)
    const [gnd, gp2] = n.headers[0].pins
    expect(gnd.gpio).toBeUndefined()
    expect(gnd.capabilities).toBeUndefined()
    // Capabilities are deduped and kept in canonical order (digital before pwm).
    expect(gp2.capabilities).toEqual(['digital', 'pwm'])
  })

  it('is idempotent', () => {
    const once = normalisePart(blankPart())
    expect(normalisePart(once)).toEqual(once)
  })
})

describe('snapToGrid', () => {
  it('snaps to the physical pin-spacing grid', () => {
    // 40mm tall, 2.54mm pitch → ~16 steps. 0.5 snaps to nearest 1/16.
    const v = snapToGrid(0.51, 2.54, 40)
    const steps = Math.round(40 / 2.54)
    expect(v).toBeCloseTo(Math.round(0.51 * steps) / steps, 5)
  })
  it('clamps and falls back to a 20-step grid without a size', () => {
    expect(snapToGrid(1.5, 2.54)).toBe(1)
    expect(snapToGrid(-1, 2.54)).toBe(0)
    expect(snapToGrid(0.11, 2.54)).toBeCloseTo(0.1, 5)
  })
})

describe('partToBoardDefinition', () => {
  it('maps pins to pads with the right pad types', () => {
    const part = normalisePart({
      id: 'b',
      name: 'B',
      pcbColor: '#123456',
      aspect: 0.5,
      headers: [
        {
          edge: 'left',
          pins: [
            { name: '3V3', type: 'pwr' },
            { name: 'GND', type: 'gnd' },
            { name: 'GP0', type: 'io', gpio: 0 },
            { name: 'RUN', type: 'other' }
          ]
        }
      ]
    })
    const board = partToBoardDefinition(part)
    const types = board.headers[0].pins.map((p) => p.type)
    expect(types).toEqual(['vcc', 'gnd', 'gpio', 'other'])
    expect(board.headers[0].pins[2].gpio).toBe(0)
    expect(board.pcbColor).toBe('#123456')
  })

  it('derives aspect from dimensions when absent and renders buttons as chips', () => {
    const part = normalisePart({
      id: 'b',
      name: 'B',
      dimensions: { width: 20, height: 40 },
      buttons: [{ label: 'BOOT', x: 0.5, y: 0.5 }],
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 1 }] }]
    })
    const board = partToBoardDefinition(part)
    expect(board.aspect).toBeCloseTo(0.5, 5)
    expect((board.features ?? []).some((f) => f.label === 'BOOT')).toBe(true)
  })

  it('uses imageData as the drawable image source', () => {
    const part = normalisePart({
      id: 'b',
      name: 'B',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 1 }] }]
    })
    part.imageData = 'data:image/png;base64,ZZZ'
    expect(partToBoardDefinition(part).image).toBe('data:image/png;base64,ZZZ')
  })

  it('carries the board pin NUMBER (distinct from gpio) onto the pad', () => {
    const part = normalisePart({
      id: 'b',
      name: 'B',
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'GP0', type: 'io', gpio: 0, number: 1 },
            { name: 'GND', type: 'gnd', number: 3 }
          ]
        }
      ]
    })
    const pads = partToBoardDefinition(part).headers[0].pins
    expect(pads[0].number).toBe(1) // physical pin 1, not gpio 0
    expect(pads[0].gpio).toBe(0)
    expect(pads[1].number).toBe(3) // a non-io pin still carries its pin number
  })

  it('carries a freely-placed pin position (x/y) onto the pad', () => {
    const part = normalisePart({
      id: 'b',
      name: 'B',
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'GP0', type: 'io', gpio: 0, x: 0.08, y: 0.2 },
            { name: 'VBUS', type: 'pwr', x: 0.92, y: 0.04 }
          ]
        }
      ]
    })
    const pads = partToBoardDefinition(part).headers[0].pins
    expect(pads[0].x).toBeCloseTo(0.08, 5)
    expect(pads[1].x).toBeCloseTo(0.92, 5) // a right-column pin kept its real x
  })
})

describe('free-placement positions', () => {
  it('derivePinPosition places pads just inside the named edge', () => {
    expect(derivePinPosition('left', 0, 1)).toEqual({ x: 0.06, y: 0.5 })
    expect(derivePinPosition('right', 0, 1)).toEqual({ x: 0.94, y: 0.5 })
    expect(derivePinPosition('top', 0, 1).y).toBe(0.06)
    expect(derivePinPosition('bottom', 0, 1).y).toBe(0.94)
  })

  it('normalisePart migrates legacy edge-based pins to absolute x/y', () => {
    const legacy: PartDefinition = {
      id: 'legacy',
      name: 'Legacy',
      headers: [
        { edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }, { name: 'B', type: 'io', gpio: 1 }] }
      ]
    }
    const n = normalisePart(legacy)
    for (const pin of n.headers[0].pins) {
      expect(typeof pin.x).toBe('number')
      expect(typeof pin.y).toBe('number')
      expect(pin.x).toBeGreaterThanOrEqual(0)
      expect(pin.x).toBeLessThanOrEqual(1)
    }
    // Idempotent: positions are preserved on a second pass.
    expect(normalisePart(n)).toEqual(n)
  })

  it('keeps explicit positions over the edge fallback', () => {
    const part: PartDefinition = {
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0, x: 0.42, y: 0.42 }] }]
    }
    const n = normalisePart(part)
    expect(n.headers[0].pins[0].x).toBe(0.42)
    expect(n.headers[0].pins[0].y).toBe(0.42)
  })

  it('withPinPositions gives every pin an x/y and preserves runtime fields', () => {
    const seeded = withPinPositions({
      id: 'p',
      name: 'P',
      imageData: 'data:image/png;base64,ZZZ',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }, { name: 'B', type: 'io', gpio: 1, x: 0.3, y: 0.3 }] }]
    })
    expect(seeded.imageData).toBe('data:image/png;base64,ZZZ') // not stripped (unlike normalisePart)
    expect(typeof seeded.headers[0].pins[0].x).toBe('number')
    expect(seeded.headers[0].pins[1]).toMatchObject({ x: 0.3, y: 0.3 }) // explicit kept
  })

  it('resolvedPins flattens pins with resolved positions + indices', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [
        { edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] },
        { edge: 'right', pins: [{ name: 'B', type: 'io', gpio: 1, x: 0.9, y: 0.2 }] }
      ]
    })
    const rp = resolvedPins(part)
    expect(rp).toHaveLength(2)
    expect(rp[0]).toMatchObject({ hi: 0, pi: 0 })
    expect(rp[1]).toMatchObject({ hi: 1, pi: 0, x: 0.9, y: 0.2 })
  })

  it('normalises shape, imageLayer and labels', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      shape: { kind: 'polygon', cornerRadius: 9 },
      imageLayer: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, opacity: 2 },
      labels: [{ text: 'Hi', x: 0.5, y: 0.5 }, { text: '', x: 0, y: 0 }],
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }]
    })
    expect(part.shape).toEqual({ kind: 'polygon', cornerRadius: 0.5 }) // clamped
    expect(part.imageLayer?.opacity).toBe(1) // clamped to 0..1
    expect(part.labels).toHaveLength(1) // empty-text label dropped
  })
})

describe('pin + component shapes', () => {
  it('pinShapeOf honours the legacy castellated flag and the explicit shape', () => {
    expect(pinShapeOf({ name: 'A', type: 'io' })).toBe('square')
    expect(pinShapeOf({ name: 'A', type: 'io', castellated: true })).toBe('castellated')
    expect(pinShapeOf({ name: 'A', type: 'io', castellated: true, shape: 'round' })).toBe('round')
    expect(pinShapeOf({ name: 'A', type: 'io', shape: 'header' })).toBe('header')
  })

  it('withShapesFromFeatures migrates legacy feature chips to component shapes', () => {
    const migrated = withShapesFromFeatures({
      id: 'p',
      name: 'P',
      features: [{ label: 'RP2350', kind: 'mcu', x: 0.3, y: 0.4, w: 0.4, h: 0.2 }],
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }]
    })
    expect(migrated.features).toBeUndefined()
    expect(migrated.shapes).toHaveLength(1)
    expect(migrated.shapes?.[0]).toMatchObject({ kind: 'rect', label: 'RP2350', w: 0.4, h: 0.2 })
  })

  it('normalisePart cleans component shapes (kind, colours, geometry defaults)', () => {
    const n = normalisePart({
      id: 'p',
      name: 'P',
      shapes: [
        { kind: 'rect', x: 0.1, y: 0.1 }, // missing w/h → defaulted
        { kind: 'circle', x: 0.5, y: 0.5 }, // missing r → defaulted
        // @ts-expect-error bad kind coerced to rect
        { kind: 'banana', x: 0.2, y: 0.2 }
      ],
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }]
    })
    expect(n.shapes?.[0]).toMatchObject({ kind: 'rect' })
    expect(n.shapes?.[0].w).toBeGreaterThan(0)
    expect(n.shapes?.[0].fill).toMatch(/^#/)
    expect(n.shapes?.[1].r).toBeGreaterThan(0)
    expect(n.shapes?.[2].kind).toBe('rect')
  })
})

describe('pinNames', () => {
  it('lists unique pin names in order', () => {
    const part = normalisePart({
      id: 'b',
      name: 'B',
      headers: [
        { edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }, { name: 'B', type: 'io', gpio: 1 }] },
        { edge: 'right', pins: [{ name: 'A', type: 'io', gpio: 2 }] }
      ]
    })
    expect(pinNames(part)).toEqual(['A', 'B'])
  })
})

describe('pinPositions + schematicSymbolLayout share the flattened endpoint index', () => {
  // A part whose explicit schematic.pins REORDER the pins (order ≠ header order),
  // and place them on chosen sides. The wiring endpoint index must stay the
  // flattened-header order in BOTH the breadboard (pinPositions) and schematic
  // (schematicSymbolLayout) views, so a wire never re-targets on toggle.
  const part: PartDefinition = {
    id: 'p',
    name: 'P',
    headers: [
      { edge: 'left', pins: [{ name: 'VCC', type: 'pwr' }, { name: 'GND', type: 'gnd' }] },
      { edge: 'right', pins: [{ name: 'SDA', type: 'io' }, { name: 'SCL', type: 'io' }] }
    ],
    schematic: {
      pins: [
        { pin: 'SCL', side: 'right', order: 0 },
        { pin: 'SDA', side: 'right', order: 1 },
        { pin: 'GND', side: 'bottom', order: 2 },
        { pin: 'VCC', side: 'top', order: 3 }
      ]
    }
  }

  it('pinPositions is in flattened header order', () => {
    expect(pinPositions(part, { x: 0, y: 0, w: 100, h: 100 }).map((p) => p.name)).toEqual(['VCC', 'GND', 'SDA', 'SCL'])
  })

  it('schematicSymbolLayout terminals carry the flattened index regardless of schematic order', () => {
    const lay = schematicSymbolLayout(part)
    // terminals[i].flatIndex === i, and the pin at each index matches the header flatten.
    expect(lay.terminals.map((t) => t.flatIndex)).toEqual([0, 1, 2, 3])
    expect(lay.terminals.map((t) => t.pin.name)).toEqual(['VCC', 'GND', 'SDA', 'SCL'])
  })

  it('places each terminal on the side from schematic.pins (not the header edge)', () => {
    const lay = schematicSymbolLayout(part)
    const side = (name: string): string => lay.terminals.find((t) => t.pin.name === name)!.side
    expect(side('VCC')).toBe('top')
    expect(side('GND')).toBe('bottom')
    expect(side('SCL')).toBe('right')
  })
})

describe('schematicSymbolLayout balances free signals across left/right', () => {
  // Five signals all on a single header edge: the schematic should split them
  // evenly L/R (so the symbol never grows into one tall column) and give each side
  // enough height that adjacent pins don't overlap.
  const part: PartDefinition = {
    id: 'p3',
    name: 'P3',
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'A', type: 'io' },
          { name: 'B', type: 'io' },
          { name: 'C', type: 'io' },
          { name: 'D', type: 'io' },
          { name: 'E', type: 'io' }
        ]
      }
    ]
  }

  it('splits same-edge signals into balanced left/right columns', () => {
    const lay = schematicSymbolLayout(part)
    const left = lay.terminals.filter((t) => t.side === 'left').map((t) => t.pin.name)
    const right = lay.terminals.filter((t) => t.side === 'right').map((t) => t.pin.name)
    expect(left).toEqual(['A', 'B', 'C'])
    expect(right).toEqual(['D', 'E'])
    expect(Math.abs(left.length - right.length)).toBeLessThanOrEqual(1)
  })

  it('spaces stub ends at least ~24px apart so labels never overlap', () => {
    const lay = schematicSymbolLayout(part)
    const ys = lay.terminals
      .filter((t) => t.side === 'left')
      .map((t) => t.outer.y)
      .sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(24)
  })

  it('keeps an author-pinned signal on its chosen side (explicit mapping wins)', () => {
    const pinned: PartDefinition = {
      ...part,
      schematic: { pins: [{ pin: 'A', side: 'right', order: 0 }] }
    }
    const lay = schematicSymbolLayout(pinned)
    expect(lay.terminals.find((t) => t.pin.name === 'A')!.side).toBe('right')
  })
})

describe('schematicSymbolLayout collapses rails (one GND / one power rail)', () => {
  const part: PartDefinition = {
    id: 'p2',
    name: 'P2',
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'V1', label: '3V3', type: 'pwr' },
          { name: 'V2', label: '3V3', type: 'pwr' },
          { name: 'G1', type: 'gnd' },
          { name: 'G2', type: 'gnd' },
          { name: 'SIG', type: 'io' }
        ]
      }
    ]
  }

  it('keeps every pad flatIndex but merges same-rail pads to one drawn terminal', () => {
    const lay = schematicSymbolLayout(part)
    expect(lay.terminals).toHaveLength(5) // all pads kept (for wiring)
    const gnd = lay.terminals.filter((t) => t.pin.type === 'gnd')
    expect(gnd.filter((t) => t.primary)).toHaveLength(1) // one GND drawn
    expect(gnd[0].outer).toEqual(gnd[1].outer) // …both grounds share its anchor
    const pwr = lay.terminals.filter((t) => t.pin.type === 'pwr')
    expect(pwr.filter((t) => t.primary)).toHaveLength(1) // both 3V3 → one terminal
    expect(pwr[0].outer).toEqual(pwr[1].outer)
  })

  it('puts the merged power rail on top and ground at the bottom', () => {
    const lay = schematicSymbolLayout(part)
    expect(lay.terminals.filter((t) => t.pin.type === 'pwr').every((t) => t.side === 'top')).toBe(true)
    expect(lay.terminals.filter((t) => t.pin.type === 'gnd').every((t) => t.side === 'bottom')).toBe(true)
  })
})

describe('orderedComponents (unified z-order for stacking)', () => {
  const part: PartDefinition = {
    id: 'p',
    name: 'P',
    headers: [],
    shapes: [{ kind: 'rect', x: 0, y: 0 }, { kind: 'rect', x: 0.1, y: 0.1 }],
    labels: [{ text: 'A', x: 0.2, y: 0.2 }]
  }

  it('defaults to shapes below labels (today\'s look) when no z is set', () => {
    const ord = orderedComponents(part)
    expect(ord.map((c) => `${c.kind}${c.index}`)).toEqual(['shape0', 'shape1', 'label0'])
  })

  it('sorts by explicit z (a shape can sit above a label)', () => {
    const withZ: PartDefinition = {
      ...part,
      shapes: [{ kind: 'rect', x: 0, y: 0, z: 9 }, { kind: 'rect', x: 0.1, y: 0.1, z: 0 }],
      labels: [{ text: 'A', x: 0.2, y: 0.2, z: 5 }]
    }
    // ascending z: shape1(0) < label0(5) < shape0(9)
    expect(orderedComponents(withZ).map((c) => `${c.kind}${c.index}`)).toEqual(['shape1', 'label0', 'shape0'])
  })

  it('nextComponentZ lands a new component on top of the stack', () => {
    expect(nextComponentZ(part)).toBe(3) // 3 items at default z 0,1,2 → next is 3
    expect(nextComponentZ({ id: 'e', name: 'E', headers: [] })).toBe(0)
  })

  it('addComponentOnTop puts a new shape strictly above a legacy no-z label', () => {
    // The regression the review caught: a pre-append z ties the label's drifting
    // fallback, sinking the new shape under it. addComponentOnTop renormalises.
    const legacy: PartDefinition = {
      id: 'p',
      name: 'P',
      headers: [],
      shapes: [{ kind: 'rect', x: 0, y: 0 }],
      labels: [{ text: 'L', x: 0.5, y: 0.5 }]
    }
    const next = addComponentOnTop(legacy, 'shape', { kind: 'circle', x: 0.3, y: 0.3, r: 0.05 })
    const ord = orderedComponents(next)
    expect(ord[ord.length - 1]).toEqual({ kind: 'shape', index: 1, z: 2 }) // new shape on top
    expect(next.shapes).toHaveLength(2)
    expect(next.labels).toHaveLength(1)
  })

  it('addComponentOnTop puts a new label above everything', () => {
    const next = addComponentOnTop(part, 'label', { text: 'New', x: 0.9, y: 0.9 })
    const ord = orderedComponents(next)
    expect(ord[ord.length - 1]).toEqual({ kind: 'label', index: 1, z: 3 })
  })

  it('reorderComponent moves an item one step and renormalises every z', () => {
    // Move shape0 (bottom) one step forward; only z changes, indices are preserved.
    const moved = reorderComponent(part, { kind: 'shape', index: 0 }, 1)
    expect(orderedComponents(moved).map((c) => `${c.kind}${c.index}`)).toEqual(['shape1', 'shape0', 'label0'])
    expect(moved.shapes?.every((s) => typeof s.z === 'number')).toBe(true)
    // The list still has the same items (no splice / identity loss).
    expect(moved.shapes).toHaveLength(2)
    expect(moved.labels).toHaveLength(1)
  })

  it('reorderComponent is a no-op past the ends', () => {
    expect(reorderComponent(part, { kind: 'label', index: 0 }, 1)).toBe(part) // already top
    expect(reorderComponent(part, { kind: 'shape', index: 0 }, -1)).toBe(part) // already bottom
  })
})

describe('polygon edge insertion helpers', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ]

  it('nearestPolygonEdge finds the edge a point is closest to', () => {
    // A point near the middle of the TOP edge (index 0: v0→v1).
    expect(nearestPolygonEdge(square, 0.5, 0.02, 100, 100).index).toBe(0)
    // Near the middle of the RIGHT edge (index 1: v1→v2).
    expect(nearestPolygonEdge(square, 0.98, 0.5, 100, 100).index).toBe(1)
    // Distance is in viewBox units (here ~2px from the top edge).
    expect(nearestPolygonEdge(square, 0.5, 0.02, 100, 100).dist).toBeCloseTo(2, 0)
  })

  it('insertPolygonPoint inserts right after the edge index', () => {
    const next = insertPolygonPoint(square, 0, 0.5, 0)
    expect(next).toHaveLength(5)
    expect(next[1]).toEqual({ x: 0.5, y: 0 }) // inserted between v0 and v1
    expect(next[2]).toEqual({ x: 1, y: 0 }) // original v1 shifted along
  })
})

describe('boardsFromLibraries / resolveBoards (#52 boards from parts)', () => {
  const ioPin = (n: number): { name: string; type: 'io'; gpio: number } => ({ name: `GP${n}`, type: 'io', gpio: n })
  const mcuPart = (id: string, name: string, pins: { name: string; type: 'io'; gpio: number }[]): PartDefinition => ({
    id,
    name,
    family: 'Microcontroller',
    headers: [{ edge: 'left', pins }]
  })

  it('isBoardPart only accepts the Microcontroller family', () => {
    expect(isBoardPart({ family: 'Microcontroller' })).toBe(true)
    expect(isBoardPart({ family: 'microcontroller' })).toBe(true)
    expect(isBoardPart({ family: 'Breakout' })).toBe(false)
    expect(isBoardPart({})).toBe(false)
  })

  it('includes only Microcontroller parts, projected to boards', () => {
    const libs = [
      {
        parts: [
          mcuPart('pico', 'Pico', [ioPin(0), ioPin(1)]),
          { id: 'vl', name: 'Sensor', family: 'Sensor', headers: [{ edge: 'left' as const, pins: [{ name: 'SDA', type: 'io' as const }] }] }
        ]
      }
    ]
    const boards = boardsFromLibraries(libs)
    expect(boards.map((b) => b.id)).toEqual(['pico'])
    expect(boards[0].headers.flatMap((h) => h.pins)).toHaveLength(2)
  })

  it('dedupes same id keeping the most complete (most pads) board', () => {
    const libs = [
      { parts: [mcuPart('pico', 'Pico', [ioPin(0)])] }, // 1 pad (a stub)
      { parts: [mcuPart('pico', 'Pico', [ioPin(0), ioPin(1), ioPin(2)])] } // 3 pads (full)
    ]
    const boards = boardsFromLibraries(libs)
    expect(boards).toHaveLength(1)
    expect(boards[0].headers.flatMap((h) => h.pins)).toHaveLength(3)
  })

  it('resolveBoards merges library + user boards and falls back to built-ins when empty', () => {
    expect(resolveBoards([], []).length).toBeGreaterThan(0) // built-in fallback
    const libs = [{ parts: [mcuPart('pico', 'Pico', [ioPin(0)])] }]
    const ids = resolveBoards(libs, [
      { id: 'custom', name: 'Custom', mcu: 'X', pcbColor: '#000', aspect: 0.5, headers: [] }
    ]).map((b) => b.id)
    expect(ids).toContain('pico')
    expect(ids).toContain('custom')
  })
})

describe('boardPartFor (issue-1: board → source part)', () => {
  const ioPin = (n: number): { name: string; type: 'io'; gpio: number } => ({ name: `GP${n}`, type: 'io', gpio: n })
  const mcuPart = (id: string, pins: { name: string; type: 'io'; gpio: number }[]): PartDefinition => ({
    id,
    name: id,
    family: 'Microcontroller',
    headers: [{ edge: 'left', pins }]
  })

  it('returns the source microcontroller part for a board id', () => {
    const libs = [{ parts: [mcuPart('pico2w', [ioPin(0), ioPin(1)])] }]
    const part = boardPartFor(libs, 'pico2w')
    expect(part?.id).toBe('pico2w')
    expect(boardPartFor(libs, 'nope')).toBeNull()
  })

  it('prefers the most complete part when an id repeats', () => {
    const libs = [
      { parts: [mcuPart('pico2w', [ioPin(0)])] },
      { parts: [mcuPart('pico2w', [ioPin(0), ioPin(1), ioPin(2)])] }
    ]
    expect((boardPartFor(libs, 'pico2w')?.headers[0].pins ?? [])).toHaveLength(3)
  })

  it('keeps board pad index aligned with the part flat-index (wiring identity)', () => {
    // The board view draws the part via partLifelikePins (flat index) while wiring
    // enumerates the converted board; both must agree so `board.<pin>#<index>` holds.
    const part = mcuPart('pico2w', [ioPin(0), ioPin(1), ioPin(2)])
    const boardPads = partToBoardDefinition(part).headers.flatMap((h) => h.pins)
    const partPins = pinPositions(part, { x: 0, y: 0, w: 100, h: 100 })
    // Same pins, same order: pad N (label) == part pin N (name).
    expect(boardPads.map((p) => p.label)).toEqual(partPins.map((p) => p.name))
    expect(partPins.map((p) => p.index)).toEqual([0, 1, 2])
  })
})

describe('nearestCenter (#169 alignment guides)', () => {
  it('snaps to a centre within the px threshold (nearest wins)', () => {
    // dim=400px: 0.50 vs centres 0.49 (4px away) and 0.70 (84px) → 0.49 within 6px.
    expect(nearestCenter([0.49, 0.7], 0.5, 400, 6)).toBe(0.49)
  })
  it('returns null when nothing is within the threshold', () => {
    expect(nearestCenter([0.7, 0.9], 0.5, 400, 6)).toBeNull()
    expect(nearestCenter([], 0.5, 400, 6)).toBeNull()
  })
  it('picks the closest of several near centres', () => {
    // 0.50: 0.515 is 6px (excluded, not < 6), 0.49 is 4px → 0.49.
    expect(nearestCenter([0.515, 0.49], 0.5, 400, 6)).toBe(0.49)
  })
})

describe('captureStyle / pasteStyle (per-type style clipboard)', () => {
  const stylePart = (): PartDefinition => ({
    id: 'p',
    name: 'P',
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'A', type: 'io', gpio: 0, capabilities: ['digital', 'pwm'], shape: 'round' },
          { name: 'B', type: 'pwr' }
        ]
      }
    ],
    shapes: [
      {
        kind: 'rect',
        x: 0.1,
        y: 0.1,
        w: 0.2,
        h: 0.2,
        fill: '#111111',
        stroke: '#222222',
        strokeWidth: 2,
        cornerRadius: 5,
        labelFontSize: 14,
        labelBold: true,
        labelColor: '#ff0000'
      },
      { kind: 'circle', x: 0.5, y: 0.5, r: 0.1 }
    ],
    labels: [
      { text: 'hi', x: 0.3, y: 0.3, fontSize: 18, bold: true, color: '#00ff00', align: 'left' },
      { text: 'bye', x: 0.6, y: 0.6 }
    ],
    mountingHoles: [
      { x: 0.2, y: 0.2, diameter: 3 },
      { x: 0.8, y: 0.8, diameter: 2 }
    ]
  })

  it('copies a shape style (paint + label*) onto another shape, keeping geometry', () => {
    const part = stylePart()
    const clip = captureStyle(part, { kind: 'shape', index: 0 })
    expect(clip?.kind).toBe('shape')
    const next = pasteStyle(part, { kind: 'shape', index: 1 }, clip)
    const s = next.shapes![1]
    expect(s.fill).toBe('#111111')
    expect(s.stroke).toBe('#222222')
    expect(s.strokeWidth).toBe(2)
    expect(s.cornerRadius).toBe(5)
    expect(s.labelFontSize).toBe(14)
    expect(s.labelBold).toBe(true)
    expect(s.labelColor).toBe('#ff0000')
    // Geometry of the target is untouched (style only).
    expect(s.kind).toBe('circle')
    expect(s.r).toBe(0.1)
    expect(s.x).toBe(0.5)
  })

  it('paste OVERWRITES (clears) a target field the source did not set', () => {
    const part = stylePart()
    const plain = captureStyle(part, { kind: 'shape', index: 1 }) // the unstyled circle
    const cleared = pasteStyle(part, { kind: 'shape', index: 0 }, plain)
    expect(cleared.shapes![0].labelBold).toBeUndefined()
    expect(cleared.shapes![0].fill).toBeUndefined()
    expect(cleared.shapes![0].cornerRadius).toBeUndefined()
  })

  it('copies a label text style, preserving the label text + position', () => {
    const part = stylePart()
    const clip = captureStyle(part, { kind: 'label', index: 0 })
    const next = pasteStyle(part, { kind: 'label', index: 1 }, clip)
    const l = next.labels![1]
    expect(l.fontSize).toBe(18)
    expect(l.bold).toBe(true)
    expect(l.color).toBe('#00ff00')
    expect(l.align).toBe('left')
    expect(l.text).toBe('bye')
    expect(l.x).toBe(0.6)
  })

  it('copies a pin style (shape + type + capabilities), cloning the caps array', () => {
    const part = stylePart()
    const clip = captureStyle(part, { kind: 'pin', hi: 0, pi: 0 })
    expect(clip).toEqual({ kind: 'pin', style: { shape: 'round', type: 'io', capabilities: ['digital', 'pwm'] } })
    const next = pasteStyle(part, { kind: 'pin', hi: 0, pi: 1 }, clip)
    const p = next.headers[0].pins[1]
    expect(p.shape).toBe('round')
    expect(p.type).toBe('io')
    expect(p.capabilities).toEqual(['digital', 'pwm'])
    expect(p.name).toBe('B') // identity preserved
    // The pasted caps are a fresh array, not aliased to the source pin's.
    expect(p.capabilities).not.toBe(part.headers[0].pins[0].capabilities)
  })

  it('resolves the legacy castellated flag on copy, and re-derives it on paste', () => {
    const legacy: PartDefinition = {
      id: 'l',
      name: 'L',
      headers: [{ edge: 'left', pins: [{ name: 'C', type: 'io', castellated: true }] }]
    }
    expect(captureStyle(legacy, { kind: 'pin', hi: 0, pi: 0 })).toEqual({
      kind: 'pin',
      style: { shape: 'castellated', type: 'io', capabilities: undefined }
    })
    const part = stylePart()
    const next = pasteStyle(part, { kind: 'pin', hi: 0, pi: 1 }, {
      kind: 'pin',
      style: { shape: 'castellated', type: 'gnd', capabilities: undefined }
    })
    expect(next.headers[0].pins[1].shape).toBe('castellated')
    expect(next.headers[0].pins[1].castellated).toBe(true)
    expect(next.headers[0].pins[1].capabilities).toBeUndefined()
  })

  it('copies a mounting hole diameter, preserving its position', () => {
    const part = stylePart()
    const clip = captureStyle(part, { kind: 'hole', index: 0 })
    const next = pasteStyle(part, { kind: 'hole', index: 1 }, clip)
    expect(next.mountingHoles![1].diameter).toBe(3)
    expect(next.mountingHoles![1].x).toBe(0.8)
  })

  it('is a no-op (same reference) for a mismatched kind, empty clipboard, or missing element', () => {
    const part = stylePart()
    const shapeClip = captureStyle(part, { kind: 'shape', index: 0 })
    expect(pasteStyle(part, { kind: 'hole', index: 0 }, shapeClip)).toBe(part)
    expect(pasteStyle(part, { kind: 'shape', index: 0 }, null)).toBe(part)
    expect(pasteStyle(part, { kind: 'shape', index: 9 }, shapeClip)).toBe(part)
  })

  it('returns null when capturing a missing element', () => {
    const part = stylePart()
    expect(captureStyle(part, { kind: 'shape', index: 9 })).toBeNull()
    expect(captureStyle(part, { kind: 'label', index: 9 })).toBeNull()
    expect(captureStyle(part, { kind: 'pin', hi: 0, pi: 9 })).toBeNull()
    expect(captureStyle(part, { kind: 'hole', index: 9 })).toBeNull()
  })

  it('does not mutate the input part', () => {
    const part = stylePart()
    const before = JSON.stringify(part)
    const clip = captureStyle(part, { kind: 'shape', index: 0 })
    pasteStyle(part, { kind: 'shape', index: 1 }, clip)
    expect(JSON.stringify(part)).toBe(before)
  })
})

// --- Driver install (#184) --------------------------------------------------

describe('driverInstallMethod', () => {
  it('treats github:/gitlab:/pypi: specs + bare package names as mip', () => {
    expect(driverInstallMethod('github:kevinmcaleer/vl53l0x')).toBe('mip')
    expect(driverInstallMethod('gitlab:org/repo')).toBe('mip')
    expect(driverInstallMethod('pypi:micropython-bme280')).toBe('mip')
    expect(driverInstallMethod('bme280')).toBe('mip') // micropython-lib package
    expect(driverInstallMethod('  umqtt.simple  ')).toBe('mip') // dotted pkg, trimmed
  })

  it('treats URLs + bundled/relative files as copy', () => {
    expect(driverInstallMethod('https://example.com/vl53l0x.py')).toBe('copy')
    expect(driverInstallMethod('http://host/x.mpy')).toBe('copy')
    expect(driverInstallMethod('vl53l0x.py')).toBe('copy') // bundled with the part
    expect(driverInstallMethod('drivers/vl53l0x.py')).toBe('copy') // relative path
  })
})

describe('driverDeviceDirs', () => {
  it('returns each ancestor folder shallowest→deepest', () => {
    expect(driverDeviceDirs('lib/drivers/x.py')).toEqual(['lib', 'lib/drivers'])
    expect(driverDeviceDirs('lib/x.py')).toEqual(['lib'])
    expect(driverDeviceDirs('/lib/x.py')).toEqual(['/lib'])
    expect(driverDeviceDirs('/lib/drivers/x.py')).toEqual(['/lib', '/lib/drivers'])
  })

  it('returns no folders for a root-level file', () => {
    expect(driverDeviceDirs('x.py')).toEqual([])
    expect(driverDeviceDirs('/x.py')).toEqual([])
    expect(driverDeviceDirs('')).toEqual([])
  })

  it('normalises back-slashes', () => {
    expect(driverDeviceDirs('lib\\drivers\\x.py')).toEqual(['lib', 'lib/drivers'])
  })
})

describe('placedPartsNeedingDrivers', () => {
  const tof: PartDefinition = {
    id: 'vl53l0x',
    name: 'VL53L0X ToF',
    headers: [{ edge: 'bottom', pins: [{ name: 'SDA', type: 'io' }] }],
    drivers: [{ source: 'vl53l0x.py', target: 'lib/vl53l0x.py', label: 'VL53L0X driver' }]
  }
  const plain: PartDefinition = {
    id: 'led',
    name: 'LED',
    headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io' }] }]
  }
  const libraries = [{ id: 'snakie-basics', parts: [tof, plain] }]

  it('returns the placed parts whose part declares drivers', () => {
    const robot = {
      parts: [
        { id: 'tof1', lib: 'snakie-basics', part: 'vl53l0x' },
        { id: 'led1', lib: 'snakie-basics', part: 'led' }
      ]
    }
    const needs = placedPartsNeedingDrivers(robot, libraries)
    expect(needs).toHaveLength(1)
    expect(needs[0]).toMatchObject({
      key: 'snakie-basics:vl53l0x',
      libraryId: 'snakie-basics',
      partId: 'vl53l0x',
      label: 'VL53L0X ToF'
    })
    expect(needs[0].drivers).toHaveLength(1)
  })

  it('dedupes the same part placed twice', () => {
    const robot = {
      parts: [
        { id: 'tof1', lib: 'snakie-basics', part: 'vl53l0x' },
        { id: 'tof2', lib: 'snakie-basics', part: 'vl53l0x' }
      ]
    }
    expect(placedPartsNeedingDrivers(robot, libraries)).toHaveLength(1)
  })

  it('skips unresolved parts and an empty/absent robot', () => {
    expect(
      placedPartsNeedingDrivers({ parts: [{ id: 'x', lib: 'missing', part: 'nope' }] }, libraries)
    ).toEqual([])
    expect(placedPartsNeedingDrivers(undefined, libraries)).toEqual([])
    expect(placedPartsNeedingDrivers({ parts: [] }, libraries)).toEqual([])
  })
})
