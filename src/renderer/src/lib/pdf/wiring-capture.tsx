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
 */

import { createRoot } from 'react-dom/client'
import { serializeLiveSvg } from '../../components/svg-export'
import { getWiringSvg } from '../../components/wiring-svg-registry'

/** A serialised diagram at its natural CSS-pixel size. */
export interface CapturedDiagram {
  svg: string
  width: number
  height: number
}

/** Chrome and view-derived backdrops that should not bake into a printed page. */
const EXCLUDE = ['.wc__sel-ring', '.wc__grid-layer', '.wc__paper']

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
    // `<img>`-rendered SVG cannot fetch — see `capture.ts`.
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
  timeoutMs: number
): Promise<CapturedDiagram | null> {
  const deadline = Date.now() + timeoutMs
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

/**
 * The project's wiring diagram, from the live canvas when there is one and from
 * an off-screen render otherwise. Null means "nothing to draw" — never a blank.
 */
export async function captureWiringDiagram(
  background = '#f6f1e6',
  fontCss = ''
): Promise<CapturedDiagram | null> {
  const live = getWiringSvg()
  if (live) {
    const captured = serialiseWiring(live, background, fontCss)
    if (captured) return captured
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
    return await settle(() => {
      const svg = host.querySelector('svg.wc__svg') as SVGSVGElement | null
      return svg ? serialiseWiring(svg, background, fontCss) : null
    }, MOUNT_TIMEOUT_MS)
  } catch {
    return null
  } finally {
    root?.unmount()
    host.remove()
  }
}
