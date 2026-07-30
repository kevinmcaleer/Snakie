import { describe, expect, it } from 'vitest'
import { FIT_PAD, fitTransform, stageViewArea } from '../src/renderer/src/components/WiringCanvas'

/**
 * Zoom-to-fit framing. The property that matters is that the content actually
 * FILLS the area — the complaint was a fit that left a wide margin all round.
 */
const AREA = { areaX: 0, areaW: 1180, areaH: 720 }

/** Where a world point lands on screen under a transform. */
const project = (
  t: { tx: number; ty: number; scale: number },
  x: number,
  y: number
): { x: number; y: number } => ({ x: t.tx + x * t.scale, y: t.ty + y * t.scale })

describe('fitTransform', () => {
  it('fills the constraining axis to within the pad', () => {
    // A wide, short box: width constrains, so the fitted width should reach the
    // area's width minus the pad on each side.
    const b = { minX: 100, minY: 200, maxX: 700, maxY: 400 }
    const t = fitTransform(b, AREA)
    const left = project(t, b.minX, b.minY).x
    const right = project(t, b.maxX, b.maxY).x
    expect(right - left).toBeCloseTo(AREA.areaW - FIT_PAD * 2, 5)
  })

  it('centres the content in both axes', () => {
    const b = { minX: 0, minY: 0, maxX: 400, maxY: 300 }
    const t = fitTransform(b, AREA)
    const c = project(t, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2)
    expect(c.x).toBeCloseTo(AREA.areaW / 2, 5)
    expect(c.y).toBeCloseTo(AREA.areaH / 2, 5)
  })

  it('is tighter than the old 60-unit padding', () => {
    const b = { minX: 0, minY: 0, maxX: 600, maxY: 400 }
    expect(fitTransform(b, AREA).scale).toBeGreaterThan(
      fitTransform(b, { ...AREA, pad: 60 }).scale
    )
  })

  it('keeps the margin CONSTANT on screen as the zoom changes', () => {
    // The pad is a screen margin, not a world one: added to the content before
    // scaling it would be multiplied by the zoom, so a small build (zoomed in)
    // would get a far wider margin than a large one.
    // Both wide enough to be width-constrained AND below the 3x cap, so the
    // comparison is about the pad rather than about clamping.
    const small = fitTransform({ minX: 0, minY: 0, maxX: 600, maxY: 200 }, AREA)
    const large = fitTransform({ minX: 0, minY: 0, maxX: 1000, maxY: 300 }, AREA)
    const marginOf = (t: { tx: number; scale: number }, minX: number): number =>
      t.tx + minX * t.scale
    // Same left margin at both zooms, and it equals the pad.
    expect(marginOf(small, 0)).toBeCloseTo(marginOf(large, 0), 5)
    expect(marginOf(small, 0)).toBeCloseTo(FIT_PAD, 5)
  })

  it('offsets by the browser inset so content clears the panel', () => {
    const b = { minX: 0, minY: 0, maxX: 400, maxY: 300 }
    const t = fitTransform(b, { areaX: 300, areaW: 880, viewH: 720 })
    // Centred within the REMAINING area, not the whole viewBox.
    expect(project(t, 200, 150).x).toBeCloseTo(300 + 880 / 2, 5)
  })

  it('does not blow one small part up absurdly', () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, AREA)
    expect(t.scale).toBe(3)
  })

  it('stops shrinking a huge build past legibility', () => {
    const t = fitTransform({ minX: 0, minY: 0, maxX: 100000, maxY: 100000 }, AREA)
    expect(t.scale).toBe(0.35)
  })

  it('survives a zero-size bound rather than dividing by zero', () => {
    const t = fitTransform({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, AREA)
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(Number.isFinite(t.tx)).toBe(true)
    expect(Number.isFinite(t.ty)).toBe(true)
  })
})

describe('stageViewArea (fit the STAGE, not the letterboxed viewBox)', () => {
  it('is the plain viewBox when the stage matches its aspect', () => {
    const a = stageViewArea(1180, 720)
    expect(a).toEqual({ x: 0, y: 0, w: 1180, h: 720 })
  })

  it('is the viewBox before the stage has been measured', () => {
    expect(stageViewArea(0, 0)).toEqual({ x: 0, y: 0, w: 1180, h: 720 })
  })

  it('gains vertical span on a TALLER pane, centred', () => {
    // 1180x1440 is twice as tall as the viewBox aspect: width binds, so the
    // visible viewBox-space region is 1180 x 1440 units, centred.
    const a = stageViewArea(1180, 1440)
    expect(a.w).toBeCloseTo(1180, 5)
    expect(a.h).toBeCloseTo(1440, 5)
    expect(a.y).toBeCloseTo((720 - 1440) / 2, 5) // extends equally above and below
  })

  it('gains horizontal span on a WIDER pane, centred', () => {
    const a = stageViewArea(2360, 720)
    expect(a.h).toBeCloseTo(720, 5)
    expect(a.w).toBeCloseTo(2360, 5)
    expect(a.x).toBeCloseTo((1180 - 2360) / 2, 5)
  })

  it('lets a tall pane zoom in further than the viewBox alone would', () => {
    // The point of the whole exercise: a square-ish build in a tall pane should
    // use the extra height rather than leaving it as letterbox.
    const b = { minX: 0, minY: 0, maxX: 400, maxY: 400 }
    const viewBoxOnly = fitTransform(b, { areaX: 0, areaW: 1180, areaH: 720 })
    const tall = stageViewArea(1180, 1440)
    const wholeStage = fitTransform(b, { areaX: tall.x, areaW: tall.w, areaY: tall.y, areaH: tall.h })
    expect(wholeStage.scale).toBeGreaterThan(viewBoxOnly.scale)
  })
})
