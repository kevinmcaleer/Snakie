import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { boxedPinLabel } from '../src/renderer/src/components/part-body'

/**
 * Boxed pin annotations (grey number box + label) read upright however the part
 * is turned (#746).
 *
 * The glyphs' final on-screen angle is `bodyRotation + appliedTransform`, so the
 * transform must be exactly `-bodyRotation` for the text to come out level. An
 * earlier attempt folded the TRANSFORM into a readable range instead of the NET
 * and regressed the 180° case, so these assert the net.
 */
const box = { x: 0, y: 0, w: 200, h: 100 }

const render = (bodyRotate: number): string =>
  renderToStaticMarkup(
    boxedPinLabel(box, 50, 50, 'left', '07', 'SDA', undefined, '#fff', bodyRotate)
  )

/** Every `rotate(a …)` angle the annotation applies to its texts. */
const applied = (svg: string): number[] =>
  [...svg.matchAll(/rotate\((-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]))

describe('boxedPinLabel counter-rotation', () => {
  it('applies nothing on an unrotated part', () => {
    expect(applied(render(0))).toHaveLength(0)
  })

  it('nets to level for EVERY quarter turn', () => {
    for (const body of [90, 180, 270]) {
      const angles = applied(render(body))
      expect(angles.length, `body ${body} counter-rotates its text`).toBeGreaterThan(0)
      for (const a of angles) {
        // net = body + applied, modulo a full turn, must be 0.
        expect((body + a) % 360, `body ${body}, applied ${a}`).toBe(0)
      }
    }
  })

  it('still swaps the anchor on a HALF turn, and only then', () => {
    // Rotating a text 180° about its anchor throws the glyphs across it; a
    // quarter turn does not, so only 180 compensates.
    expect(render(180)).toContain('text-anchor="start"') // 'left' pins anchor end, swapped
    expect(render(90)).toContain('text-anchor="end"')
    expect(render(0)).toContain('text-anchor="end"')
  })

  it('counter-rotates a top/bottom pin too, which the old 180-only rule skipped', () => {
    // A top/bottom annotation carries its own layout rotation as well, so its
    // net isn't simply 0 — but every text must now receive a counter, where
    // before these were skipped entirely and turned with the board. The exact
    // top/bottom LAYOUT at a quarter turn is still open on #746.
    const svg = renderToStaticMarkup(
      boxedPinLabel(box, 50, 50, 'top', '01', 'VIN', undefined, '#fff', 180)
    )
    expect(applied(svg).length).toBeGreaterThan(0)
  })
})
