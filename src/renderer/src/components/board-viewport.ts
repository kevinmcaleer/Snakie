/**
 * BOARD VIEWPORT MATH (pure helpers for the Board View pan/zoom/rotate viewport)
 * =============================================================================
 *
 * Pure, side-effect-free geometry used by {@link BoardGraph}'s viewport toolbar
 * (issues #99 zoom/fit/100% and #96 rotate). Kept out of the component so the
 * fiddly bits — clamp, fit-to-rotated-bounding-box, the legibility rule — can be
 * unit-tested without a DOM.
 *
 * The viewport renders the fixed-size "stage" (width `W` × height `H` in stage
 * pixels) inside a clipping canvas of `vw` × `vh` CSS pixels under the transform:
 *
 *     transform: translate(panX, panY) scale(zoom) rotate(rot°)
 *
 * applied with `transform-origin: 0 0` (top-left). Because rotation happens about
 * the stage origin, a 90°/180°/270° rotation moves the stage out of view, so the
 * pan must be derived from the rotated bounding box (see {@link fitTransform}).
 */

/** Hard zoom clamp — matches noodleplanner's sane mindmap range. */
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 4
/** Multiplicative step for the +/− keys (×/÷ 1.2 per click). */
export const ZOOM_STEP = 1.2

/** Clamp a zoom factor into [{@link MIN_ZOOM}, {@link MAX_ZOOM}]. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/** One zoom step in (×{@link ZOOM_STEP}), clamped. */
export function zoomIn(z: number): number {
  return clampZoom(z * ZOOM_STEP)
}

/** One zoom step out (÷{@link ZOOM_STEP}), clamped. */
export function zoomOut(z: number): number {
  return clampZoom(z / ZOOM_STEP)
}

/**
 * Re-pan so the viewport point `(ax, ay)` (CSS px, relative to the clip box)
 * stays put as the zoom goes from `view.zoom` to `next` (clamped). The stage
 * transform is `translate(pan) scale(zoom) rotate(rot)` about origin (0,0), so
 * the rotated-stage point under the anchor is invariant of zoom — anchoring
 * there is what makes the view zoom *toward* a chosen point instead of ballooning
 * out of the stage's top-left corner (the old bug: only `zoom` changed, so the
 * pinned origin sat at the top-left).
 *
 * For the −/+ buttons we anchor at the horizontal centre and the current top
 * (`ay = view.panY`), which keeps the board centred with its top in view; for the
 * wheel we anchor at the cursor.
 */
export function zoomAround(view: ViewTransform, next: number, ax: number, ay: number): ViewTransform {
  const zoom = clampZoom(next)
  const k = view.zoom > 0 ? zoom / view.zoom : 1
  return {
    panX: ax - (ax - view.panX) * k,
    panY: ay - (ay - view.panY) * k,
    zoom
  }
}

/** Normalise any (possibly negative / >360) angle to one of 0 | 90 | 180 | 270. */
export function normaliseRotation(deg: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360
  return r as 0 | 90 | 180 | 270
}

/** The next rotation, 90° clockwise (0→90→180→270→0). */
export function rotateCW(deg: number): 0 | 90 | 180 | 270 {
  return normaliseRotation(deg + 90)
}

/**
 * The size of an axis-aligned stage (W×H) after rotating it by `rot` degrees.
 * For 90°/270° the width and height swap; for 0°/180° they're unchanged.
 */
export function rotatedSize(W: number, H: number, rot: number): { w: number; h: number } {
  return normaliseRotation(rot) % 180 === 0 ? { w: W, h: H } : { w: H, h: W }
}

export interface ViewTransform {
  /** Translate X (CSS px), applied before scale/rotate (transform-origin 0 0). */
  panX: number
  /** Translate Y (CSS px). */
  panY: number
  /** Uniform scale. */
  zoom: number
}

/**
 * Compute the pan that centres the rotated, scaled stage within the viewport.
 *
 * With `transform: translate(pan) scale(zoom) rotate(rot)` about origin (0,0),
 * the stage's rotated bounding box has its own top-left at some offset from the
 * origin; we translate so that box is centred in the `vw`×`vh` viewport.
 */
export function centrePan(
  W: number,
  H: number,
  zoom: number,
  rot: number,
  vw: number,
  vh: number
): { panX: number; panY: number } {
  const r = normaliseRotation(rot)
  const { w, h } = rotatedSize(W, H, r)
  const bw = w * zoom
  const bh = h * zoom
  // Where the (untranslated) rotated+scaled box's top-left lands, so we can pull
  // it back to the origin before centring. After rotate-about-origin:
  //   0°:   box top-left at (0, 0)
  //   90°:  at (-H*zoom, 0)   (stage rotated CW swings left)  → shift +H*zoom
  //   180°: at (-W*zoom, -H*zoom)
  //   270°: at (0, -W*zoom)
  let originX = 0
  let originY = 0
  if (r === 90) {
    originX = H * zoom
  } else if (r === 180) {
    originX = W * zoom
    originY = H * zoom
  } else if (r === 270) {
    originY = W * zoom
  }
  return {
    panX: originX + (vw - bw) / 2,
    panY: originY + (vh - bh) / 2
  }
}

/**
 * Fit the whole stage (W×H, in stage px) into the `vw`×`vh` viewport with a
 * `margin` (CSS px) of breathing room on every side, accounting for `rot`. The
 * returned transform centres the rotated stage and is clamped to the zoom range.
 */
export function fitTransform(
  W: number,
  H: number,
  vw: number,
  vh: number,
  rot: number,
  margin = 28
): ViewTransform {
  const { w, h } = rotatedSize(W, H, rot)
  const availW = Math.max(1, vw - margin * 2)
  const availH = Math.max(1, vh - margin * 2)
  const raw = Math.min(availW / w, availH / h)
  const zoom = clampZoom(Number.isFinite(raw) && raw > 0 ? raw : 1)
  const { panX, panY } = centrePan(W, H, zoom, rot, vw, vh)
  return { panX, panY, zoom }
}

/**
 * The 1:1 ("100%") transform: scale 1, the rotated stage centred in the
 * viewport (so the toggle's 100% view is centred, not pinned top-left).
 */
export function oneToOneTransform(
  W: number,
  H: number,
  vw: number,
  vh: number,
  rot: number
): ViewTransform {
  const { panX, panY } = centrePan(W, H, 1, rot, vw, vh)
  return { panX, panY, zoom: 1 }
}

/**
 * The legibility rule (#96): given the stage rotation, the **in-stage** rotation
 * to apply to a label so it renders on screen **only at 0° or 90° clockwise —
 * never upside down**.
 *
 * The stage rotates CW by `rot`; a label baked into the stage inherits that, so
 * to land on a net on-screen angle `net` the label needs an in-stage rotation of
 * `(net − rot)`. Picking `net` as the nearest legible angle gives a `counter` of
 * only 0 or 180 (the same value works for SVG `rotate()` and an HTML CSS
 * `transform: rotate(...)`):
 *
 *   | stage rot | net (on screen) | counter (in-stage) |
 *   |-----------|-----------------|--------------------|
 *   | 0         | 0               | 0                  |
 *   | 90        | 90              | 0   (90 − 90)      |
 *   | 180       | 0               | 180 (0 − 180)      |
 *   | 270       | 90              | 180 (90 − 270 ≡)   |
 *
 * So at 0°/90° labels ride the stage untouched (net 0° / 90° CW); at 180°/270°
 * they get a 180° counter that flips the otherwise-upside-down text upright.
 *
 * Returns `counter` (the in-stage rotation to apply) and `net` (the resulting
 * on-screen angle, for assertions — always 0 or 90, never 180/270).
 */
export function labelCounterRotation(rot: number): { counter: 0 | 180; net: 0 | 90 } {
  const r = normaliseRotation(rot)
  if (r === 0) return { counter: 0, net: 0 }
  if (r === 90) return { counter: 0, net: 90 }
  if (r === 180) return { counter: 180, net: 0 }
  return { counter: 180, net: 90 } // 270
}

/** Round a zoom factor to a human percent string, e.g. 1 → "100%". */
export function zoomPercent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}
