import { describe, expect, it } from 'vitest'
import { wrapTextLines } from '../src/renderer/src/components/part-body'

/**
 * `wrapTextLines` greedily word-wraps a shape label to a pixel width (the mono
 * font is ~0.6·fontSize per glyph). Used to wrap text to a shape in the editor
 * and board views without foreignObject (so PNG/PDF export still works).
 */
describe('wrapTextLines', () => {
  // At fontSize 10, charW ≈ 6 → maxChars = floor(width / 6).
  it('wraps words to fit the width', () => {
    // width 60 → 10 chars per line.
    expect(wrapTextLines('one two three four', 60, 10)).toEqual(['one two', 'three four'])
  })

  it('honours explicit newlines', () => {
    expect(wrapTextLines('a\nb', 600, 10)).toEqual(['a', 'b'])
  })

  it('keeps a short string on one line', () => {
    expect(wrapTextLines('hi', 600, 10)).toEqual(['hi'])
  })

  it('hard-breaks a single word longer than the line', () => {
    // width 30 → 5 chars per line; an 11-char word splits.
    expect(wrapTextLines('abcdefghijk', 30, 10)).toEqual(['abcde', 'fghij', 'k'])
  })

  it('never produces a zero-width line (clamps to ≥1 char)', () => {
    expect(wrapTextLines('ab', 1, 10)).toEqual(['a', 'b'])
  })
})
