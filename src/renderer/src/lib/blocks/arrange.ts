import type * as Blockly from 'blockly/core'

/**
 * WHERE THE ROOTS GO, replacing #1062 and #1145.
 * =============================================================================
 *
 * A converted file arrives as several top-level stacks: whatever ran before the
 * first `def`, each `def` (a hat, with no previous or next connection), and
 * whatever ran after. Something has to decide where on the canvas each one
 * sits, and two things have to be true of the answer:
 *
 *  1. **Nothing overlaps.** The whole premise of a block canvas is that what
 *     you see is the structure, and a `def` drawn on top of the program is a
 *     program you cannot read.
 *  2. **The functions are out of the program's way.** A file with four `def`s
 *     used to open as one tall column — the program itself a screen and a half
 *     below the last function, with the reader scrolling past everything to
 *     find where it starts. The functions go in a COLUMN OF THEIR OWN, beside
 *     the program rather than above it, which is also how anybody would lay
 *     them out on a table.
 *
 * MEASURED, NOT ESTIMATED, and that is the change this module is.
 *
 * The layout used to live in `python-to-blocks.ts`, which is pure and has never
 * loaded Blockly — so it counted rows and multiplied by hand-measured constants
 * (`ROW_HEIGHT = 56`, `NESTED_VALUE = 8`, a cap, a fudge for the hat…). Every
 * one of those numbers was measured against the renderer of the day, and every
 * one of them was wrong the moment the geometry changed: on the day this
 * moved the canvas to standard Blockly, a root the estimate called 520px tall
 * rendered 283, and a `def` it called 424 rendered 445 — so the roots were laid
 * out both much too far apart AND, twice in the same file, overlapping.
 *
 * A rendered block knows its own size. `getHeightWidth()` is Blockly's answer
 * and it includes the whole chain below the block, which is exactly the span a
 * root occupies. So the arithmetic below cannot drift from the renderer,
 * because there is nothing left to drift.
 *
 * THE SAME VERDICT ARRIVED TWICE, from two sessions and two directions, and
 * this module is both. The other was `root-column.ts`, which kept the estimate
 * and re-spaced the column after Blockly had drawn it; measured against the
 * repo's own `examples/`, it found the estimate over-reserving by up to 512px
 * after a long chain — half a screen of empty parchment, which a learner reads
 * as blocks that failed to render — and still coming up 18px SHORT on a `def`
 * with a big body. Its argument is the one worth keeping: a row count cannot be
 * right for every block, because a folded comment run draws shorter rows than a
 * statement, a `def`'s hat and empty mouth are their own arithmetic, and a
 * block a plugin registered has a height nothing in the converter has ever
 * seen. Two passes laying out the same roots is a disagreement waiting to
 * happen, so there is one, and it is this.
 *
 * ONLY A DERIVED DOCUMENT IS LAID OUT. A file whose footer matched its code was
 * arranged by the person who saved it, and tidying that up behind their back
 * throws away work — including the case the previous pass could not see, where
 * somebody spaced their stacks out deliberately without moving any of them
 * sideways. `BlocksCanvas` owns that decision; see its `derived` prop.
 *
 * THE ALGORITHM IS PURE AND THE MEASURING IS NOT, which is why they are two
 * functions. {@link arrangeRoots} takes boxes and returns positions and is a
 * unit test; {@link arrangeWorkspaceRoots} is the four lines that ask Blockly
 * for the boxes and move the blocks.
 */

/** One top-level stack, as the arranger needs to know it. */
export interface RootBox {
  /**
   * Is this a DEFINITION — a hat, which goes in the second column?
   *
   * Structural rather than a list of types: a top block with nothing to connect
   * to above it and no output is a hat, which is what a `def` is and what
   * anything else we make a hat will be.
   */
  definition: boolean
  width: number
  height: number
}

/** Where one root was put. */
export interface RootPlacement {
  x: number
  y: number
}

/** Where the first root goes, and the left margin for both columns. */
export const ROOT_ORIGIN = 40

/**
 * Clear space between one root's bottom and the next root's top.
 *
 * 48, which is the number `root-column.ts` arrived at independently and
 * verified against every file in `examples/`. Keeping it is cheaper than
 * having two opinions about what a gutter is.
 */
export const ROOT_GUTTER = 48

/**
 * Clear space between the program column and the functions column.
 *
 * Wider than the vertical gutter on purpose: two stacks side by side with a
 * thin gap read as one wide stack, where two stacks above and below each other
 * are told apart by their own notches.
 */
export const COLUMN_GAP = 72

/**
 * Lay the roots out in two columns: the program on the left, the functions to
 * the right of it. Returns a placement per root, in the order given.
 *
 * ORDER IS PRESERVED WITHIN EACH COLUMN, which is what makes this safe for the
 * generator: `getTopBlocks(true)` walks top blocks by position, so the program
 * stacks are still generated in the order the file had them. The functions
 * interleave into that walk wherever their y lands, and it makes no difference
 * — a `def` emits into the generator's functions section rather than into the
 * body, so where it falls in the walk cannot move a line of the program.
 */
export function arrangeRoots(boxes: readonly RootBox[]): RootPlacement[] {
  const programs = boxes.filter((box) => !box.definition)
  // A file that is ALL functions has no program column to sit beside, so the
  // functions take the left-hand one. Otherwise the column starts past the
  // widest thing in the program — the widest, not the first, or a long line
  // halfway down would reach under the functions.
  const widest = programs.reduce((max, box) => Math.max(max, box.width), 0)
  const definitionX = programs.length > 0 ? ROOT_ORIGIN + widest + COLUMN_GAP : ROOT_ORIGIN
  const nextY = { program: ROOT_ORIGIN, definition: ROOT_ORIGIN }
  return boxes.map((box) => {
    const column = box.definition ? 'definition' : 'program'
    const placed = { x: box.definition ? definitionX : ROOT_ORIGIN, y: nextY[column] }
    nextY[column] += box.height + ROOT_GUTTER
    return placed
  })
}

/**
 * Lay out every top-level stack on `ws`, measuring each one as it is drawn.
 *
 * Returns what it did, keyed by block id — which the caller keeps so it can
 * tell its own arrangement from one the learner has since dragged (see
 * `BlocksCanvas`, where a late-arriving webfont is a reason to measure again
 * and a moved block is a reason not to).
 */
export function arrangeWorkspaceRoots(ws: Blockly.WorkspaceSvg): Map<string, RootPlacement> {
  // `false` — the UNORDERED list, which is registration order and therefore the
  // order the document listed them in. Asking for the ordered one would sort by
  // the positions this function is about to replace.
  const roots = ws.getTopBlocks(false).filter((block) => !block.outputConnection)
  const boxes = roots.map((block) => {
    const size = block.getHeightWidth()
    return {
      // A hat: nothing connects above it, and it is not a value. That is a
      // `def` today and whatever else we give a hat to tomorrow.
      definition: !block.previousConnection,
      width: size.width,
      height: size.height
    }
  })
  const placements = arrangeRoots(boxes)
  const applied = new Map<string, RootPlacement>()
  roots.forEach((block, i) => {
    const at = placements[i]
    const now = block.getRelativeToSurfaceXY()
    block.moveBy(at.x - now.x, at.y - now.y)
    applied.set(block.id, at)
  })
  return applied
}

/**
 * How far from where we put it still counts as "nobody has moved this".
 *
 * Blockly rounds coordinates as it serialises, so a root placed at 299.25 can
 * come back a hair off it; half a pixel forgives that and nothing else, since a
 * drag moves a block by whole pixels of screen divided by the scale. Borrowed
 * intact from `root-column.ts`, which found it the hard way.
 */
const MOVED_EPSILON = 0.5

/**
 * Is every root still where {@link arrangeWorkspaceRoots} put it?
 *
 * The test before re-arranging: a canvas nobody has touched may be measured
 * again, and one where a learner has dragged a function aside may not.
 */
export function rootsUnmoved(ws: Blockly.WorkspaceSvg, applied: ReadonlyMap<string, RootPlacement>): boolean {
  const roots = ws.getTopBlocks(false).filter((block) => !block.outputConnection)
  if (roots.length !== applied.size) return false
  return roots.every((block) => {
    const at = applied.get(block.id)
    if (!at) return false
    const now = block.getRelativeToSurfaceXY()
    return Math.abs(now.x - at.x) <= MOVED_EPSILON && Math.abs(now.y - at.y) <= MOVED_EPSILON
  })
}

/** The same forgiveness, for the caller that asks the same question of one root. */
export function rootMoved(now: { x: number; y: number }, applied: RootPlacement | undefined): boolean {
  if (!applied) return true
  return Math.abs(now.x - applied.x) > MOVED_EPSILON || Math.abs(now.y - applied.y) > MOVED_EPSILON
}
