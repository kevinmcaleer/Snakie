import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RENDER,
  estimateBytes,
  etaSeconds,
  formatBytes,
  frameClipTime,
  h264Codec,
  loadRender,
  MAX_MOVIE_SECONDS,
  planRender,
  renderDimensions,
  sanitizeRender,
  saveRender
} from '../src/renderer/src/components/robot-render'

describe('renderDimensions', () => {
  it('gives even pixel sizes for every preset', () => {
    for (const size of ['720p', '1080p', '4k', 'square', 'vertical'] as const) {
      const { width, height } = renderDimensions(size)
      expect(width % 2).toBe(0)
      expect(height % 2).toBe(0)
    }
    expect(renderDimensions('vertical')).toEqual({ width: 1080, height: 1920 })
  })
})

describe('sanitizeRender / storage', () => {
  it('falls back for anything unknown', () => {
    expect(sanitizeRender(null)).toEqual(DEFAULT_RENDER)
    expect(sanitizeRender({ size: '8k', fps: 12, loops: 'lots', format: 'avi', watermark: 'yes' })).toEqual(DEFAULT_RENDER)
  })
  it('keeps valid choices and clamps loops', () => {
    const s = sanitizeRender({ size: 'vertical', fps: 60, loops: 99, camera: 'turntable', look: 'editor', quality: 'best', format: 'gif', watermark: false })
    expect(s).toEqual({ size: 'vertical', fps: 60, loops: 20, camera: 'turntable', look: 'editor', quality: 'best', format: 'gif', watermark: false })
    expect(sanitizeRender({ loops: 0 }).loops).toBe(1)
  })
  it('the watermark is on unless switched off', () => {
    expect(DEFAULT_RENDER.watermark).toBe(true)
  })
  it('round-trips through storage and survives junk', () => {
    const mem: Record<string, string> = {}
    const store = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => void (mem[k] = v) }
    saveRender(store, { ...DEFAULT_RENDER, size: 'square', watermark: false })
    expect(loadRender(store)).toEqual({ ...DEFAULT_RENDER, size: 'square', watermark: false })
    mem['snakie:renderMovie'] = '{not json'
    expect(loadRender(store)).toEqual(DEFAULT_RENDER)
    expect(loadRender(undefined)).toEqual(DEFAULT_RENDER)
  })
})

describe('planRender', () => {
  it('counts frames from length, loops and frame rate', () => {
    const p = planRender({ ...DEFAULT_RENDER, fps: 30, loops: 3 }, 1.2)
    expect(p.seconds).toBeCloseTo(3.6)
    expect(p.frames).toBe(108)
    expect(p).toMatchObject({ width: 1920, height: 1080, drawWidth: 1920, drawHeight: 1080, loops: 3 })
  })
  it('best quality draws at twice the size where that fits', () => {
    expect(planRender({ ...DEFAULT_RENDER, quality: 'best' }, 1)).toMatchObject({ drawWidth: 3840, drawHeight: 2160 })
    expect(planRender({ ...DEFAULT_RENDER, quality: 'best', size: '4k' }, 1)).toMatchObject({ drawWidth: 3840, drawHeight: 2160 })
  })
  it('a GIF is smaller and slower', () => {
    const p = planRender({ ...DEFAULT_RENDER, format: 'gif', fps: 60 }, 1)
    expect(p.fps).toBe(25)
    expect(Math.max(p.width, p.height)).toBe(720)
    expect(p.width % 2).toBe(0)
    const v = planRender({ ...DEFAULT_RENDER, format: 'gif', size: 'vertical' }, 1)
    expect([v.width, v.height]).toEqual([406, 720])
  })
  it('drops loops rather than run past the longest movie', () => {
    const p = planRender({ ...DEFAULT_RENDER, loops: 20 }, 30)
    expect(p.loops).toBe(4)
    expect(p.seconds).toBe(MAX_MOVIE_SECONDS)
    expect(planRender({ ...DEFAULT_RENDER, loops: 2 }, 500).seconds).toBe(MAX_MOVIE_SECONDS)
  })
  it('more quality means more bits', () => {
    const b = (quality: 'draft' | 'good' | 'best'): number => planRender({ ...DEFAULT_RENDER, quality }, 1).bitrate
    expect(b('draft')).toBeLessThan(b('good'))
    expect(b('good')).toBeLessThan(b('best'))
  })
  it('always makes at least one frame', () => {
    expect(planRender(DEFAULT_RENDER, 0).frames).toBe(1)
  })
})

describe('frameClipTime', () => {
  it('a loop wraps round', () => {
    expect(frameClipTime(0, 30, 1, true)).toBe(0)
    expect(frameClipTime(15, 30, 1, true)).toBeCloseTo(0.5)
    expect(frameClipTime(30, 30, 1, true)).toBeCloseTo(0)
    expect(frameClipTime(45, 30, 1, true)).toBeCloseTo(0.5)
  })
  it('a one-shot reaches its very last pose on every pass', () => {
    expect(frameClipTime(0, 30, 1, false)).toBe(0)
    expect(frameClipTime(29, 30, 1, false)).toBeCloseTo(1)
    expect(frameClipTime(30, 30, 1, false)).toBe(0)
    expect(frameClipTime(59, 30, 1, false)).toBeCloseTo(1)
  })
  it('an empty clip stays at the start', () => {
    expect(frameClipTime(12, 30, 0, true)).toBe(0)
  })
})

describe('h264Codec', () => {
  it('asks for a level that allows the frame size', () => {
    expect(h264Codec(1280, 720, 30)).toBe('avc1.64001f')
    expect(h264Codec(1920, 1080, 30)).toBe('avc1.640028')
    expect(h264Codec(1920, 1080, 60)).toBe('avc1.64002a')
    expect(h264Codec(1080, 1920, 30)).toBe('avc1.640028')
    expect(h264Codec(3840, 2160, 30)).toBe('avc1.640033')
    expect(h264Codec(3840, 2160, 60)).toBe('avc1.640034')
  })
})

describe('estimates', () => {
  it('sizes a video from its bitrate and length', () => {
    const p = planRender({ ...DEFAULT_RENDER, loops: 1 }, 8)
    expect(estimateBytes('mp4', p)).toBe(Math.round((p.bitrate / 8) * 8))
    expect(estimateBytes('webm', p)).toBeLessThan(estimateBytes('mp4', p))
  })
  it('formats sizes for people', () => {
    expect(formatBytes(500)).toBe('1 KB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatBytes(48 * 1024 * 1024)).toBe('48 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
  it('waits for a few frames before guessing the time left', () => {
    expect(etaSeconds(1, 100, 500)).toBeNull()
    expect(etaSeconds(10, 100, 1000)).toBe(9)
    expect(etaSeconds(100, 100, 1000)).toBe(0)
  })
})
