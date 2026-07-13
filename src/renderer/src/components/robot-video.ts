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
  const pump = (async (): Promise<void> => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done || stopped) {
        value?.close()
        return
      }
      // Backpressure: drop frames rather than ballooning the encode queue.
      if (encoder.encodeQueueSize > 8) {
        value.close()
        continue
      }
      encoder.encode(value, { keyFrame: frameIndex % (fps * 2) === 0 })
      frameIndex++
      value.close()
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
