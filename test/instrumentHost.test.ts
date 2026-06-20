import { describe, it, expect } from 'vitest'
import {
  clampOffset,
  initialOffset,
  instrumentKey,
  liveWarningVisible,
  redockKind,
  redockOne,
  unionByVariable
} from '../src/renderer/src/components/instrument-host'

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

describe('instrumentKey', () => {
  it('keys by kind + variable', () => {
    expect(instrumentKey('scope', 'pwm0')).toBe('scope:pwm0')
    expect(instrumentKey('meter', 'adc1')).toBe('meter:adc1')
  })

  it('distinguishes the same variable across kinds', () => {
    expect(instrumentKey('scope', 'x')).not.toBe(instrumentKey('meter', 'x'))
  })
})

describe('redockOne', () => {
  it('re-docks a floated instrument (close ✕ returns it to the dock)', () => {
    const before = { 'scope:a': false }
    const after = redockOne(before, 'scope', 'a')
    expect(after['scope:a']).toBe(true)
    // Pure: the input is not mutated.
    expect(before['scope:a']).toBe(false)
  })

  it('marks an unset instrument docked explicitly', () => {
    expect(redockOne({}, 'meter', 'b')).toEqual({ 'meter:b': true })
  })

  it('returns the SAME reference when already docked (no needless re-render)', () => {
    const docked = { 'scope:a': true }
    expect(redockOne(docked, 'scope', 'a')).toBe(docked)
  })

  it('leaves other instruments untouched', () => {
    const before = { 'scope:a': false, 'meter:b': false }
    const after = redockOne(before, 'scope', 'a')
    expect(after).toEqual({ 'scope:a': true, 'meter:b': false })
  })
})

describe('redockKind', () => {
  it('re-docks every open instrument of the kind (panel button restores docked)', () => {
    const before = { 'scope:a': false, 'scope:b': false, 'meter:c': false }
    const after = redockKind(before, 'scope', ['a', 'b'])
    expect(after).toEqual({ 'scope:a': true, 'scope:b': true, 'meter:c': false })
  })

  it('only touches the named kind (leaves the other kind floating)', () => {
    const before = { 'scope:a': false, 'meter:c': false }
    const after = redockKind(before, 'meter', ['c'])
    expect(after).toEqual({ 'scope:a': false, 'meter:c': true })
  })

  it('docks instruments with no prior override entry', () => {
    expect(redockKind({}, 'scope', ['a', 'b'])).toEqual({ 'scope:a': true, 'scope:b': true })
  })

  it('returns the SAME reference when nothing changes (all already docked)', () => {
    const docked = { 'scope:a': true, 'scope:b': true }
    expect(redockKind(docked, 'scope', ['a', 'b'])).toBe(docked)
  })

  it('is a no-op for an empty variable list', () => {
    const docked = { 'scope:a': false }
    expect(redockKind(docked, 'scope', [])).toBe(docked)
  })

  it('does not mutate its input', () => {
    const before = { 'scope:a': false }
    redockKind(before, 'scope', ['a'])
    expect(before['scope:a']).toBe(false)
  })
})

describe('unionByVariable', () => {
  const c = (variable: string, tag = ''): { variable: string; tag: string } => ({ variable, tag })

  it('appends extras not already present (selector lists every open instrument)', () => {
    const file = [c('pwm0')]
    const open = [c('pwm0'), c('pwm1')]
    expect(unionByVariable(file, open)).toEqual([c('pwm0'), c('pwm1')])
  })

  it('keeps the PRIMARY (file) version of a shared variable — first wins', () => {
    const file = [c('pwm0', 'from-file')]
    const open = [c('pwm0', 'from-instrument')]
    expect(unionByVariable(file, open)).toEqual([c('pwm0', 'from-file')])
  })

  it('returns ALL open instruments when the active file has none (the bug case)', () => {
    // Empty/non-.py main file → no file conns, but the open instruments must
    // still populate the selector so the instrument renders + is switchable.
    const open = [c('pwm0'), c('pwm1')]
    expect(unionByVariable([], open)).toEqual(open)
  })

  it('preserves order (file conns first, then new open conns)', () => {
    const file = [c('a'), c('b')]
    const open = [c('b'), c('c'), c('a'), c('d')]
    expect(unionByVariable(file, open).map((x) => x.variable)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not mutate its inputs', () => {
    const file = [c('a')]
    const open = [c('b')]
    unionByVariable(file, open)
    expect(file).toEqual([c('a')])
    expect(open).toEqual([c('b')])
  })
})

describe('liveWarningVisible', () => {
  it('shows only when live + connected + ≥1 instrument open', () => {
    expect(liveWarningVisible(true, true, 1)).toBe(true)
    expect(liveWarningVisible(true, true, 3)).toBe(true)
  })

  it('hides when LIVE is off (the default → no poll, no interruption)', () => {
    expect(liveWarningVisible(false, true, 2)).toBe(false)
  })

  it('hides when the board is disconnected (nothing is being interrupted)', () => {
    expect(liveWarningVisible(true, false, 2)).toBe(false)
  })

  it('hides when no instrument is open', () => {
    expect(liveWarningVisible(true, true, 0)).toBe(false)
  })

  it('treats a negative count defensively as nothing open', () => {
    expect(liveWarningVisible(true, true, -1)).toBe(false)
  })
})
