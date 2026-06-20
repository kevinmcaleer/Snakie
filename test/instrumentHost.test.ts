import { describe, it, expect } from 'vitest'
import { clampOffset, initialOffset } from '../src/renderer/src/components/instrument-host'

describe('initialOffset', () => {
  it('cascades the first windows down-right', () => {
    const a = initialOffset(0)
    const b = initialOffset(1)
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBeGreaterThan(a.y)
  })

  it('keeps the first window at a small positive inset (on-screen)', () => {
    const a = initialOffset(0)
    expect(a.x).toBeGreaterThan(0)
    expect(a.y).toBeGreaterThan(0)
  })

  it('wraps after the cascade slots so a long stack does not march off-screen', () => {
    // Slot 6 wraps back to slot 0's position.
    expect(initialOffset(6)).toEqual(initialOffset(0))
    expect(initialOffset(7)).toEqual(initialOffset(1))
  })

  it('handles negative indices defensively (no NaN / negative position)', () => {
    const n = initialOffset(-1)
    expect(Number.isFinite(n.x)).toBe(true)
    expect(Number.isFinite(n.y)).toBe(true)
    expect(n.x).toBeGreaterThanOrEqual(0)
    expect(n.y).toBeGreaterThanOrEqual(0)
  })
})

describe('clampOffset', () => {
  const HOST_W = 1000
  const HOST_H = 700

  it('leaves an in-bounds offset unchanged', () => {
    expect(clampOffset({ x: 120, y: 80 }, HOST_W, HOST_H)).toEqual({ x: 120, y: 80 })
  })

  it('pins a negative offset to the top-left (grip never leaves the host)', () => {
    expect(clampOffset({ x: -50, y: -30 }, HOST_W, HOST_H)).toEqual({ x: 0, y: 0 })
  })

  it('keeps at least `margin` of the window inside the far edge', () => {
    const out = clampOffset({ x: 99999, y: 99999 }, HOST_W, HOST_H, 24)
    expect(out.x).toBe(HOST_W - 24)
    expect(out.y).toBe(HOST_H - 24)
  })

  it('respects a custom margin', () => {
    const out = clampOffset({ x: 99999, y: 99999 }, HOST_W, HOST_H, 100)
    expect(out.x).toBe(HOST_W - 100)
    expect(out.y).toBe(HOST_H - 100)
  })

  it('never returns a negative max when the host is smaller than the margin', () => {
    const out = clampOffset({ x: 500, y: 500 }, 10, 10, 40)
    expect(out.x).toBe(0)
    expect(out.y).toBe(0)
  })
})
