/**
 * THE BLOCKS SPLIT — how wide is wide enough (#1009, epic #1007).
 * =============================================================================
 *
 * Blocks and code have to be on screen TOGETHER: that is the teaching
 * mechanism, and a learner who must switch away to see the code will never
 * look. So there is one split, and the DIVIDER is the control (#1034) — all the
 * way one way for blocks, all the way the other for code, and a stop in the
 * middle where both are on screen.
 *
 * Which leaves the case the rule can't survive — a window too narrow to hold two
 * usable columns. Two 180px panes are not "both on screen", they are two things
 * you cannot use, so below the threshold the split becomes a TAB PAIR: one pane
 * at full width with a Blocks/Python switch above it (epic #903). Still one
 * component, still one mounted canvas; only the chrome changes.
 *
 * Pure, so the threshold is a tested number rather than a media query somebody
 * has to reproduce by dragging a window.
 */
import { BLOCKS_PANE_CLOSED, BLOCKS_VIEW_RATIOS, type BlocksViewMode } from '../../store/layout'

/**
 * Narrowest editor width (px) that still holds two usable columns.
 *
 * Derived, not guessed: a block canvas needs roughly 380px before dragging a
 * two-input block becomes a fight, and the Python mirror needs roughly 320px to
 * show the ~52 characters our generated lines run to at the Soft Shell mono
 * size. Plus the resize handle. Below that, one pane at a time is strictly more
 * useful than two.
 */
export const BLOCKS_SPLIT_MIN_WIDTH = 720

/** Does an editor region `width` px wide have room for the split? */
export function blocksSplitFits(width: number): boolean {
  return width >= BLOCKS_SPLIT_MIN_WIDTH
}

/** Which side a narrow (tabbed) layout is showing. */
export type BlocksPane = 'canvas' | 'python'

export interface BlocksViewLayout {
  /** Two columns, or one pane with a tab pair above it. */
  kind: 'split' | 'tabs'
  /** `[canvas, python]` shares — only meaningful when `kind` is `split`. */
  ratio: [number, number]
  /** The canvas is collapsed to a clickable peek strip (the divider is hard right). */
  peek: boolean
  /** Which pane a tabbed layout shows. */
  pane: BlocksPane
}

/**
 * Resolve the emphasis and the available width into a concrete layout.
 *
 * `ratio` comes from the workspace's remembered `blocksSplit` when the user has
 * dragged the handle in this emphasis, and from {@link BLOCKS_VIEW_RATIOS}
 * otherwise — so a drag survives a remount, and pressing a mode button still
 * does something visible rather than restoring a ratio indistinguishable from
 * the one already on screen.
 */
export function resolveBlocksView(
  mode: BlocksViewMode,
  width: number,
  remembered?: readonly [number, number]
): BlocksViewLayout {
  const preset = BLOCKS_VIEW_RATIOS[mode]
  if (!blocksSplitFits(width)) {
    // A peek strip in a tabbed layout would be a strip with nothing to peek
    // beside it, so narrow always resolves to a whole pane.
    return {
      kind: 'tabs',
      ratio: [...preset],
      peek: false,
      pane: mode === 'python' ? 'python' : 'canvas'
    }
  }
  if (mode === 'python') return { kind: 'split', ratio: [...preset], peek: true, pane: 'python' }
  // Blocks-only is the mirror image and needs no remembered ratio either: the
  // divider is at the far end, and what it remembers is where it was in the
  // MIDDLE, which is the only stop with two sizes to remember.
  if (mode === 'blocks') return { kind: 'split', ratio: [...preset], peek: false, pane: 'canvas' }
  const ratio = usable(remembered)
    ? ([...remembered] as [number, number])
    : ([...preset] as [number, number])
  return { kind: 'split', ratio, peek: false, pane: 'canvas' }
}

/**
 * A remembered ratio is usable when it sums to ~100 and leaves both panes on
 * screen.
 *
 * The floor is DELIBERATELY TINY (#1034). It used to be 15% each, to stop a
 * stored end-stop ratio leaking in and stranding a pane with no handle to drag
 * back — but now the divider IS the control, and that guard vetoed every
 * position near an end: a drag past it was silently re-applied as the preset,
 * so the divider appeared to refuse to travel the last fifth of its range.
 *
 * Stranding is prevented properly instead: the ends are their own stops, which
 * `resolveBlocksView` answers before asking this, and anything released close
 * to one clicks into it (see {@link stopFor}).
 */
function usable(r: readonly [number, number] | undefined): r is readonly [number, number] {
  if (!r || r.length !== 2) return false
  if (!r.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  if (Math.abs(r[0] + r[1] - 100) > 1) return false
  return r[0] >= BLOCKS_PANE_CLOSED && r[1] >= BLOCKS_PANE_CLOSED
}

// ---------------------------------------------------------------------------
// The divider's stops (#1034)
// ---------------------------------------------------------------------------

/** One position the divider clicks into. `at` is the canvas's share. */
export interface BlocksStop {
  mode: BlocksViewMode
  at: number
}

/**
 * The three stops, left to right as the divider travels.
 *
 * Code at the left end, blocks at the right, both in the middle — matching
 * which pane is where, so "drag it towards the code" moves it towards the code.
 */
export const BLOCKS_STOPS: readonly BlocksStop[] = [
  { mode: 'python', at: BLOCKS_VIEW_RATIOS.python[0] },
  { mode: 'split', at: BLOCKS_VIEW_RATIOS.split[0] },
  { mode: 'blocks', at: BLOCKS_VIEW_RATIOS.blocks[0] }
]

/**
 * How close (in share points) the divider has to be released to a stop before
 * it clicks into it.
 *
 * Wide enough that the middle stop is easy to find with a mouse, narrow enough
 * that somebody who deliberately wants 65/35 can still have it — a detent you
 * cannot escape is not a detent, it is three buttons wearing a costume.
 */
export const BLOCKS_STOP_RANGE = 12

/**
 * The stop a released divider settles into, or null to leave it where it is.
 *
 * Pure, so "does the middle stop actually catch" is a test rather than something
 * you find out by dragging.
 */
export function stopFor(canvasShare: number): BlocksStop | null {
  let best: BlocksStop | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (const stop of BLOCKS_STOPS) {
    const gap = Math.abs(canvasShare - stop.at)
    if (gap <= BLOCKS_STOP_RANGE && gap < bestGap) {
      best = stop
      bestGap = gap
    }
  }
  return best
}

/**
 * Which stop a ratio currently reads as — what the divider would say if asked.
 *
 * The ends are exact (a collapsed pane is collapsed), and anything else is the
 * middle, because the middle stop means "both on screen" rather than "exactly
 * half each".
 */
export function modeForRatio(ratio: readonly [number, number]): BlocksViewMode {
  if (ratio[0] <= BLOCKS_PANE_CLOSED) return 'python'
  if (ratio[1] <= BLOCKS_PANE_CLOSED) return 'blocks'
  return 'split'
}
