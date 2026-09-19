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
import { type CapturedWiring, captureWiring } from './wiring-capture'
import type { DiagramArt, ProjectArt, StackArt } from './project-pdf'
import type { PdfImageData } from './writer'

/** The parchment every rasterised piece is drawn onto — JPEG has no alpha, so
 *  the background has to match the page or the art sits in a grey box. */
const ART_BACKGROUND = '#f6f1e6'

/** The mark's raster size; it is placed at ~112pt, so this is comfortably 2×. */
const LOGO_PX = 256

/** The live app's art: the mounted Blockly workspace and the breadboard. */
export function domProjectArt(opts: { functionIds?: readonly string[] } = {}): ProjectArt {
  /**
   * ONE capture of the board, shared by both of its pages (#1147).
   *
   * `captureWiring` may mount a whole off-screen `BoardPane` and wait for its
   * libraries — much the most expensive thing this module does — and the
   * document asks for the diagram and the sheet separately. Memoising the
   * PROMISE means the second ask is free however the two calls interleave.
   */
  let board: Promise<CapturedWiring | null> | null = null
  const captureBoard = async (): Promise<CapturedWiring | null> => {
    board ??= captureWiring(ART_BACKGROUND, await inlineFontCss())
    return board
  }

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
      const captured = await captureBoard()
      if (!captured) return null
      const { diagram } = captured
      return {
        width: diagram.width * PX_TO_PT,
        height: diagram.height * PX_TO_PT,
        jpeg: await svgToJpeg(diagram.svg, diagram.width, diagram.height, ART_BACKGROUND)
      }
    },

    async wiringSheet(): Promise<DiagramArt | null> {
      const sheet = (await captureBoard())?.sheet
      if (!sheet) return null
      return {
        width: sheet.width * PX_TO_PT,
        height: sheet.height * PX_TO_PT,
        // The sheet's OWN mat, not the parchment: this page is the workspace's
        // export, and a JPEG has no alpha to let the page show through.
        jpeg: await svgToJpeg(sheet.svg, sheet.width, sheet.height, sheet.background)
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
