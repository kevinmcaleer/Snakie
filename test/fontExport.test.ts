import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ERROR_CODE,
  FONT_EXPORT_FORMATS,
  FONT_TO_PY_VERSION,
  buildFontToPyArrays,
  byteBlock,
  bytesPerRow,
  exportFilename,
  exportFont,
  exportFontPacked,
  exportFontToPy,
  moduleName,
  packGlyph
} from '../src/renderer/src/components/font-export'
import {
  autoWidth,
  createFont,
  fontCodes,
  glyphAt,
  parseGlyphArt,
  setMonospaced,
  toGlyphArt,
  type BitmapFont,
  type Glyph
} from '../src/renderer/src/components/font-model'
import { seedFont } from '../src/renderer/src/components/font-seed'

/** Build a font from `{code: art}`, cell `w × h`. */
function fontOf(w: number, h: number, art: Record<number, string[]>, monospaced = true): BitmapFont {
  const codes = Object.keys(art).map(Number)
  const base = createFont({ name: 'test', width: w, height: h, baseline: h, monospaced, codes })
  return {
    ...base,
    glyphs: base.glyphs.map((g) => ({ ...g, rows: parseGlyphArt(art[g.code], g.width, h) }))
  }
}

/** Pull a `name =\ b'…'\ b'…'` block out of generated source back into bytes. */
function readByteBlock(source: string, name: string): number[] {
  const m = new RegExp(`^${name} =\\\\?[ ]?((?:.|\\n)*?)\\n\\n`, 'm').exec(source)
  if (!m) throw new Error(`no ${name} block in generated source`)
  const bytes: number[] = []
  for (const hex of m[1].matchAll(/\\x([0-9a-f]{2})/g)) bytes.push(parseInt(hex[1], 16))
  return bytes
}

/** The value a generated `def name(): return X` reports. */
function readFunc(source: string, name: string): string {
  const m = new RegExp(`def ${name}\\(\\):\\n    return (.+)`).exec(source)
  if (!m) throw new Error(`no ${name}() in generated source`)
  return m[1]
}

/**
 * Re-implement the EMITTED `get_ch` exactly as the generated Python does — index
 * lookup, `ifb` little-endian read, and the arithmetic record end — so the tests
 * decode the module the same way MicroPython will.
 */
function getCh(
  data: number[],
  index: number[],
  minCh: number,
  maxCh: number,
  height: number,
  code: number
): { bytes: number[]; height: number; width: number } {
  const ifb = (arr: number[], at: number): number => arr[at] | (arr[at + 1] << 8)
  const ioff = code >= minCh && code <= maxCh ? 2 * (code - minCh + 1) : 0
  const doff = ifb(index, ioff)
  const width = ifb(data, doff)
  const next = doff + 2 + (Math.floor((width - 1) / 8) + 1) * height
  return { bytes: data.slice(doff + 2, next), height, width }
}

/** Unpack MONO_HLSB glyph bytes back into ASCII art, for the round-trip tests. */
function unpack(bytes: number[], width: number, height: number, reverse = false): string[] {
  const bpr = bytesPerRow(width)
  const out: string[] = []
  for (let y = 0; y < height; y++) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const byte = bytes[y * bpr + (x >> 3)] ?? 0
      const bit = reverse ? x & 7 : 7 - (x & 7)
      row += byte & (1 << bit) ? '#' : '.'
    }
    out.push(row)
  }
  return out
}

describe('moduleName / exportFilename', () => {
  it('coerces any name into a legal Python module identifier', () => {
    expect(moduleName('Jonny 5')).toBe('jonny_5')
    expect(moduleName('My Font 5×8!')).toBe('my_font_5_8')
    expect(moduleName('  ')).toBe('myfont')
    expect(moduleName('8bit')).toBe('_8bit')
    expect(exportFilename(createFont({ name: 'Jonny 5' }))).toBe('jonny_5.py')
  })
})

describe('packGlyph — the MONO_HLSB bit layout', () => {
  const g = (width: number, art: string[]): Glyph => ({
    code: 0x41,
    width,
    rows: parseGlyphArt(art, width, art.length)
  })

  it('puts pixel x=0 in bit 7 of a row’s first byte', () => {
    // A 5-px row with only the leftmost pixel lit → 0b1000_0000.
    expect(packGlyph(g(5, ['#....']), 1)).toEqual([0x80])
    // …and only x=4 lit → 0b0000_1000.
    expect(packGlyph(g(5, ['....#']), 1)).toEqual([0x08])
  })

  it('pads each row to whole bytes, zero-filling the low bits', () => {
    // 9 px wide ⇒ 2 bytes per row, 3 rows ⇒ 6 bytes.
    const bytes = packGlyph(g(9, ['#........', '........#', '#.......#']), 3)
    expect(bytes).toEqual([0x80, 0x00, 0x00, 0x80, 0x80, 0x80])
    expect(bytes).toHaveLength(bytesPerRow(9) * 3)
  })

  it('flips to LSB-first when reversed', () => {
    expect(packGlyph(g(9, ['#........', '........#', '#.......#']), 3, true)).toEqual([
      0x01, 0x00, 0x00, 0x01, 0x01, 0x01
    ])
  })

  it('emits exactly ceil(width/8) × height bytes', () => {
    for (const w of [1, 5, 8, 9, 16, 17, 32]) {
      expect(packGlyph(g(w, ['.'.repeat(w)]), 4)).toHaveLength(bytesPerRow(w) * 4)
    }
  })

  it('round-trips any bitmap through pack/unpack', () => {
    const art = ['#.#.#.#.#', '.#.#.#.#.', '#########', '.........']
    expect(unpack(packGlyph(g(9, art), 4), 9, 4)).toEqual(art)
    expect(unpack(packGlyph(g(9, art), 4, true), 9, 4, true)).toEqual(art)
  })
})

describe('font-to-py arrays', () => {
  const font = fontOf(5, 3, {
    0x3f: ['#####', '.....', '#####'], //  ? — the default glyph
    0x41: ['#....', '.....', '....#'], //  A
    0x42: ['.....', '#####', '.....'] //   B
  })

  it('writes the default glyph at _font offset 0 and points index entry 0 at it', () => {
    const { data, index } = buildFontToPyArrays(font)
    expect(index[0] | (index[1] << 8)).toBe(0)
    expect(data[0] | (data[1] << 8)).toBe(5) // the uint16 LE width prefix
    expect(data.slice(2, 5)).toEqual([0xf8, 0x00, 0xf8]) // the `?` bitmap
  })

  it('sizes the index as 2 × (max_ch - min_ch + 3)', () => {
    const { index, minCh, maxCh } = buildFontToPyArrays(font)
    expect([minCh, maxCh]).toEqual([0x3f, 0x42])
    expect(index).toHaveLength(2 * (maxCh - minCh + 3))
  })

  it('ends the index with a terminator holding len(_font)', () => {
    const { data, index } = buildFontToPyArrays(font)
    const last = index.length - 2
    expect(index[last] | (index[last + 1] << 8)).toBe(data.length)
  })

  it('gives a gap in the code range offset 0 — i.e. the default glyph', () => {
    const gappy = fontOf(3, 2, {
      0x41: ['#..', '...'],
      0x44: ['..#', '...']
    })
    const { data, index, minCh, maxCh } = buildFontToPyArrays(gappy)
    for (const code of [0x42, 0x43]) {
      const at = 2 * (code - minCh + 1)
      expect(index[at] | (index[at + 1] << 8), `gap at ${code}`).toBe(0)
      // …and decoding it yields the default glyph's bitmap.
      const ch = getCh(data, index, minCh, maxCh, 2, code)
      expect(unpack(ch.bytes, ch.width, 2)).toEqual(['#..', '...'])
    }
  })

  it('round-trips EVERY glyph through the emitted get_ch arithmetic', () => {
    for (const mono of [true, false]) {
      let f = setMonospaced(seedFont('round trip'), mono)
      if (!mono) for (const code of fontCodes(f)) f = autoWidth(f, code, 1)
      const { data, index, minCh, maxCh } = buildFontToPyArrays(f)
      for (const g of f.glyphs) {
        const ch = getCh(data, index, minCh, maxCh, f.height, g.code)
        expect(ch.width, `width of ${g.code}`).toBe(g.width)
        expect(ch.height).toBe(f.height)
        expect(ch.bytes, `record length of ${g.code}`).toHaveLength(
          bytesPerRow(g.width) * f.height
        )
        expect(unpack(ch.bytes, g.width, f.height), `bitmap of ${g.code}`).toEqual(
          toGlyphArt(g.rows)
        )
      }
      // An out-of-range char falls back to `?`.
      const miss = getCh(data, index, minCh, maxCh, f.height, 0x2603)
      expect(unpack(miss.bytes, miss.width, f.height)).toEqual(
        toGlyphArt(glyphAt(f, DEFAULT_ERROR_CODE)!.rows)
      )
    }
  })

  it('honours an explicit default glyph', () => {
    const { data } = buildFontToPyArrays(font, { defaultCode: 0x42 })
    expect(unpack(data.slice(2, 5), 5, 3)).toEqual(['.....', '#####', '.....'])
    // An unknown defaultCode falls back to `?` rather than throwing.
    expect(buildFontToPyArrays(font, { defaultCode: 0x2603 }).data.slice(2, 5)).toEqual([
      0xf8, 0x00, 0xf8
    ])
  })
})

describe('exportFontToPy — the generated module', () => {
  const font = fontOf(5, 3, {
    0x3f: ['#####', '.....', '#####'],
    0x41: ['#....', '.....', '....#']
  })
  const src = exportFontToPy(font)

  it('emits the version literal and the full font-to-py function set', () => {
    expect(src).toContain(`version = '${FONT_TO_PY_VERSION}'`)
    expect(readFunc(src, 'height')).toBe('3')
    expect(readFunc(src, 'baseline')).toBe('3')
    expect(readFunc(src, 'max_width')).toBe('5')
    expect(readFunc(src, 'hmap')).toBe('True')
    expect(readFunc(src, 'reverse')).toBe('False')
    expect(readFunc(src, 'monospaced')).toBe('True')
    expect(readFunc(src, 'min_ch')).toBe('63')
    expect(readFunc(src, 'max_ch')).toBe('65')
  })

  it('emits the memoryviews, ifb and a get_ch returning (mv, height, width)', () => {
    expect(src).toContain('_mvfont = memoryview(_font)')
    expect(src).toContain('_mvi = memoryview(_index)')
    expect(src).toContain('ifb = lambda l : l[0] | (l[1] << 8)')
    expect(src).toContain('def get_ch(ch):')
    expect(src).toContain('    ioff = 2 * (oc - 63 + 1) if oc >= 63 and oc <= 65 else 0')
    expect(src).toContain('    next_offs = doff + 2 + ((width - 1)//8 + 1) * 3')
    expect(src).toContain('    return _mvfont[doff + 2:next_offs], 3, width')
  })

  it('has no imports — the module is literals and defs only', () => {
    for (const line of src.split('\n')) {
      expect(line.startsWith('import ') || line.startsWith('from ')).toBe(false)
    }
  })

  it('serialises _font and _index faithfully into the source text', () => {
    const { data, index } = buildFontToPyArrays(font)
    expect(readByteBlock(src, '_font')).toEqual(data)
    expect(readByteBlock(src, '_index')).toEqual(index)
  })

  it('reports reverse() and packs LSB-first when asked', () => {
    const rev = exportFontToPy(font, { reverse: true })
    expect(readFunc(rev, 'reverse')).toBe('True')
    expect(readByteBlock(rev, '_font').slice(2, 5)).toEqual([0x1f, 0x00, 0x1f])
  })

  it('reports monospaced() and max_width() for a proportional font', () => {
    let prop = setMonospaced(font, false)
    for (const code of fontCodes(prop)) prop = autoWidth(prop, code, 1)
    const psrc = exportFontToPy(prop)
    expect(readFunc(psrc, 'monospaced')).toBe('False')
    expect(readFunc(psrc, 'max_width')).toBe(
      String(prop.glyphs.reduce((m, g) => Math.max(m, g.width), 0))
    )
  })

  it('survives a full 95-glyph printable-ASCII font at a realistic size', () => {
    const seed = seedFont('jonny5')
    const out = exportFont(seed)
    expect(out.filename).toBe('jonny5.py')
    expect(readFunc(out.source, 'min_ch')).toBe('32')
    expect(readFunc(out.source, 'max_ch')).toBe('126')
    // 95 in-range glyphs + the duplicated default `?` record.
    const recordLen = 2 + bytesPerRow(5) * 8
    expect(readByteBlock(out.source, '_font')).toHaveLength(96 * recordLen)
    expect(readByteBlock(out.source, '_index')).toHaveLength(2 * (126 - 32 + 3))
  })
})

describe('byteBlock', () => {
  it('wraps at 16 bytes per line with backslash continuations', () => {
    const block = byteBlock('_x', Array.from({ length: 20 }, (_, i) => i))
    const lines = block.trimEnd().split('\n')
    expect(lines[0]).toBe('_x =\\')
    expect(lines[1].endsWith("'\\")).toBe(true)
    expect(lines[1]).toContain('\\x00\\x01')
    expect(lines[2].endsWith("'")).toBe(true)
    expect(lines).toHaveLength(3)
  })

  it('emits a valid empty literal for no data', () => {
    expect(byteBlock('_x', [])).toBe("_x = b''\n\n")
  })

  it('always uses two lower-case hex digits', () => {
    expect(byteBlock('_x', [0, 0xab, 0xff])).toContain("b'\\x00\\xab\\xff'")
  })
})

describe('exportFontPacked — the simple format', () => {
  const font = fontOf(5, 3, {
    0x41: ['#....', '.....', '....#'],
    0x43: ['.....', '#####', '.....']
  })
  const src = exportFontPacked(font)

  it('emits the metrics a caller needs to blit it', () => {
    expect(src).toContain('WIDTH = 5')
    expect(src).toContain('HEIGHT = 3')
    expect(src).toContain('BASELINE = 3')
    expect(src).toContain('MONOSPACED = True')
    expect(src).toContain('FIRST = 65')
    expect(src).toContain('LAST = 67')
    expect(src).toContain('def glyph(ch):')
  })

  it('uses one fixed-stride slot per code point, blanking the gaps', () => {
    const stride = bytesPerRow(5) * 3
    const data = readByteBlock(src, 'FONT')
    expect(data).toHaveLength(3 * stride) // A, B (gap), C
    expect(unpack(data.slice(0, stride), 5, 3)).toEqual(['#....', '.....', '....#'])
    expect(data.slice(stride, 2 * stride).every((b) => b === 0)).toBe(true)
    expect(unpack(data.slice(2 * stride), 5, 3)).toEqual(['.....', '#####', '.....'])
  })

  it('carries the per-glyph advance in WIDTHS', () => {
    expect(readByteBlock(src, 'WIDTHS')).toEqual([5, 5, 5])
    let prop = setMonospaced(font, false)
    for (const code of fontCodes(prop)) prop = autoWidth(prop, code, 1)
    const widths = readByteBlock(exportFontPacked(prop), 'WIDTHS')
    expect(widths[0]).toBe(glyphAt(prop, 0x41)!.width)
    // …while the bitmap slots stay the full cell width.
    expect(readByteBlock(exportFontPacked(prop), 'FONT')).toHaveLength(3 * bytesPerRow(5) * 3)
  })

  it('pads a narrow proportional glyph on the right, keeping its ink', () => {
    const prop = setMonospaced(fontOf(5, 2, { 0x41: ['##...', '#....'] }, false), false)
    const data = readByteBlock(exportFontPacked(prop), 'FONT')
    expect(unpack(data, 5, 2)).toEqual(['##...', '#....'])
  })
})

describe('exportFont', () => {
  it('dispatches on the format and names the file after the module', () => {
    const font = createFont({ name: 'Jonny 5', width: 3, height: 3, codes: [0x41] })
    expect(exportFont(font, 'font-to-py').source).toContain('def get_ch(ch):')
    expect(exportFont(font, 'packed').source).toContain('def glyph(ch):')
    expect(exportFont(font).source).toContain('def get_ch(ch):') // font-to-py by default
    expect(exportFont(font, 'packed').filename).toBe('jonny_5.py')
  })

  it('offers both formats to the picker, font-to-py first', () => {
    expect(FONT_EXPORT_FORMATS.map((f) => f.id)).toEqual(['font-to-py', 'packed'])
    for (const f of FONT_EXPORT_FORMATS) {
      expect(f.label).toBeTruthy()
      expect(f.blurb).toBeTruthy()
    }
  })
})
