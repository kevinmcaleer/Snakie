import { describe, it, expect } from 'vitest'
import { shouldAutoHide, loadPin, savePin, PIN_KEYS } from '../src/renderer/src/components/pin-overlay'

/** A fake panel: "contains" exactly the nodes in the set. */
const panelWith = (...nodes: Node[]): { contains(n: Node | null): boolean } => ({
  contains: (n) => n !== null && nodes.includes(n)
})
// Minimal Node stand-ins — shouldAutoHide duck-types (no `instanceof Node`),
// so plain objects work in the DOM-less node test environment.
const mkNode = (): Node => ({} as Node)

describe('shouldAutoHide (pinnable board panels)', () => {
  it('a pinned panel never auto-hides', () => {
    expect(shouldAutoHide(true, panelWith(), null)).toBe(false)
    expect(shouldAutoHide(true, null, null)).toBe(false)
  })

  it('no panel element → never hides (not mounted yet)', () => {
    expect(shouldAutoHide(false, null, null)).toBe(false)
  })

  it('focus moving OUTSIDE the panel hides it; inside keeps it', () => {
    const inside = mkNode()
    const outside = mkNode()
    const panel = panelWith(inside)
    expect(shouldAutoHide(false, panel, inside)).toBe(false)
    expect(shouldAutoHide(false, panel, outside)).toBe(true)
  })

  it('focus leaving the document (null) hides an unpinned panel', () => {
    expect(shouldAutoHide(false, panelWith(), null)).toBe(true)
  })
})

describe('pin persistence', () => {
  const mem = (): { store: Record<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } => {
    const store: Record<string, string> = {}
    return {
      store,
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v
      }
    }
  }

  it('round-trips a pin flag', () => {
    const s = mem()
    savePin(s, PIN_KEYS.library, true)
    expect(loadPin(s, PIN_KEYS.library, false)).toBe(true)
    savePin(s, PIN_KEYS.library, false)
    expect(loadPin(s, PIN_KEYS.library, true)).toBe(false)
  })

  it('missing / corrupt values fall back', () => {
    const s = mem()
    expect(loadPin(s, PIN_KEYS.connections, true)).toBe(true)
    s.store[PIN_KEYS.connections] = 'not json{{'
    expect(loadPin(s, PIN_KEYS.connections, false)).toBe(false)
    s.store[PIN_KEYS.connections] = '"yes"'
    expect(loadPin(s, PIN_KEYS.connections, true)).toBe(true)
  })

  it('savePin tolerates a read-only storage', () => {
    expect(() => savePin({ getItem: () => null }, PIN_KEYS.library, true)).not.toThrow()
    expect(() =>
      savePin(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota')
          }
        },
        PIN_KEYS.library,
        true
      )
    ).not.toThrow()
  })
})
