/**
 * Turning what is on screen into images the PDF can embed (#1112, #1110).
 *
 * This is the one part of the PDF export that needs a DOM: everything else in
 * `lib/pdf` is pure arithmetic. It reuses the pipeline the breadboard's own
 * export already uses — `serializeLiveSvg` clones a live `<svg>`, inlines its
 * computed presentation styles so it paints standalone, and frames it at 1:1
 * independent of the on-screen pan and zoom; `rasterise` draws that through an
 * `<img>` onto a canvas.
 *
 * ONE THING WORTH SAYING OUT LOUD about block lettering: `renderer.ts` colours
 * it by publishing `--snakie-block-text` on each block's SVG group, which
 * `BlocksCanvas.css` reads as `fill: var(--snakie-block-text, #fff)`. Custom
 * properties are resolved by the time `getComputedStyle().fill` answers, so
 * `INLINE_PROPS` bakes the CONCRETE colour into the clone rather than a `var()`
 * the standalone SVG could not resolve. Were that not so, the export would be
 * white-on-pale — exactly the failure #1099 was about.
 */

import type * as Blockly from 'blockly/core'
import { canvasToBlob, rasterise, serializeLiveSvg } from '../../components/svg-export'
import type { PdfImageData } from './writer'

/** CSS pixels to PDF points: SVG measures at 96dpi, PDF at 72. */
export const PX_TO_PT = 72 / 96

/** Marks the group we are framing, so the selector cannot match the flyout's
 *  block canvas instead of the workspace's. Removed again immediately. */
const CAPTURE_ATTR = 'data-snakie-pdf-capture'

/** Chrome that should never bake into a printed page. */
const CHROME_SELECTORS = [
  '.blocklyFlyout',
  '.blocklyScrollbarBackground',
  '.blocklyScrollbarHandle',
  '.blocklyZoom',
  '.blocklyTrash',
  '.blocklyMainBackground'
]

/**
 * THE FONTS HAVE TO TRAVEL WITH THE PICTURE (#1112).
 *
 * `rasterise` draws the serialised SVG through an `<img>` — the only route the
 * renderer's CSP allows — and an SVG loaded that way is a sandboxed document
 * that fetches NOTHING external, webfonts included. Blockly lays a block out
 * around text measured in Plus Jakarta Sans; render that same markup with the
 * fallback and every label is wider than the block it sits on, so the lettering
 * spills past the edge onto the page's parchment. White on cream: #1099, again,
 * by a different route.
 *
 * So the `@font-face` rules the app already loaded are collected from the
 * document's own stylesheets and re-emitted with their sources inlined as data
 * URIs. Only the LATIN subset of each family and weight — the others are for
 * scripts no block label uses, and each one is another 12KB through the
 * rasteriser.
 */

/** The families the blocks canvas and the breadboard letter themselves in. */
export const ART_FONT_FAMILIES = ['Plus Jakarta Sans', 'IBM Plex Mono'] as const

/** Built once per family set: the same bytes go into every captured stack. */
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
 * a block label is actually lettered from.
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

/** Fetch `url` and return it as a `data:` URI, or null if it cannot be read. */
async function asDataUri(url: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    }
    return `data:font/woff2;base64,${btoa(binary)}`
  } catch {
    return null
  }
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
      const data = source.startsWith('data:') ? source : await asDataUri(source)
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

/** A top-level stack, serialised and measured. */
export interface CapturedStack {
  /** The top block's id — the same id `GeneratedProgram.functions` names. */
  id: string
  svg: string
  /** Natural width in POINTS. */
  width: number
  /** Natural height in POINTS. */
  height: number
  label?: string
  /** The function's docstring, printed under its name (#1147). */
  description?: string
}

/**
 * A `def` block's DESCRIPTION — which is its docstring (#1147).
 *
 * The two are one thing in this app: `lib/blocks/docstring.ts` reads a
 * function's `"""…"""` line into the block's comment bubble and writes the
 * bubble back out as that line, so asking the block for its comment is asking
 * the function for its docstring. The bubble is read rather than the generated
 * Python because a bubble that is NOT expressible as a docstring (one holding
 * `"""`, say) is still a description worth printing.
 *
 * Returns undefined rather than an empty string, so a function with nothing
 * written about it prints its name and nothing else.
 */
function functionDescription(block: Blockly.Block): string | undefined {
  const text = String(block.getCommentText?.() ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
  return text || undefined
}

/** Escape a Blockly id for use inside an attribute selector's quoted value. */
function attrValue(id: string): string {
  return id.replace(/["\\]/g, (c) => `\\${c}`)
}

/**
 * Capture every top-level stack as its OWN image, ordered functions first.
 *
 * Per-stack rather than one screenshot of the canvas, because that is what
 * makes "never break a block across a page" true by construction (#1112).
 */
export function captureBlockStacks(
  workspace: Blockly.WorkspaceSvg,
  functionIds: readonly string[],
  fontCss = ''
): CapturedStack[] {
  const svg = workspace.getParentSvg()
  const canvas = workspace.getCanvas()
  if (!svg || !canvas) return []

  const tops = workspace.getTopBlocks(true).filter((b) => !b.isInsertionMarker())
  if (!tops.length) return []

  const functions = new Set(functionIds)
  const ordered = [
    ...functionIds
      .map((id) => tops.find((b) => b.id === id))
      .filter((b): b is Blockly.BlockSvg => !!b),
    ...tops.filter((b) => !functions.has(b.id))
  ]

  const out: CapturedStack[] = []
  let labelledMain = false
  canvas.setAttribute(CAPTURE_ATTR, '')
  try {
    for (const block of ordered) {
      const rect = block.getBoundingRectangle()
      const frame = {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top
      }
      if (frame.width <= 0 || frame.height <= 0) continue
      const others = ordered.filter((b) => b !== block).map((b) => `[data-id="${attrValue(b.id)}"]`)
      const serialised = serializeLiveSvg(svg, `[${CAPTURE_ATTR}]`, {
        frame,
        margin: 8,
        exclude: [...CHROME_SELECTORS, ...others],
        fontCss
      })
      if (!serialised) continue

      const isFunction = functions.has(block.id)
      let label: string | undefined
      let description: string | undefined
      if (isFunction) {
        const name = String(block.getFieldValue('NAME') ?? '').trim()
        label = name ? `Function: ${name}` : 'Function'
        description = functionDescription(block)
      } else if (!labelledMain) {
        label = 'Main program'
        labelledMain = true
      }

      out.push({
        id: block.id,
        svg: serialised.svg,
        width: serialised.width * PX_TO_PT,
        height: serialised.height * PX_TO_PT,
        label,
        description
      })
    }
  } finally {
    canvas.removeAttribute(CAPTURE_ATTR)
  }
  return out
}

/** Oversampling for rasterised art, so a printed page isn't soft. */
const RASTER_SCALE = 2

/**
 * Rasterise an SVG string to a JPEG ready for {@link PdfWriter.addImage}.
 *
 * `outW`/`outH` are the SVG's own (CSS pixel) size; the JPEG is that at
 * {@link RASTER_SCALE}, and the caller places it at whatever size the page has
 * room for.
 */
export async function svgToJpeg(
  svg: string,
  outW: number,
  outH: number,
  background = '#f6f1e6'
): Promise<PdfImageData> {
  const canvas = await rasterise(svg, outW, outH, RASTER_SCALE, background)
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height
  }
}
