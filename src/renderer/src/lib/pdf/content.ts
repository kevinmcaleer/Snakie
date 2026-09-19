/**
 * A PDF content stream builder (#1113).
 *
 * Coordinates here are RAW PDF user space: the origin is the BOTTOM-left of the
 * page and y grows upwards. The page-layout layer (`layout.ts`) is what offers a
 * top-left, "reading order" API on top of this; keeping the two apart means the
 * flip happens in exactly one place.
 */

import { type PdfFont, textWidth } from './metrics'
import { pdfString } from './winansi'

/** An RGB colour with components in 0–1. */
export type Rgb = readonly [number, number, number]

export const BLACK: Rgb = [0, 0, 0]

/** Parse `#rgb`/`#rrggbb` into a {@link Rgb}. Unparseable input reads as black. */
export function hexRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return BLACK
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255
  ]
}

/** The `/Font` resource name each base-14 font is published under. */
export const FONT_RESOURCE: Readonly<Record<PdfFont, string>> = {
  Helvetica: 'F1',
  'Helvetica-Bold': 'F2',
  Courier: 'F3'
}

/**
 * Format a number for the content stream: at most 4 decimals, no exponent, no
 * trailing zeros. PDF has no notion of `1e-7`, and a stable shortest form keeps
 * the output byte-for-byte deterministic (#1108).
 */
export function num(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 10000) / 10000
  if (Number.isInteger(r)) return String(r)
  return r.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

/** How a path is painted. */
export type PaintMode = 'fill' | 'stroke' | 'fillStroke'

const PAINT_OP: Record<PaintMode, string> = { fill: 'f', stroke: 'S', fillStroke: 'B' }

/** Horizontal placement for {@link ContentStream.text}. */
export type TextAlign = 'left' | 'center' | 'right'

/** Accumulates content-stream operators for a single page. */
export class ContentStream {
  private readonly ops: string[] = []

  /** `q` — push the graphics state. */
  save(): this {
    this.ops.push('q')
    return this
  }

  /** `Q` — pop the graphics state. */
  restore(): this {
    this.ops.push('Q')
    return this
  }

  fillColor(c: Rgb): this {
    this.ops.push(`${num(c[0])} ${num(c[1])} ${num(c[2])} rg`)
    return this
  }

  strokeColor(c: Rgb): this {
    this.ops.push(`${num(c[0])} ${num(c[1])} ${num(c[2])} RG`)
    return this
  }

  lineWidth(w: number): this {
    this.ops.push(`${num(w)} w`)
    return this
  }

  /** A rectangle with its lower-left corner at (`x`, `y`). */
  rect(x: number, y: number, w: number, h: number, mode: PaintMode = 'fill'): this {
    this.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${PAINT_OP[mode]}`)
    return this
  }

  line(x1: number, y1: number, x2: number, y2: number): this {
    this.ops.push(`${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`)
    return this
  }

  /**
   * Show `text` with its BASELINE at `y`, aligned about `x`. Centre and right
   * alignment measure with the real font metrics, so they are correct rather
   * than eyeballed.
   */
  text(
    text: string,
    x: number,
    y: number,
    opts: { font?: PdfFont; size?: number; color?: Rgb; align?: TextAlign } = {}
  ): this {
    const font = opts.font ?? 'Helvetica'
    const size = opts.size ?? 11
    const align = opts.align ?? 'left'
    let tx = x
    if (align !== 'left') {
      const w = textWidth(text, font, size)
      tx = align === 'center' ? x - w / 2 : x - w
    }
    this.ops.push('BT')
    this.ops.push(`/${FONT_RESOURCE[font]} ${num(size)} Tf`)
    this.ops.push(
      `${num((opts.color ?? BLACK)[0])} ${num((opts.color ?? BLACK)[1])} ${num((opts.color ?? BLACK)[2])} rg`
    )
    this.ops.push(`${num(tx)} ${num(y)} Td`)
    this.ops.push(`${pdfString(text)} Tj`)
    this.ops.push('ET')
    return this
  }

  /**
   * Draw the image published as `resourceName` into the box whose lower-left
   * corner is (`x`, `y`). The image XObject is a unit square, so the `cm` matrix
   * IS the placement — callers that care about aspect ratio should size the box
   * with `fitBox` from `layout.ts` first.
   */
  image(resourceName: string, x: number, y: number, w: number, h: number): this {
    this.ops.push('q')
    this.ops.push(`${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm`)
    this.ops.push(`/${resourceName} Do`)
    this.ops.push('Q')
    return this
  }

  /** True when nothing has been drawn. */
  get isEmpty(): boolean {
    return this.ops.length === 0
  }

  toString(): string {
    return this.ops.length ? `${this.ops.join('\n')}\n` : ''
  }
}
