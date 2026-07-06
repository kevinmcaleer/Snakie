import { describe, it, expect, vi } from 'vitest'
import { broadcastToTargets, type BroadcastTarget } from '../src/main/device/broadcast'

/** A fake WebContents: records sends, can be pre-destroyed, can throw on send. */
function fakeWC(opts: { destroyed?: boolean; throwOnSend?: boolean } = {}): BroadcastTarget & {
  send: ReturnType<typeof vi.fn>
} {
  return {
    isDestroyed: () => opts.destroyed ?? false,
    send: vi.fn(() => {
      if (opts.throwOnSend) throw new Error('Object has been destroyed')
    })
  }
}

describe('broadcastToTargets (#226)', () => {
  it('sends to every live target with the channel + payload', () => {
    const a = fakeWC()
    const b = fakeWC()
    broadcastToTargets([a, b], 'device:data', { n: 1 })
    expect(a.send).toHaveBeenCalledWith('device:data', { n: 1 })
    expect(b.send).toHaveBeenCalledWith('device:data', { n: 1 })
  })

  it('skips destroyed windows and undefined/null targets', () => {
    const dead = fakeWC({ destroyed: true })
    const live = fakeWC()
    broadcastToTargets([undefined, null, dead, live], 'device:status', 'connected')
    expect(dead.send).not.toHaveBeenCalled()
    expect(live.send).toHaveBeenCalledOnce()
  })

  it('a window torn down mid-send does not stop the rest (the crash race)', () => {
    // isDestroyed() passes, but send() throws (window closed between the two).
    const boom = fakeWC({ throwOnSend: true })
    const after = fakeWC()
    expect(() => broadcastToTargets([boom, after], 'device:data', new Uint8Array([1]))).not.toThrow()
    expect(boom.send).toHaveBeenCalledOnce()
    expect(after.send).toHaveBeenCalledOnce() // still reached despite the throw
  })
})
