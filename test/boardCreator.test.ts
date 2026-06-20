import { describe, it, expect } from 'vitest'
import {
  blankBoard,
  fromJson,
  idCollides,
  ledLabelOptions,
  normaliseBoard,
  sanitiseBoardId,
  toJson,
  validateBoard
} from '../src/renderer/src/components/board-creator.util'
import type { BoardDefinition } from '../src/shared/board'

describe('sanitiseBoardId', () => {
  it('lower-cases and keeps [a-z0-9-_]', () => {
    expect(sanitiseBoardId('My Board')).toBe('my-board')
    expect(sanitiseBoardId('Pico_2 W')).toBe('pico_2-w')
    expect(sanitiseBoardId('a__b')).toBe('a__b')
  })

  it('collapses runs of disallowed chars to a single dash', () => {
    expect(sanitiseBoardId('a   b!!!c')).toBe('a-b-c')
    expect(sanitiseBoardId('a/../b')).toBe('a-b') // no path traversal
  })

  it('trims leading/trailing dashes and handles empties', () => {
    expect(sanitiseBoardId('  hi  ')).toBe('hi')
    expect(sanitiseBoardId('!!!')).toBe('')
    expect(sanitiseBoardId('')).toBe('')
  })
})

describe('blankBoard', () => {
  it('produces a valid, drawable starter board', () => {
    const b = blankBoard()
    expect(validateBoard(b)).toBeNull()
    expect(b.headers.length).toBe(2)
    expect(b.headers.map((h) => h.edge)).toEqual(['left', 'right'])
    expect((b.features ?? []).some((f) => f.kind === 'mcu')).toBe(true)
  })

  it('is unchanged by normalisation (already canonical)', () => {
    const b = blankBoard()
    expect(normaliseBoard(b)).toEqual(b)
  })
})

describe('normaliseBoard', () => {
  it("defaults each pad's type to 'gpio' when absent", () => {
    const def: BoardDefinition = {
      id: 'x',
      name: 'X',
      mcu: '',
      pcbColor: '#000000',
      aspect: 0.5,
      headers: [{ edge: 'left', pins: [{ label: 'GP0', gpio: 0 }] }]
    }
    const out = normaliseBoard(def)
    expect(out.headers[0].pins[0].type).toBe('gpio')
  })

  it('drops headers with no (valid) pads', () => {
    const def: BoardDefinition = {
      id: 'x',
      name: 'X',
      mcu: '',
      pcbColor: '#000000',
      aspect: 0.5,
      headers: [
        { edge: 'left', pins: [] },
        { edge: 'right', pins: [{ label: '   ' }] }, // blank label → dropped
        { edge: 'top', pins: [{ label: '5V', type: 'vcc' }] }
      ]
    }
    const out = normaliseBoard(def)
    expect(out.headers).toHaveLength(1)
    expect(out.headers[0].edge).toBe('top')
    expect(out.headers[0].pins[0].type).toBe('vcc')
  })

  it('strips the numeric gpio from non-GPIO pads', () => {
    const def: BoardDefinition = {
      id: 'x',
      name: 'X',
      mcu: '',
      pcbColor: '#000000',
      aspect: 0.5,
      // A power pad that wrongly carries a gpio number — normalise drops it.
      headers: [{ edge: 'left', pins: [{ label: 'GND', type: 'gnd', gpio: 99 }] }]
    }
    const out = normaliseBoard(def)
    expect(out.headers[0].pins[0].gpio).toBeUndefined()
  })

  it('keeps an image data URL verbatim and drops empty optional fields', () => {
    const img = 'data:image/png;base64,AAAA'
    const def: BoardDefinition = {
      id: 'x',
      name: 'X',
      mcu: '',
      pcbColor: '#000000',
      aspect: 0.5,
      ledLabel: '   ',
      features: [],
      image: img,
      headers: [{ edge: 'left', pins: [{ label: 'GP0', gpio: 0 }] }]
    }
    const out = normaliseBoard(def)
    expect(out.image).toBe(img)
    expect('ledLabel' in out).toBe(false) // blank → dropped
    expect('features' in out).toBe(false) // empty → dropped
  })

  it('defaults a bad aspect/pcbColor/edge', () => {
    const def = {
      id: 'x',
      name: '',
      mcu: '',
      pcbColor: '',
      aspect: 0,
      headers: [{ edge: 'sideways', pins: [{ label: 'A' }] }]
    } as unknown as BoardDefinition
    const out = normaliseBoard(def)
    expect(out.aspect).toBeGreaterThan(0)
    expect(out.pcbColor).toMatch(/^#/)
    expect(out.name).toBe('Untitled Board')
    expect(out.headers[0].edge).toBe('left')
  })
})

describe('validateBoard', () => {
  it('rejects a board with no id-able name', () => {
    const b = { ...blankBoard(), id: '!!!', name: '!!!' }
    expect(validateBoard(b)).toMatch(/name/i)
  })

  it('rejects a board with no pads', () => {
    const b = { ...blankBoard(), headers: [] }
    expect(validateBoard(b)).toMatch(/pad/i)
  })

  it('accepts a sensible board', () => {
    expect(validateBoard(blankBoard())).toBeNull()
  })
})

describe('round-trip (JSON is the editable source of truth)', () => {
  it('def → JSON → parse equals the normalised def', () => {
    const def = blankBoard()
    const restored = fromJson(toJson(def))
    expect(restored).toEqual(normaliseBoard(def))
  })

  it('survives a full editing-shaped board through JSON unchanged', () => {
    const def: BoardDefinition = {
      id: 'fancy',
      name: 'Fancy Board',
      mcu: 'ESP32',
      pcbColor: '#1b2733',
      aspect: 0.46,
      ledLabel: 'LED',
      image: 'data:image/svg+xml,<svg/>',
      features: [{ label: 'WROOM', kind: 'wifi', x: 0.1, y: 0.1, w: 0.5, h: 0.2 }],
      headers: [
        {
          edge: 'left',
          pins: [
            { gpio: 0, label: 'IO0', name: 'GPIO 0', type: 'gpio' },
            { label: 'GND', name: 'Ground', type: 'gnd' },
            { label: '3V3', name: '3.3V', type: 'vcc' }
          ]
        }
      ]
    }
    const normalised = normaliseBoard(def)
    // Two round-trips are idempotent — the canonical form is stable.
    expect(fromJson(toJson(def))).toEqual(normalised)
    expect(fromJson(toJson(normalised))).toEqual(normalised)
  })
})

describe('ledLabelOptions', () => {
  it('lists distinct pad labels in order', () => {
    expect(ledLabelOptions(blankBoard())).toEqual(['GP0', 'GP1', 'GND', '3V3', 'GP2', 'GP3'])
  })
})

describe('idCollides', () => {
  const existing: BoardDefinition[] = [{ ...blankBoard(), id: 'taken', name: 'Taken' }]

  it('flags a new board reusing an existing user id', () => {
    const b = { ...blankBoard(), id: 'taken', name: 'Taken' }
    expect(idCollides(b, existing, null)).toBe(true)
  })

  it('flags a new board reusing a built-in id', () => {
    const b = { ...blankBoard(), id: 'pico2w', name: 'Pico 2 W' }
    expect(idCollides(b, [], null)).toBe(true)
  })

  it('does not flag re-saving the board you opened', () => {
    const b = { ...blankBoard(), id: 'taken', name: 'Taken' }
    expect(idCollides(b, existing, 'taken')).toBe(false)
  })

  it('does not flag a brand-new unique id', () => {
    const b = { ...blankBoard(), id: 'brand-new', name: 'Brand New' }
    expect(idCollides(b, existing, null)).toBe(false)
  })
})
