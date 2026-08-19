import { describe, it, expect } from 'vitest'
import {
  pinLabelScales,
  PIN_LABEL_MIN_SCALE,
  PIN_LABEL_REF_PX,
  type LabelledPin
} from '../src/renderer/src/components/pin-label-scale'

/**
 * The rule that decides how big a pin's annotation is drawn (#778).
 *
 * The bug it fixes: label size came from the tightest gap between any two pins
 * measured in the part's own fit-to-footprint body box, so the SAME 2.54mm header
 * was typeset differently depending on the outline it sat on — and one tight
 * cluster (a QWIIC's 1.2mm contacts) shrank every label on the board.
 *
 * These tests pin the properties, not the arithmetic: the same real-world pitch
 * must come out the same size whatever the outline, a genuinely dense edge must
 * shrink far enough that its number boxes still clear each other, and the Servo
 * 2040 — the board the shrink exists for — must keep shrinking.
 */

/** A row of `n` labelled pins on one edge, spaced `pitchPx` apart along it. */
const row = (edge: LabelledPin['edge'], n: number, pitchPx: number, from = 0): LabelledPin[] =>
  Array.from({ length: n }, (_, i) => ({ edge, along: from + i * pitchPx }))

/** The drawn width of a full-size pin number box (`boxedPinLabel`'s `B`). */
const NUM_BOX_PX = 14

/** How a part is drawn: its real width in mm fitted into a body box `boxW` px
 *  wide, then scaled by `bodyScale` on the canvas. */
const drawn = (mm: number, boxW: number, widthMm: number): number => (mm * boxW) / widthMm

describe('pinLabelScales — identical hardware reads the same size', () => {
  // The reported pair. Both boards carry an ordinary 2.54mm header; they are very
  // different sizes, so they fit into very different body boxes, and the canvas
  // draws each at the scale that puts them both at the same px-per-mm.
  const CANVAS_PX_PER_MM = 9.27

  const board = (widthMm: number, boxW: number, pitchMm = 2.54): number => {
    const pxPerMm = boxW / widthMm
    return pinLabelScales({
      pins: row('left', 8, drawn(pitchMm, boxW, widthMm)),
      nominalPitchPx: pitchMm * pxPerMm,
      bodyScale: CANVAS_PX_PER_MM / pxPerMm
    }).left
  }

  it('gives a 18mm board and a 41mm board the same label size at the same canvas scale', () => {
    // Tiny 2350 (18mm wide, body box 167px) vs Modulino LED Matrix (41mm, box 300px).
    expect(board(18, 167)).toBeCloseTo(board(41, 300), 6)
  })

  it('is unchanged by the body box the part happens to be fitted into', () => {
    // The SAME part, fitted into three different boxes and scaled back to the same
    // canvas px-per-mm. Body-box pixels are an accident of the fit; millimetres
    // are not.
    expect(board(41, 190)).toBeCloseTo(board(41, 300), 6)
    expect(board(41, 380)).toBeCloseTo(board(41, 300), 6)
  })

  it('does depend on the canvas scale — a board drawn smaller gets smaller type', () => {
    const big = pinLabelScales({ pins: row('left', 8, 12), bodyScale: 1 }).left
    const small = pinLabelScales({ pins: row('left', 8, 12), bodyScale: 0.5 }).left
    expect(small).toBeLessThan(big)
  })
})

describe('pinLabelScales — a dense edge shrinks enough not to overlap', () => {
  const boxesClear = (gapPx: number, scale: number): boolean => NUM_BOX_PX * scale <= gapPx

  it('keeps adjacent number boxes clear of each other at every pitch it can', () => {
    // Shrinking must actually solve the collision it is there for. It can, right
    // down to the floored box width (14 × 0.25 = 3.5px); below that the type is
    // unreadable anyway and the view's zoom is the answer instead.
    for (let gap = NUM_BOX_PX * PIN_LABEL_MIN_SCALE; gap <= 40; gap += 0.5) {
      const scale = pinLabelScales({ pins: row('top', 12, gap) }).top
      expect(boxesClear(gap, scale), `${gap}px pitch → scale ${scale}`).toBe(true)
    }
  })

  it('shrinks in proportion to how tight the row is, until it hits the floor', () => {
    const at = (gap: number): number => pinLabelScales({ pins: row('top', 12, gap) }).top
    expect(at(9)).toBeCloseTo(0.5, 6)
    expect(at(9)).toBeLessThan(at(12))
    expect(at(12)).toBeLessThan(at(18))
    expect(at(1)).toBe(PIN_LABEL_MIN_SCALE)
  })

  it('never grows past full size — the annotation is fixed-pixel artwork', () => {
    expect(pinLabelScales({ pins: row('top', 12, 200) }).top).toBe(1)
    expect(pinLabelScales({ pins: row('top', 2, 30), bodyScale: 8 }).top).toBe(1)
  })

  it('is exactly 1 at the reference gap', () => {
    expect(pinLabelScales({ pins: row('left', 4, PIN_LABEL_REF_PX) }).left).toBe(1)
  })
})

describe('pinLabelScales — only the labels that share an edge compete', () => {
  it('leaves a comfortable edge alone when a DIFFERENT edge is crowded', () => {
    // The Tiny 2350: 2.19mm castellations down both sides, and a QWIIC whose four
    // contacts sit 1.2mm apart and label off the bottom edge. Those four used to
    // shrink the castellations too, which is why its pin names came out smaller
    // than a Modulino's identical hardware.
    const pxPerMm = 9.27
    const scales = pinLabelScales({
      pins: [
        ...row('left', 8, 2.19 * pxPerMm),
        ...row('right', 8, 2.19 * pxPerMm),
        ...row('bottom', 4, 1.2 * pxPerMm)
      ],
      nominalPitchPx: 2.54 * pxPerMm
    })
    expect(scales.left).toBe(1)
    expect(scales.right).toBe(1)
    expect(scales.bottom).toBeLessThan(1) // the QWIIC row still shrinks — it must
    expect(NUM_BOX_PX * scales.bottom).toBeLessThanOrEqual(1.2 * pxPerMm)
  })

  it('falls back to the part’s nominal pitch on an edge with a single label', () => {
    // One lone label has no neighbour to measure against, but the part's real pitch
    // still says how big the board is drawn — a lone label on a board squeezed into
    // a thumbnail must not stay full size while every other label shrinks.
    const lone = pinLabelScales({ pins: [{ edge: 'top', along: 40 }], nominalPitchPx: 9 })
    expect(lone.top).toBeCloseTo(0.5, 6)
  })

  it('leaves an edge with no labels at all alone, whatever the part’s pitch', () => {
    // Nothing is drawn there, so there is nothing to size — and it must not pick up
    // the nominal-pitch fallback meant for a lone label.
    expect(pinLabelScales({ pins: row('left', 4, 9), nominalPitchPx: 4 }).right).toBe(1)
  })

  it('leaves a legacy part with no mm dimensions at full size rather than guessing', () => {
    // nominalPitchPx = 0 ⇒ there is no physical pitch to size from.
    expect(pinLabelScales({ pins: [{ edge: 'top', along: 0 }], nominalPitchPx: 0 }).top).toBe(1)
    expect(pinLabelScales({ pins: [] }).top).toBe(1)
  })

  it('ignores annotations stacked at the same point — shrinking cannot separate them', () => {
    // Two pins that label to the same spot on an edge overlap whatever the scale;
    // treating their 0 gap as the pitch would drive the whole edge to the floor.
    const stacked = pinLabelScales({
      pins: [...row('bottom', 6, 20), { edge: 'bottom', along: 20 }]
    })
    expect(stacked.bottom).toBe(1)
  })
})

describe('pinLabelScales — the Servo 2040 still shrinks (the regression case)', () => {
  // 62.2mm wide, 92 pads, drawn ~6.11 px/mm on the breadboard. Its labelled pins
  // run ~2.15mm apart along the top edge and ~2.32mm along the bottom (the V+/GND
  // rows of each servo trio are hidden, so they are not in this list).
  const PX_PER_MM = 6.11
  const scales = pinLabelScales({
    pins: [...row('top', 18, 2.15 * PX_PER_MM), ...row('bottom', 17, 2.32 * PX_PER_MM)],
    nominalPitchPx: 2.54 * PX_PER_MM
  })

  it('shrinks the dense servo rows well below full size', () => {
    expect(scales.top).toBeLessThan(0.8)
    expect(scales.bottom).toBeLessThan(0.85)
  })

  it('shrinks them far enough that the number boxes clear each other', () => {
    expect(NUM_BOX_PX * scales.top).toBeLessThan(2.15 * PX_PER_MM)
    expect(NUM_BOX_PX * scales.bottom).toBeLessThan(2.32 * PX_PER_MM)
  })

  it('shrinks harder still in the board graph, where the same board is drawn at 3px/mm', () => {
    const graph = pinLabelScales({
      pins: [...row('top', 18, 2.15 * 3.05), ...row('bottom', 17, 2.32 * 3.05)],
      nominalPitchPx: 2.54 * 3.05
    })
    expect(graph.top).toBeLessThan(scales.top)
    expect(NUM_BOX_PX * graph.top).toBeLessThan(2.15 * 3.05)
  })
})
