/**
 * Proper MP4 recording for the exploded-view animation (#499).
 * =============================================================================
 * MediaRecorder's mp4 output is a FRAGMENTED mp4 — byte-valid, but QuickTime /
 * Finder preview frequently refuse it ("not a valid file"), and Electron has no
 * H.264 encoder at all. This records via WebCodecs (VideoEncoder → mp4-muxer,
 * `fastStart: 'in-memory'`) producing a progressive mp4 with the moov atom up
 * front — the kind every player accepts. Frames come from captureStream +
 * MediaStreamTrackProcessor (compositor-fed, so no preserveDrawingBuffer games).
 * Callers fall back to the probed MediaRecorder path when WebCodecs/H.264 is
 * unavailable (e.g. stock Electron → .webm).
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

/** Small bottom-left watermark drawn onto every recorded frame (#499). */
const WATERMARK = 'Made with https://app.snakie.org'
function drawWatermark(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): void {
  const size = Math.max(11, Math.round(w / 60))
  ctx.font = `${size}px system-ui, sans-serif`
  ctx.textBaseline = 'bottom'
  // Plain black text — no stroke/halo (the outlined version read oddly).
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.fillText(WATERMARK, 10, h - 8)
}

type TrackProcessor = { readable: ReadableStream<VideoFrame> }
declare const MediaStreamTrackProcessor:
  | (new (init: { track: MediaStreamTrack }) => TrackProcessor)
  | undefined

/**
 * Record `canvas` while `startAnim(onDone)` runs, returning a progressive mp4
 * Blob — or null when this engine can't encode H.264 (caller falls back).
 */
export async function recordCanvasMp4(
  canvas: HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream },
  startAnim: (onDone: () => void) => void,
  fps = 30
): Promise<Blob | null> {
  // Even dimensions are an H.264 requirement; odd canvases fall back.
  const width = canvas.width - (canvas.width % 2)
  const height = canvas.height - (canvas.height % 2)
  if (
    typeof VideoEncoder === 'undefined' ||
    typeof MediaStreamTrackProcessor === 'undefined' ||
    !canvas.captureStream ||
    width < 2 ||
    height < 2 ||
    width !== canvas.width ||
    height !== canvas.height
  ) {
    return null
  }
  const config: VideoEncoderConfig = {
    codec: 'avc1.42001f',
    width,
    height,
    bitrate: 8_000_000,
    framerate: fps
  }
  try {
    const support = await VideoEncoder.isConfigSupported(config)
    if (!support.supported) return null
  } catch {
    return null
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory'
  })
  let failed = false
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: () => {
      failed = true
    }
  })
  encoder.configure(config)

  const stream = canvas.captureStream(fps)
  const track = stream.getVideoTracks()[0]
  const processor = new MediaStreamTrackProcessor({ track })
  const reader = processor.readable.getReader()

  let stopped = false
  let frameIndex = 0
  // Frames re-composite through a 2D canvas so the watermark rides every frame.
  const scratch = new OffscreenCanvas(width, height)
  const sctx = scratch.getContext('2d')
  const pump = (async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done || stopped) {
        value?.close()
        return
      }
      // Backpressure: drop frames rather than ballooning the encode queue.
      if (encoder.encodeQueueSize > 8 || !sctx) {
        value.close()
        continue
      }
      sctx.drawImage(value, 0, 0, width, height)
      drawWatermark(sctx, width, height)
      const stamped = new VideoFrame(scratch, { timestamp: value.timestamp ?? 0 })
      value.close()
      encoder.encode(stamped, { keyFrame: frameIndex % (fps * 2) === 0 })
      frameIndex++
      stamped.close()
    }
  })()

  await new Promise<void>((res) => startAnim(res))
  stopped = true
  await reader.cancel().catch(() => undefined)
  await pump.catch(() => undefined)
  track.stop()
  try {
    await encoder.flush()
    encoder.close()
    if (failed || frameIndex === 0) return null
    muxer.finalize()
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  } catch {
    return null
  }
}

import { GIFEncoder, quantize, applyPalette } from 'gifenc'

/**
 * Universal fallback (#499): record the animation as an animated GIF — the one
 * format that renders on ALL platforms (macOS QuickTime/Finder can't open webm,
 * and Electron can't encode H.264, so desktop needs this). Frames come
 * compositor-side (captureStream + MediaStreamTrackProcessor → VideoFrame
 * RGBA readback), sampled at ~15 fps and palette-quantised per frame.
 */
export async function recordCanvasGif(
  canvas: HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream },
  startAnim: (onDone: () => void) => void,
  fps = 30
): Promise<Blob | null> {
  if (typeof MediaStreamTrackProcessor === 'undefined' || !canvas.captureStream) return null
  const stream = canvas.captureStream(fps)
  const track = stream.getVideoTracks()[0]
  const processor = new MediaStreamTrackProcessor({ track })
  const reader = processor.readable.getReader()
  const gif = GIFEncoder()
  const frameGapUs = 1_000_000 / fps
  let nextStamp = -1
  let frames = 0
  let stopped = false
  // VideoFrame native pixel formats vary (often BGRA from the compositor, which
  // showed red as blue when read as RGBA). Rasterising through a 2D canvas lets
  // the browser do the colour conversion — getImageData is ALWAYS RGBA.
  let scratch: OffscreenCanvas | null = null
  let scratchCtx: OffscreenCanvasRenderingContext2D | null = null
  // ONE palette for the whole clip (from the first frame): per-frame palettes
  // flicker as colours re-quantise every frame, which read as jitter.
  let palette: number[][] | null = null
  const pump = (async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done || stopped) {
        value?.close()
        return
      }
      try {
        if (value.timestamp >= nextStamp) {
          nextStamp = value.timestamp + frameGapUs
          const w = value.displayWidth
          const h = value.displayHeight
          if (!scratch || scratch.width !== w || scratch.height !== h) {
            scratch = new OffscreenCanvas(w, h)
            scratchCtx = scratch.getContext('2d', { willReadFrequently: true })
          }
          if (!scratchCtx) continue
          scratchCtx.drawImage(value, 0, 0)
          const rgba = scratchCtx.getImageData(0, 0, w, h).data
          if (!palette) palette = quantize(rgba, 256)
          const index = applyPalette(rgba, palette)
          gif.writeFrame(index, w, h, { palette, delay: Math.round(1000 / fps) })
          frames++
        }
      } catch {
        /* an unconvertible frame — skip it */
      } finally {
        value.close()
      }
    }
  })()
  await new Promise<void>((res) => startAnim(res))
  stopped = true
  await reader.cancel().catch(() => undefined)
  await pump.catch(() => undefined)
  track.stop()
  if (frames === 0) return null
  gif.finish()
  return new Blob([gif.bytes()], { type: 'image/gif' })
}

/**
 * Incremental GIF sink for DETERMINISTIC (offline) frame-by-frame rendering —
 * the caller steps the animation math itself and pushes each rendered canvas.
 * Uniform time steps are what make the GIF read as smooth: live sampling drops
 * frames unevenly (rAF beats vs the sample rate + encode stalls) → judder.
 * Frames are downscaled to ≤`maxWidth` and share one first-frame palette.
 * NOTE: 30 ms is GIF's practical minimum delay — browsers clamp <20 ms to
 * 100 ms, so "60 fps" GIFs actually play at 10 fps.
 */
export function createGifSink(
  delayMs = 30,
  maxWidth = 960
): { addCanvasFrame: (src: HTMLCanvasElement) => void; finish: () => Blob | null } {
  const gif = GIFEncoder()
  let scratch: OffscreenCanvas | null = null
  let ctx: OffscreenCanvasRenderingContext2D | null = null
  let palette: number[][] | null = null
  let frames = 0
  return {
    addCanvasFrame(src: HTMLCanvasElement): void {
      const scale = Math.min(1, maxWidth / Math.max(1, src.width))
      const w = Math.max(2, Math.round(src.width * scale))
      const h = Math.max(2, Math.round(src.height * scale))
      if (!scratch || scratch.width !== w || scratch.height !== h) {
        scratch = new OffscreenCanvas(w, h)
        ctx = scratch.getContext('2d', { willReadFrequently: true })
      }
      if (!ctx) return
      ctx.drawImage(src, 0, 0, w, h)
      drawWatermark(ctx, w, h)
      const rgba = ctx.getImageData(0, 0, w, h).data
      if (!palette) palette = quantize(rgba, 256)
      gif.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay: delayMs })
      frames++
    },
    finish(): Blob | null {
      if (!frames) return null
      gif.finish()
      return new Blob([gif.bytes()], { type: 'image/gif' })
    }
  }
}
