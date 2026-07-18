import { describe, it, expect, vi } from 'vitest'
import { emitServoDrive, onServoDrive } from '../src/renderer/src/components/servo-drive-bus'

describe('servo-drive-bus (#)', () => {
  it('delivers an emitted batch to every subscriber', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onServoDrive(a)
    const offB = onServoDrive(b)
    emitServoDrive({ '16': 90, '17': 45 })
    expect(a).toHaveBeenCalledWith({ '16': 90, '17': 45 })
    expect(b).toHaveBeenCalledWith({ '16': 90, '17': 45 })
    offA()
    offB()
  })

  it('stops delivering after unsubscribe', () => {
    const cb = vi.fn()
    const off = onServoDrive(cb)
    off()
    emitServoDrive({ '0': 10 })
    expect(cb).not.toHaveBeenCalled()
  })

  it('ignores an empty (or missing) batch', () => {
    const cb = vi.fn()
    const off = onServoDrive(cb)
    emitServoDrive({})
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('hands each subscriber a copy it cannot use to mutate the caller', () => {
    const original = { '5': 120 }
    let received: Record<string, number> | null = null
    const off = onServoDrive((m) => {
      received = m
      m['5'] = 0 // mutating the delivered object must not touch the caller's
    })
    emitServoDrive(original)
    expect(received).not.toBe(original)
    expect(original['5']).toBe(120)
    off()
  })
})
