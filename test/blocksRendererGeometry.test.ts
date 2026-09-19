import { describe, it, expect } from 'vitest'
import * as Blockly from 'blockly/core'
import { snugStatementSpacers, softShellConstants } from '../src/renderer/src/lib/blocks/renderer'

/**
 * SOFT SHELL'S CORNER HAS TO FIT IN THE ROW IT IS DRAWN INTO (#1158).
 * =============================================================================
 *
 * Both bugs this file guards were the same mistake twice: `renderer.ts` raises
 * `CORNER_RADIUS` to 12 in its constructor, but Zelos sized the rows around it
 * in ITS constructor, which has already run. Blockly then draws an arc of the
 * new radius into a row measured for the old one, and the difference comes out
 * on the canvas — a hairline hanging off the bottom-right corner of every
 * block, and a sliver of canvas between a block and the bottom of the mouth it
 * is sitting in.
 *
 * THE ASSERTIONS ARE THE DRAWER'S ARITHMETIC, not the numbers it produced.
 * `12` and `6` are not written down here; each test recomputes the span
 * `renderers/common/drawer.ts` walks and asks whether the row reserved it. So
 * they still hold if the radius is retuned, and they fail if it is retuned
 * without the rows following — which is the failure that was shipped.
 */

/**
 * The geometry as the drawer sees it. `init()` is the shape pass Blockly runs
 * on a live renderer — it turns the numbers into the corner, notch and tab
 * PATHS, and it is where a radius raised after Zelos's constructor finally
 * takes effect. Pure arithmetic, unlike `setTheme` (which measures a font) and
 * `createDom`, so it needs no canvas and no DOM.
 */
function geometry(): Blockly.zelos.ConstantProvider {
  const constants = softShellConstants()
  constants.init()
  return constants
}

describe('the bottom row is as tall as the corner drawn into it (#1158)', () => {
  it('reserves above the baseline everything the bottom-right arc consumes', () => {
    const c = geometry()

    // `drawBottom_` runs the right-hand edge down to
    // `baseline - OUTSIDE_CORNERS.rightHeight` and arcs away from there.
    const arcNeeds = c.OUTSIDE_CORNERS.rightHeight
    // `BottomRow.measure` gives the row `max(minHeight, corner height)` above
    // its descender, and `RoundCorner` is half the radius tall.
    const rowReserves = Math.max(c.BOTTOM_ROW_MIN_HEIGHT, c.CORNER_RADIUS / 2)

    // Short by even a pixel and the edge is drawn past where the arc leaves,
    // so the path doubles back up and the stroke paints a tick in open air.
    expect(rowReserves).toBeGreaterThanOrEqual(arcNeeds)
  })

  it('keeps the top row alone, because the top corner cannot overshoot', () => {
    const c = geometry()

    // Stated so the asymmetry is a decision rather than an oversight: the top
    // corner is drawn BEFORE the edge below it, so the pen is already past the
    // arc when that edge starts and the absolute `V` after it only moves down.
    expect(c.TOP_ROW_MIN_HEIGHT).toBeLessThan(c.CORNER_RADIUS)
  })
})

describe("a C-block's mouth closes on what is in it (#1158)", () => {
  /** Zelos widens `INSIDE_CORNERS` with the right-hand pair. */
  const rightHeight = (c: Blockly.zelos.ConstantProvider): number =>
    (c.INSIDE_CORNERS as Blockly.blockRendering.InsideCorners & { rightHeight: number }).rightHeight

  it('lifts a tight-nested spacer back to the height of its inside corner', () => {
    const c = geometry()
    const corner = rightHeight(c)

    // Zelos's own two steps, in order: the spacer either side of a statement
    // input is `max(NOTCH_HEIGHT, cornerHeight)` …
    const measured = Math.max(c.NOTCH_HEIGHT, corner)
    // … and then `finalizeVerticalAlignment_` takes `SMALL_PADDING` off it when
    // a block is nested tightly. At Zelos's own 4px corner that still clears
    // the arc; at 12px it does not, which is the bug.
    const tightened = measured - c.SMALL_PADDING
    expect(tightened).toBeLessThan(corner)

    const spacer = new Blockly.blockRendering.SpacerRow(c, tightened, 100)
    spacer.precedesStatement = true
    snugStatementSpacers([spacer], corner)

    expect(spacer.height).toBe(corner)
  })

  it('lifts the spacer under a mouth as well as the one above it', () => {
    const c = geometry()
    const corner = rightHeight(c)

    const spacer = new Blockly.blockRendering.SpacerRow(c, 1, 100)
    spacer.followsStatement = true
    snugStatementSpacers([spacer], corner)

    expect(spacer.height).toBe(corner)
  })

  it('leaves a spacer that already clears the corner where it is', () => {
    const c = geometry()
    const corner = rightHeight(c)

    // The spacer BETWEEN two mouths is `DUMMY_INPUT_MIN_HEIGHT` tall, well
    // clear of the arc — a floor that raised it would be a layout change.
    const spacer = new Blockly.blockRendering.SpacerRow(c, corner + 20, 100)
    spacer.precedesStatement = true
    spacer.followsStatement = true
    snugStatementSpacers([spacer], corner)

    expect(spacer.height).toBe(corner + 20)
  })

  it('leaves rows that have no corner drawn into them alone', () => {
    const c = geometry()

    // An ordinary spacer between two field rows is the block's breathing room,
    // and nothing arcs into it. Lifting it would pad every block for nothing.
    const plain = new Blockly.blockRendering.SpacerRow(c, 0, 100)
    snugStatementSpacers([plain], rightHeight(c))
    expect(plain.height).toBe(0)
  })
})
