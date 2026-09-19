import { describe, it, expect } from 'vitest'
import type * as Blockly from 'blockly/core'
import { compactRootColumn, tightenColumn } from '../src/renderer/src/lib/blocks/root-column'
import { ROOT_GUTTER, ROOT_ORIGIN } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * THE COLUMN IS SPACED BY WHAT THE BLOCKS MEASURE, NOT BY A GUESS.
 * =============================================================================
 *
 * `stackRoots` estimates each stack's height without Blockly, because the
 * converter is pure. Measured against the real canvas on this repo's own
 * examples, that estimate over-reserved by up to 512px after a long chain —
 * which is a screen of empty parchment between the imports and the next stack,
 * and reads as blocks that never rendered — and under-reserved by 18px on a
 * `def` with a big body, which is the overlap the estimate exists to prevent.
 *
 * So the canvas re-spaces the column once the blocks are drawn and their
 * heights are a fact. The arithmetic is here; the measuring is Blockly's.
 */
describe('tightenColumn', () => {
  it('anchors on the first root and gives every gap the gutter', () => {
    const tops = tightenColumn([
      { top: 40, height: 1880 },
      { top: 2424, height: 223 },
      { top: 2695, height: 400 }
    ])
    expect(tops).toEqual([40, 40 + 1880 + ROOT_GUTTER, 40 + 1880 + ROOT_GUTTER + 223 + ROOT_GUTTER])
  })

  it('closes the 512px hole the estimate left', () => {
    // The worst case in `examples/`: a 16-block chain whose estimate ran 504px
    // long. Whatever the second root's stored y was, it lands one gutter down.
    const [, second] = tightenColumn([
      { top: 40, height: 1880 },
      { top: 2424, height: 223 }
    ])
    expect(second - (40 + 1880)).toBe(ROOT_GUTTER)
  })

  it('pushes a root DOWN when the estimate was short — the overlap case', () => {
    // `examples/buddyjr/pose_demo.py`: the next root was drawn 18px inside the
    // one above it. Tightening is not only about closing gaps.
    const [, second] = tightenColumn([
      { top: 40, height: 819 },
      { top: 841, height: 200 }
    ])
    expect(second).toBe(40 + 819 + ROOT_GUTTER)
    expect(second).toBeGreaterThan(841)
  })

  it('leaves the anchor where it is, so the canvas does not scroll out from under anyone', () => {
    expect(tightenColumn([{ top: 613, height: 100 }, { top: 900, height: 50 }])[0]).toBe(613)
  })

  it('has nothing to say about no roots, or one', () => {
    expect(tightenColumn([])).toEqual([])
    expect(tightenColumn([{ top: 7, height: 100 }])).toEqual([7])
  })
})

/** A stand-in for a rendered `BlockSvg`: where it is, and where it was moved. */
function root(x: number, top: number, height: number): {
  block: Blockly.BlockSvg
  moved: () => number
} {
  let dy = 0
  const block = {
    getBoundingRectangle: () => ({ left: x, right: x + 200, top: top + dy, bottom: top + dy + height }),
    moveBy: (_dx: number, by: number) => {
      dy += by
    }
  }
  return { block: block as unknown as Blockly.BlockSvg, moved: () => dy }
}

function workspaceOf(blocks: readonly Blockly.BlockSvg[]): Blockly.WorkspaceSvg {
  return { getTopBlocks: () => [...blocks] } as unknown as Blockly.WorkspaceSvg
}

describe('compactRootColumn', () => {
  it('re-spaces the converter’s column', () => {
    const a = root(ROOT_ORIGIN, 40, 1880)
    const b = root(ROOT_ORIGIN, 2424, 223)
    const c = root(ROOT_ORIGIN, 2695, 400)
    compactRootColumn(workspaceOf([a.block, b.block, c.block]))
    expect(a.moved()).toBe(0)
    expect(b.block.getBoundingRectangle().top).toBe(40 + 1880 + ROOT_GUTTER)
    expect(c.block.getBoundingRectangle().top).toBe(40 + 1880 + ROOT_GUTTER + 223 + ROOT_GUTTER)
  })

  it('WILL NOT TOUCH a root the learner dragged aside (#1036)', () => {
    // The whole safeguard: #1036 puts a dragged root back where they left it,
    // and a re-stack would drag it away again once per typing pause. Off the
    // column's x means off the column.
    const dragged = root(ROOT_ORIGIN + 600, 200, 100)
    const a = root(ROOT_ORIGIN, 40, 100)
    const b = root(ROOT_ORIGIN, 900, 100)
    compactRootColumn(workspaceOf([a.block, dragged.block, b.block]))
    expect(dragged.moved()).toBe(0)
    // And the stacks that are still in the column close up around it.
    expect(b.block.getBoundingRectangle().top).toBe(40 + 100 + ROOT_GUTTER)
  })

  it('forgives the rounding a serialised coordinate comes back with', () => {
    const a = root(ROOT_ORIGIN, 40, 100)
    const b = root(ROOT_ORIGIN + 0.4, 900, 100)
    compactRootColumn(workspaceOf([a.block, b.block]))
    expect(b.block.getBoundingRectangle().top).toBe(40 + 100 + ROOT_GUTTER)
  })

  it('takes the roots in the order they are ON SCREEN, not the order Blockly lists them', () => {
    const second = root(ROOT_ORIGIN, 900, 100)
    const first = root(ROOT_ORIGIN, 40, 100)
    compactRootColumn(workspaceOf([second.block, first.block]))
    expect(first.moved()).toBe(0)
    expect(second.block.getBoundingRectangle().top).toBe(40 + 100 + ROOT_GUTTER)
  })

  it('leaves a lone root alone — there is nothing to space it against', () => {
    const only = root(ROOT_ORIGIN, 613, 100)
    compactRootColumn(workspaceOf([only.block]))
    expect(only.moved()).toBe(0)
  })
})
