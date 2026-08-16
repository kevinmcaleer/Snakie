import { describe, expect, it } from 'vitest'
import { readablePinLabel } from '../src/renderer/src/components/part-body'

/**
 * Pin labels stay the right way up on a ROTATED part.
 *
 * A label carries its own angle from the edge it sits on (0 for left/right,
 * ∓90 for top/bottom), and the body's rotation is countered so text doesn't
 * spin with the board. Composing those two used to land in the upside-down
 * half — a top-edge label on a part rotated 90° came out at −180° — which is
 * what made a rotated Modulino's silk unreadable.
 */
const LEFT = 0
const RIGHT = 0
const TOP = -90
const BOTTOM = 90

/** Is this angle comfortably readable (never inverted or mirrored)? */
const readable = (deg: number): boolean => deg > -91 && deg <= 91

describe('readablePinLabel', () => {
  it('leaves an unrotated part exactly as authored', () => {
    expect(readablePinLabel(LEFT, 0, 'end')).toEqual({ rotate: 0, anchor: 'end' })
    expect(readablePinLabel(TOP, 0, 'start')).toEqual({ rotate: -90, anchor: 'start' })
  })

  it('fixes the reported case: a TOP-edge label on a part rotated 90°', () => {
    // -90 - 90 = -180 — upside down. Folding lands it upright…
    const l = readablePinLabel(TOP, 90, 'start')
    expect(l.rotate).toBe(0)
    // …and because a 180° fold throws the glyphs across their anchor, the
    // anchor swaps with it, so the text stays in the same span.
    expect(l.anchor).toBe('end')
  })

  it('never leaves a label inverted, for ANY edge and ANY quarter turn', () => {
    for (const local of [LEFT, RIGHT, TOP, BOTTOM]) {
      for (const body of [0, 90, 180, 270, 360, -90]) {
        const { rotate } = readablePinLabel(local, body, 'start')
        expect(readable(rotate), `local ${local}, body ${body} → ${rotate}`).toBe(true)
      }
    }
  })

  it('keeps a quarter-turn label on its side rather than over-correcting', () => {
    // 90° reads fine tilted; only the inverted half needs folding, and folding
    // everything would spin labels that were already legible.
    expect(readablePinLabel(BOTTOM, 0, 'start').rotate).toBe(90)
    expect(readablePinLabel(LEFT, 270, 'start').rotate).toBe(90)
  })

  it('swaps the anchor only when it actually flipped', () => {
    expect(readablePinLabel(LEFT, 0, 'start').anchor).toBe('start') // no fold
    expect(readablePinLabel(LEFT, 180, 'start').anchor).toBe('end') // folded
    expect(readablePinLabel(LEFT, 180, 'middle').anchor).toBe('middle') // symmetric
  })

  it('handles a 180° body, the case that already had a bespoke fix', () => {
    // boxedPinLabel flips + swaps by hand for this; the general rule agrees.
    const l = readablePinLabel(LEFT, 180, 'end')
    expect(l).toEqual({ rotate: 0, anchor: 'start' })
  })

  it('is stable for angles outside 0..360', () => {
    expect(readablePinLabel(TOP, 450, 'start')).toEqual(readablePinLabel(TOP, 90, 'start'))
    expect(readablePinLabel(TOP, -270, 'start')).toEqual(readablePinLabel(TOP, 90, 'start'))
  })
})
