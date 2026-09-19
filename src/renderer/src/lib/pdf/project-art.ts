/**
 * The DOM-backed {@link ProjectArt} (#1108) — where the pictures come from.
 *
 * `project-pdf.ts` never imports any of this: it takes an art source so it stays
 * node-testable and so a capture that fails is a value it can report rather
 * than a crash halfway through writing a file. This is the real implementation
 * that runs in the app.
 */

import { getBlocksWorkspace } from '../blocks/workspace-registry'
import { generateProgram } from '../blocks/generator'
import { snakieMarkSvg } from '../../components/snakie-mark'
import { PX_TO_PT, captureBlockStacks, inlineFontCss, svgToJpeg } from './capture'
import { captureWiringDiagram } from './wiring-capture'
import type { DiagramArt, ProjectArt, StackArt } from './project-pdf'
import type { PdfImageData } from './writer'

/** The parchment every rasterised piece is drawn onto — JPEG has no alpha, so
 *  the background has to match the page or the art sits in a grey box. */
const ART_BACKGROUND = '#f6f1e6'

/** The mark's raster size; it is placed at ~112pt, so this is comfortably 2×. */
const LOGO_PX = 256

/** The live app's art: the mounted Blockly workspace and the breadboard. */
export function domProjectArt(opts: { functionIds?: readonly string[] } = {}): ProjectArt {
  return {
    async blockStacks(): Promise<readonly StackArt[]> {
      const workspace = getBlocksWorkspace()
      if (!workspace) return []
      // The generator's own notion of which stacks are functions, so the pages
      // and the generated `.py` order them the same way (#1112). The caller
      // normally hands over the pass it already ran for the listing.
      const functions = opts.functionIds ?? generateProgram(workspace).functions
      // The app's webfont, inlined — Blockly's layout assumes it, and an
      // `<img>`-rendered SVG cannot fetch it (see `capture.ts`).
      const captured = captureBlockStacks(workspace, functions, await inlineFontCss())
      const out: StackArt[] = []
      for (const stack of captured) {
        out.push({
          id: stack.id,
          label: stack.label,
          width: stack.width,
          height: stack.height,
          jpeg: await svgToJpeg(
            stack.svg,
            stack.width / PX_TO_PT,
            stack.height / PX_TO_PT,
            ART_BACKGROUND
          )
        })
      }
      return out
    },

    async wiring(): Promise<DiagramArt | null> {
      const captured = await captureWiringDiagram(ART_BACKGROUND, await inlineFontCss())
      if (!captured) return null
      return {
        width: captured.width * PX_TO_PT,
        height: captured.height * PX_TO_PT,
        jpeg: await svgToJpeg(captured.svg, captured.width, captured.height, ART_BACKGROUND)
      }
    },

    async logo(): Promise<PdfImageData | null> {
      try {
        return await svgToJpeg(
          snakieMarkSvg(LOGO_PX, ART_BACKGROUND),
          LOGO_PX,
          LOGO_PX,
          ART_BACKGROUND
        )
      } catch {
        // The cover reads fine without the mark; it is decoration, not content.
        return null
      }
    }
  }
}
