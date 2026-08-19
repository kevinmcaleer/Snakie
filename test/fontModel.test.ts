import { describe, it, expect } from 'vitest'
import {
  CHARSETS,
  MAX_CELL,
  SAMPLE_TEXT,
  advanceOf,
  autoFitAll,
  autoWidth,
  blankRows,
  charsetById,
  clearGlyph,
  codeLabel,
  codeRange,
  copyGlyph,
  createFont,
  drawnCount,
  fitRows,
  fontCodes,
  fromFontJson,
  glyphAt,
  glyphHasInk,
  getPixel,
  hasGlyph,
  inkWidth,
  invertGlyph,
  measureText,
  parseGlyphArt,
  renderText,
  resizeFont,
  setBaseline,
  setCharset,
  setGlyphWidth,
  setMonospaced,
  setPixel,
  shiftGlyph,
  toFontJson,
  toGlyphArt,
  togglePixel,
  type BitmapFont
} from '../src/renderer/src/components/font-model'
import {
  SEED_ART,
  SEED_BASELINE,
  SEED_FIRST_CODE,
  SEED_HEIGHT,
  SEED_WIDTH,
  seedFont
} from '../src/renderer/src/components/font-seed'

const A = 0x41

/** Every invariant the model promises, asserted in one place. */
function expectInvariants(font: BitmapFont): void {
  const codes = font.glyphs.map((g) => g.code)
  expect([...codes].sort((a, b) => a - b), 'glyphs sorted by code').toEqual(codes)
  expect(new Set(codes).size, 'codes unique').toBe(codes.length)
  expect(font.baseline).toBeGreaterThanOrEqual(0)
  expect(font.baseline).toBeLessThanOrEqual(font.height)
  for (const g of font.glyphs) {
    expect(g.rows.length, `rows for ${g.code}`).toBe(font.height)
    expect(g.width).toBeGreaterThanOrEqual(1)
    expect(g.width).toBeLessThanOrEqual(font.width)
    if (font.monospaced) expect(g.width, `monospaced width for ${g.code}`).toBe(font.width)
    for (const row of g.rows) expect(row.length).toBe(g.width)
  }
}

/** A 5×5 font whose `A` is narrow and whose `B` fills the whole cell. */
function fontOf6(): BitmapFont {
  const base = createFont({ width: 5, height: 5, monospaced: false, codes: [A, 0x42] })
  return {
    ...base,
    glyphs: base.glyphs.map((g) =>
      g.code === A
        ? { ...g, rows: parseGlyphArt(['##...', '#....', '##...', '#....', '.....'], 5, 5) }
        : { ...g, rows: parseGlyphArt(['####.', '#...#', '####.', '#...#', '####.'], 5, 5) }
    )
  }
}

/** A 5×7 font with one drawn `A`, for the editing tests. */
function fontWithA(): BitmapFont {
  const base = createFont({ width: 5, height: 7, codes: [0x20, A, 0x42] })
  const art = ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '.....']
  return {
    ...base,
    glyphs: base.glyphs.map((g) =>
      g.code === A ? { ...g, rows: parseGlyphArt(art, 5, 7) } : g
    )
  }
}

describe('createFont', () => {
  it('builds a blank font of the requested cell over the requested codes', () => {
    const f = createFont({ name: 'f', width: 6, height: 9, codes: [0x43, 0x41, 0x41, 0x42] })
    expect(f.width).toBe(6)
    expect(f.height).toBe(9)
    expect(fontCodes(f)).toEqual([0x41, 0x42, 0x43]) // deduped + sorted
    expect(drawnCount(f)).toBe(0)
    expectInvariants(f)
  })

  it('clamps a silly cell size and baseline instead of throwing', () => {
    const f = createFont({ width: 0, height: 9999, baseline: -4, codes: [A] })
    expect(f.width).toBe(1)
    expect(f.height).toBe(MAX_CELL)
    expect(f.baseline).toBe(0)
    expectInvariants(f)
  })

  it('defaults to printable ASCII', () => {
    expect(createFont().glyphs).toHaveLength(95)
  })
})

describe('pixel editing', () => {
  it('sets, reads and toggles a pixel without mutating the source font', () => {
    const f = createFont({ width: 5, height: 7, codes: [A] })
    const on = setPixel(f, A, 2, 3, true)
    expect(getPixel(on, A, 2, 3)).toBe(true)
    expect(getPixel(f, A, 2, 3), 'original untouched').toBe(false)
    expect(getPixel(togglePixel(on, A, 2, 3), A, 2, 3)).toBe(false)
    expectInvariants(on)
  })

  it('treats an out-of-range pixel as a NO-OP, not a crash', () => {
    const f = fontWithA()
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [5, 0],
      [0, 7],
      [999, 999],
      [1.5, 2],
      [NaN, 0]
    ]) {
      expect(() => setPixel(f, A, x, y, true)).not.toThrow()
      expect(setPixel(f, A, x, y, true), `${x},${y} is a no-op`).toBe(f)
      expect(getPixel(f, A, x, y)).toBe(false)
    }
  })

  it('treats an unknown code point as a no-op', () => {
    const f = fontWithA()
    expect(setPixel(f, 0x2603, 0, 0, true)).toBe(f)
    expect(clearGlyph(f, 0x2603)).toBe(f)
    expect(shiftGlyph(f, 0x2603, 1, 0)).toBe(f)
    expect(invertGlyph(f, 0x2603)).toBe(f)
    expect(hasGlyph(f, 0x2603)).toBe(false)
    expect(getPixel(f, 0x2603, 0, 0)).toBe(false)
  })

  it('returns the same font when the pixel already has that value', () => {
    const f = fontWithA()
    expect(setPixel(f, A, 0, 0, false)).toBe(f)
    expect(setPixel(f, A, 1, 0, true)).toBe(f) // already ink in the `A` art
  })

  it('clears and inverts a glyph', () => {
    const f = fontWithA()
    expect(glyphHasInk(glyphAt(clearGlyph(f, A), A)!)).toBe(false)
    const inv = invertGlyph(f, A)
    expect(toGlyphArt(glyphAt(inv, A)!.rows)[0]).toBe('#...#')
    expect(toGlyphArt(glyphAt(invertGlyph(inv, A), A)!.rows)).toEqual(
      toGlyphArt(glyphAt(f, A)!.rows)
    )
  })
})

describe('shiftGlyph', () => {
  it('is reversible while no ink falls off the edge', () => {
    // The `A` art has a clear right column on rows 0 and 3-6? No — use a glyph
    // with a guaranteed blank margin all round.
    const base = createFont({ width: 5, height: 7, codes: [A] })
    const f = {
      ...base,
      glyphs: base.glyphs.map((g) => ({
        ...g,
        rows: parseGlyphArt(['.....', '.###.', '.#.#.', '.###.', '.....', '.....', '.....'], 5, 7)
      }))
    }
    const before = toGlyphArt(glyphAt(f, A)!.rows)
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [-1, 0],
      [0, -1],
      [-1, -1]
    ]) {
      const there = shiftGlyph(f, A, dx, dy)
      const back = shiftGlyph(there, A, -dx, -dy)
      expect(toGlyphArt(glyphAt(back, A)!.rows), `shift ${dx},${dy} round-trips`).toEqual(before)
    }
  })

  it('drops ink pushed past an edge rather than wrapping it', () => {
    const base = createFont({ width: 3, height: 3, codes: [A] })
    const f = {
      ...base,
      glyphs: base.glyphs.map((g) => ({ ...g, rows: parseGlyphArt(['#..', '...', '...'], 3, 3) }))
    }
    const left = shiftGlyph(f, A, -1, 0)
    expect(toGlyphArt(glyphAt(left, A)!.rows)).toEqual(['...', '...', '...'])
    // …and it does NOT reappear on the far side.
    expect(getPixel(left, A, 2, 0)).toBe(false)
  })

  it('is a no-op for a zero or non-integer shift', () => {
    const f = fontWithA()
    expect(shiftGlyph(f, A, 0, 0)).toBe(f)
    expect(shiftGlyph(f, A, 0.5, 0)).toBe(f)
  })
})

describe('resizeFont', () => {
  it('preserves every pixel that still fits when shrinking', () => {
    const f = fontWithA()
    const small = resizeFont(f, 3, 4)
    expect(small.width).toBe(3)
    expect(small.height).toBe(4)
    // Top-left 3×4 of the original `A`.
    expect(toGlyphArt(glyphAt(small, A)!.rows)).toEqual(['.##', '#..', '#..', '###'])
    expectInvariants(small)
  })

  it('preserves everything and blanks the new cells when growing', () => {
    const f = fontWithA()
    const big = resizeFont(f, 8, 9)
    const art = toGlyphArt(glyphAt(big, A)!.rows)
    expect(art).toHaveLength(9)
    // Original rows keep their pixels at the same (x, y); new area is blank.
    expect(art.slice(0, 7).map((r) => r.slice(0, 5))).toEqual(
      toGlyphArt(glyphAt(f, A)!.rows)
    )
    expect(art.slice(0, 7).every((r) => r.slice(5) === '...')).toBe(true)
    expect(art.slice(7)).toEqual(['........', '........'])
    expectInvariants(big)
  })

  it('round-trips losslessly when the shrink keeps all the ink', () => {
    const f = fontWithA()
    const there = resizeFont(f, 12, 12)
    const back = resizeFont(there, 5, 7)
    expect(toGlyphArt(glyphAt(back, A)!.rows)).toEqual(toGlyphArt(glyphAt(f, A)!.rows))
  })

  it('clamps the baseline into the new height', () => {
    const f = setBaseline(createFont({ width: 5, height: 8, codes: [A] }), 7)
    expect(resizeFont(f, 5, 4).baseline).toBe(4)
  })

  it('is a no-op at the same size', () => {
    const f = fontWithA()
    expect(resizeFont(f, 5, 7)).toBe(f)
  })
})

describe('proportional widths', () => {
  it('rejects a width change on a monospaced font', () => {
    const f = fontWithA()
    expect(f.monospaced).toBe(true)
    expect(setGlyphWidth(f, A, 3)).toBe(f)
    expect(autoWidth(f, A)).toBe(f)
  })

  it('crops and pads a glyph when its width changes', () => {
    const f = setMonospaced(fontWithA(), false)
    const narrow = setGlyphWidth(f, A, 3)
    expect(glyphAt(narrow, A)!.width).toBe(3)
    expect(toGlyphArt(glyphAt(narrow, A)!.rows)).toEqual([
      '.##',
      '#..',
      '#..',
      '###',
      '#..',
      '#..',
      '...'
    ])
    // Widening again pads on the right — the cropped column does NOT come back.
    const wide = setGlyphWidth(narrow, A, 5)
    expect(toGlyphArt(glyphAt(wide, A)!.rows)[0]).toBe('.##..')
    expectInvariants(wide)
  })

  it('clamps a requested width into [1, font.width]', () => {
    const f = setMonospaced(fontWithA(), false)
    expect(glyphAt(setGlyphWidth(f, A, 0), A)!.width).toBe(1)
    expect(glyphAt(setGlyphWidth(f, A, 99), A)!.width).toBe(5)
  })

  it('auto-fits a glyph to its ink plus the trailing pad', () => {
    const base = createFont({ width: 8, height: 5, monospaced: false, codes: [A, 0x20] })
    const f = {
      ...base,
      glyphs: base.glyphs.map((g) =>
        g.code === A
          ? { ...g, rows: parseGlyphArt(['##......', '#.#.....', '##......', '#.......', '........'], 8, 5) }
          : g
      )
    }
    expect(glyphAt(autoWidth(f, A), A)!.width).toBe(4) // ink to x=2 (+1 col) + 1 pad
    expect(glyphAt(autoWidth(f, A, 0), A)!.width).toBe(3)
    // A blank glyph (the space) is left alone rather than collapsing to 1px.
    expect(autoWidth(f, 0x20, 2)).toBe(f)
  })

  it('measures ink width, ignoring trailing blank columns', () => {
    const base = createFont({ width: 6, height: 2, codes: [A, 0x42] })
    expect(inkWidth({ code: A, width: 6, rows: parseGlyphArt(['##....', '#.....'], 6, 2) })).toBe(2)
    expect(inkWidth({ code: A, width: 6, rows: parseGlyphArt(['.....#', '......'], 6, 2) })).toBe(6)
    expect(inkWidth(base.glyphs[0])).toBe(0)
  })

  it('auto-fits the whole font, growing the cell so every glyph keeps its pad', () => {
    // `B` fills the cell, so a naive auto-fit would clamp it and lose the spacing.
    const f = fontOf6()
    const fit = autoFitAll(f, 1)
    expect(fit.monospaced).toBe(false)
    expect(fit.width).toBe(6) // widest ink (5) + 1 pad
    expect(glyphAt(fit, A)!.width).toBe(3) // ink 2 + 1
    expect(glyphAt(fit, 0x42)!.width).toBe(6) // ink 5 + 1
    expectInvariants(fit)
  })

  it('never shrinks the cell when auto-fitting', () => {
    const wide = resizeFont(fontOf6(), 12, 5)
    expect(autoFitAll(wide, 1).width).toBe(12)
  })

  it('pads every glyph back out to the cell when going monospaced', () => {
    const f = setGlyphWidth(setMonospaced(fontWithA(), false), A, 2)
    const mono = setMonospaced(f, true)
    expect(mono.monospaced).toBe(true)
    expect(toGlyphArt(glyphAt(mono, A)!.rows)[0]).toBe('.#...')
    expectInvariants(mono)
  })

  it('leaves widths alone when going proportional', () => {
    const f = setMonospaced(fontWithA(), false)
    expect(glyphAt(f, A)!.width).toBe(5)
    expect(setMonospaced(f, false)).toBe(f)
  })
})

describe('copyGlyph', () => {
  it('copies the bitmap and width onto another code point', () => {
    const f = copyGlyph(fontWithA(), A, 0x42)
    expect(toGlyphArt(glyphAt(f, 0x42)!.rows)).toEqual(toGlyphArt(glyphAt(f, A)!.rows))
    expectInvariants(f)
  })

  it('is a no-op for a missing source, missing target, or a self-copy', () => {
    const f = fontWithA()
    expect(copyGlyph(f, 0x2603, A)).toBe(f)
    expect(copyGlyph(f, A, 0x2603)).toBe(f)
    expect(copyGlyph(f, A, A)).toBe(f)
  })

  it('crops to the destination cell in a proportional font', () => {
    const prop = setGlyphWidth(setMonospaced(fontWithA(), false), 0x42, 2)
    const copied = copyGlyph(prop, A, 0x42)
    // The DESTINATION takes the source's width — that's what "copy from" means.
    expect(glyphAt(copied, 0x42)!.width).toBe(5)
  })
})

describe('charsets', () => {
  it('keeps the glyphs that survive and blanks the newly-added ones', () => {
    const f = fontWithA()
    const wider = setCharset(f, [A, 0x42, 0x43])
    expect(fontCodes(wider)).toEqual([0x41, 0x42, 0x43])
    expect(toGlyphArt(glyphAt(wider, A)!.rows)[0], 'the drawn A survives').toBe('.###.')
    expect(glyphHasInk(glyphAt(wider, 0x43)!), 'the new C is blank').toBe(false)
    expectInvariants(wider)
  })

  it('DROPS glyphs outside the new charset (the panel confirms before narrowing)', () => {
    const digits = setCharset(fontWithA(), charsetById('digits').codes)
    expect(fontCodes(digits)).toEqual(codeRange(0x30, 0x39))
    expect(glyphAt(digits, A)).toBeUndefined()
    expect(drawnCount(digits)).toBe(0)
    expectInvariants(digits)
  })

  it('exposes well-formed charsets and falls back on an unknown id', () => {
    for (const cs of CHARSETS) {
      expect(cs.codes.length).toBeGreaterThan(0)
      expect([...cs.codes].sort((a, b) => a - b)).toEqual(cs.codes)
      expect(new Set(cs.codes).size).toBe(cs.codes.length)
    }
    expect(charsetById('nope')).toBe(CHARSETS[0])
    expect(charsetById('digits').codes).toHaveLength(10)
  })

  it('labels code points for the navigator', () => {
    expect(codeLabel(0x20)).toBe('SP')
    expect(codeLabel(0x41)).toBe('A')
    expect(codeLabel(0x07)).toBe('·')
    expect(codeLabel(0x7f)).toBe('·')
  })
})

describe('metrics & text rendering', () => {
  it('measures a monospaced string as glyphs × cell width', () => {
    const f = fontWithA()
    expect(measureText(f, 'AB')).toBe(10)
    expect(measureText(f, '')).toBe(0)
    expect(advanceOf(f, A)).toBe(5)
  })

  it('uses the cell width for a character the font has no glyph for', () => {
    const f = fontWithA()
    expect(advanceOf(f, 0x2603)).toBe(5)
    expect(measureText(f, 'A☃')).toBe(10)
    expect(renderText(f, 'A☃').w).toBe(10)
  })

  it('sums per-glyph advances in a proportional font', () => {
    const f = setGlyphWidth(setMonospaced(fontWithA(), false), A, 3)
    expect(measureText(f, 'AA')).toBe(6)
    expect(measureText(f, 'AB')).toBe(8)
  })

  it('lays glyphs out left to right at their advance', () => {
    const base = createFont({ width: 3, height: 2, monospaced: false, codes: [A, 0x42] })
    const f: BitmapFont = {
      ...base,
      glyphs: base.glyphs.map((g) =>
        g.code === A
          ? { ...g, width: 2, rows: parseGlyphArt(['#.', '.#'], 2, 2) }
          : { ...g, rows: parseGlyphArt(['###', '...'], 3, 2) }
      )
    }
    const grid = renderText(f, 'AB')
    expect(grid.w).toBe(5)
    expect(grid.h).toBe(2)
    expect(toGlyphArt(grid.pixels)).toEqual(['#.###', '.#...'])
  })

  it('offers the pangram as the preview line', () => {
    expect(SAMPLE_TEXT.toLowerCase()).toContain('quick brown fox')
  })
})

describe('bitmap helpers', () => {
  it('parses and re-emits ASCII art', () => {
    const rows = parseGlyphArt(['#.#', '.#.'])
    expect(toGlyphArt(rows)).toEqual(['#.#', '.#.'])
    // Any of #/X/x/1/* count as ink; ragged rows are padded.
    expect(toGlyphArt(parseGlyphArt(['X1*', 'a'], 3, 2))).toEqual(['###', '...'])
  })

  it('crops and pads with fitRows anchored top-left', () => {
    const rows = parseGlyphArt(['##.', '.##'])
    expect(toGlyphArt(fitRows(rows, 2, 1))).toEqual(['##'])
    expect(toGlyphArt(fitRows(rows, 4, 3))).toEqual(['##..', '.##.', '....'])
    expect(blankRows(2, 2)).toEqual([
      [false, false],
      [false, false]
    ])
  })
})

describe('persistence', () => {
  it('round-trips a font through JSON without losing anything', () => {
    const f = autoFitAll(fontWithA(), 1)
    const back = fromFontJson(JSON.parse(JSON.stringify(toFontJson(f))))!
    expect(back).toEqual(f)
  })

  it('round-trips the whole starter font', () => {
    const f = seedFont('jonny5')
    expect(fromFontJson(toFontJson(f))).toEqual(f)
  })

  it('returns null for anything that is not a font, instead of throwing', () => {
    for (const bad of [null, undefined, 0, 'nope', [], {}, { v: 2, glyphs: [] }, { v: 1 }]) {
      expect(fromFontJson(bad), JSON.stringify(bad) ?? 'undefined').toBeNull()
    }
    // A font whose glyphs are all unusable is also nothing to restore.
    expect(fromFontJson({ v: 1, glyphs: [{ c: 'x' }] })).toBeNull()
  })

  it('clamps hostile values back into the model’s invariants', () => {
    const f = fromFontJson({
      v: 1,
      name: '',
      width: 9999,
      height: -3,
      baseline: 500,
      monospaced: false,
      glyphs: [
        { c: 0x41, w: 99999, a: '###/###' },
        { c: 0x41, w: 2, a: '##' }, // a duplicate code is dropped
        { c: -5, w: 2, a: '##' }, // …as is a nonsense code point
        { c: 0x20, w: 0, a: 'not-art' }
      ]
    })!
    expect(f.name).toBe('myfont')
    expect(f.width).toBe(MAX_CELL)
    expect(f.height).toBe(1)
    expect(f.baseline).toBe(1)
    expect(fontCodes(f)).toEqual([0x20, 0x41])
    expectInvariants(f)
  })
})

describe('the bundled starter font', () => {
  const f = seedFont()

  it('covers printable ASCII at 5×8 with a descender row', () => {
    expect(SEED_ART).toHaveLength(95)
    expect(f.glyphs).toHaveLength(95)
    expect(fontCodes(f)).toEqual(codeRange(0x20, 0x7e))
    expect([f.width, f.height, f.baseline]).toEqual([SEED_WIDTH, SEED_HEIGHT, SEED_BASELINE])
    expect(f.monospaced).toBe(true)
    expectInvariants(f)
  })

  it('has art for every glyph and ink in all but the space', () => {
    for (const art of SEED_ART) {
      expect(art.split('/')).toHaveLength(SEED_HEIGHT)
      for (const row of art.split('/')) expect(row).toHaveLength(SEED_WIDTH)
    }
    expect(drawnCount(f)).toBe(94) // everything except the space
    expect(glyphHasInk(glyphAt(f, 0x20)!)).toBe(false)
  })

  it('draws recognisable letters', () => {
    expect(toGlyphArt(glyphAt(f, 0x41)!.rows)).toEqual([
      '..#..',
      '.#.#.',
      '#...#',
      '#...#',
      '#####',
      '#...#',
      '#...#',
      '.....'
    ])
    // Descenders reach the descender row; capitals never do.
    for (const ch of 'gjpqy,;_') expect(glyphAt(f, ch.charCodeAt(0))!.rows[7].some(Boolean)).toBe(true)
    for (const ch of 'ABCXYZ0189') expect(glyphAt(f, ch.charCodeAt(0))!.rows[7].some(Boolean)).toBe(false)
  })

  it('is dense from the first code point, so the art index lines up', () => {
    for (let i = 0; i < SEED_ART.length; i++) {
      expect(f.glyphs[i].code).toBe(SEED_FIRST_CODE + i)
    }
  })

  it('renders the preview pangram at the expected size', () => {
    const grid = renderText(f, SAMPLE_TEXT)
    expect(grid.w).toBe(SAMPLE_TEXT.length * SEED_WIDTH)
    expect(grid.h).toBe(SEED_HEIGHT)
    expect(grid.pixels.some((r) => r.some(Boolean))).toBe(true)
  })

  it('becomes properly proportional after an auto-fit pass', () => {
    const prop = autoFitAll(f, 1)
    expect(prop.monospaced).toBe(false)
    // The cell grew by the pad so the widest glyphs still get their spacing…
    expect(prop.width).toBe(SEED_WIDTH + 1)
    // …narrow letters are now narrower than wide ones, and the space is untouched.
    expect(glyphAt(prop, 0x6c)!.width).toBeLessThan(glyphAt(prop, 0x6d)!.width) // l < m
    expect(glyphAt(prop, 0x2e)!.width).toBeLessThan(glyphAt(prop, 0x57)!.width) // . < W
    expect(glyphAt(prop, 0x20)!.width).toBe(SEED_WIDTH)
    expect(new Set(prop.glyphs.map((g) => g.width)).size).toBeGreaterThan(2)
    expectInvariants(prop)
  })
})
