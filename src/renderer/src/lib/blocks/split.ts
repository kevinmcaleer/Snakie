/**
 * THE BLOCKS SPLIT — how wide is wide enough (#1009, epic #1007).
 * =============================================================================
 *
 * The switcher is either/or, but blocks and Python have to be on screen
 * TOGETHER: that is the teaching mechanism, and a learner who must switch away
 * to see the code will never look. So the split lives inside the view and the
 * workspace only decides which side is big.
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
import { BLOCKS_VIEW_RATIOS, type BlocksViewMode } from '../../store/layout'

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
  /** The canvas is collapsed to a clickable peek strip (the `python` emphasis). */
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
  const ratio = usable(remembered)
    ? ([...remembered] as [number, number])
    : ([...preset] as [number, number])
  return { kind: 'split', ratio, peek: false, pane: 'canvas' }
}

/**
 * A remembered ratio is usable when it sums to ~100 and leaves BOTH panes
 * something to be. A stored `[0, 100]` is the `python` emphasis's own ratio; if
 * it leaked into `blocks` it would show an empty canvas with no handle to drag
 * back, so the preset wins instead.
 */
function usable(r: readonly [number, number] | undefined): r is readonly [number, number] {
  if (!r || r.length !== 2) return false
  if (!r.every((n) => typeof n === 'number' && Number.isFinite(n))) return false
  if (Math.abs(r[0] + r[1] - 100) > 1) return false
  return r[0] >= 15 && r[1] >= 15
}
