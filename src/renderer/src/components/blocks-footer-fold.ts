/**
 * THE BLOCK-LAYOUT FOOTER, TUCKED AWAY IN THE CODE EDITOR.
 * =============================================================================
 *
 * A file saved from Blocks is ordinary MicroPython with a comment footer at the
 * end (`# --8<-- snakie-blocks v1 …` and lines of encoded layout, see
 * `shared/blocks-doc.ts`). The board ignores it; Blocks reads it to put each
 * block back where you left it.
 *
 * Since the Code workspace opens every `.py` in the same code editor, that
 * footer would sit at the bottom of the file as a wall of base64. The editor
 * keeps the marker line (it says "do not edit below this line") and hides the
 * payload lines under it. Pure, so which lines hide is a test.
 */

/** Matches the footer marker line (same shape `blocks-doc.ts` writes). */
const MARKER_RE = /^#[ \t]*--8<--[ \t]+snakie-blocks[ \t]+v\d+/

/**
 * The 1-based, inclusive line range of the footer's payload (the comment lines
 * after the LAST marker), or null when there is no footer or no payload.
 */
export function blocksFooterPayloadLines(
  lines: readonly string[]
): { markerLine: number; startLine: number; endLine: number } | null {
  let marker = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (MARKER_RE.test(lines[i])) {
      marker = i
      break
    }
  }
  if (marker < 0) return null
  let end = marker
  for (let i = marker + 1; i < lines.length; i++) {
    if (/^#/.test(lines[i])) end = i
    else break
  }
  if (end === marker) return null
  return { markerLine: marker + 1, startLine: marker + 2, endLine: end + 1 }
}
