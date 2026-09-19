import * as Blockly from 'blockly/core'
import { ROOT_GUTTER, ROOT_ORIGIN } from './python-to-blocks'

/**
 * THE COLUMN, MEASURED RATHER THAN GUESSED (#1160, epic #1007).
 * =============================================================================
 *
 * `python-to-blocks.ts` lays the roots of a converted program out in one column
 * and has to ESTIMATE how tall each one renders, because it is a pure module
 * that has never loaded Blockly — it counts rows and multiplies by a measured
 * row height. Its own comment is candid about what that costs: *"where it is
 * still an estimate, it errs UPWARDS, and the gutter is wide. Being a little too
 * far apart costs a scroll; being too close costs the overlap this exists to
 * remove"*.
 *
 * It errs upwards by a LOT. On a six-line `def` the estimate reserves 552px for
 * a root that renders 427, so the next hat starts 125px below the bottom of the
 * one above it — and on a three-line import section the gap is wider than half
 * the section. Open a file and the top of the canvas is two small stacks with a
 * hole between them; you cannot tell whether the hole is deliberate, whether
 * something failed to convert, or whether there is a block in it you have not
 * scrolled to.
 *
 * So the canvas — which HAS Blockly, and has just rendered every block — closes
 * the gaps itself. Each root is measured and put one {@link ROOT_GUTTER} under
 * the real bottom of the one above it, and the estimate goes back to being what
 * it is good at: a non-overlapping starting point for a module that cannot
 * measure. The two share the gutter so "tight" means the same thing either side
 * of the seam.
 *
 * ONLY WHEN NOBODY HAS MOVED ANYTHING. A root the learner dragged somewhere is
 * the one thing #1036 exists to preserve, and a tidy-up that overrules it would
 * undo their arrangement once per typing pause. {@link isConverterColumn} is the
 * test, and it is deliberately all-or-nothing: one root off the column and the
 * whole canvas is theirs, untouched. The converter's own output always passes
 * it, and so does a canvas nobody has rearranged — which is why the answer is
 * stable, reopening to the same tight column rather than creeping.
 */

/** A root as this module needs to see it: where it is, and how tall it renders. */
export interface TidyRoot {
  readonly x: number
  readonly y: number
  readonly height: number
}

/**
 * Where each root belongs, stacked tight, in the order given.
 *
 * Pure arithmetic over measured heights, so the spacing rule is a unit test
 * rather than something you check by eye on a canvas.
 */
export function tidyColumn(
  roots: readonly TidyRoot[],
  origin: number = ROOT_ORIGIN,
  gutter: number = ROOT_GUTTER
): number[] {
  let y = origin
  return roots.map((root) => {
    const at = y
    y += root.height + gutter
    return at
  })
}

/**
 * Is this canvas still the column the converter laid out — has nobody moved a
 * root?
 *
 * Two questions, both cheap: every root at the left margin, and every root
 * below the one before it. A drag breaks the first almost always (the grid snaps
 * to 24s and the margin is 40) and the second whenever a root is dragged past
 * its neighbour; either is enough to say the arrangement is the learner's.
 *
 * An empty canvas passes and tidies nothing, which is the right answer for both
 * questions at once.
 */
export function isConverterColumn(
  roots: readonly { x: number; y: number }[],
  origin: number = ROOT_ORIGIN
): boolean {
  let above = -Infinity
  for (const root of roots) {
    if (root.x !== origin) return false
    if (root.y <= above) return false
    above = root.y
  }
  return true
}

/**
 * Close up the gaps between the roots of a live workspace.
 *
 * Returns whether it did anything, which is what the canvas's load effect logs
 * against — and false is the normal answer on a canvas somebody has arranged.
 *
 * The caller runs this inside `Blockly.Events.disable()`: moving a block is an
 * event, and a load that fired a move per root would put the file's own opening
 * on the undo stack and look like an edit to the listener that writes it back.
 */
export function tidyRoots(ws: Blockly.WorkspaceSvg): boolean {
  // Ordered, so "the one above" means what it says. With every root on the same
  // x — which `isConverterColumn` has just insisted on — Blockly's ordering is
  // plain top-to-bottom.
  const roots = ws.getTopBlocks(true)
  const at = roots.map((block) => {
    const xy = block.getRelativeToSurfaceXY()
    return { x: xy.x, y: xy.y }
  })
  if (!isConverterColumn(at)) return false
  // THE RENDERED HEIGHT, chain and all: `getHeightWidth` walks the `next`
  // connections, which is exactly the footprint a root occupies on the canvas.
  const wanted = tidyColumn(
    roots.map((block, i) => ({ ...at[i], height: block.getHeightWidth().height }))
  )
  let moved = false
  roots.forEach((block, i) => {
    const by = wanted[i] - at[i].y
    if (by === 0) return
    block.moveBy(0, by)
    moved = true
  })
  return moved
}
