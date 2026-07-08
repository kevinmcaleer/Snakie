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
export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality)
  })
}

/**
 * Build a minimal single-page PDF embedding a JPEG (the rasterised view) at
 * `outW`×`outH` points. No dependency: a tiny hand-assembled PDF (5 objects +
 * xref) with a single `/DCTDecode` (JPEG) image XObject. Intentionally the
 * WEAKEST export — an image-only, vector-less page — but a real, openable PDF.
 */
export function buildImagePdf(jpeg: Uint8Array, outW: number, outH: number): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (chunk: Uint8Array | string): void => {
    const u = typeof chunk === 'string' ? enc.encode(chunk) : chunk
    parts.push(u)
    length += u.length
  }
  const startObj = (): void => {
    offsets.push(length)
  }
  const w = Math.round(outW)
  const h = Math.round(outH)

  push('%PDF-1.4\n%ÿÿÿÿ\n')
  startObj()
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObj()
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  startObj()
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  )
  startObj()
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  )
  push(jpeg)
  push('\nendstream\nendobj\n')
  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`
  startObj()
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
  const xrefOffset = length
  let xref = `xref\n0 6\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  const total = new Uint8Array(length)
  let pos = 0
  for (const p of parts) {
    total.set(p, pos)
    pos += p.length
  }
  return new Blob([total], { type: 'application/pdf' })
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
function childBoxInParent(k: SVGGraphicsElement): { x0: number; y0: number; x1: number; y1: number } | null {
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
  } = {}
): { svg: string; width: number; height: number } | null {
  const content = svg.querySelector(contentSelector) as SVGGraphicsElement | null
  if (!content) return null
  let bbox: { x: number; y: number; width: number; height: number }
  try {
    bbox = opts.bboxExclude?.length ? bboxExcluding(content, opts.bboxExclude) : content.getBBox()
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
  downloadBlob(buildImagePdf(jpeg, outW, outH), `${baseName}.pdf`)
}
