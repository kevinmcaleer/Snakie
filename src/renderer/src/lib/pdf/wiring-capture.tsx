/**
 * Getting the breadboard into the document (#1110).
 *
 * THE DECISION THIS ISSUE ASKED FOR, stated plainly: the export **renders the
 * diagram off-screen from the project model on demand**, and reuses the live
 * canvas when the Electronics view happens to be mounted.
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
 * `BoardPane` takes no props and feeds itself from the workspace store, so
 * mounting a second one into an off-screen host gives a real, laid-out canvas
 * without duplicating any of its plumbing here. It is imported dynamically, so
 * the board subsystem stays out of the main bundle exactly as `AppShell`'s
 * `React.lazy` intends.
 *
 * The one hard rule: this returns null rather than something blank. A blank
 * wiring page is worse than no wiring page, so an empty or unmeasurable canvas
 * is reported as "no diagram" and the section is left out (#1108).
 *
 * TWO PICTURES, ONE PASS (#1147). The document shows the board twice: the
 * drawing lifted onto the page's parchment, and the workspace's own sheet —
 * grid, mat and all — as `Export ▸ PDF document` writes it. Mounting the board
 * is the expensive half of this module, so both are serialised from whichever
 * canvas it got hold of rather than capturing twice.
 */

import { createRoot } from 'react-dom/client'
import {
  inlineImageHrefs,
  serializeLiveSvg,
  stageBackground
} from '../../components/svg-export'
import { getWiringSvg } from '../../components/wiring-svg-registry'

/** A serialised diagram at its natural CSS-pixel size. */
export interface CapturedDiagram {
  svg: string
  width: number
  height: number
}

/** A serialised diagram that carries its own sheet colour (#1147). */
export interface CapturedSheet extends CapturedDiagram {
  /** The mat the board is drawn on, for the JPEG's letterbox to match. */
  background: string
}

/** Both pictures of the board the document wants, from one pass (#1147). */
export interface CapturedWiring {
  /** The drawing alone, on the document's parchment. */
  diagram: CapturedDiagram
  /** The workspace's own sheet, exactly as `Export ▸ PDF document` prints it. */
  sheet: CapturedSheet | null
}

/** Chrome and view-derived backdrops that should not bake into a printed page. */
const EXCLUDE = ['.wc__sel-ring', '.wc__grid-layer', '.wc__paper']

/** The sheet keeps the grid and the mat; only the selection ring is chrome. */
const SHEET_EXCLUDE = ['.wc__sel-ring']
/** The margin `WiringCanvas`'s own PDF export frames the board with. */
const SHEET_MARGIN = 24

/** How long to wait for an off-screen board to finish loading its libraries. */
const MOUNT_TIMEOUT_MS = 12000
const POLL_MS = 80

/** Serialise a breadboard `<svg>`, framed tight to the parts. */
export function serialiseWiring(
  svg: SVGSVGElement,
  background: string,
  fontCss = ''
): CapturedDiagram | null {
  return serializeLiveSvg(svg, '.wc__content', {
    background,
    margin: 20,
    // The grid and the paper are view-derived full-canvas layers; the printed
    // page wants the drawing on parchment, not a screenshot of the mat.
    exclude: EXCLUDE,
    bboxExclude: ['.wc__grid-layer', '.wc__paper'],
    // Part labels and pin names are lettered in the app's webfont, which an
    // `<img>`-rendered SVG cannot fetch — see `export-fonts.ts`.
    fontCss
  })
}

/**
 * Serialise a breadboard `<svg>` AS THE WORKSPACE EXPORTS IT (#1147).
 *
 * The same call `WiringCanvas.doExport` makes: the grid and the paper stay,
 * the mat colour is read off the live stage, and the frame is the parts plus
 * the export's own 24px margin — so the page in the document and the file that
 * button writes are the same picture.
 *
 * Nothing forces a zoom-to-fit first, as the button does. It does not need to:
 * the grid and the paper are drawn to cover the PLACED CONTENT as well as the
 * viewport (`coverBounds`), precisely so an export fills to its edges whatever
 * the canvas is scrolled to.
 */
export function serialiseWiringSheet(svg: SVGSVGElement, fontCss = ''): CapturedSheet | null {
  const background = stageBackground(svg)
  const res = serializeLiveSvg(svg, '.wc__content', {
    background,
    margin: SHEET_MARGIN,
    exclude: SHEET_EXCLUDE,
    // Frame to the parts, not the full-canvas grid/paper — they just fill it.
    bboxExclude: ['.wc__grid-layer', '.wc__paper'],
    fontCss
  })
  return res ? { ...res, background } : null
}

/** Both pictures of one canvas — the diagram, and the sheet beside it. */
function captureBoth(
  svg: SVGSVGElement,
  background: string,
  fontCss: string
): CapturedWiring | null {
  const diagram = serialiseWiring(svg, background, fontCss)
  if (!diagram) return null
  // The sheet is the extra page, not the section: a canvas that serialises one
  // way but not the other still gets its diagram.
  return { diagram, sheet: serialiseWiringSheet(svg, fontCss) }
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
  probe: () => CapturedWiring | null,
  timeoutMs: number
): Promise<CapturedWiring | null> {
  const deadline = Date.now() + timeoutMs
  let previous: string | null = null
  while (Date.now() < deadline) {
    const value = probe()
    if (value !== null) {
      // Size and serialised length, rather than the whole markup: the string is
      // large and this runs several times a second.
      const fingerprint = `${value.diagram.width}x${value.diagram.height}:${value.diagram.svg.length}`
      if (fingerprint === previous) return value
      previous = fingerprint
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return null
}

/** Carry the part photos into the capture — BOTH pictures of it. A no-op on
 *  the desktop, where the main process has already inlined them; on the web
 *  they are build assets named by URL, which the `<img>` the rasteriser uses
 *  cannot fetch, so the board would print without its own photograph. */
async function withImages(w: CapturedWiring | null): Promise<CapturedWiring | null> {
  if (!w) return null
  return {
    diagram: { ...w.diagram, svg: await inlineImageHrefs(w.diagram.svg) },
    sheet: w.sheet ? { ...w.sheet, svg: await inlineImageHrefs(w.sheet.svg) } : null
  }
}

/**
 * The project's wiring, from the live canvas when there is one and from an
 * off-screen render otherwise. Null means "nothing to draw" — never a blank.
 *
 * Both pictures come out of ONE pass: mounting a second board is the expensive
 * part of this module, and the sheet page must never cost a second one.
 */
export async function captureWiring(
  background = '#f6f1e6',
  fontCss = ''
): Promise<CapturedWiring | null> {
  const live = getWiringSvg()
  if (live) {
    const captured = captureBoth(live, background, fontCss)
    if (captured) return withImages(captured)
  }
  if (typeof document === 'undefined') return null

  const host = offscreenHost()
  let root: ReturnType<typeof createRoot> | null = null
  try {
    const { BoardPane } = await import('../../components/BoardPane')
    root = createRoot(host)
    root.render(<BoardPane />)
    // The board loads its part libraries and robot.yml asynchronously, so wait
    // for a canvas that measures the same twice running rather than grabbing
    // the first frame — which would print a board with no parts on it.
    return await withImages(
      await settle(() => {
        const svg = host.querySelector('svg.wc__svg') as SVGSVGElement | null
        return svg ? captureBoth(svg, background, fontCss) : null
      }, MOUNT_TIMEOUT_MS)
    )
  } catch {
    return null
  } finally {
    root?.unmount()
    host.remove()
  }
}
