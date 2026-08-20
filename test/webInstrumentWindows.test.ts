import { describe, it, expect } from 'vitest'
import {
  createApiGuard,
  instrumentKeyFromHash,
  instrumentWindowName,
  instrumentWindowUrl
} from '../src/renderer/src/web/web-instruments'

/**
 * The web pop-out (#781) lends the EDITOR window's `window.api` to a browser
 * popup, which is a separate JS realm that can vanish at any moment. These cover
 * the two properties that makes safe:
 *
 *  - a borrower whose realm is gone must not be able to break the lender, and
 *  - when the borrower goes, so does everything it subscribed to.
 *
 * The fake device below broadcasts with a BARE `forEach`, exactly as
 * `web-device.ts` / `web-serial.ts` do — that is the loop a dead popup callback
 * would otherwise throw inside, taking the editor's own telemetry with it.
 */
function makeLender(): {
  api: Record<string, unknown>
  emit: (chunk: number) => void
  subscribers: () => number
  unsubscribeCalls: () => number
} {
  const subs = new Set<(chunk: number) => void>()
  let unsubscribeCalls = 0
  return {
    api: {
      version: '1.2.3',
      device: {
        onData(cb: (chunk: number) => void): () => void {
          subs.add(cb)
          return () => {
            unsubscribeCalls += 1
            subs.delete(cb)
          }
        },
        sendControl(target: string, payload: string): string {
          return `${target}=${payload}`
        }
      }
    },
    emit: (chunk) => subs.forEach((cb) => cb(chunk)),
    subscribers: () => subs.size,
    unsubscribeCalls: () => unsubscribeCalls
  }
}

describe('createApiGuard — lending one window’s API to another', () => {
  it('passes calls and events straight through', () => {
    const lender = makeLender()
    const guard = createApiGuard()
    const api = guard.view(lender.api) as { device: Record<string, (...a: never[]) => unknown> }

    const seen: number[] = []
    api.device.onData(((c: number) => seen.push(c)) as never)
    expect(api.device.sendControl('led' as never, 'on' as never)).toBe('led=on')
    lender.emit(7)
    expect(seen).toEqual([7])
  })

  it('reports non-function properties unchanged', () => {
    const lender = makeLender()
    const api = createApiGuard().view(lender.api) as { version: string }
    expect(api.version).toBe('1.2.3')
  })

  it('a borrowed subscriber that throws does not break the broadcast', () => {
    const lender = makeLender()
    const guard = createApiGuard()
    const borrowed = guard.view(lender.api) as { device: { onData: (cb: () => void) => () => void } }

    // The lender's own subscriber, taken directly — it must still be reached.
    const mine: number[] = []
    ;(lender.api.device as { onData: (cb: (c: number) => void) => void }).onData((c) => mine.push(c))
    borrowed.device.onData(() => {
      throw new Error('this window no longer exists')
    })

    expect(() => lender.emit(3)).not.toThrow()
    expect(mine).toEqual([3])
  })

  it('dispose() unsubscribes everything the borrower took', () => {
    const lender = makeLender()
    const guard = createApiGuard()
    const borrowed = guard.view(lender.api) as { device: { onData: (cb: () => void) => () => void } }

    borrowed.device.onData(() => undefined)
    borrowed.device.onData(() => undefined)
    expect(lender.subscribers()).toBe(2)

    guard.dispose()
    expect(lender.subscribers()).toBe(0)
  })

  it('dispose() leaves the borrowed API inert, so a late call is not a crash', () => {
    const lender = makeLender()
    const guard = createApiGuard()
    const borrowed = guard.view(lender.api) as {
      device: { sendControl: (t: string, p: string) => unknown }
    }

    guard.dispose()
    expect(borrowed.device.sendControl('led', 'on')).toBeUndefined()
    expect(lender.subscribers()).toBe(0)
  })

  it('an unsubscribe used by the borrower is not run again by dispose()', () => {
    const lender = makeLender()
    const guard = createApiGuard()
    const borrowed = guard.view(lender.api) as { device: { onData: (cb: () => void) => () => void } }

    const off = borrowed.device.onData(() => undefined)
    off()
    guard.dispose()
    expect(lender.unsubscribeCalls()).toBe(1)
  })

  it('wraps nested namespaces the same way, so a deep subscription is tracked too', () => {
    const subs = new Set<() => void>()
    const lender = {
      robot: {
        onChanged(cb: () => void): () => void {
          subs.add(cb)
          return () => subs.delete(cb)
        }
      }
    }
    const guard = createApiGuard()
    guard.view(lender).robot.onChanged(() => {
      throw new Error('this window no longer exists')
    })

    expect(subs.size).toBe(1)
    expect(() => subs.forEach((cb) => cb())).not.toThrow()
    guard.dispose()
    expect(subs.size).toBe(0)
  })
})

describe('instrument popup identity', () => {
  it('round-trips a key through the popup URL', () => {
    for (const key of ['scope:pwm0', 'meter:adc0', 'singleton:i2c-detect']) {
      const url = instrumentWindowUrl(key)
      expect(instrumentKeyFromHash(url.slice(url.indexOf('#')))).toBe(key)
    }
  })

  it('keeps the key out of the request URL, so the offline precache still matches', () => {
    // A query string would miss the precached `instrument.html` and be answered
    // by the PWA's navigation fallback — i.e. the whole editor in a pop-out.
    const url = instrumentWindowUrl('scope:pwm0')
    expect(url.split('#')[0]).toBe('instrument.html')
    expect(url).not.toContain('?')
  })

  it('has no key for a hand-opened instrument.html', () => {
    expect(instrumentKeyFromHash('')).toBeNull()
    expect(instrumentKeyFromHash('#other=1')).toBeNull()
    expect(instrumentKeyFromHash('#key=')).toBeNull()
  })

  it('names one window per instrument, so re-undocking re-adopts it', () => {
    expect(instrumentWindowName('scope:pwm0')).toBe(instrumentWindowName('scope:pwm0'))
    expect(instrumentWindowName('scope:pwm0')).not.toBe(instrumentWindowName('meter:pwm0'))
    // A window name must survive being put in a `window.open` argument.
    expect(instrumentWindowName('singleton:i2c-detect')).toMatch(/^[a-zA-Z0-9-]+$/)
  })
})
