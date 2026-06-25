import { describe, it, expect } from 'vitest'
import {
  blankPart,
  normalisePart,
  partToBoardDefinition,
  pinNames,
  sanitisePartId,
  snapToGrid,
  validatePart
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
