import { describe, it, expect } from 'vitest'
import { connectorSize } from '../src/renderer/src/components/part-body'
import { connectorDims } from '../src/renderer/src/components/part-editor.util'
import type { PartConnector } from '../src/shared/part'

/**
 * A connector housing's REAL footprint (#697).
 *
 * The cable plug used to be sized off the contact span with a 1.6× pad, which drew
 * a 3-way servo plug about 4 mm deep against a real 2.54 mm. On a PCA9685, whose
 * servo headers sit one 2.54 mm pitch apart, that made neighbouring plugs overlap.
 * Plug and socket now come from this one function, so they cannot disagree — these
 * pin the millimetres that both of them draw.
 */
const conn = (kind: PartConnector['kind'], pins: number, variant?: string): PartConnector =>
  ({
    kind,
    variant,
    x: 0.5,
    y: 0.5,
    pins: Array.from({ length: pins }, (_, i) => ({ name: `P${i}`, type: 'io' }))
  }) as unknown as PartConnector

/**
 * A realistic canvas scale. `connectorSize` floors its result in PIXELS (16 × 8)
 * so a small socket stays visible and clickable when zoomed out, which would
 * otherwise swamp the millimetres these tests are about.
 */
const PX_PER_MM = 10

/** A connector's footprint back in millimetres. */
const mm = (c: PartConnector): { w: number; h: number } => {
  const s = connectorSize(c, PX_PER_MM)
  return { w: s.w / PX_PER_MM, h: s.h / PX_PER_MM }
}

describe('connector footprint (#697)', () => {
  it('a servo/DuPont header is one 2.54 mm square cell per pin', () => {
    // 0.1" pitch, and the housing walls are half a pitch each side — so an n-way
    // plug is exactly n × 2.54 mm long and one pitch deep, which is why a strip of
    // them butts up without overlapping.
    const { pitch, sideMargin, depthMm } = connectorDims(conn('dupont', 3))
    expect(pitch).toBe(2.54)
    expect(sideMargin).toBe(2.54 / 2)
    expect(depthMm).toBe(2.54)

    const three = mm(conn('dupont', 3))
    expect(three.w).toBeCloseTo(3 * 2.54, 6) // 7.62 mm along the pins
    expect(three.h).toBeCloseTo(2.54, 6) //     2.54 mm across them
  })

  it('scales by pin count at the pitch, not by a padded span', () => {
    for (const n of [2, 3, 4, 6]) {
      expect(mm(conn('dupont', n)).w).toBeCloseTo(n * 2.54, 6)
    }
  })

  it('is never deeper than the pitch for a DuPont header', () => {
    // The overlap that started this: adjacent servo headers on a PCA9685 are one
    // pitch apart, so anything deeper than a pitch collides with its neighbour.
    const { h } = mm(conn('dupont', 3))
    expect(h).toBeLessThanOrEqual(2.54)
  })

  it('keeps the other kinds at their own real sizes', () => {
    // QWIIC (JST-SH, 1 mm) is small and Grove (2 mm) is chunky — the point of
    // measuring rather than padding a span is that these differ.
    //
    // The QWIIC figures were 4.5 × 2.9 here, which pinned a socket a third too
    // narrow (and used the connector's HEIGHT as its board depth). The real
    // SM04B-SRSS-TB is 6.0 × 4.25 — see the datasheet-accuracy block below.
    const qwiic = mm(conn('qwiic', 4))
    const grove = mm(conn('grove', 4))
    expect(qwiic.w).toBeCloseTo(6.0, 6)
    expect(qwiic.h).toBeCloseTo(4.25, 6)
    expect(grove.w).toBeCloseTo(11.8, 6)
    expect(grove.h).toBeCloseTo(6.6, 6)
    expect(grove.w).toBeGreaterThan(qwiic.w)
  })

  it('floors at a visible size when zoomed right out', () => {
    // Honest about the one case where the millimetres stop being honest: below
    // ~3 px/mm the depth hits its 8 px floor, so plugs at one pitch apart do
    // touch — but so do the sockets they sit on, because both come from here.
    const tiny = connectorSize(conn('dupont', 3), 1)
    expect(tiny.h).toBe(8)
    expect(tiny.w).toBe(16)
  })

  it('falls back to a fixed on-screen size without real dimensions', () => {
    // pxPerMm 0 means the part has no dimensions, so there is no millimetre to
    // scale to — the glyph draws at a legacy fixed size rather than vanishing.
    const s = connectorSize(conn('dupont', 3), 0)
    expect(s.w).toBeGreaterThan(0)
    expect(s.h).toBeGreaterThan(0)
  })
})

describe('QWIIC / JST-SH is datasheet-accurate (#697 follow-up)', () => {
  // JST SH series, side-entry SMT header SM04B-SRSS-TB — the QWIIC connector.
  // The datasheet's header table gives B = A + 3.0 for every circuit count,
  // where A is the contact span: so 4 circuits → A 3.0, B 6.0, body 4.25 deep,
  // 2.9 tall. The drawn socket was 4.5 × 2.9 — a third too narrow, and using
  // the connector's HEIGHT as its board depth.
  it('a 4-way QWIIC socket is the datasheet 6.0 × 4.25 mm', () => {
    const q = mm(conn('qwiic', 4))
    expect(q.w).toBeCloseTo(6.0, 6)
    expect(q.h).toBeCloseTo(4.25, 6)
  })

  it('matches the datasheet across circuit counts (B = A + 3.0)', () => {
    // Straight off JST's header table: 2 → 4.0, 4 → 6.0, 6 → 8.0, 10 → 12.0.
    for (const [pins, b] of [
      [2, 4.0],
      [4, 6.0],
      [6, 8.0],
      [10, 12.0]
    ] as const) {
      expect(mm(conn('qwiic', pins)).w, `${pins}-way`).toBeCloseTo(b, 6)
    }
  })

  it('a JST connector declared as the SH family measures the same', () => {
    // QWIIC is not a separate connector from JST-SH — it IS one, so the two
    // spellings must not drift apart again.
    const asJst = mm(conn('jst', 4, 'sh'))
    expect(asJst).toEqual(mm(conn('qwiic', 4)))
  })
})
