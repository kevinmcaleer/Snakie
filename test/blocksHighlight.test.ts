import { describe, it, expect } from 'vitest'
import {
  putOutHighlight,
  type BlockLookup,
  type LitRef
} from '../src/renderer/src/lib/blocks/highlight'

/**
 * THE LINK'S HIGHLIGHT (#1050, #1016).
 * =============================================================================
 *
 * Clicking a line in the Python lit the block that wrote it — and never put it
 * out again. Blockly's programmatic `select()` highlights without clearing the
 * previous selection (v13 hands that to the focus manager), so the highlights
 * accumulated: clicking four lines in turn left four blocks lit, and the only
 * way to clear one was to click it on the canvas and then click away.
 *
 * The rule is short and I got it wrong twice writing it, in both of the ways the
 * last two describes pin. That is why it is out here rather than inline.
 */

const fake = (): { ws: BlockLookup; out: string[] } => {
  const out: string[] = []
  return {
    out,
    ws: {
      getBlockById: (id: string) => ({
        unselect: () => {
          out.push(id)
        }
      })
    }
  }
}

const lit = (id: string | null): LitRef => ({ current: id })

describe('putting out the highlight we added (#1050)', () => {
  it('puts out the block we lit when another is wanted', () => {
    const { ws, out } = fake()
    const ref = lit('a')
    putOutHighlight(ws, ref, 'b')
    expect(out).toEqual(['a'])
    expect(ref.current).toBe(null)
  })

  it('puts it out when NOTHING is wanted — the case that was missing', () => {
    // Clicking a line no block wrote (an import, a comment, a blank line) is a
    // real answer: "nothing here came from a block". It has to look like one.
    const { ws, out } = fake()
    const ref = lit('a')
    putOutHighlight(ws, ref, null)
    expect(out).toEqual(['a'])
    expect(ref.current).toBe(null)
  })

  it('does nothing when we hold no highlight', () => {
    const { ws, out } = fake()
    const ref = lit(null)
    putOutHighlight(ws, ref, 'b')
    expect(out).toEqual([])
  })
})

describe('what must NOT be put out (#1050)', () => {
  it('leaves the highlight alone when it is the one that should stay', () => {
    // MISTAKE ONE. The canvas's own `select()` echoes back through Blockly's
    // selection event; putting the light out on that echo means the highlight
    // never appears at all.
    const { ws, out } = fake()
    const ref = lit('a')
    putOutHighlight(ws, ref, 'a')
    expect(out).toEqual([])
    expect(ref.current).toBe('a')
  })

  it('and the caller can therefore treat its own echo as a no-op', () => {
    // The same call twice must not put out on the second pass.
    const { ws, out } = fake()
    const ref = lit('a')
    putOutHighlight(ws, ref, 'a')
    putOutHighlight(ws, ref, 'a')
    expect(out).toEqual([])
  })
})

describe('it never throws (#1050)', () => {
  it('with no workspace', () => {
    const ref = lit('a')
    expect(() => putOutHighlight(null, ref, 'b')).not.toThrow()
    // The bookkeeping still clears: what we were holding is gone either way.
    expect(ref.current).toBe(null)
  })

  it('when the block has since been deleted', () => {
    // A reconversion (#1034) rebuilds the canvas, so the id we are holding may
    // name a block that no longer exists.
    const ws: BlockLookup = { getBlockById: () => null }
    const ref = lit('a')
    expect(() => putOutHighlight(ws, ref, 'b')).not.toThrow()
    expect(ref.current).toBe(null)
  })
})
