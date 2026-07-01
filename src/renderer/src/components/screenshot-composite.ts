/**
 * Composite multiple captured Snakie windows into ONE labelled image for a bug
 * report (issue #206). The main process captures every open window (main + Board
 * View + any undocked instrument windows); the feedback API takes a single file,
 * so we stack them vertically here (in the renderer, which has a canvas) with a
 * title above each. One shot is returned as-is; if the PNG would exceed the
 * server's 4 MB cap we fall back to progressively-lower-quality JPEG.
 */

/** One captured Snakie window (from `window.api.captureScreenshot()`). */
export interface WindowShot {
  title: string
  dataUrl: string
}

const MAX_W = 1400 // cap each shot's width in the composite
const LABEL_H = 26
const GAP = 10
const MAX_BYTES = 3_900_000 // stay under the feedback API's 4 MB screenshot cap

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/** Approx decoded byte size of a base64 data URL. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  const b64 = comma < 0 ? dataUrl.length : dataUrl.length - comma - 1
  return Math.floor(b64 * 0.75)
}

export async function compositeShots(shots: WindowShot[]): Promise<string | null> {
  if (!shots || shots.length === 0) return null
  if (shots.length === 1) return shots[0].dataUrl

  const imgs = await Promise.all(shots.map((s) => loadImage(s.dataUrl)))
  const scaled = imgs.map((img) => {
    const scale = Math.min(1, MAX_W / (img.width || 1))
    return { w: Math.round((img.width || 1) * scale), h: Math.round((img.height || 1) * scale) }
  })
  const width = Math.max(...scaled.map((s) => s.w), 320)
  const height = scaled.reduce((sum, s) => sum + LABEL_H + s.h + GAP, GAP)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return shots[0].dataUrl

  ctx.fillStyle = '#15171a'
  ctx.fillRect(0, 0, width, height)
  let y = GAP
  imgs.forEach((img, i) => {
    ctx.fillStyle = '#9aa0a8'
    ctx.font = '14px -apple-system, "Segoe UI", sans-serif'
    ctx.fillText(shots[i].title, 6, y + 17)
    y += LABEL_H
    ctx.drawImage(img, 0, y, scaled[i].w, scaled[i].h)
    y += scaled[i].h + GAP
  })

  // Prefer lossless PNG; if it blows the size cap, drop to JPEG at falling quality.
  let out = canvas.toDataURL('image/png')
  let quality = 0.85
  while (dataUrlBytes(out) > MAX_BYTES && quality >= 0.4) {
    out = canvas.toDataURL('image/jpeg', quality)
    quality -= 0.15
  }
  return out
}
