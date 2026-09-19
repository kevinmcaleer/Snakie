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
  functionIds: readonly string[]
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
        exclude: [...CHROME_SELECTORS, ...others]
      })
      if (!serialised) continue

      const isFunction = functions.has(block.id)
      let label: string | undefined
      if (isFunction) {
        const name = String(block.getFieldValue('NAME') ?? '').trim()
        label = name ? `Function: ${name}` : 'Function'
      } else if (!labelledMain) {
        label = 'Main program'
        labelledMain = true
      }

      out.push({
        id: block.id,
        svg: serialised.svg,
        width: serialised.width * PX_TO_PT,
        height: serialised.height * PX_TO_PT,
        label
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
