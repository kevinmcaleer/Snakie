// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  coversLatin,
  inlineFontCss,
  resetFontCssCache
} from '../src/renderer/src/components/export-fonts'

/**
 * The fonts have to travel with the picture (#1112).
 *
 * `rasterise` draws the serialised SVG through an `<img>`, and an SVG loaded
 * that way fetches nothing external — webfonts included. Blockly lays a block
 * out around text measured in Plus Jakarta Sans; rendered with the fallback,
 * every label is wider than the block it sits on and the lettering spills off
 * the edge onto the page's parchment. Verified in a real browser, where it was
 * exactly what happened.
 *
 * The same is true of the Board Viewer's own `PNG / SVG / PDF` menu, which
 * goes through the same `<img>`, so the last block here guards the handler
 * that feeds it.
 */

const SRC = (p: string): string =>
  readFileSync(join(__dirname, '..', 'src', 'renderer', 'src', p), 'utf-8')

afterEach(() => resetFontCssCache())

describe('picking the latin subset', () => {
  it('takes the subset that covers plain ASCII', () => {
    // As the CSSOM hands it back — NORMALISED. The authored descriptor reads
    // `U+0000-00FF`, and matching that text found nothing, so every rule was
    // filtered out and the export silently used the fallback font.
    expect(coversLatin('U+0-FF, U+131, U+152-153, U+2000-206F, U+FFFD')).toBe(true)
    expect(coversLatin('U+0000-00FF,U+0131')).toBe(true)
  })

  it('leaves the subsets no block label is written in', () => {
    expect(coversLatin('U+460-52F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF')).toBe(false) // cyrillic
    expect(coversLatin('U+0102-0103, U+0110-0111, U+1EA0-1EF9')).toBe(false) // vietnamese
    expect(coversLatin('U+0100-02BA, U+1E00-1E9F')).toBe(false) // latin-ext
  })

  it('treats a face with no range at all as covering everything', () => {
    expect(coversLatin('')).toBe(true)
    expect(coversLatin('   ')).toBe(true)
  })

  it('ignores a part it cannot read rather than guessing', () => {
    expect(coversLatin('U+??, U+0-FF')).toBe(true)
    expect(coversLatin('nonsense')).toBe(false)
  })

  it('handles a single code point', () => {
    expect(coversLatin('U+41')).toBe(true)
    expect(coversLatin('U+20AC')).toBe(false)
  })
})

describe('collecting the faces', () => {
  it('returns nothing, rather than throwing, when the document has no faces', async () => {
    expect(await inlineFontCss(['Nothing At All'])).toBe('')
  })

  it('builds the CSS once and reuses it for every captured stack', async () => {
    const first = inlineFontCss(['Plus Jakarta Sans'])
    const second = inlineFontCss(['Plus Jakarta Sans'])
    expect(second).toBe(first)
    await first
  })

  it('does not mistake one family set for another', () => {
    expect(inlineFontCss(['A'])).not.toBe(inlineFontCss(['B']))
  })
})

describe("the Board Viewer's own image export", () => {
  const WIRING = SRC('components/WiringCanvas.tsx')

  it('hands the inlined fonts to the serialiser', () => {
    // Without this the breadboard's PNG/SVG/PDF come out in the fallback font
    // and a part label overruns the shape it was laid out to fit.
    const handler = WIRING.slice(WIRING.indexOf('const doExport'), WIRING.indexOf('const doExportMarkdown'))
    expect(handler).toContain('await inlineFontCss()')
    expect(handler).toContain('fontCss')
  })

  it('inlines the fonts BEFORE the fit/serialise/restore, not inside it', () => {
    // `doExport` fits the view, serialises and restores in one synchronous
    // run so the user never sees the fitted frame paint; an await in the
    // middle of that would let it through.
    const handler = WIRING.slice(WIRING.indexOf('const doExport'), WIRING.indexOf('const doExportMarkdown'))
    expect(handler.indexOf('await inlineFontCss()')).toBeLessThan(handler.indexOf('flushSync'))
    expect(handler.slice(handler.indexOf('flushSync'))).not.toContain('await ')
  })
})
