/**
 * WinAnsiEncoding for the zero-dependency PDF writer (#1113).
 *
 * The base-14 fonts we use (`/Helvetica`, `/Helvetica-Bold`, `/Courier`) need no
 * embedding, but they DO need an agreed encoding: we declare
 * `/Encoding /WinAnsiEncoding` on every font and emit one byte per glyph here.
 *
 * WinAnsi is Latin-1 except for `0x80`–`0x9F`, which it fills with typographic
 * punctuation (the Windows-1252 block: curly quotes, dashes, the bullet, …).
 * A character outside the encoding is SUBSTITUTED rather than emitted raw —
 * a malformed byte would corrupt the stream for every reader, whereas a `?`
 * is merely disappointing.
 */

/** `0x80`–`0x9F`: the Windows-1252 punctuation block, as code points keyed by byte. */
const HIGH_BLOCK: ReadonlyArray<readonly [number, number]> = [
  [0x80, 0x20ac], // €
  [0x82, 0x201a], // ‚
  [0x83, 0x0192], // ƒ
  [0x84, 0x201e], // „
  [0x85, 0x2026], // …
  [0x86, 0x2020], // †
  [0x87, 0x2021], // ‡
  [0x88, 0x02c6], // ˆ
  [0x89, 0x2030], // ‰
  [0x8a, 0x0160], // Š
  [0x8b, 0x2039], // ‹
  [0x8c, 0x0152], // Œ
  [0x8e, 0x017d], // Ž
  [0x91, 0x2018], // ‘
  [0x92, 0x2019], // ’
  [0x93, 0x201c], // “
  [0x94, 0x201d], // ”
  [0x95, 0x2022], // •
  [0x96, 0x2013], // –
  [0x97, 0x2014], // —
  [0x98, 0x02dc], // ˜
  [0x99, 0x2122], // ™
  [0x9a, 0x0161], // š
  [0x9b, 0x203a], // ›
  [0x9c, 0x0153], // œ
  [0x9e, 0x017e], // ž
  [0x9f, 0x0178] // Ÿ
]

const CP_TO_BYTE = new Map<number, number>(HIGH_BLOCK.map(([byte, cp]) => [cp, byte]))

/** The byte emitted for a character WinAnsi cannot represent. */
export const SUBSTITUTE_BYTE = 0x3f // '?'

/** Whitespace control bytes that are STRUCTURE rather than glyphs — the newlines
 *  between operators, a tab in a stream — and so pass through the encoder
 *  untouched even though no font draws them. */
const PASSTHROUGH = new Set([0x09, 0x0a, 0x0c, 0x0d])

/**
 * The WinAnsi byte for a code point, or `undefined` when the encoding has no
 * glyph for it. `0x20`–`0x7E` and `0xA0`–`0xFF` are Latin-1; the rest comes from
 * {@link HIGH_BLOCK}.
 */
export function winAnsiByte(cp: number): number | undefined {
  if (cp >= 0x20 && cp <= 0x7e) return cp
  if (cp >= 0xa0 && cp <= 0xff) return cp
  return CP_TO_BYTE.get(cp)
}

/** True when every character of `s` has a WinAnsi glyph. */
export function isWinAnsiRepresentable(s: string): boolean {
  for (const ch of s) if (winAnsiByte(ch.codePointAt(0) ?? 0) === undefined) return false
  return true
}

/**
 * Encode a string to WinAnsi bytes — ONE byte per character, unrepresentable
 * characters replaced by {@link SUBSTITUTE_BYTE}.
 *
 * Deliberately NOT `TextEncoder`: that is UTF-8, so a `°` would become two bytes
 * the font cannot read, and any `/Length` taken from `String.length` would then
 * be a lie. Callers must always size a stream from the bytes this returns.
 */
export function encodeWinAnsi(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  let n = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    if (PASSTHROUGH.has(cp)) {
      out[n++] = cp
      continue
    }
    const b = winAnsiByte(cp)
    out[n++] = b === undefined ? SUBSTITUTE_BYTE : b
  }
  return out.subarray(0, n)
}

/**
 * Escape a string for use inside a PDF literal string, WITHOUT the surrounding
 * parentheses. `\`, `(` and `)` are the three characters that would otherwise
 * end or unbalance the literal; the line breaks are escaped so a stray one
 * cannot be mistaken for the stream's own structure.
 */
export function escapePdfText(s: string): string {
  return s
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
}

/** {@link escapePdfText} wrapped in the parentheses of a PDF literal string. */
export function pdfString(s: string): string {
  return `(${escapePdfText(s)})`
}
