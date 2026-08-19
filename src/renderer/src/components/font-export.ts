/**
 * FONT EXPORT (#250) — pure, DOM-free serialisers that turn a {@link BitmapFont}
 * into a MicroPython module. No React, no DOM: byte-for-byte testable in node.
 * =============================================================================
 *
 * Two formats, both emitted from the same packed-glyph helper:
 *
 * ── 1. `font-to-py` (the default) ────────────────────────────────────────────
 * A drop-in replacement for a module produced by Peter Hinch's
 * `micropython-font-to-py`, so **existing `Writer` code keeps working**:
 *
 *     from writer import Writer
 *     import myfont
 *     Writer(ssd, myfont).printstring('hello')
 *
 * Layout implemented here is the **v0.42 dense-index, horizontally-mapped**
 * variant — verified against `font_to_py.py` on `peterhinch/micropython-font-to-py`
 * (master) rather than inferred:
 *
 *   - module-level `version = '0.42'` plus the functions `height()`, `baseline()`,
 *     `max_width()`, `hmap()`, `reverse()`, `monospaced()`, `min_ch()`, `max_ch()`
 *     — `Writer` itself only calls `height`/`max_width`/`hmap`/`reverse`/`get_ch`,
 *     but nano-gui and friends read `baseline()`, so all eight are emitted.
 *   - `_font` is a concatenation of GLYPH RECORDS. Each record is a **uint16
 *     little-endian width** followed by `ceil(width / 8) * height` bitmap bytes:
 *     row-major, each row padded to whole bytes, **MSB first — bit 7 of a row's
 *     first byte is the leftmost pixel** (this is `framebuf.MONO_HLSB`, which is
 *     what `Writer` builds when `reverse()` is False). The `reverse` option flips
 *     that to LSB-first (`MONO_HMSB`).
 *   - `_index` is 2 bytes per entry, little-endian offsets into `_font`, for the
 *     charset `[default glyph] + [min_ch … max_ch]` **plus one terminator entry**
 *     holding `len(_font)`. So `len(_index) == 2 * (max_ch - min_ch + 3)`. Entry 0
 *     is the DEFAULT glyph — which is therefore written at `_font` offset 0 — and
 *     any code point inside the range that the font has no glyph for gets
 *     `b'\x00\x00'`, i.e. falls back to that default glyph.
 *   - `get_ch(ch)` returns `(memoryview, height, width)` and computes the record
 *     end arithmetically (`doff + 2 + ((width - 1)//8 + 1) * height`) — the
 *     terminator entry is vestigial in v0.42 but is still emitted, because the
 *     pre-0.3 readers do consult it and it costs two bytes.
 *
 * NOT implemented: the SPARSE index (`_sparse`), which the reference tool switches
 * to only when the charset spans ≥ 96 code points, and vertical mapping (`-y`) —
 * `Writer` rejects a vertically-mapped font outright. Every charset the editor
 * offers lives inside printable ASCII (span ≤ 95), so the dense index is exactly
 * what `font_to_py.py` would emit for the same font.
 *
 * ── 2. `packed` (the simple alternative) ─────────────────────────────────────
 * A plain `bytearray` + metrics module for people driving `framebuf` directly
 * without `Writer`: one FIXED-stride slot per code point from `FIRST` to `LAST`,
 * `WIDTHS` carrying the per-glyph advance, and a five-line `glyph()` helper. Much
 * easier to read and to hand-modify; no index arithmetic at all.
 */

import {
  glyphAt,
  type BitmapFont,
  type Glyph
} from './font-model'

/** Which module layout {@link exportFont} should emit. */
export type FontExportFormat = 'font-to-py' | 'packed'

/** The pickable export formats, in UI order (the first is the default). */
export const FONT_EXPORT_FORMATS: { id: FontExportFormat; label: string; blurb: string }[] = [
  {
    id: 'font-to-py',
    label: 'font-to-py module',
    blurb: 'Drop-in for Peter Hinch’s Writer — indexed glyphs, get_ch(), MONO_HLSB.'
  },
  {
    id: 'packed',
    label: 'Packed bytearray',
    blurb: 'Simple fixed-stride bytearray + metrics for driving framebuf yourself.'
  }
]

/** The format version of the `font-to-py` layout emitted below. */
export const FONT_TO_PY_VERSION = '0.42'

/** The reference tool's default "character not in this font" glyph — `?`. */
export const DEFAULT_ERROR_CODE = 0x3f

export interface FontExportOptions {
  /**
   * Bit order within a byte. `false` (default) = MSB-first, which `Writer` maps
   * to `framebuf.MONO_HLSB`; `true` = LSB-first (`MONO_HMSB`). Emitted as
   * `reverse()` so `Writer` picks the matching mode either way.
   */
  reverse?: boolean
  /**
   * The code point drawn for characters the font doesn't contain. Defaults to
   * `?` when the font has it, else the font's first glyph.
   */
  defaultCode?: number
}

// ── Identifiers & filenames ─────────────────────────────────────────────────

/**
 * Coerce a font name into a legal Python module identifier: lower-cased, every
 * run of non-`[a-z0-9_]` collapsed to `_`, never starting with a digit, never
 * empty. `My Font 5×8!` → `my_font_5_8`.
 */
export function moduleName(name: string): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) return 'myfont'
  return /^[0-9]/.test(slug) ? `_${slug}` : slug
}

/** The `.py` filename an export should be written/opened as. */
export function exportFilename(font: BitmapFont): string {
  return `${moduleName(font.name)}.py`
}

// ── Glyph packing ───────────────────────────────────────────────────────────

/** Bytes per bitmap row for a glyph `width` px wide (rows pad to whole bytes). */
export function bytesPerRow(width: number): number {
  return Math.ceil(Math.max(1, width) / 8)
}

/**
 * Pack one glyph's bitmap, row-major, each row padded to whole bytes.
 *
 * `reverse: false` (the default) puts pixel x=0 in **bit 7** of a row's first
 * byte — `framebuf.MONO_HLSB`. `reverse: true` puts it in bit 0 (`MONO_HMSB`).
 * Padding bits are always zero. Exactly `bytesPerRow(width) * height` bytes.
 */
export function packGlyph(glyph: Glyph, height: number, reverse = false): number[] {
  const bpr = bytesPerRow(glyph.width)
  const out: number[] = []
  for (let y = 0; y < height; y++) {
    for (let b = 0; b < bpr; b++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit
        if (x >= glyph.width) break
        if (glyph.rows[y]?.[x]) byte |= reverse ? 1 << bit : 1 << (7 - bit)
      }
      out.push(byte)
    }
  }
  return out
}

/** Append a uint16 little-endian to `out`. */
function pushU16(out: number[], n: number): void {
  out.push(n & 0xff, (n >> 8) & 0xff)
}

// ── Python source emitters ──────────────────────────────────────────────────

/** One byte as a Python `\xNN` escape (lower-case hex, always two digits). */
function hexByte(b: number): string {
  return `\\x${(b & 0xff).toString(16).padStart(2, '0')}`
}

/**
 * Emit a `name =\` byte block in `font_to_py`'s ByteWriter style: 16 bytes per
 * `b'…'` line, backslash-continued, blank line after. An empty array still emits
 * a valid `b''`.
 */
export function byteBlock(name: string, data: number[]): string {
  if (data.length === 0) return `${name} = b''\n\n`
  const lines: string[] = [`${name} =\\`]
  for (let i = 0; i < data.length; i += 16) {
    const chunk = data.slice(i, i + 16).map(hexByte).join('')
    const last = i + 16 >= data.length
    lines.push(`b'${chunk}'${last ? '' : '\\'}`)
  }
  return `${lines.join('\n')}\n\n`
}

/** `def name():\n    return value\n\n` — the reference tool's `write_func`. */
function pyFunc(name: string, value: string): string {
  return `def ${name}():\n    return ${value}\n\n`
}

// ── Format 1: font-to-py ────────────────────────────────────────────────────

/**
 * Which glyph stands in for an unknown character. `opts.defaultCode` wins if the
 * font has it, else `?`, else the font's first glyph. `undefined` only for a font
 * with no glyphs at all.
 */
function pickDefaultGlyph(font: BitmapFont, opts: FontExportOptions): Glyph | undefined {
  const wanted = opts.defaultCode
  if (wanted !== undefined) {
    const g = glyphAt(font, wanted)
    if (g) return g
  }
  return glyphAt(font, DEFAULT_ERROR_CODE) ?? font.glyphs[0]
}

/** The `_font` + `_index` byte arrays for the dense-index layout. */
export function buildFontToPyArrays(
  font: BitmapFont,
  opts: FontExportOptions = {}
): { data: number[]; index: number[]; minCh: number; maxCh: number } {
  const reverse = opts.reverse ?? false
  const codes = font.glyphs.map((g) => g.code)
  const minCh = codes.length ? Math.min(...codes) : 0
  const maxCh = codes.length ? Math.max(...codes) : 0
  const data: number[] = []
  const index: number[] = []

  const append = (g: Glyph): number => {
    const at = data.length
    pushU16(data, g.width)
    data.push(...packGlyph(g, font.height, reverse))
    return at
  }

  // Entry 0 — the default/error glyph, which must therefore live at offset 0.
  const def = pickDefaultGlyph(font, opts)
  if (def) {
    pushU16(index, append(def))
  } else {
    pushU16(index, 0)
  }

  // Entries 1…span — every code point in [minCh, maxCh]. A gap in the range gets
  // offset 0, i.e. it renders as the default glyph (matching the reference tool).
  for (let code = minCh; code <= maxCh; code++) {
    const g = glyphAt(font, code)
    if (!g) {
      pushU16(index, 0)
      continue
    }
    pushU16(index, append(g))
  }

  // The vestigial terminator entry: the total length of `_font`.
  pushU16(index, data.length)
  return { data, index, minCh, maxCh }
}

/**
 * Serialise `font` as a `font-to-py`-compatible MicroPython module (see the file
 * header for the exact layout and what was verified against the reference tool).
 */
export function exportFontToPy(font: BitmapFont, opts: FontExportOptions = {}): string {
  const reverse = opts.reverse ?? false
  const { data, index, minCh, maxCh } = buildFontToPyArrays(font, opts)
  const maxWidth = font.glyphs.reduce((m, g) => Math.max(m, g.width), 0) || font.width
  const h = font.height

  const head =
    `# Code generated by Snakie's font editor (#250).\n` +
    `# Font: ${font.name} ${font.width}x${font.height}, ` +
    `${font.glyphs.length} glyph${font.glyphs.length === 1 ? '' : 's'} ` +
    `(${minCh}-${maxCh})\n` +
    `# Layout: font-to-py v${FONT_TO_PY_VERSION}, dense index, ` +
    `${reverse ? 'MONO_HMSB' : 'MONO_HLSB'} — usable with writer.Writer.\n` +
    `version = '${FONT_TO_PY_VERSION}'\n\n`

  const meta =
    pyFunc('height', String(h)) +
    pyFunc('baseline', String(font.baseline)) +
    pyFunc('max_width', String(maxWidth)) +
    pyFunc('hmap', 'True') +
    pyFunc('reverse', reverse ? 'True' : 'False') +
    pyFunc('monospaced', font.monospaced ? 'True' : 'False') +
    pyFunc('min_ch', String(minCh)) +
    pyFunc('max_ch', String(maxCh))

  const tail =
    `_mvfont = memoryview(_font)\n` +
    `_mvi = memoryview(_index)\n` +
    `ifb = lambda l : l[0] | (l[1] << 8)\n\n` +
    `def get_ch(ch):\n` +
    `    oc = ord(ch)\n` +
    `    ioff = 2 * (oc - ${minCh} + 1) if oc >= ${minCh} and oc <= ${maxCh} else 0\n` +
    `    doff = ifb(_mvi[ioff : ])\n` +
    `    width = ifb(_mvfont[doff : ])\n\n` +
    `    next_offs = doff + 2 + ((width - 1)//8 + 1) * ${h}\n` +
    `    return _mvfont[doff + 2:next_offs], ${h}, width\n`

  return head + meta + byteBlock('_font', data) + byteBlock('_index', index) + tail
}

// ── Format 2: packed bytearray + metrics ────────────────────────────────────

/**
 * Serialise `font` as a simple fixed-stride `bytearray` + metrics module.
 *
 * Every code point from `FIRST` to `LAST` gets a slot of `_STRIDE =
 * ceil(WIDTH/8) * HEIGHT` bytes (blank for a gap in the charset), so the lookup
 * is one multiply — no index, no offsets. `WIDTHS[i]` carries the per-glyph
 * ADVANCE, which is what you step the pen by; the bitmap itself is always blitted
 * at the full cell `WIDTH`.
 */
export function exportFontPacked(font: BitmapFont, opts: FontExportOptions = {}): string {
  const reverse = opts.reverse ?? false
  const codes = font.glyphs.map((g) => g.code)
  const first = codes.length ? Math.min(...codes) : 0
  const last = codes.length ? Math.max(...codes) : 0
  const stride = bytesPerRow(font.width) * font.height

  const data: number[] = []
  const widths: number[] = []
  for (let code = first; code <= last; code++) {
    const g = glyphAt(font, code)
    if (!g) {
      data.push(...new Array<number>(stride).fill(0))
      widths.push(font.width)
      continue
    }
    // Pack at the FULL cell width so every slot is the same size — a narrow
    // proportional glyph is padded with blank columns on the right.
    const padded: Glyph = { ...g, width: font.width }
    data.push(...packGlyph(padded, font.height, reverse))
    widths.push(Math.min(255, g.width))
  }

  return (
    `# Code generated by Snakie's font editor (#250).\n` +
    `# ${font.name}: a ${font.width}x${font.height} ${font.monospaced ? 'monospaced' : 'proportional'} bitmap font.\n` +
    `#\n` +
    `# Fixed-stride packed bitmap, ${reverse ? 'MONO_HMSB' : 'MONO_HLSB'} — blit it straight into a framebuf:\n` +
    `#\n` +
    `#     import framebuf, ${moduleName(font.name)} as f\n` +
    `#     def text(fb, s, x, y):\n` +
    `#         for ch in s:\n` +
    `#             g = f.glyph(ch)\n` +
    `#             if g:\n` +
    `#                 buf, h, w = g\n` +
    `#                 fb.blit(framebuf.FrameBuffer(bytearray(buf), f.WIDTH, h, framebuf.MONO_HLSB), x, y)\n` +
    `#                 x += w\n` +
    `\n` +
    `NAME = ${JSON.stringify(font.name)}\n` +
    `WIDTH = ${font.width}\n` +
    `HEIGHT = ${font.height}\n` +
    `BASELINE = ${font.baseline}\n` +
    `MONOSPACED = ${font.monospaced ? 'True' : 'False'}\n` +
    `FIRST = ${first}\n` +
    `LAST = ${last}\n\n` +
    byteBlock('WIDTHS', widths) +
    byteBlock('FONT', data) +
    `_STRIDE = ((WIDTH + 7) // 8) * HEIGHT\n` +
    `_mv = memoryview(FONT)\n\n` +
    `def glyph(ch):\n` +
    `    """(bitmap, height, advance) for 'ch', or None if it isn't in the font."""\n` +
    `    i = ord(ch) - FIRST\n` +
    `    if i < 0 or i > LAST - FIRST:\n` +
    `        return None\n` +
    `    o = i * _STRIDE\n` +
    `    return _mv[o : o + _STRIDE], HEIGHT, WIDTHS[i]\n`
  )
}

/** Serialise `font` in `format`, returning the filename and the module source. */
export function exportFont(
  font: BitmapFont,
  format: FontExportFormat = 'font-to-py',
  opts: FontExportOptions = {}
): { filename: string; source: string } {
  return {
    filename: exportFilename(font),
    source: format === 'packed' ? exportFontPacked(font, opts) : exportFontToPy(font, opts)
  }
}
