import { describe, expect, it } from 'vitest'
import {
  MAX_SPR_BYTES,
  SpriteThumbCache,
  type SpriteThumbIo
} from '../src/renderer/src/components/sprite-thumb-cache'
import { encodeSpr } from '../src/renderer/src/components/sprite-codecs'
import { newSprite, setPixel } from '../src/renderer/src/components/sprite-model'

/** A `.spr` with one lit pixel, so the rendered thumbnail is distinguishable. */
const sprBytes = (x = 0): Uint8Array =>
  encodeSpr(setPixel(newSprite('eyes', 8, 8), 0, x, 0, true))

/** A fake filesystem that counts what it was asked to do. */
function fakeIo(files: Record<string, { bytes: Uint8Array; mtimeMs: number; isDir?: boolean }>): {
  io: SpriteThumbIo
  stats: number
  reads: number
  files: typeof files
} {
  const spy = {
    files,
    stats: 0,
    reads: 0,
    io: {
      async stat(path: string) {
        spy.stats++
        const file = files[path]
        if (!file) throw new Error('ENOENT: no such file or directory')
        return { isDir: !!file.isDir, size: file.bytes.length, mtimeMs: file.mtimeMs }
      },
      async readBytes(path: string) {
        spy.reads++
        const file = files[path]
        if (!file) throw new Error('ENOENT: no such file or directory')
        return file.bytes
      }
    }
  }
  return spy
}

/** A cache whose clock we drive, so TTL behaviour is deterministic. */
function cacheAt(io: SpriteThumbIo, clock: { t: number }, ttlMs = 4000): SpriteThumbCache {
  return new SpriteThumbCache(io, { ttlMs, now: () => clock.t })
}

describe('reading a sprite', () => {
  it('decodes it once and answers from memory afterwards', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: sprBytes(), mtimeMs: 1000 } })
    const clock = { t: 0 }
    const cache = cacheAt(spy.io, clock)

    expect(cache.peek('/p/eyes.spr')).toBeUndefined() // nothing known, and no I/O
    expect(spy.stats).toBe(0)

    expect(await cache.refresh(['/p/eyes.spr'])).toBe(true)
    const record = cache.peek('/p/eyes.spr')
    expect(record?.state).toBe('ok')
    expect(record?.width).toBe(8)
    expect(record?.frames).toBe(1)
    expect(record?.thumb?.dataUri).toContain('data:image/svg+xml,')
    expect(spy.reads).toBe(1)
  })

  it('costs NOTHING on a keystroke — peek never touches the filesystem', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: sprBytes(), mtimeMs: 1000 } })
    const clock = { t: 0 }
    const cache = cacheAt(spy.io, clock)
    await cache.refresh(['/p/eyes.spr'])
    const before = { stats: spy.stats, reads: spy.reads }
    for (let i = 0; i < 200; i++) expect(cache.peek('/p/eyes.spr')?.state).toBe('ok')
    expect(spy.stats).toBe(before.stats)
    expect(spy.reads).toBe(before.reads)
  })

  it('does not re-stat inside the TTL, however often refresh is called', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: sprBytes(), mtimeMs: 1000 } })
    const clock = { t: 0 }
    const cache = cacheAt(spy.io, clock, 4000)
    await cache.refresh(['/p/eyes.spr'])
    for (let i = 0; i < 10; i++) {
      clock.t += 100 // still well inside the TTL
      expect(await cache.refresh(['/p/eyes.spr'])).toBe(false)
    }
    expect(spy.stats).toBe(1)
    expect(spy.reads).toBe(1)
  })

  it('re-stats past the TTL but only re-reads when the file actually moved', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: sprBytes(), mtimeMs: 1000 } })
    const clock = { t: 0 }
    const cache = cacheAt(spy.io, clock, 4000)
    await cache.refresh(['/p/eyes.spr'])
    const key = cache.peek('/p/eyes.spr')?.key

    clock.t = 5000
    expect(await cache.refresh(['/p/eyes.spr'])).toBe(false) // same mtime + size
    expect(spy.stats).toBe(2)
    expect(spy.reads).toBe(1) // the bytes were NOT read again
    expect(cache.peek('/p/eyes.spr')?.key).toBe(key)

    spy.files['/p/eyes.spr'] = { bytes: sprBytes(3), mtimeMs: 2000 }
    clock.t = 10000
    expect(await cache.refresh(['/p/eyes.spr'])).toBe(true)
    expect(spy.reads).toBe(2)
    expect(cache.peek('/p/eyes.spr')?.key).not.toBe(key) // new content, new CSS rule
  })

  it('shares one load between concurrent requests for the same path', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: sprBytes(), mtimeMs: 1000 } })
    const clock = { t: 0 }
    const cache = cacheAt(spy.io, clock)
    await Promise.all([
      cache.refresh(['/p/eyes.spr']),
      cache.refresh(['/p/eyes.spr']),
      cache.refresh(['/p/eyes.spr'])
    ])
    expect(spy.stats).toBe(1)
    expect(spy.reads).toBe(1)
  })
})

describe('a reference that cannot be drawn', () => {
  it('records a MISSING file as a value, with the reason', async () => {
    const spy = fakeIo({})
    const cache = cacheAt(spy.io, { t: 0 })
    await cache.refresh(['/p/gone.spr'])
    const record = cache.peek('/p/gone.spr')
    expect(record?.state).toBe('missing')
    expect(record?.error).toContain('ENOENT')
    expect(record?.thumb).toBeUndefined()
  })

  it('surfaces the decoder’s complaint for a file that is not a sprite', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: new Uint8Array(32), mtimeMs: 1 } })
    const cache = cacheAt(spy.io, { t: 0 })
    await cache.refresh(['/p/eyes.spr'])
    const record = cache.peek('/p/eyes.spr')
    expect(record?.state).toBe('error')
    // The message comes from decodeSpr — not a generic "failed", and not silence.
    expect(record?.error).toContain('.spr')
  })

  it('reports a truncated sprite rather than drawing a partial one', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: sprBytes().slice(0, 20), mtimeMs: 1 } })
    const cache = cacheAt(spy.io, { t: 0 })
    await cache.refresh(['/p/eyes.spr'])
    expect(cache.peek('/p/eyes.spr')?.state).toBe('error')
    expect(cache.peek('/p/eyes.spr')?.error).toMatch(/truncated/i)
  })

  it('says so when the path is a folder', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: new Uint8Array(), mtimeMs: 1, isDir: true } })
    const cache = cacheAt(spy.io, { t: 0 })
    await cache.refresh(['/p/eyes.spr'])
    expect(cache.peek('/p/eyes.spr')?.error).toContain('folder')
  })

  it('declines to read something absurdly large instead of stalling the editor', async () => {
    const spy = fakeIo({ '/p/huge.spr': { bytes: new Uint8Array(0), mtimeMs: 1 } })
    // Report a huge size without allocating one.
    spy.io.stat = async () => ({ isDir: false, size: MAX_SPR_BYTES + 1, mtimeMs: 1 })
    const cache = cacheAt(spy.io, { t: 0 })
    await cache.refresh(['/p/huge.spr'])
    expect(cache.peek('/p/huge.spr')?.state).toBe('error')
    expect(spy.reads).toBe(0)
  })

  it('caches the failure too — a missing file is not re-checked every keystroke', async () => {
    const spy = fakeIo({})
    const clock = { t: 0 }
    const cache = cacheAt(spy.io, clock, 4000)
    await cache.refresh(['/p/gone.spr'])
    await cache.refresh(['/p/gone.spr'])
    expect(spy.stats).toBe(1)
    // …but it IS re-checked once the TTL lapses, so creating the file heals it.
    clock.t = 5000
    spy.files['/p/gone.spr'] = { bytes: sprBytes(), mtimeMs: 1 }
    expect(await cache.refresh(['/p/gone.spr'])).toBe(true)
    expect(cache.peek('/p/gone.spr')?.state).toBe('ok')
  })
})

describe('invalidation', () => {
  it('forgets a path and tells subscribers, so a save repaints at once', async () => {
    const spy = fakeIo({ '/p/eyes.spr': { bytes: sprBytes(), mtimeMs: 1000 } })
    const clock = { t: 0 }
    const cache = cacheAt(spy.io, clock, 60000)
    await cache.refresh(['/p/eyes.spr'])

    let told = 0
    const stop = cache.subscribe(() => told++)
    spy.files['/p/eyes.spr'] = { bytes: sprBytes(5), mtimeMs: 2000 }

    // Inside the TTL, refresh alone would change nothing.
    expect(await cache.refresh(['/p/eyes.spr'])).toBe(false)
    cache.invalidate('/p/eyes.spr')
    expect(told).toBe(1)
    expect(cache.peek('/p/eyes.spr')).toBeUndefined()

    expect(await cache.refresh(['/p/eyes.spr'])).toBe(true)
    expect(told).toBe(2) // the reload notified as well
    expect(spy.reads).toBe(2)

    stop()
    cache.invalidate()
    expect(told).toBe(2) // unsubscribed
  })
})
