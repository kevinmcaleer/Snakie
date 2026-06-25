import { describe, it, expect } from 'vitest'
import {
  boardBox,
  layoutPads,
  ledPoint,
  nodeSide,
  padForToken,
  padLabelPlacement,
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

describe('padLabelPlacement (#109 side-correct labels)', () => {
  it('puts a LEFT-edge pad label to its LEFT, anchored at its end', () => {
    const p = padLabelPlacement('left')
    expect(p.dx).toBeLessThan(0) // label sits left of the pad (outside the board)
    expect(p.anchor).toBe('end')
  })

  it('puts a RIGHT-edge pad label to its RIGHT, anchored at its start', () => {
    const p = padLabelPlacement('right')
    expect(p.dx).toBeGreaterThan(0) // label sits right of the pad (outside)
    expect(p.anchor).toBe('start')
  })

  it('mirrors left/right so neither overlaps the board', () => {
    // Same gap magnitude on each side, opposite signs → symmetric outside labels.
    expect(padLabelPlacement('left').dx).toBe(-padLabelPlacement('right').dx)
  })

  it('centres top/bottom labels above/below the pad', () => {
    const top = padLabelPlacement('top')
    const bottom = padLabelPlacement('bottom')
    expect(top.anchor).toBe('middle')
    expect(bottom.anchor).toBe('middle')
    expect(top.dx).toBe(0)
    expect(bottom.dx).toBe(0)
    expect(top.dy).toBeLessThan(0) // above
    expect(bottom.dy).toBeGreaterThan(0) // below
  })

  it('centres the led label below its dot', () => {
    const p = padLabelPlacement('led')
    expect(p.anchor).toBe('middle')
    expect(p.dx).toBe(0)
    expect(p.dy).toBeGreaterThan(0)
  })

  it('honours a custom horizontal gap', () => {
    expect(padLabelPlacement('left', 13).dx).toBe(-13)
    expect(padLabelPlacement('right', 13).dx).toBe(13)
  })
})

describe('nodeSide (#148 mirrored right-column cards)', () => {
  it('docks right-edge and bottom-edge connections on the RIGHT', () => {
    expect(nodeSide('right')).toBe('right')
    expect(nodeSide('bottom')).toBe('right')
  })

  it('keeps left / top / led connections on the LEFT', () => {
    expect(nodeSide('left')).toBe('left')
    expect(nodeSide('top')).toBe('left')
    expect(nodeSide('led')).toBe('left')
  })
})

describe('vertical-edge layout (#109 Tiny boards)', () => {
  // A Tiny-style board: pins down the LEFT and RIGHT long edges (no top/bottom),
  // i.e. the pins run VERTICALLY as the issue requires.
  const tiny: BoardDefinition = {
    id: 'tiny',
    name: 'Tiny',
    mcu: 'RP2040',
    pcbColor: '#3a1d52',
    aspect: 0.78,
    headers: [
      { edge: 'left', pins: [{ label: '5V', type: 'vcc' }, { gpio: 0, label: 'GP0' }] },
      { edge: 'right', pins: [{ gpio: 7, label: 'GP7' }, { gpio: 26, label: 'A3' }] }
    ]
  }

  it('lays every pad on a vertical edge (left or right, never top/bottom)', () => {
    const box = boardBox(tiny.aspect, GEOM)
    const pads = layoutPads(tiny, box)
    expect(pads).toHaveLength(4)
    expect(pads.every((p) => p.edge === 'left' || p.edge === 'right')).toBe(true)
    // Left column at the left x, right column at the right x.
    const left = pads.filter((p) => p.edge === 'left')
    const right = pads.filter((p) => p.edge === 'right')
    expect(left.every((p) => p.x === box.x + 12)).toBe(true)
    expect(right.every((p) => p.x === box.x + box.w - 12)).toBe(true)
    // …and each runs top→bottom (vertical pins).
    expect(left[0].y).toBeLessThan(left[1].y)
    expect(right[0].y).toBeLessThan(right[1].y)
  })
})
