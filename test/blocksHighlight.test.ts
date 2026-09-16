import { describe, it, expect } from 'vitest'
import {
  isStaleDeselect,
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

describe('a selection event that has been overtaken (#1050)', () => {
  /**
   * The regression the first fix caused, and the reason this rule exists.
   *
   * Putting our own highlight out fires a selection event carrying NO id, and
   * Blockly queues its events — so that "nothing is selected" lands AFTER we
   * have lit the next block. Forwarding it as the learner's choice cleared the
   * link: clicking a block on the canvas lit its lines in the Python for an
   * instant, then put them out again.
   */
  it('drops a "nothing selected" that something has already replaced', () => {
    expect(isStaleDeselect(null, 'b')).toBe(true)
  })

  it('lets a GENUINE deselect through — clicking empty canvas', () => {
    // Nothing selected, and nothing IS: that is the learner, not our echo.
    expect(isStaleDeselect(null, null)).toBe(false)
  })

  it('never drops an event that names a block', () => {
    expect(isStaleDeselect('a', 'a')).toBe(false)
    expect(isStaleDeselect('a', 'b')).toBe(false)
    expect(isStaleDeselect('a', null)).toBe(false)
  })

  it('is decided by what is selected NOW, not by event order', () => {
    // Whether our echo arrives before or after the next `select()` is Blockly's
    // business. Asking the present tense is what makes the rule timing-proof.
    const beforeOurSelect = isStaleDeselect(null, null)
    const afterOurSelect = isStaleDeselect(null, 'b')
    expect(beforeOurSelect).toBe(false)
    expect(afterOurSelect).toBe(true)
  })
})
