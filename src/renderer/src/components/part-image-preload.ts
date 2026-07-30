/**
 * Part-image decode warming.
 *
 * A life-like part draws in layers: the PCB rectangle and its silk shapes first,
 * then the board photo on top. The photo is a data URL, and the browser decodes it
 * asynchronously — so on a fresh mount of the Board View every part paints as bare
 * green PCB + shapes for a frame or two before the image lands. That reads as
 * "generic parts, then a redraw", which is what it is.
 *
 * Leaving the Electronics workspace unmounts the pane, so this happens on every
 * return, not just the first.
 *
 * Decoding each image once, up front, means the `<image>` element finds it already
 * decoded and paints on the first frame. The decoded copies are held (rather than
 * left to the browser's cache) so they survive until the app closes, and keyed by
 * `src` so a re-imported photo is warmed afresh.
 */

/** Decoded images, kept alive so the browser doesn't evict them between mounts. */
const warmed = new Map<string, HTMLImageElement>()

/** Anything with part-shaped image fields — kept structural so this has no
 *  dependency on the full `PartDefinition`. */
interface ImageBearing {
  imageData?: string
  rear?: { imageData?: string }
}

/**
 * Decode every part photo in `libraries` ahead of first paint. Idempotent, cheap
 * to call again (already-warmed sources are skipped), and a no-op outside a DOM
 * (tests, the main process).
 */
export function preloadPartImages(libraries: { parts: ImageBearing[] }[]): void {
  if (typeof Image === 'undefined') return
  for (const lib of libraries ?? []) {
    for (const part of lib.parts ?? []) {
      for (const src of [part.imageData, part.rear?.imageData]) {
        if (!src || warmed.has(src)) continue
        const img = new Image()
        warmed.set(src, img)
        img.src = src
        // `decode()` does the expensive work NOW rather than at paint time. Its
        // rejection (a malformed data URL) is not worth surfacing: the <image>
        // element will fail the same way and the part still draws from shapes.
        void img.decode?.().catch(() => undefined)
      }
    }
  }
}

/** How many distinct images have been warmed — for tests/diagnostics. */
export function warmedImageCount(): number {
  return warmed.size
}
