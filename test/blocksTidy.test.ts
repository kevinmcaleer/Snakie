import { describe, it, expect } from 'vitest'
import { isConverterColumn, tidyColumn } from '../src/renderer/src/lib/blocks/tidy'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * THE COLUMN CLOSES UP (#1160).
 *
 * The canvas measures the roots it has just rendered and re-stacks them; the
 * measuring needs Blockly, the stacking rule does not — so the rule is checked
 * here, and the measurement in a real canvas.
 */
describe('tidyColumn — one gutter between roots, and no more (#1160)', () => {
  it('puts each root one gutter under the real bottom of the one above', () => {
    const ys = tidyColumn(
      [
        { x: 40, y: 40, height: 104 },
        { x: 40, y: 320, height: 422 },
        { x: 40, y: 900, height: 196 }
      ],
      40,
      24
    )
    expect(ys).toEqual([40, 40 + 104 + 24, 40 + 104 + 24 + 422 + 24])
  })

  it('ignores where the roots were — the estimate is not an input', () => {
    // The whole point: the converter's guess at where these go is what we are
    // replacing, so two very differently-spread columns of the same blocks come
    // out identical.
    const heights = [100, 200, 50]
    const spread = heights.map((height, i) => ({ x: 40, y: 40 + i * 900, height }))
    const packed = heights.map((height, i) => ({ x: 40, y: 40 + i * 10, height }))
    expect(tidyColumn(spread)).toEqual(tidyColumn(packed))
  })

  it('starts at the margin, and an empty canvas is no rows at all', () => {
    expect(tidyColumn([{ x: 40, y: 700, height: 10 }], 40)).toEqual([40])
    expect(tidyColumn([])).toEqual([])
  })

  it('defaults to the converter’s own origin and gutter', () => {
    // Shared constants, so a file cannot open tight and reopen loose.
    const ys = tidyColumn([
      { x: 40, y: 0, height: 100 },
      { x: 40, y: 0, height: 100 }
    ])
    expect(ys[0]).toBe(40)
    expect(ys[1] - ys[0]).toBe(100 + 24)
  })
})

describe('isConverterColumn — whose arrangement is this? (#1160, #1036)', () => {
  it('says yes to the column the converter emits', () => {
    // Not a hand-written fixture: the real thing, so this test fails if the
    // converter ever stops laying roots out in one column.
    const { workspace } = pythonToBlocks(
      ['import time', '', 'def go():', '    print(1)', '', 'go()', ''].join('\n')
    )
    const roots = workspace.blocks.blocks as unknown as { x: number; y: number }[]
    expect(roots.length).toBeGreaterThan(1)
    expect(isConverterColumn(roots)).toBe(true)
  })

  it('says no the moment a root is off the left margin', () => {
    // A drag. Blockly snaps to the 24px grid and the margin is 40, so a root
    // that moved at all is a root that no longer starts there.
    expect(
      isConverterColumn([
        { x: 40, y: 40 },
        { x: 288, y: 200 }
      ])
    ).toBe(false)
  })

  it('says no when a root has been dragged above the one before it', () => {
    expect(
      isConverterColumn([
        { x: 40, y: 400 },
        { x: 40, y: 200 }
      ])
    ).toBe(false)
    // Two roots at the same height are side by side, which is an arrangement
    // too — and one this must not flatten back into a column.
    expect(
      isConverterColumn([
        { x: 40, y: 200 },
        { x: 40, y: 200 }
      ])
    ).toBe(false)
  })

  it('says yes to an empty canvas, which then tidies nothing', () => {
    expect(isConverterColumn([])).toBe(true)
  })
})
