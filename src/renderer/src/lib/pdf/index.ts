/**
 * Snakie's zero-dependency PDF writer (epic #1105).
 *
 * `writer.ts` emits objects and bytes; `layout.ts` turns those into pages with
 * margins, a running footer and flowed text; `content.ts` builds the operator
 * stream; `metrics.ts` and `winansi.ts` make the measurements and the encoding
 * exact. Nothing here touches the DOM, so it all unit-tests in node.
 */

export { ContentStream, hexRgb, num, BLACK, FONT_RESOURCE } from './content'
export type { Rgb, PaintMode, TextAlign } from './content'
export { COURIER_WIDTH, courierCharsPerLine, glyphWidth, textWidth } from './metrics'
export type { PdfFont } from './metrics'
export {
  encodeWinAnsi,
  escapePdfText,
  isWinAnsiRepresentable,
  pdfString,
  winAnsiByte
} from './winansi'
export { PdfPageBuilder, PdfWriter } from './writer'
export type { PdfImageData, PdfImageRef, PdfInfo } from './writer'
export {
  A4,
  DEFAULT_MARGINS,
  LETTER,
  LaidOutPage,
  PdfDocument,
  expandTabs,
  fitBox,
  packUnits,
  wrapMonospace,
  wrapText
} from './layout'
export type { Box, DocumentOptions, Margins, PackUnit, PageSize } from './layout'
