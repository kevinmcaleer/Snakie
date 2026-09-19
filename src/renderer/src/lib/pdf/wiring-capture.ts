/**
 * Getting the breadboard into the document (#1110, #1147, #1168).
 *
 * THE DECISION THIS ISSUE ASKED FOR, stated plainly: the export **renders the
 * diagram off-screen from the project model on demand**, every time.
 *
 * The other two options were rejected:
 *
 *  - *Keep a mounted-but-hidden canvas.* The breadboard is not cheap — it is
 *    the reason `BoardPane` is lazily loaded at all — and paying for it on
 *    every session so that printing is quick is the wrong trade.
 *  - *Require the Electronics view and tell the user why.* "Go and open another
 *    tab, then press print again" is a worse answer than doing it for them,
 *    when the project model already has everything needed to draw it.
 *
 * WHY NOT REUSE THE CANVAS ON SCREEN, which this module used to do when the
 * Electronics view happened to be open: the printed page would then be dressed
 * in whatever mat that window is set to — a dark or blueprint sheet, with the
 * ink turned round to suit it — so the same project printed two different
 * documents depending on which tab you pressed the button from. One board,
 * rendered for the page on the white print mat, is the picture the document
 * wants (#1168).
 *
 * `BoardPane` feeds itself from the workspace store, so mounting one into an
 * off-screen host gives a real, laid-out canvas without duplicating any of its
 * plumbing here — but it has to be mounted by the APP, inside its providers: a
 * React root of its own is a TREE of its own, and the pane threw
 * `useWorkspace must be used within a WorkspaceProvider` where nothing could
 * see it. `BoardCaptureHost` does the mounting; see
 * `components/board-capture-registry.ts`.
 *
 * WAITING FOR A BOARD THAT IS ACTUALLY DRAWN (#1168). The pane fills itself in
 * asynchronously — robot.yml, then the installed part libraries — and until the
 * libraries land every placed part draws as a `part library not installed`
 * placeholder: a box with NO PINS, and therefore no wires between them. A
 * capture taken in that window is a picture of an empty bench, and it is
 * perfectly stable while it lasts, so "measured the same twice" was not enough
 * to rule it out. The pane says when it has everything (`data-board-ready`);
 * only then does the stability check start.
 *
 * The one hard rule: this returns null rather than something blank. A blank
 * wiring page is worse than no wiring page, so an empty or unmeasurable canvas
 * is reported as "no diagram" and the section is left out (#1108).
 */

import { inlineImageHrefs, serializeLiveSvg } from '../../components/svg-export'
import { mountCaptureBoard } from '../../components/board-capture-registry'

/** A serialised diagram at its natural CSS-pixel size. */
export interface CapturedDiagram {
  svg: string
  width: number
  height: number
}

/** Chrome and view-derived backdrops that should not bake into a printed page. */
const EXCLUDE = ['.wc__sel-ring', '.wc__grid-layer', '.wc__paper']

/** The print mat: a plain white sheet, the same one Settings ▸ Appearance
 *  offers for printing and screenshots. */
export const PRINT_MAT = 'white'
/** …and its colour, for the margin the frame leaves around the drawing. */
export const PRINT_BACKGROUND = '#ffffff'

/** How long to wait for an off-screen board to finish loading its libraries. */
const MOUNT_TIMEOUT_MS = 20000
const POLL_MS = 80

/** Serialise a breadboard `<svg>`, framed tight to the parts. */
export function serialiseWiring(
  svg: SVGSVGElement,
  background = PRINT_BACKGROUND,
  fontCss = ''
): CapturedDiagram | null {
  return serializeLiveSvg(svg, '.wc__content', {
    background,
    margin: 20,
    // The grid and the paper are view-derived full-canvas layers; the printed
    // page wants the drawing on the sheet, not a screenshot of the mat.
    exclude: EXCLUDE,
    bboxExclude: ['.wc__grid-layer', '.wc__paper'],
    // Part labels and pin names are lettered in the app's webfont, which an
    // `<img>`-rendered SVG cannot fetch — see `export-fonts.ts`.
    fontCss
  })
}

/** A `<div>` parked off-screen, big enough for the canvas to lay out in. */
function offscreenHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.dataset.snakiePdfHost = ''
  // Off-screen rather than hidden: `display: none` makes `getBBox()` zero and
  // the capture would measure nothing.
  host.style.cssText =
    'position:fixed;left:-30000px;top:0;width:1400px;height:1000px;pointer-events:none;'
  document.body.appendChild(host)
  return host
}

/** Resolve once `probe` returns the same non-null answer twice running. */
async function settle(
  probe: () => CapturedDiagram | null,
  deadline: number
): Promise<CapturedDiagram | null> {
  let previous: string | null = null
  while (Date.now() < deadline) {
    const value = probe()
    if (value !== null) {
      // Size and serialised length, rather than the whole markup: the string is
      // large and this runs several times a second.
      const fingerprint = `${value.width}x${value.height}:${value.svg.length}`
      if (fingerprint === previous) return value
      previous = fingerprint
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return null
}

/** Resolve once the pane says it has its robot.yml AND its part libraries, or
 *  null if it never does. Everything after this is a board actually drawn. */
async function ready(host: HTMLElement, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    if (host.querySelector('[data-board-ready]')) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return false
}

/** Carry the part photos into the capture. A no-op on the desktop, where the
 *  main process has already inlined them; on the web they are build assets
 *  named by URL, which the `<img>` the rasteriser uses cannot fetch, so the
 *  board would print without its own photograph. */
async function withImages(d: CapturedDiagram | null): Promise<CapturedDiagram | null> {
  return d ? { ...d, svg: await inlineImageHrefs(d.svg) } : null
}

/**
 * The project's wiring, rendered for the page. Null means "nothing to draw" —
 * never a blank.
 */
export async function captureWiring(
  background = PRINT_BACKGROUND,
  fontCss = ''
): Promise<CapturedDiagram | null> {
  if (typeof document === 'undefined') return null

  const host = offscreenHost()
  let unmount: (() => void) | null = null
  try {
    // The app renders the pane — inside its providers, reading the same
    // workspace the Electronics view reads. Null means there is no app tree to
    // render it in, which is "no diagram", not a failure.
    unmount = mountCaptureBoard(host, PRINT_MAT)
    if (!unmount) return null
    const deadline = Date.now() + MOUNT_TIMEOUT_MS
    if (!(await ready(host, deadline))) return null
    // Ready is not yet still: the parts are there, but their photos decode and
    // the wires route over the next frames, so wait for a canvas that measures
    // the same twice running.
    return await withImages(
      await settle(() => {
        const svg = host.querySelector('svg.wc__svg') as SVGSVGElement | null
        return svg ? serialiseWiring(svg, background, fontCss) : null
      }, deadline)
    )
  } catch {
    return null
  } finally {
    unmount?.()
    host.remove()
  }
}
