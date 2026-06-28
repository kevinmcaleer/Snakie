import { describe, it, expect } from 'vitest'
import {
  historyInit,
  historyPush,
  historyReplace,
  historyUndo,
  historyRedo,
  canUndo,
  canRedo
} from '../src/renderer/src/components/use-history'

/**
 * The undo/redo stack behind the Part Editor's Ctrl+Z (#187). These cover the
 * pure past/present/future ops; the React hook layers a coalescing clock on top
 * (so one drag = one undo step), which is exercised through these primitives.
 */
describe('use-history stack', () => {
  it('starts empty (no undo/redo) holding just the present', () => {
    const h = historyInit('a')
    expect(h).toEqual({ past: [], present: 'a', future: [] })
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('push checkpoints the present and clears the redo stack', () => {
    let h = historyInit('a')
    h = historyPush(h, 'b')
    expect(h).toEqual({ past: ['a'], present: 'b', future: [] })
    h = historyPush(h, 'c')
    expect(h).toEqual({ past: ['a', 'b'], present: 'c', future: [] })
    expect(canUndo(h)).toBe(true)
  })

  it('undo walks back and fills the redo stack; redo walks forward', () => {
    let h = historyPush(historyPush(historyInit('a'), 'b'), 'c')
    h = historyUndo(h)
    expect(h).toEqual({ past: ['a'], present: 'b', future: ['c'] })
    h = historyUndo(h)
    expect(h).toEqual({ past: [], present: 'a', future: ['b', 'c'] })
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(true)
    h = historyRedo(h)
    expect(h).toEqual({ past: ['a'], present: 'b', future: ['c'] })
    h = historyRedo(h)
    expect(h).toEqual({ past: ['a', 'b'], present: 'c', future: [] })
  })

  it('undo / redo at the ends are no-ops', () => {
    const base = historyInit('a')
    expect(historyUndo(base)).toBe(base)
    expect(historyRedo(base)).toBe(base)
  })

  it('a push after an undo branches — the old redo future is dropped', () => {
    let h = historyPush(historyPush(historyInit('a'), 'b'), 'c') // a→b→c
    h = historyUndo(h) // present b, future [c]
    h = historyPush(h, 'd') // new branch from b
    expect(h).toEqual({ past: ['a', 'b'], present: 'd', future: [] })
    expect(canRedo(h)).toBe(false)
  })

  it('replace updates the present WITHOUT a checkpoint (a coalesced drag frame)', () => {
    let h = historyPush(historyInit('a'), 'b') // past [a], present b
    h = historyReplace(h, 'b2')
    h = historyReplace(h, 'b3')
    // Still ONE checkpoint — undo jumps straight back past the whole gesture.
    expect(h).toEqual({ past: ['a'], present: 'b3', future: [] })
    expect(historyUndo(h)).toMatchObject({ present: 'a' })
  })

  it('push caps retained checkpoints at the limit (drops the oldest)', () => {
    let h = historyInit(0)
    for (let i = 1; i <= 5; i++) h = historyPush(h, i, 3)
    // limit 3 → only the 3 most-recent checkpoints kept.
    expect(h.past).toEqual([2, 3, 4])
    expect(h.present).toBe(5)
  })
})
