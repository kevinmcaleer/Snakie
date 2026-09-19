/**
 * The DOM-backed {@link ProjectArt} (#1108) — where the pictures come from.
 *
 * `project-pdf.ts` never imports any of this: it takes an art source so it stays
 * node-testable and so a capture that fails is a value it can report rather
 * than a crash halfway through writing a file. This is the real implementation
 * that runs in the app.
 */

import type * as Blockly from 'blockly/core'
import { getBlocksWorkspace } from '../blocks/workspace-registry'
import { generateProgram } from '../blocks/generator'
import { snakieMarkSvg } from '../../components/snakie-mark'
import { inlineFontCss } from '../../components/export-fonts'
import { PX_TO_PT, captureBlockStacks, svgToJpeg } from './capture'
import { PRINT_BACKGROUND, captureWiring } from './wiring-capture'
import type { DiagramArt, ProjectArt, StackArt } from './project-pdf'
import type { PdfImageData } from './writer'

/** The page every rasterised piece is drawn onto — JPEG has no alpha, so the
 *  background has to match the page or the art sits in a tinted box (#1170:
 *  the page is white now, so this is too). */
const ART_BACKGROUND = '#ffffff'

/** The mark's raster size; it is placed at ~112pt, so this is comfortably 2×. */
const LOGO_PX = 256

/** The live app's art: the mounted Blockly workspace and the breadboard. */
export function domProjectArt(
  opts: {
    functionIds?: readonly string[]
    /**
     * The workspace to photograph — the canvas on screen, or the off-screen one
     * `lib/pdf/blocks-source.ts` builds from the file when there isn't one.
     * Omitted, the art falls back to whatever is registered; null means the
     * project has no blocks at all.
     */
    workspace?: Blockly.WorkspaceSvg | null
  } = {}
): ProjectArt {
  return {
    async blockStacks(): Promise<readonly StackArt[]> {
      const workspace = opts.workspace === undefined ? getBlocksWorkspace() : opts.workspace
      if (!workspace) return []
      // The generator's own notion of which stacks are functions, so the pages
      // and the generated `.py` order them the same way (#1112). The caller
      // normally hands over the pass it already ran for the listing.
      const functions = opts.functionIds ?? generateProgram(workspace).functions
      // The app's webfont, inlined — Blockly's layout assumes it, and an
      // `<img>`-rendered SVG cannot fetch it (see `export-fonts.ts`).
      const captured = captureBlockStacks(workspace, functions, await inlineFontCss())
      const out: StackArt[] = []
      for (const stack of captured) {
        out.push({
          id: stack.id,
          label: stack.label,
          description: stack.description,
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
      const diagram = await captureWiring(PRINT_BACKGROUND, await inlineFontCss())
      if (!diagram) return null
      return {
        width: diagram.width * PX_TO_PT,
        height: diagram.height * PX_TO_PT,
        // The board's OWN sheet, not the page's parchment (#1168): it is drawn
        // on the white print mat, and a JPEG has no alpha to let the page show
        // through anyway.
        jpeg: await svgToJpeg(diagram.svg, diagram.width, diagram.height, PRINT_BACKGROUND)
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
