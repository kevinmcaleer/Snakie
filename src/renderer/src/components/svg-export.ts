/**
 * Shared, dependency-free SVG → image/PDF export helpers.
 *
 * The Board Viewer can save its canvas as SVG, PNG or a (image-only) PDF. ALL of
 * this runs in the renderer with no extra dependency:
 *  - {@link rasterise} draws an SVG string onto a 2D canvas,
 *  - {@link canvasToBlob} reads it back as a blob,
 *  - {@link buildImagePdf} hand-assembles a tiny single-page PDF around a JPEG,
 *  - {@link downloadBlob} triggers the browser download.
 *
 * {@link serializeLiveSvg} captures a LIVE `<svg>` (e.g. the breadboard) by
 * cloning it, inlining its computed styles (so it renders standalone without the
 * app's external CSS) and framing it tightly to a content group's bounding box at
 * 1:1 — independent of the on-screen pan/zoom. {@link exportSvgString} dispatches
 * an SVG string to the chosen format. Extracted from BoardGraph so the node-graph
 * and the breadboard share one pipeline.
 */

import { PdfWriter } from '../lib/pdf'

export type ExportFmt = 'svg' | 'png' | 'pdf'

/** XML-escape a string for use inside SVG text / attributes. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Trigger a browser download of a Blob under `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Load an SVG string as an <img> and draw it onto a fresh 2D canvas at `dpr`. */
export async function rasterise(
  svg: string,
  outW: number,
  outH: number,
  dpr: number,
  background?: string
): Promise<HTMLCanvasElement> {
  const img = new Image()
  // Load via a `data:` URL, NOT a `blob:` object URL. The renderer's CSP is
  // `img-src 'self' data:` — a blob: URL is blocked, so the <img> would silently
  // fail to load and PNG/PDF export would do nothing (SVG export still works as it
  // downloads via an <a>, not an <img>). data: is allowed and doesn't taint the
  // canvas (so toBlob succeeds). encodeURIComponent keeps the SVG markup valid.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG image failed to load'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(outW * dpr))
  canvas.height = Math.max(1, Math.round(outH * dpr))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2D canvas context')
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.scale(dpr, dpr)
  ctx.drawImage(img, 0, 0, outW, outH)
  return canvas
}

/** Read a canvas as a Blob of the given MIME (+ quality). */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality)
  })
}

/**
 * Build a single-page PDF embedding a JPEG (the rasterised view) at
 * `outW`×`outH` points. Still no dependency — it now goes through the shared
 * writer in `lib/pdf` (#1113), which is the same one the project export uses,
 * so there is one implementation of "get the bytes right" rather than two.
 *
 * `pixelW`/`pixelH` are the JPEG's own dimensions; they differ from the placed
 * size whenever the canvas was rasterised above 1× and belong in the XObject's
 * `/Width` and `/Height`.
 */
export function buildImagePdf(
  jpeg: Uint8Array,
  outW: number,
  outH: number,
  pixelW = Math.round(outW),
  pixelH = Math.round(outH)
): Blob {
  const w = Math.round(outW)
  const h = Math.round(outH)
  const writer = new PdfWriter()
  const image = writer.addImage({ jpeg, width: pixelW, height: pixelH })
  const page = writer.addPage(w, h)
  page.drawImage(image, 0, 0, w, h)
  return new Blob([writer.build()], { type: 'application/pdf' })
}

/** The mat colour an export falls back to when the stage has none of its own. */
export const DEFAULT_SHEET_BACKGROUND = '#161719'

/**
 * The sheet colour BEHIND a canvas, read live.
 *
 * The board's mat lives in CSS on the stage (blueprint blue / schematic white /
 * dark mat), so an export that wants to look like what is on screen has to ask
 * the element rather than pick a constant. A fully transparent background —
 * which is what a detached or unstyled element answers — is no colour at all,
 * so the fallback stands in for it.
 */
export function stageBackground(
  el: Element | null | undefined,
  fallback = DEFAULT_SHEET_BACKGROUND
): string {
  const parent = el?.parentElement
  if (!parent) return fallback
  const bg = getComputedStyle(parent).backgroundColor
  return bg && !/rgba?\([^)]*,\s*0\s*\)/.test(bg) ? bg : fallback
}

/** SVG presentation properties worth inlining so a serialized SVG paints alone. */
const INLINE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  // Preserve the blueprint paper's soft-light mottle in exports.
  'mix-blend-mode',
  // Preserve CSS-applied filters (e.g. the blueprint grid's ink-on-paper wobble).
  'filter',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline'
]

/** Copy `live`'s computed presentation styles onto `clone` and recurse (the two
 *  trees are clones, so they walk in lockstep). */
function inlineComputedStyles(live: Element, clone: Element): void {
  const cs = window.getComputedStyle(live)
  let style = ''
  for (const p of INLINE_PROPS) {
    const v = cs.getPropertyValue(p)
    if (v) style += `${p}:${v};`
  }
  clone.setAttribute('style', style + (clone.getAttribute('style') ?? ''))
  const lc = live.children
  const cc = clone.children
  for (let i = 0; i < lc.length && i < cc.length; i++) inlineComputedStyles(lc[i], cc[i])
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Serialise a LIVE `<svg>` to a standalone string, framed tightly (1:1) to the
 * bounding box of the `contentSelector` group and independent of the on-screen
 * pan/zoom (the content group's own transform is dropped in the clone). Computed
 * styles are inlined so it renders without the app's CSS. Returns null when the
 * content has no measurable box.
 */
/** A child's bbox mapped into its PARENT's coordinate space. `getBBox()` alone
 *  is in the child's own (pre-transform) space, so a translated group would be
 *  mislocated — apply the child's transform matrix to the box corners. */
function childBoxInParent(
  k: SVGGraphicsElement
): { x0: number; y0: number; x1: number; y1: number } | null {
  let bb: DOMRect
  try {
    bb = k.getBBox()
  } catch {
    return null
  }
  if (!bb.width && !bb.height) return null
  const m = k.transform?.baseVal?.consolidate?.()?.matrix
  if (!m) return { x0: bb.x, y0: bb.y, x1: bb.x + bb.width, y1: bb.y + bb.height }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [px, py] of [
    [bb.x, bb.y],
    [bb.x + bb.width, bb.y],
    [bb.x, bb.y + bb.height],
    [bb.x + bb.width, bb.y + bb.height]
  ]) {
    const X = m.a * px + m.c * py + m.e
    const Y = m.b * px + m.d * py + m.f
    x0 = Math.min(x0, X)
    y0 = Math.min(y0, Y)
    x1 = Math.max(x1, X)
    y1 = Math.max(y1, Y)
  }
  return { x0, y0, x1, y1 }
}

/** Union bbox (in the group's own space) of a group's direct children, skipping
 *  `<defs>` + `exclude` selectors. Falls back to the full getBBox if none. */
function bboxExcluding(
  content: SVGGraphicsElement,
  exclude: string[]
): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  content.querySelectorAll(':scope > *').forEach((k) => {
    if (k.tagName.toLowerCase() === 'defs') return
    if (exclude.some((sel) => (k as Element).matches?.(sel))) return
    const b = childBoxInParent(k as SVGGraphicsElement)
    if (!b) return
    x0 = Math.min(x0, b.x0)
    y0 = Math.min(y0, b.y0)
    x1 = Math.max(x1, b.x1)
    y1 = Math.max(y1, b.y1)
  })
  if (!Number.isFinite(x0)) return content.getBBox()
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function serializeLiveSvg(
  svg: SVGSVGElement,
  contentSelector: string,
  opts: {
    background?: string
    margin?: number
    exclude?: string[]
    /** Frame to everything EXCEPT children matching these selectors (e.g. the
     *  full-canvas grid/paper) so the export is tight to the drawing, and those
     *  large backdrop layers just fill the framed area to the edges. */
    bboxExclude?: string[]
    /**
     * Frame to THIS box (in the content group's own coordinates) instead of
     * measuring the group (#1112).
     *
     * The blocks export captures one stack at a time out of a canvas holding
     * several: the other stacks are excluded from the clone, but the live group
     * still measures as all of them, so the caller supplies the box it wants.
     */
    frame?: { x: number; y: number; width: number; height: number }
    /**
     * CSS to embed in the serialised file — in practice `@font-face` rules with
     * their sources inlined as data URIs (#1112).
     *
     * An SVG rendered through an `<img>` (which is how {@link rasterise} works,
     * and the only route the renderer's CSP allows) loads NO external resource,
     * fonts included. Without this the app's webfont silently falls back to a
     * wider one, and text laid out to fit a Blockly block runs off the end of
     * it — white lettering on the page's parchment, which is #1099 again.
     */
    fontCss?: string
  } = {}
): { svg: string; width: number; height: number } | null {
  const content = svg.querySelector(contentSelector) as SVGGraphicsElement | null
  if (!content) return null
  let bbox: { x: number; y: number; width: number; height: number }
  try {
    bbox = opts.frame
      ? opts.frame
      : opts.bboxExclude?.length
        ? bboxExcluding(content, opts.bboxExclude)
        : content.getBBox()
  } catch {
    return null
  }
  if (!bbox.width || !bbox.height) return null
  const m = opts.margin ?? 16
  const x = bbox.x - m
  const y = bbox.y - m
  const w = Math.round(bbox.width + 2 * m)
  const h = Math.round(bbox.height + 2 * m)

  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineComputedStyles(svg, clone)
  // Drop UI-only chrome (e.g. the selection ring) so it doesn't bake into the file.
  opts.exclude?.forEach((sel) => clone.querySelectorAll(sel).forEach((n) => n.remove()))
  const cloneContent = clone.querySelector(contentSelector) as SVGGraphicsElement | null
  if (cloneContent) cloneContent.removeAttribute('transform') // drop pan/zoom → raw coords
  clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  clone.setAttribute('xmlns', SVG_NS)
  if (opts.fontCss) {
    const style = document.createElementNS(SVG_NS, 'style')
    style.textContent = opts.fontCss
    clone.insertBefore(style, clone.firstChild)
  }
  if (opts.background) {
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', String(x))
    rect.setAttribute('y', String(y))
    rect.setAttribute('width', String(w))
    rect.setAttribute('height', String(h))
    rect.setAttribute('fill', opts.background)
    clone.insertBefore(rect, clone.firstChild)
  }
  return { svg: new XMLSerializer().serializeToString(clone), width: w, height: h }
}

/** Dispatch an SVG string to the chosen export format, triggering a download. */
export async function exportSvgString(
  svgStr: string,
  fmt: ExportFmt,
  outW: number,
  outH: number,
  baseName: string,
  background = '#161719'
): Promise<void> {
  if (fmt === 'svg') {
    downloadBlob(new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.svg`)
    return
  }
  if (fmt === 'png') {
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const canvas = await rasterise(svgStr, outW, outH, dpr)
    downloadBlob(await canvasToBlob(canvas, 'image/png'), `${baseName}.png`)
    return
  }
  // PDF: image-only single page (JPEG stream) — see buildImagePdf.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = await rasterise(svgStr, outW, outH, dpr, background)
  const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer())
  downloadBlob(buildImagePdf(jpeg, outW, outH, canvas.width, canvas.height), `${baseName}.pdf`)
}
