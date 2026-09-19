/**
 * WHERE THE LIVE BREADBOARD `<svg>` LIVES (#1110).
 *
 * The twin of `lib/blocks/workspace-registry.ts`, for the same reason: the PDF
 * export needs the breadboard, and `WiringCanvas` keeps its root `<svg>` in a
 * component-local ref. The canvas publishes it on mount and takes it back on
 * unmount, so the exporter asks for a canvas rather than guessing at a selector.
 *
 * The export must cope with the canvas NOT being mounted — the learner is
 * usually on Blocks or Code when they press print — so this deliberately says
 * "no canvas" rather than pretending; see `wiring-capture.ts` for what happens
 * then.
 */

let current: SVGSVGElement | null = null

/** Publish `svg` as the breadboard on screen. Returns the undo. */
export function registerWiringSvg(svg: SVGSVGElement): () => void {
  current = svg
  return () => {
    // Only clear if we are still the current one: a remount can register the
    // new canvas before the old one's cleanup runs.
    if (current === svg) current = null
  }
}

/** The breadboard on screen, or null when the Electronics view isn't mounted. */
export function getWiringSvg(): SVGSVGElement | null {
  // A canvas whose node has left the document is no use to a capture — and a
  // missed cleanup would otherwise hand out a detached element that measures 0.
  if (current && !current.isConnected) current = null
  return current
}

/** Test seam. */
export function resetWiringSvgRegistry(): void {
  current = null
}
