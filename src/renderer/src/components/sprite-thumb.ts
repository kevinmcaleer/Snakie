/**
 * SPRITE THUMBNAILS — pure, DOM-free rendering of one sprite frame to an SVG
 * data URI, small enough to sit inline in the code editor (#790).
 * =============================================================================
 *
 * ── Why SVG and not the editor's canvas ─────────────────────────────────────
 * `SpriteEditor.tsx` paints the drawing grid with `roundRect` "LED" pixels, and
 * `sprite-image-io.ts` encodes PNG/GIF through an `OffscreenCanvas`. Both are
 * right for their jobs and wrong for this one: a decoration must be produced
 * SYNCHRONOUSLY while Monaco is laying out a line (the canvas encoders are
 * async), must be a value we can cache and diff (a canvas is not), and lands at
 * roughly ONE line height — about 2 device pixels per sprite pixel, where a
 * rounded corner is not merely invisible but actively smears the shape. So this
 * module shares the sprite MODEL (`SpriteFrame`, `frameHasInk`, `decodeSpr`)
 * with the editor and renders crisp rectangles at thumbnail scale.
 *
 * ── Cheap by construction ───────────────────────────────────────────────────
 * Lit pixels are merged into horizontal runs and emitted as ONE `<path>`, so a
 * full 128×64 sprite is a few hundred path commands rather than 8192 elements.
 * The result is a plain string: hashable, comparable, and injectable as a CSS
 * `background-image` without a DOM round-trip.
 */
import { frameHasInk, type SpriteFrame } from './sprite-model'

/**
 * The lit-pixel colour. `--gold` resolves to the SAME `#d9a441` in both the
 * dark and the Skeuomorph skins (see `index.css`), so the thumbnail needs no
 * per-theme variant — which is what lets one cached data URI serve both. The
 * chip it sits on IS themed, in `SpriteDecorations.css`.
 */
export const SPRITE_THUMB_LIT = '#d9a441'

/**
 * Which frame an animation shows inline: the first frame with any ink, or frame
 * 0 when every frame is blank.
 *
 * A **static** frame, not a cycle — a decoration that animates in a code editor
 * competes with the text for attention, and the whole point of #789 is that the
 * artwork is present, not that it performs. The first INKED frame rather than
 * literally the first: animations habitually open on a blank frame (a blink, a
 * fade-in), and an empty chip reads as a broken reference.
 */
export function pickThumbFrame(frames: SpriteFrame[]): number {
  const i = frames.findIndex(frameHasInk)
  return i < 0 ? 0 : i
}

/**
 * One frame as an SVG document string, `width`×`height` user units (one unit
 * per sprite pixel) so the caller scales it with CSS.
 */
export function spriteThumbSvg(
  frame: SpriteFrame,
  width: number,
  height: number,
  colour: string = SPRITE_THUMB_LIT
): string {
  let d = ''
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      if (!frame.pixels[y]?.[x]) {
        x++
        continue
      }
      const start = x
      while (x < width && frame.pixels[y]?.[x]) x++
      d += `M${start} ${y}h${x - start}v1h-${x - start}z`
    }
  }
  const body = d ? `<path fill="${colour}" d="${d}"/>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="${width}" height="${height}" shape-rendering="crispEdges">${body}</svg>`
  )
}

/**
 * An SVG string as a `data:` URI safe to drop straight into a CSS `url()`.
 * `encodeURIComponent` escapes `#`, `<`, `>` and the quotes, which are the
 * characters that would otherwise end the declaration early.
 */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * A short, stable, CSS-identifier-safe key for a string (djb2 → base 36).
 * Used to name the per-sprite CSS rule that carries its background image; the
 * seed includes the file's mtime, so an edited sprite gets a NEW class and the
 * stale rule is dropped rather than repainted.
 */
export function cssKey(seed: string): string {
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Everything the editor needs to paint one sprite inline. */
export interface SpriteThumb {
  /** CSS `background-image` value (a data URI). */
  dataUri: string
  /** Pixel width ÷ height — the caller sizes the chip from it. */
  aspect: number
  /** The frame that is shown (see {@link pickThumbFrame}). */
  frameIndex: number
}

/** Render the thumbnail for a decoded sprite: pick the frame, draw it, wrap it. */
export function spriteThumb(
  frames: SpriteFrame[],
  width: number,
  height: number,
  colour: string = SPRITE_THUMB_LIT
): SpriteThumb {
  const frameIndex = pickThumbFrame(frames)
  return {
    dataUri: svgDataUri(spriteThumbSvg(frames[frameIndex], width, height, colour)),
    aspect: height > 0 ? width / height : 1,
    frameIndex
  }
}

/** A one-line description of a sprite, for the decoration's hover. */
export function spriteSummary(width: number, height: number, frames: number): string {
  return `${width}×${height} · ${frames} frame${frames === 1 ? '' : 's'}`
}
