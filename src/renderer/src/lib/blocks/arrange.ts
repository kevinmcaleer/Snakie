import * as Blockly from 'blockly/core'

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
 *     program you cannot read. Every island of blocks has an invisible box
 *     around it, and no two boxes share a pixel.
 *  2. **The functions are out of the program's way.** A file with four `def`s
 *     used to open as one tall column — the program itself a screen and a half
 *     below the last function, with the reader scrolling past everything to
 *     find where it starts. The functions go in COLUMNS OF THEIR OWN, beside
 *     the program rather than above it, which is also how anybody would lay
 *     them out on a table — and as many columns as the canvas is wide, so a
 *     file with a dozen functions uses the screen's width rather than running
 *     off the bottom of it.
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
 * RENDERED FIRST, THEN MEASURED. Blockly queues its renders and draws them on
 * the next animation frame, so a block straight out of
 * `serialization.workspaces.load` has not been drawn yet and measures 0×0.
 * The first version of this module asked anyway, got a column of nothings,
 * and laid every root one gutter below the last — which is exactly the pile
 * of overlapping stacks this module exists to prevent, arriving by a new
 * road. {@link measureRoots} flushes the queue before it asks.
 *
 * ONLY A DERIVED DOCUMENT IS LAID OUT FROM SCRATCH. A file whose footer
 * matched its code was arranged by the person who saved it, and tidying that
 * up behind their back throws away work. But property 1 holds for that file
 * too: a saved layout whose function has since grown into the one below it is
 * put right by {@link separateRoots}, which moves the least it can — the
 * later root, straight down, until its box is clear — and leaves everything
 * else where it was put. `BlocksCanvas` owns that decision; see its `derived`
 * prop.
 *
 * THE ALGORITHMS ARE PURE AND THE MEASURING IS NOT, which is why they are
 * separate functions. {@link arrangeRoots} and {@link separateRoots} take
 * boxes and return positions and are unit tests;
 * {@link arrangeWorkspaceRoots} and {@link separateWorkspaceRoots} are the few
 * lines that ask Blockly for the boxes and move the blocks.
 */

/** One top-level stack, as the arranger needs to know it. */
export interface RootBox {
  /**
   * Is this a DEFINITION — a hat, which goes in the function columns?
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

/** A root that already has a place, for {@link separateRoots}. */
export interface PlacedRoot extends RootPlacement {
  width: number
  height: number
  /**
   * Never move this one. A root the learner dragged, or the one they just
   * edited: the thing they are looking at stays put and the others yield.
   */
  fixed?: boolean
}

/** What the canvas can see, so the function columns can be sized to it. */
export interface Viewport {
  /** In workspace units — screen pixels divided by the zoom. */
  width: number
  height: number
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
 * Clear space between one column and the next.
 *
 * Wider than the vertical gutter on purpose: two stacks side by side with a
 * thin gap read as one wide stack, where two stacks above and below each other
 * are told apart by their own notches.
 */
export const COLUMN_GAP = 72

/**
 * How tall a function column may be when nothing has said how tall the
 * canvas is — a workspace off screen, or one asked before it has a size.
 *
 * A screen's worth, near enough: a column this tall beside a short program
 * reads as "the functions", where one that wrapped every few hundred pixels
 * would read as a grid.
 */
export const FALLBACK_VIEW_HEIGHT = 900

/**
 * Lay the roots out in columns: the program on the left, the functions in as
 * many columns to the right of it as fit the viewport. Returns a placement per
 * root, in the order given.
 *
 * A FUNCTION COLUMN IS AS TALL AS THE PROGRAM, or as tall as the screen when
 * the program is shorter than that — so the functions sit beside the program
 * rather than trailing below it, and a short program with many functions
 * still fills a screen before it starts a second one. A function that would
 * run past the bottom of its column starts the next column, provided there is
 * room to its right; when the viewport is used up, the last column simply
 * carries on downwards. Longer is untidy; overlapping is unreadable.
 *
 * ORDER IS PRESERVED, reading down each column and then across, which is what
 * makes this safe for the generator: `getTopBlocks(true)` walks top blocks by
 * position, so the program stacks are still generated in the order the file
 * had them. The functions interleave into that walk wherever their y lands,
 * and it makes no difference — a `def` emits into the generator's functions
 * section rather than into the body, so where it falls in the walk cannot move
 * a line of the program.
 */
export function arrangeRoots(boxes: readonly RootBox[], viewport?: Viewport): RootPlacement[] {
  const programs = boxes.filter((box) => !box.definition)
  const definitions = boxes.filter((box) => box.definition)
  // A file that is ALL functions has no program column to sit beside, so the
  // functions take the left-hand one. Otherwise the columns start past the
  // widest thing in the program — the widest, not the first, or a long line
  // halfway down would reach under the functions.
  const widest = programs.reduce((max, box) => Math.max(max, box.width), 0)
  const programHeight = programs.reduce((sum, box) => sum + box.height, 0) + Math.max(0, programs.length - 1) * ROOT_GUTTER
  const firstColumnX = programs.length > 0 ? ROOT_ORIGIN + widest + COLUMN_GAP : ROOT_ORIGIN
  // How far down a function column may run before the next one starts.
  const columnLimit = Math.max(programHeight, (viewport?.height ?? FALLBACK_VIEW_HEIGHT) - ROOT_ORIGIN)
  // The right-hand edge a new column must fit inside, when the viewport is
  // known — a column started past it would open off screen, which is no better
  // than a column that runs off the bottom.
  const rightEdge = viewport ? viewport.width - ROOT_ORIGIN : Number.POSITIVE_INFINITY

  const definitionAt = new Map<RootBox, RootPlacement>()
  let columnX = firstColumnX
  let columnWidth = 0
  let y = ROOT_ORIGIN
  for (const box of definitions) {
    const bottom = y + box.height
    const fits = bottom - ROOT_ORIGIN <= columnLimit
    const empty = columnWidth === 0
    if (!fits && !empty) {
      const nextX = columnX + columnWidth + COLUMN_GAP
      if (nextX + box.width <= rightEdge) {
        columnX = nextX
        columnWidth = 0
        y = ROOT_ORIGIN
      }
    }
    definitionAt.set(box, { x: columnX, y })
    columnWidth = Math.max(columnWidth, box.width)
    y += box.height + ROOT_GUTTER
  }

  let programY = ROOT_ORIGIN
  return boxes.map((box) => {
    if (box.definition) return definitionAt.get(box) as RootPlacement
    const placed = { x: ROOT_ORIGIN, y: programY }
    programY += box.height + ROOT_GUTTER
    return placed
  })
}

/** Do two boxes share any pixels? Touching edges do not count. */
function overlaps(a: PlacedRoot, b: PlacedRoot): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Take a layout somebody made and make it a layout where nothing overlaps,
 * moving as little as possible. Returns a placement per root, in the order
 * given.
 *
 * THE LATER ROOT YIELDS. Roots are settled top to bottom (then left to right),
 * with the `fixed` ones settled first and never moved; each of the rest is
 * pushed straight down until its box is clear of everything settled before
 * it. Down rather than sideways because a learner's canvas is read down its
 * columns: a function shoved right lands in a column it was never part of,
 * where one shoved down is still under the thing it was under, just further.
 *
 * Pushing only ever increases a root's y, and a root is only compared with
 * roots already settled, so this always terminates.
 */
export function separateRoots(roots: readonly PlacedRoot[]): RootPlacement[] {
  const order = roots
    .map((root, i) => ({ root, i }))
    .sort((a, b) => {
      if (!!a.root.fixed !== !!b.root.fixed) return a.root.fixed ? -1 : 1
      return a.root.y - b.root.y || a.root.x - b.root.x || a.i - b.i
    })
  const settled: PlacedRoot[] = []
  const out: RootPlacement[] = new Array(roots.length)
  for (const { root, i } of order) {
    const box: PlacedRoot = { ...root }
    if (!box.fixed) {
      let moved = true
      while (moved) {
        moved = false
        for (const other of settled) {
          if (!overlaps(box, other)) continue
          box.y = other.y + other.height + ROOT_GUTTER
          moved = true
        }
      }
    }
    settled.push(box)
    out[i] = { x: box.x, y: box.y }
  }
  return out
}

/** The top-level stacks worth laying out, in the order the document listed them. */
function rootBlocks(ws: Blockly.WorkspaceSvg): Blockly.BlockSvg[] {
  // `false` — the UNORDERED list, which is registration order and therefore the
  // order the document listed them in. Asking for the ordered one would sort by
  // the positions this module is about to replace.
  return ws
    .getTopBlocks(false)
    .filter((block) => !block.outputConnection && !block.isInsertionMarker())
}

/**
 * Every root, measured as it is actually drawn.
 *
 * FLUSHES THE RENDER QUEUE FIRST — see the module comment: a block Blockly has
 * not drawn yet is 0×0, and 0×0 is not a size anything can be laid out by.
 */
function measureRoots(ws: Blockly.WorkspaceSvg): { block: Blockly.BlockSvg; box: RootBox; at: RootPlacement }[] {
  Blockly.renderManagement.triggerQueuedRenders(ws)
  return rootBlocks(ws).map((block) => {
    const size = block.getHeightWidth()
    const at = block.getRelativeToSurfaceXY()
    return {
      block,
      box: {
        // A hat: nothing connects above it, and it is not a value. That is a
        // `def` today and whatever else we give a hat to tomorrow.
        definition: !block.previousConnection,
        width: size.width,
        height: size.height
      },
      at: { x: at.x, y: at.y }
    }
  })
}

/** The visible part of the canvas, in workspace units, or undefined off screen. */
function viewportOf(ws: Blockly.WorkspaceSvg): Viewport | undefined {
  try {
    const view = ws.getMetricsManager().getViewMetrics(true)
    if (!(view.width > 0) || !(view.height > 0)) return undefined
    return { width: view.width, height: view.height }
  } catch {
    return undefined
  }
}

/** Move each block to its placement and record where it went. */
function apply(
  measured: readonly { block: Blockly.BlockSvg; at: RootPlacement }[],
  placements: readonly RootPlacement[]
): Map<string, RootPlacement> {
  const applied = new Map<string, RootPlacement>()
  measured.forEach(({ block, at }, i) => {
    const to = placements[i]
    if (to.x !== at.x || to.y !== at.y) block.moveBy(to.x - at.x, to.y - at.y)
    applied.set(block.id, to)
  })
  return applied
}

/**
 * Lay out every top-level stack on `ws` from scratch, measuring each one as it
 * is drawn.
 *
 * `keep` names roots that stay exactly where they are — the ones a learner
 * dragged since we last arranged. They are laid around, not over: the fresh
 * arrangement is made for the rest and then separated from the kept ones.
 *
 * Returns what it did, keyed by block id — which the caller keeps so it can
 * tell its own arrangement from one the learner has since dragged (see
 * `BlocksCanvas`, where a late-arriving webfont is a reason to measure again
 * and a moved block is a reason not to).
 */
export function arrangeWorkspaceRoots(
  ws: Blockly.WorkspaceSvg,
  keep: ReadonlySet<string> = new Set()
): Map<string, RootPlacement> {
  const measured = measureRoots(ws)
  const arranged = arrangeRoots(
    measured.map((m) => m.box),
    viewportOf(ws)
  )
  const placed: PlacedRoot[] = measured.map((m, i) => {
    const fixed = keep.has(m.block.id)
    const at = fixed ? m.at : arranged[i]
    return { ...at, width: m.box.width, height: m.box.height, fixed }
  })
  return apply(measured, separateRoots(placed))
}

/**
 * Leave the layout alone, except that nothing may overlap.
 *
 * For a file somebody arranged themselves, and for a canvas somebody is
 * editing: `fixed` is the root they are working on (or none), which stays
 * put while whatever it has grown into is moved out from under it.
 */
export function separateWorkspaceRoots(
  ws: Blockly.WorkspaceSvg,
  fixed: ReadonlySet<string> = new Set()
): Map<string, RootPlacement> {
  const measured = measureRoots(ws)
  const placed: PlacedRoot[] = measured.map((m) => ({
    ...m.at,
    width: m.box.width,
    height: m.box.height,
    fixed: fixed.has(m.block.id)
  }))
  return apply(measured, separateRoots(placed))
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
  const roots = rootBlocks(ws)
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
