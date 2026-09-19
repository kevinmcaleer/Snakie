import { describe, it, expect } from 'vitest'
import { SimOutputPump, FLUSH_BYTES } from '../src/shared/sim-output-pump'

const enc = new TextEncoder()
const dec = new TextDecoder()

const make = (): { pump: SimOutputPump; posts: string[] } => {
  const posts: string[] = []
  const pump = new SimOutputPump((b) => posts.push(dec.decode(b)))
  return { pump, posts }
}

/**
 * The simulator's stdout pump. The web simulator's "Run does nothing" bug was a
 * program whose output only ever left the worker on a timer — a timer that a
 * busy-waiting `time.sleep` never let fire. These pin the behaviour that fixes
 * it: a line is posted the moment it is complete, timer or no timer.
 */
describe('SimOutputPump', () => {
  it('posts a line as soon as its newline arrives, without waiting for flush()', () => {
    const { pump, posts } = make()
    for (const b of enc.encode('hello\n')) pump.collect(Uint8Array.of(b))
    expect(posts).toEqual(['hello\n'])
  })

  it('holds a partial line until flush() — or until it grows too long', () => {
    const { pump, posts } = make()
    pump.collect(enc.encode('>>> '))
    expect(posts).toEqual([])
    pump.flush()
    expect(posts).toEqual(['>>> '])

    pump.collect(enc.encode('#'.repeat(FLUSH_BYTES - 1)))
    expect(posts).toHaveLength(1)
    pump.collect(enc.encode('#'))
    expect(posts).toHaveLength(2)
    expect(posts[1]).toHaveLength(FLUSH_BYTES)
  })

  it('diverts everything into a capture and posts nothing meanwhile', () => {
    const { pump, posts } = make()
    pump.collect(enc.encode('tail'))
    pump.beginCapture()
    // The terminal's partial line went out before the capture opened.
    expect(posts).toEqual(['tail'])
    pump.collect(enc.encode('["a",true,3]\n'))
    pump.flush()
    expect(posts).toEqual(['tail'])
    expect(pump.captured()).toBe('["a",true,3]\n')
    pump.endCapture()
    pump.collect(enc.encode('back\n'))
    expect(posts).toEqual(['tail', 'back\n'])
  })

  it('flush() is a no-op when there is nothing pending', () => {
    const { pump, posts } = make()
    pump.flush()
    expect(posts).toEqual([])
  })
})
