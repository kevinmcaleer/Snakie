/**
 * RENDER MOVIE — settings, sizing and the frame sinks.
 * =============================================================================
 * A movie is rendered OFFLINE: for frame `i` the robot is put into the posture
 * at exactly `i / fps` seconds, drawn at the output size, and handed to an
 * encoder. Nothing depends on how fast this computer draws, so the result is
 * the same smooth movie on a slow laptop as on a fast one — it only takes
 * longer. It all happens on this computer; nothing is uploaded.
 *
 * This module has no three.js or React. The settings maths is pure (and unit
 * tested); the sinks wrap WebCodecs + the muxers.
 */
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { zipSync } from 'fflate'

export type RenderSize = '720p' | '1080p' | '4k' | 'square' | 'vertical'
export type RenderCamera = 'current' | 'turntable'
export type RenderLook = 'studio-light' | 'studio-dark' | 'editor'
export type RenderQuality = 'draft' | 'good' | 'best'
export type RenderFormat = 'mp4' | 'webm' | 'gif' | 'png'

export interface RenderSettings {
  size: RenderSize
  fps: 24 | 30 | 60
  /** How many times the motion plays through (1–20). */
  loops: number
  camera: RenderCamera
  look: RenderLook
  quality: RenderQuality
  format: RenderFormat
  /** Draw "Made with snakie.org" in the corner. */
  watermark: boolean
}

export const DEFAULT_RENDER: RenderSettings = {
  size: '1080p',
  fps: 30,
  loops: 3,
  camera: 'current',
  look: 'studio-light',
  quality: 'good',
  format: 'mp4',
  watermark: true
}

/** One press for "just show me": small, quick, good enough to check the motion. */
export const QUICK_DRAFT: Partial<RenderSettings> = { size: '720p', fps: 24, quality: 'draft' }

export const SIZE_LABEL: Record<RenderSize, string> = {
  '720p': '720p',
  '1080p': '1080p',
  '4k': '4K',
  square: 'Square',
  vertical: 'Vertical'
}

const SIZES: Record<RenderSize, [number, number]> = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '4k': [3840, 2160],
  square: [1080, 1080],
  vertical: [1080, 1920]
}

/** Output pixels for a size (always even, as H.264 needs). */
export function renderDimensions(size: RenderSize): { width: number; height: number } {
  const [width, height] = SIZES[size] ?? SIZES['1080p']
  return { width, height }
}

const STORE_KEY = 'snakie:renderMovie'
type Store = Pick<Storage, 'getItem' | 'setItem'>
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback

/** Clean up settings from storage (or anywhere): unknown values fall back. */
export function sanitizeRender(raw: unknown): RenderSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_RENDER
  const loops = Math.round(Number(r.loops))
  return {
    size: oneOf(r.size, ['720p', '1080p', '4k', 'square', 'vertical'] as const, d.size),
    fps: oneOf(r.fps, [24, 30, 60] as const, d.fps),
    loops: Number.isFinite(loops) ? Math.max(1, Math.min(20, loops)) : d.loops,
    camera: oneOf(r.camera, ['current', 'turntable'] as const, d.camera),
    look: oneOf(r.look, ['studio-light', 'studio-dark', 'editor'] as const, d.look),
    quality: oneOf(r.quality, ['draft', 'good', 'best'] as const, d.quality),
    format: oneOf(r.format, ['mp4', 'webm', 'gif', 'png'] as const, d.format),
    watermark: typeof r.watermark === 'boolean' ? r.watermark : d.watermark
  }
}

export function loadRender(store: Store | undefined): RenderSettings {
  try {
    const raw = store?.getItem(STORE_KEY)
    return sanitizeRender(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_RENDER }
  }
}

export function saveRender(store: Store | undefined, s: RenderSettings): void {
  try {
    store?.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    /* a preference not persisting is non-fatal */
  }
}

/** The longest movie one render will make (seconds) — keeps memory in hand. */
export const MAX_MOVIE_SECONDS = 120

export interface RenderPlan {
  /** Output pixels. */
  width: number
  height: number
  /** Pixels actually drawn per frame (larger than the output for "best"). */
  drawWidth: number
  drawHeight: number
  fps: number
  /** Frames in the movie. */
  frames: number
  /** Length of the movie (seconds). */
  seconds: number
  /** Loops actually rendered (fewer than asked if the movie hit the cap). */
  loops: number
  /** Target video bitrate (bits per second) for mp4 / webm. */
  bitrate: number
}

/**
 * Work out what a render will produce for a motion `clipSeconds` long.
 *
 *  - GIF plays at ~33 fps at most in browsers (a delay under 20 ms is treated
 *    as 100 ms), and big GIFs are enormous, so it is capped at 25 fps and
 *    720 px on its longer side.
 *  - "Draft" draws at the output size with a lean bitrate; "Best" draws at
 *    twice the size and scales down (smoother edges) where that fits in 4096 px.
 */
export function planRender(s: RenderSettings, clipSeconds: number): RenderPlan {
  let { width, height } = renderDimensions(s.size)
  let fps: number = s.fps
  if (s.format === 'gif') {
    fps = Math.min(fps, 25)
    const k = Math.min(1, 720 / Math.max(width, height))
    width = Math.round((width * k) / 2) * 2
    height = Math.round((height * k) / 2) * 2
  }
  const clip = Math.max(0, clipSeconds)
  const maxLoops = clip > 0 ? Math.max(1, Math.floor(MAX_MOVIE_SECONDS / clip)) : 1
  const loops = Math.max(1, Math.min(s.loops, maxLoops))
  const seconds = Math.min(MAX_MOVIE_SECONDS, clip * loops)
  const frames = Math.max(1, Math.round(seconds * fps))
  const ss = s.quality === 'best' && Math.max(width, height) * 2 <= 4096 ? 2 : 1
  // Bits per pixel per frame: animation with flat colours compresses well.
  const bpp = s.quality === 'draft' ? 0.06 : s.quality === 'good' ? 0.12 : 0.2
  const bitrate = Math.round(Math.max(1_000_000, Math.min(60_000_000, width * height * fps * bpp)))
  return { width, height, drawWidth: width * ss, drawHeight: height * ss, fps, frames, seconds, loops, bitrate }
}

/**
 * The time within the clip (seconds) that movie frame `i` shows. A looping clip
 * wraps round. A one-shot plays start to END on every pass — its last frame is
 * exactly the final pose, not one step short of it.
 */
export function frameClipTime(i: number, fps: number, clipSeconds: number, loop: boolean): number {
  if (clipSeconds <= 0) return 0
  if (loop) return (i / fps) % clipSeconds
  const perPass = Math.max(2, Math.round(clipSeconds * fps))
  return (clipSeconds * (i % perPass)) / (perPass - 1)
}

/**
 * H.264 codec string for a frame size. The LEVEL has to allow the size: asking
 * for level 3.1 at 1080p is refused outright (that, not a missing encoder, is
 * why the desktop app used to fall back to GIF).
 */
export function h264Codec(width: number, height: number, fps: number): string {
  const mbPerSec = Math.ceil(width / 16) * Math.ceil(height / 16) * fps
  const mb = Math.ceil(width / 16) * Math.ceil(height / 16)
  // High profile; level by macroblock rate / frame size.
  if (mb <= 3600 && mbPerSec <= 108000) return 'avc1.64001f' // 3.1 — 720p30
  if (mb <= 8192 && mbPerSec <= 245760) return 'avc1.640028' // 4.0 — 1080p30
  if (mb <= 8704 && mbPerSec <= 522240) return 'avc1.64002a' // 4.2 — 1080p60
  if (mb <= 22080 && mbPerSec <= 589824) return 'avc1.640032' // 5.0
  if (mb <= 36864 && mbPerSec <= 983040) return 'avc1.640033' // 5.1 — 4K30
  return 'avc1.640034' // 5.2 — 4K60
}

export const FORMAT_INFO: Record<RenderFormat, { label: string; ext: string; mime: string; blurb: string }> = {
  mp4: { label: 'MP4', ext: 'mp4', mime: 'video/mp4', blurb: 'Plays everywhere: phones, YouTube, slides.' },
  webm: { label: 'WebM', ext: 'webm', mime: 'video/webm', blurb: 'Small files; plays in browsers and VLC.' },
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif', blurb: 'Loops by itself in chats and READMEs. Smaller picture.' },
  png: { label: 'PNG frames', ext: 'zip', mime: 'application/zip', blurb: 'Every frame as a picture, in a zip, for your own video editor.' }
}

/** Can this computer make the format? PNG and GIF always can. */
export async function formatSupported(format: RenderFormat, plan: RenderPlan): Promise<boolean> {
  if (format === 'png' || format === 'gif') return true
  if (typeof VideoEncoder === 'undefined') return false
  const codec = format === 'mp4' ? h264Codec(plan.width, plan.height, plan.fps) : 'vp09.00.40.08'
  try {
    const s = await VideoEncoder.isConfigSupported({
      codec,
      width: plan.width,
      height: plan.height,
      bitrate: plan.bitrate,
      framerate: plan.fps
    })
    return !!s.supported
  } catch {
    return false
  }
}

/** Rough size of the finished file (bytes), for the panel's estimate. */
export function estimateBytes(format: RenderFormat, plan: RenderPlan): number {
  if (format === 'mp4' || format === 'webm') return Math.round((plan.bitrate / 8) * plan.seconds * (format === 'webm' ? 0.8 : 1))
  if (format === 'gif') return Math.round(plan.width * plan.height * plan.frames * 0.18)
  return Math.round(plan.width * plan.height * plan.frames * 0.35)
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** "about 12 s left" from frames done and time spent. */
export function etaSeconds(done: number, total: number, elapsedMs: number): number | null {
  if (done < 3 || total <= done) return total <= done ? 0 : null
  return Math.ceil(((elapsedMs / done) * (total - done)) / 1000)
}

// ── Frame sinks ──────────────────────────────────────────────────────────────

/** Takes the finished frames one by one and produces the file. */
export interface FrameSink {
  /** Add the frame drawn on `canvas` (already at the output size). */
  add: (canvas: OffscreenCanvas | HTMLCanvasElement, index: number) => Promise<void>
  finish: () => Promise<Blob | null>
  /** Stop and free everything (after a cancel or an error). */
  abort: () => void
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

async function createVideoSink(format: 'mp4' | 'webm', plan: RenderPlan): Promise<FrameSink | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null
  const { width, height, fps, bitrate } = plan
  const codec = format === 'mp4' ? h264Codec(width, height, fps) : 'vp09.00.40.08'
  const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps }
  try {
    if (!(await VideoEncoder.isConfigSupported(config)).supported) return null
  } catch {
    return null
  }
  const mp4 =
    format === 'mp4'
      ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' })
      : null
  const webm =
    format === 'webm'
      ? new WebmMuxer({ target: new WebmTarget(), video: { codec: 'V_VP9', width, height, frameRate: fps } })
      : null
  let failed: string | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        if (mp4) mp4.addVideoChunk(chunk, meta)
        else webm?.addVideoChunk(chunk, meta)
      } catch (e) {
        failed = String(e)
      }
    },
    error: (e) => {
      failed = String(e)
    }
  })
  encoder.configure(config)
  const frameUs = 1_000_000 / fps
  return {
    async add(canvas, index): Promise<void> {
      if (failed) throw new Error(failed)
      // Let the encoder catch up rather than queueing frames without limit.
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1))
      const frame = new VideoFrame(canvas, { timestamp: Math.round(index * frameUs), duration: Math.round(frameUs) })
      try {
        encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 })
      } finally {
        frame.close()
      }
    },
    async finish(): Promise<Blob | null> {
      await encoder.flush()
      encoder.close()
      if (failed) return null
      if (mp4) {
        mp4.finalize()
        return new Blob([mp4.target.buffer], { type: 'video/mp4' })
      }
      webm!.finalize()
      return new Blob([webm!.target.buffer], { type: 'video/webm' })
    },
    abort(): void {
      try {
        if (encoder.state !== 'closed') encoder.close()
      } catch {
        /* already closed */
      }
    }
  }
}

const rgbaOf = (canvas: OffscreenCanvas | HTMLCanvasElement, scratch: { c?: OffscreenCanvas; x?: Ctx2D | null }): Uint8ClampedArray => {
  if (!scratch.c || scratch.c.width !== canvas.width || scratch.c.height !== canvas.height) {
    scratch.c = new OffscreenCanvas(canvas.width, canvas.height)
    scratch.x = scratch.c.getContext('2d', { willReadFrequently: true })
  }
  scratch.x!.drawImage(canvas, 0, 0)
  return scratch.x!.getImageData(0, 0, canvas.width, canvas.height).data
}

function createGifFrameSink(plan: RenderPlan): FrameSink {
  const gif = GIFEncoder()
  const scratch: { c?: OffscreenCanvas; x?: Ctx2D | null } = {}
  // One palette for the whole clip: per-frame palettes shimmer.
  let palette: number[][] | null = null
  const delay = Math.round(1000 / plan.fps)
  let frames = 0
  return {
    async add(canvas): Promise<void> {
      const rgba = rgbaOf(canvas, scratch)
      if (!palette) palette = quantize(rgba, 256)
      gif.writeFrame(applyPalette(rgba, palette), canvas.width, canvas.height, { palette, delay })
      frames++
    },
    async finish(): Promise<Blob | null> {
      if (!frames) return null
      gif.finish()
      return new Blob([gif.bytes()], { type: 'image/gif' })
    },
    abort(): void {
      /* nothing held */
    }
  }
}

const toPng = async (canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> => {
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('no png'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

function createPngFrameSink(plan: RenderPlan): FrameSink {
  const files: Record<string, Uint8Array> = {}
  const digits = String(plan.frames).length
  return {
    async add(canvas, index): Promise<void> {
      files[`frame-${String(index + 1).padStart(Math.max(4, digits), '0')}.png`] = await toPng(canvas)
    },
    async finish(): Promise<Blob | null> {
      if (!Object.keys(files).length) return null
      // PNG is already compressed: store, don't deflate again.
      return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' })
    },
    abort(): void {
      for (const k of Object.keys(files)) delete files[k]
    }
  }
}

/** The sink for a format, or null when this computer can't encode it. */
export async function createFrameSink(format: RenderFormat, plan: RenderPlan): Promise<FrameSink | null> {
  if (format === 'gif') return createGifFrameSink(plan)
  if (format === 'png') return createPngFrameSink(plan)
  return createVideoSink(format, plan)
}

/** The corner credit, sized to the frame. Light text on dark looks, dark on light. */
export function drawRenderWatermark(ctx: Ctx2D, width: number, height: number, text: string, dark: boolean): void {
  const size = Math.max(12, Math.round(Math.min(width, height) / 45))
  ctx.save()
  ctx.font = `500 ${size}px 'Plus Jakarta Sans', system-ui, sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(36, 38, 31, 0.72)'
  ctx.fillText(text, Math.round(size * 0.9), height - Math.round(size * 0.7))
  ctx.restore()
}

export const RENDER_WATERMARK = 'Made with snakie.org'

/** One render, as the 3-D view runs it. */
export interface RenderJob {
  settings: RenderSettings
  plan: RenderPlan
  /** The posture (native joint values) for movie frame `frame`. */
  poseAt: (frame: number) => Record<string, number>
  /** A canvas to show each finished frame on (the panel's preview). */
  preview?: HTMLCanvasElement | null
  /** Draw only the first frame into `preview` — a quick look at the settings. */
  still?: boolean
  onProgress?: (framesDone: number) => void
  signal?: AbortSignal
}

export interface RenderResult {
  blob: Blob | null
  /** Why there is no movie: `unsupported` (this computer can't encode the
   *  format), `cancelled`, `no-robot`, `no-webgl` or `encode-failed`. */
  error?: 'unsupported' | 'cancelled' | 'no-robot' | 'no-webgl' | 'encode-failed'
  detail?: string
}
