import { describe, it, expect } from 'vitest'
import {
  boardBox,
  layoutPads,
  ledPoint,
  padForToken,
  type BoardBox
} from '../src/renderer/src/components/board-layout'
import type { BoardDefinition } from '../src/renderer/src/components/board-defs'

// A small board exercising every edge: a left header (mixed gpio + power), a
// right header, a top header and a bottom header, plus an onboard-LED token.
const DEF: BoardDefinition = {
  id: 'test',
  name: 'Test Board',
  mcu: 'TST',
  pcbColor: '#0f5a2e',
  aspect: 1,
  ledLabel: 'LED',
  headers: [
    {
      edge: 'left',
      pins: [{ gpio: 0, label: 'GP0' }, { label: 'GND', type: 'gnd' }, { gpio: 2, label: 'GP2' }]
    },
    { edge: 'right', pins: [{ gpio: 10, label: 'GP10' }, { gpio: 11, label: 'GP11' }] },
    { edge: 'top', pins: [{ gpio: 20, label: 'GP20' }] },
    { edge: 'bottom', pins: [{ gpio: 26, label: 'A0' }, { gpio: 27, label: 'A1' }] }
  ]
}

const GEOM = { cx: 380, cy: 240, maxW: 300, maxH: 380 }

describe('boardBox', () => {
  it('fits a square board within maxW and centres it on the geom', () => {
    const box = boardBox(1, GEOM)
    expect(box.w).toBe(300)
    expect(box.h).toBe(300) // aspect 1 → square, capped by maxW (300 < maxH 380)
    expect(box.x).toBe(GEOM.cx - 150)
    expect(box.y).toBe(GEOM.cy - 150)
  })

  it('shrinks a tall board so it never exceeds maxH', () => {
    // aspect 0.5 (w/h) at maxW 300 → h 600 > maxH 380, so it shrinks to maxH.
    const box = boardBox(0.5, GEOM)
    expect(box.h).toBe(380)
    expect(box.w).toBe(190) // 380 * 0.5
  })

  it('keeps a wide board within maxW', () => {
    const box = boardBox(2, GEOM)
    expect(box.w).toBe(300)
    expect(box.h).toBe(150)
  })
})

describe('layoutPads', () => {
  const box: BoardBox = boardBox(1, GEOM) // 300×300 at (230,90)
  const pads = layoutPads(DEF, box)

  it('lays out EVERY pad from every header (the full pinout)', () => {
    // 3 left + 2 right + 1 top + 2 bottom = 8 pads, in header/array order.
    expect(pads).toHaveLength(8)
    expect(pads.map((p) => p.pad.label)).toEqual([
      'GP0',
      'GND',
      'GP2',
      'GP10',
      'GP11',
      'GP20',
      'A0',
      'A1'
    ])
  })

  it('tags each pad with the edge of its header', () => {
    expect(pads.map((p) => p.edge)).toEqual([
      'left',
      'left',
      'left',
      'right',
      'right',
      'top',
      'bottom',
      'bottom'
    ])
  })

  it('places left/right pads on the correct x, spread down the edge', () => {
    const left = pads.filter((p) => p.edge === 'left')
    const right = pads.filter((p) => p.edge === 'right')
    // Left pads share an x near the left edge; right pads near the right edge.
    expect(left.every((p) => p.x === box.x + 12)).toBe(true)
    expect(right.every((p) => p.x === box.x + box.w - 12)).toBe(true)
    // Spread vertically in order, inset from the corners.
    expect(left[0].y).toBeLessThan(left[1].y)
    expect(left[1].y).toBeLessThan(left[2].y)
    expect(left[0].y).toBeGreaterThanOrEqual(box.y)
    expect(left[2].y).toBeLessThanOrEqual(box.y + box.h)
  })

  it('places top/bottom pads on the correct y, spread along the edge', () => {
    const top = pads.filter((p) => p.edge === 'top')
    const bottom = pads.filter((p) => p.edge === 'bottom')
    expect(top.every((p) => p.y === box.y + 12)).toBe(true)
    expect(bottom.every((p) => p.y === box.y + box.h - 12)).toBe(true)
    // A single top pad is centred on the edge.
    expect(top[0].x).toBeCloseTo(box.x + box.w / 2, 0)
    // Two bottom pads spread left→right in order.
    expect(bottom[0].x).toBeLessThan(bottom[1].x)
  })

  it('skips empty headers', () => {
    const def: BoardDefinition = { ...DEF, headers: [{ edge: 'left', pins: [] }] }
    expect(layoutPads(def, box)).toEqual([])
  })
})

describe('ledPoint', () => {
  it('sits inside the board near the top-right corner', () => {
    const box = boardBox(1, GEOM)
    const led = ledPoint(box)
    expect(led.x).toBe(box.x + box.w - 26)
    expect(led.y).toBe(box.y + 26)
  })
})

describe('padForToken', () => {
  const box = boardBox(1, GEOM)
  const pads = layoutPads(DEF, box)

  it('resolves a numeric token to its GPIO pad', () => {
    const p = padForToken('2', DEF, pads, box)
    expect(p.pad.label).toBe('GP2')
    expect(p.pad.gpio).toBe(2)
  })

  it('resolves a numeric token to a right-edge GPIO pad', () => {
    const p = padForToken('11', DEF, pads, box)
    expect(p.pad.label).toBe('GP11')
    expect(p.edge).toBe('right')
  })

  it('resolves an exact label token (case-insensitive)', () => {
    expect(padForToken('a0', DEF, pads, box).pad.label).toBe('A0')
    expect(padForToken('GP20', DEF, pads, box).pad.label).toBe('GP20')
  })

  it('treats GP12 ↔ 12 as equivalent for label matching', () => {
    // '0' is numeric → gpio match wins, but 'GP0' as a token also resolves.
    expect(padForToken('GP0', DEF, pads, box).pad.label).toBe('GP0')
  })

  it('resolves the board ledLabel token to the LED dot', () => {
    const p = padForToken('LED', DEF, pads, box)
    expect(p.edge).toBe('led')
    const led = ledPoint(box)
    expect(p.x).toBe(led.x)
    expect(p.y).toBe(led.y)
  })

  it('falls back to the nearest GPIO pad for an out-of-range numeric', () => {
    // No GPIO 99 → nearest is GP27 (the highest gpio present).
    const p = padForToken('99', DEF, pads, box)
    expect(p.pad.gpio).toBe(27)
  })

  it('falls back to the first pad for an unknown label', () => {
    const p = padForToken('NOPE', DEF, pads, box)
    expect(p.pad.label).toBe('GP0')
  })

  it('survives an empty board (no pads) with a placeholder', () => {
    const empty: BoardDefinition = { ...DEF, ledLabel: undefined, headers: [] }
    const p = padForToken('5', empty, [], box)
    expect(p.pad.label).toBe('5')
    expect(p.x).toBe(box.x)
    expect(p.y).toBe(box.y)
  })
})
