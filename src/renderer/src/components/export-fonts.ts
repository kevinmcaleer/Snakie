/**
 * THE FONTS HAVE TO TRAVEL WITH THE PICTURE (#1112).
 *
 * {@link rasterise} draws a serialised SVG through an `<img>` — the only route
 * the renderer's CSP allows — and an SVG loaded that way is a sandboxed
 * document that fetches NOTHING external, webfonts included. Blockly lays a
 * block out around text measured in Plus Jakarta Sans, and the breadboard sizes
 * its part labels and pin names the same way; render that same markup with the
 * fallback and every label is wider than the shape it sits on, so the lettering
 * spills past the edge onto the page's parchment. White on cream: #1099, again,
 * by a different route.
 *
 * So the `@font-face` rules the app already loaded are collected from the
 * document's own stylesheets and re-emitted with their sources inlined as data
 * URIs, ready to drop into a serialised SVG as `serializeLiveSvg`'s `fontCss`.
 * Only the LATIN subset of each family and weight — the others are for scripts
 * no label uses, and each one is another 12KB through the rasteriser.
 *
 * This lives beside `svg-export.ts` rather than under `lib/pdf` because it is
 * not about PDFs: it belongs to every export that goes through `<img>`, which
 * is the Board Viewer's own PNG/SVG/PDF menu as much as the printed document.
 */

import { fetchAsDataUri } from './svg-export'

/** The families the blocks canvas and the breadboard letter themselves in. */
export const ART_FONT_FAMILIES = ['Plus Jakarta Sans', 'IBM Plex Mono'] as const

/** Built once per family set: the same bytes go into every captured picture. */
const FONT_CSS_CACHE = new Map<string, Promise<string>>()

/** `"Plus Jakarta Sans", sans-serif` → `plus jakarta sans`. */
function familyKey(value: string): string {
  return value.split(',')[0].replace(/['"]/g, '').trim().toLowerCase()
}

/** The first `woff2` source in a `src` descriptor, resolved against `base`. */
function woff2Source(src: string, base: string | null): string | null {
  const match = /url\((['"]?)([^)'"]+)\1\)\s*format\((['"]?)woff2\3\)/.exec(src)
  if (!match) return null
  const raw = match[2]
  if (raw.startsWith('data:')) return raw
  try {
    return new URL(raw, base ?? document.baseURI).href
  } catch {
    return null
  }
}

/**
 * Whether a `unicode-range` descriptor covers plain ASCII — i.e. is the subset
 * a label is actually lettered from.
 *
 * Parsed rather than matched as text: the CSSOM NORMALISES the descriptor, so
 * the latin subset's authored `U+0000-00FF` reads back as `U+0-FF` and a
 * literal comparison silently selects nothing.
 */
export function coversLatin(range: string): boolean {
  if (!range.trim()) return true
  for (const part of range.split(',')) {
    const match = /^\s*U\+([0-9a-f]+)(?:-([0-9a-f]+))?\s*$/i.exec(part)
    if (!match) continue
    const low = parseInt(match[1], 16)
    const high = match[2] ? parseInt(match[2], 16) : low
    if (low <= 0x41 && 0x41 <= high) return true // 'A'
  }
  return false
}

async function collectFontCss(families: readonly string[]): Promise<string> {
  if (typeof document === 'undefined') return ''
  const wanted = new Set(families.map((f) => familyKey(f)))
  const seen = new Set<string>()
  const out: string[] = []

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // a cross-origin stylesheet will not be read; nothing to do
    }
    for (const rule of Array.from(rules)) {
      if (rule.type !== 5 /* CSSRule.FONT_FACE_RULE */) continue
      const style = (rule as CSSStyleRule).style
      const declared = style.getPropertyValue('font-family')
      if (!wanted.has(familyKey(declared))) continue
      // Keep the LATIN subset; the others are for scripts no label uses.
      if (!coversLatin(style.getPropertyValue('unicode-range'))) continue
      const weight = style.getPropertyValue('font-weight') || '400'
      const slant = style.getPropertyValue('font-style') || 'normal'
      const id = `${familyKey(declared)}|${weight}|${slant}`
      if (seen.has(id)) continue
      const source = woff2Source(style.getPropertyValue('src'), sheet.href)
      if (!source) continue
      const data = source.startsWith('data:') ? source : await fetchAsDataUri(source, 'font/woff2')
      if (!data) continue
      seen.add(id)
      out.push(
        `@font-face{font-family:'${declared.replace(/['"]/g, '').split(',')[0].trim()}';` +
          `font-style:${slant};font-weight:${weight};src:url(${data}) format('woff2');}`
      )
    }
  }
  return out.join('')
}

/**
 * `@font-face` rules for `families`, with their sources inlined, ready to drop
 * into a serialised SVG. Never throws: art with fallback lettering is still
 * better than no art, so a failure here is an empty string.
 */
export function inlineFontCss(families: readonly string[] = ART_FONT_FAMILIES): Promise<string> {
  const key = families.join('|')
  const cached = FONT_CSS_CACHE.get(key)
  if (cached) return cached
  const job = collectFontCss(families).catch(() => '')
  FONT_CSS_CACHE.set(key, job)
  return job
}

/** Test seam: forget the inlined fonts. */
export function resetFontCssCache(): void {
  FONT_CSS_CACHE.clear()
}
