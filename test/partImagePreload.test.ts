import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Part-image decode warming. The point is that it is SAFE and idempotent — it runs
 * on every library load, including in a pop-out window and under tests.
 */

class FakeImage {
  static made: FakeImage[] = []
  src = ''
  decode = vi.fn(() => Promise.resolve())
  constructor() {
    FakeImage.made.push(this)
  }
}

describe('preloadPartImages', () => {
  beforeEach(() => {
    FakeImage.made = []
    vi.resetModules()
    ;(globalThis as { Image?: unknown }).Image = FakeImage
  })

  it('decodes each part photo once, up front', async () => {
    const { preloadPartImages, warmedImageCount } = await import(
      '../src/renderer/src/components/part-image-preload'
    )
    preloadPartImages([{ parts: [{ imageData: 'data:a' }, { imageData: 'data:b' }] }])
    expect(FakeImage.made.map((i) => i.src)).toEqual(['data:a', 'data:b'])
    expect(FakeImage.made.every((i) => i.decode.mock.calls.length === 1)).toBe(true)
    expect(warmedImageCount()).toBe(2)
  })

  it('is idempotent — a second load re-decodes nothing', async () => {
    const { preloadPartImages } = await import('../src/renderer/src/components/part-image-preload')
    const libs = [{ parts: [{ imageData: 'data:a' }] }]
    preloadPartImages(libs)
    preloadPartImages(libs)
    expect(FakeImage.made).toHaveLength(1)
  })

  it('warms the REAR face too', async () => {
    const { preloadPartImages } = await import('../src/renderer/src/components/part-image-preload')
    preloadPartImages([{ parts: [{ imageData: 'data:front', rear: { imageData: 'data:back' } }] }])
    expect(FakeImage.made.map((i) => i.src)).toEqual(['data:front', 'data:back'])
  })

  it('ignores parts with no photo, and empty input', async () => {
    const { preloadPartImages } = await import('../src/renderer/src/components/part-image-preload')
    preloadPartImages([{ parts: [{}, { rear: {} }] }])
    preloadPartImages([])
    expect(FakeImage.made).toHaveLength(0)
  })

  it('is a no-op with no DOM, rather than throwing', async () => {
    ;(globalThis as { Image?: unknown }).Image = undefined
    const { preloadPartImages } = await import('../src/renderer/src/components/part-image-preload')
    expect(() => preloadPartImages([{ parts: [{ imageData: 'data:a' }] }])).not.toThrow()
  })

  it('survives a decode rejection (a malformed data URL)', async () => {
    class Rejecting extends FakeImage {
      decode = vi.fn(() => Promise.reject(new Error('bad image')))
    }
    ;(globalThis as { Image?: unknown }).Image = Rejecting
    const { preloadPartImages } = await import('../src/renderer/src/components/part-image-preload')
    expect(() => preloadPartImages([{ parts: [{ imageData: 'data:bad' }] }])).not.toThrow()
    await Promise.resolve()
  })
})
