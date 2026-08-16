/**
 * ROTATING A BOARD PHOTO A QUARTER TURN (#749).
 *
 * The part's geometry turns by transforming coordinates ({@link rotatePart}),
 * but a photo is pixels — there is nothing to transform, and `part-body` draws
 * the image axis-aligned with `preserveAspectRatio="none"`, so its `rotation`
 * field is not rendered. Swapping the image layer's width and height without
 * turning the pixels would simply squash the picture into a box the wrong way
 * round. So the bitmap itself is re-drawn, turned, onto a canvas whose axes are
 * swapped.
 *
 * The output keeps the SOURCE's format. Always writing PNG (to protect the
 * transparency the background-removal tools paint in) turned a 127 KB board
 * photo into a 640 KB one — five times the size, committed to the parts library
 * and served to the web. A photo that is still a JPEG has no alpha to protect;
 * one that has been through background removal is already a PNG and stays one.
 */
import type { RotateDir } from './part-rotate'

/**
 * A data URL turned a quarter turn. Resolves `null` when the image can't be
 * read (a broken or tainted source), which callers treat as "leave it alone"
 * rather than as an error worth stopping the rotate for.
 */
export function rotateImage90(dataUrl: string, dir: RotateDir): Promise<string | null> {
  return new Promise((resolve) => {
    const mime = /^data:(image\/[a-z+]+)[;,]/.exec(dataUrl)?.[1] ?? 'image/png'
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (!w || !h) return resolve(null)
      const canvas = document.createElement('canvas')
      // Axes swap: a portrait photo becomes a landscape one.
      canvas.width = h
      canvas.height = w
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(null)
      // Move the origin to the corner the image will hang from, turn, then draw
      // at 0,0 — the usual canvas rotate, written out so the two directions are
      // visibly mirror images of each other rather than one magic matrix.
      if (dir === 'cw') {
        ctx.translate(h, 0)
        ctx.rotate(Math.PI / 2)
      } else {
        ctx.translate(0, w)
        ctx.rotate(-Math.PI / 2)
      }
      ctx.drawImage(img, 0, 0)
      try {
        // JPEG in, JPEG out. 0.92 keeps a quarter-turn visually lossless enough
        // that the recompression doesn't show; a part would have to be rotated
        // many times over before it did.
        resolve(mime === 'image/jpeg' ? canvas.toDataURL(mime, 0.92) : canvas.toDataURL('image/png'))
      } catch {
        resolve(null) // tainted canvas
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}
