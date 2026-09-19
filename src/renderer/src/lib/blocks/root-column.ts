import type * as Blockly from 'blockly/core'
import { ROOT_GUTTER, ROOT_ORIGIN } from './python-to-blocks'

/**
 * THE COLUMN IS TIGHTENED ONCE THE BLOCKS ARE REAL (#1062, #1145, and the
 * follow-up that says a gap reads as a canvas that failed to draw).
 * =============================================================================
 *
 * `stackRoots` in `python-to-blocks.ts` decides where each top-level stack goes
 * by ESTIMATING how tall it will render — counting rows and multiplying by the
 * Soft Shell renderer's row height — because that module is pure and has never
 * loaded Blockly. The estimate is deliberately generous, on the argument that
 * "being a little too far apart costs a scroll; being too close costs an
 * overlap, and only one of those is a bug".
 *
 * IT IS BOTH. Measured against the real canvas on the repo's own examples, the
 * estimate over-reserves by up to 512px after a long chain — half a screen of
 * empty parchment between the imports and whatever the file does next, which a
 * learner reads as "the rest of my blocks have not rendered" — and still comes
 * up 18px SHORT on a `def` with a big body, which is the overlap it was meant
 * to prevent. A row count cannot be right for every block: a folded comment run
 * draws shorter rows than a statement, a `def`'s hat and empty mouth are their
 * own arithmetic, and a block a plugin registered has a height nothing here has
 * ever seen.
 *
 * So the canvas stops guessing. Once Blockly has laid the workspace out, every
 * stack's true height is a question with an answer — `getBoundingRectangle()` —
 * and the column is re-spaced to exactly {@link ROOT_GUTTER} between them. The
 * estimate stays where it is and keeps doing its job: it is what an UNRENDERED
 * document (the footer a file is saved with, the JSON a test reads) carries, and
 * a sane starting layout for anything that never reaches a canvas.
 *
 * WHAT IT WILL NOT TOUCH. A root the learner dragged aside is theirs, and #1036
 * exists to put it back where they left it. The test for "still the converter's"
 * is the x: `stackRoots` puts every root at {@link ROOT_ORIGIN}, and a drag
 * essentially never lands back on it exactly. Anything else keeps its place and
 * drops out of the column, so the stacks that remain close up around it.
 */

/** One stack's vertical extent, in workspace units. */
export interface ColumnRoot {
  readonly top: number
  readonly height: number
}

/**
 * Where each root in a column belongs, given what they actually measure.
 *
 * The first one does not move — it is the anchor, and re-homing the whole
 * program to a nominal origin would scroll the canvas out from under anyone who
 * had paused typing. Everything after it follows its predecessor's real bottom
 * plus one gutter.
 *
 * Pure, so the spacing rule is a unit test rather than something you find out
 * by opening a file and looking.
 */
export function tightenColumn(roots: readonly ColumnRoot[], gutter = ROOT_GUTTER): number[] {
  const tops: number[] = []
  let y = roots.length > 0 ? roots[0].top : 0
  for (const root of roots) {
    tops.push(y)
    y += root.height + gutter
  }
  return tops
}

/**
 * How far from {@link ROOT_ORIGIN} still counts as "in the column".
 *
 * Blockly rounds serialised coordinates, so a root that was written at 40 can
 * come back a hair off it. Half a pixel forgives that and nothing else — a drag
 * moves a block by whole pixels of screen, divided by the scale.
 */
const COLUMN_EPSILON = 0.5

/**
 * Re-space the converter's column of a rendered workspace. Call it after a load,
 * with events disabled — this is the layout finishing, not a change the learner
 * made.
 */
export function compactRootColumn(ws: Blockly.WorkspaceSvg): void {
  const column = ws
    .getTopBlocks(false)
    .map((block) => ({ block, rect: block.getBoundingRectangle() }))
    .filter((root) => Math.abs(root.rect.left - ROOT_ORIGIN) <= COLUMN_EPSILON)
    .sort((a, b) => a.rect.top - b.rect.top)
  // One root cannot be spaced against anything, and moving it would only undo
  // the scroll position it was opened at.
  if (column.length < 2) return

  const tops = tightenColumn(
    column.map((root) => ({ top: root.rect.top, height: root.rect.bottom - root.rect.top }))
  )
  column.forEach((root, i) => {
    const dy = tops[i] - root.rect.top
    if (dy !== 0) root.block.moveBy(0, dy)
  })
}
