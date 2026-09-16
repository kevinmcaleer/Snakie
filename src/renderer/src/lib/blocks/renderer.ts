import * as Blockly from 'blockly/core'
import { SOFT_SHELL_RENDERER } from './theme'

/**
 * THE SOFT SHELL BLOCK GEOMETRY (#573's design direction, epic #1007).
 * =============================================================================
 *
 * Blockly's theme decides what a block is COLOURED. Its renderer decides what a
 * block is SHAPED — the corner radius, the padding around a field, whether a
 * plugged-in value sits inside its parent or hangs off the edge — and none of
 * that is reachable from a theme. So the shape is its own small subclass,
 * registered once and named in the workspace options.
 *
 * ZELOS IS THE BASE, and that is the whole of this file's argument.
 *
 * This started on `thrasos` and was tuned by hand — rounder corners, taller
 * rows, roomier fields. Each pass helped and none of it arrived, because the
 * things that make MakeCode and Scratch look the way they do are not constants
 * on thrasos at all:
 *
 *  - **Thrasos has EXTERNAL value inputs.** A plugged-in block sits OUTSIDE its
 *    parent, past the right edge, joined by a puzzle tab. So `set x to (5)`
 *    renders as two blocks touching, the `5` visibly shorter than the row it
 *    belongs to, and no amount of padding fixes it: the child is not inside
 *    anything. Zelos uses INLINE inputs, so the `5` sits within the parent with
 *    even space around it — which is what "the variable block should match the
 *    block it plugs into" actually means, and it is structural, not a number.
 *  - **Thrasos rounds two corners.** Its outline arcs the left-hand pair and
 *    draws the right-hand pair square; a value block is a plain rectangle with
 *    a tab. Zelos arcs all four, and gives booleans a hexagon and reporters a
 *    pill, which is the Scratch vocabulary a child arrives already knowing.
 *  - **Thrasos's notch is a sharp trapezoid.** Zelos's is the soft bump.
 *
 * Zelos IS Blockly's port of `scratch-blocks`. Asking for the Scratch/MakeCode
 * feel and staying on thrasos was asking the wrong layer for it.
 *
 * WHAT IS OVERRIDDEN, and why each one. Stock Zelos is already generous, so the
 * list is short and every entry makes it rounder or roomier than Scratch rather
 * than re-deriving it. Zelos's own defaults are in the comment beside each.
 *
 * THE ONE CONSTRAINT THAT IS NOT TASTE: `NOTCH_OFFSET_LEFT` must stay clear of
 * `CORNER_RADIUS`. The notch is drawn along the top edge starting at that
 * offset, and the corner arc eats the first `CORNER_RADIUS` pixels of it — so a
 * corner rounder than the notch's offset cuts into the notch and the two blocks
 * stop looking like they fit together.
 */

/** Corner rounding, in px. Bounded by {@link NOTCH_OFFSET_LEFT} — see above. */
const CORNER_RADIUS = 12

/** Where the top notch starts, in px. Must leave the corner arc room. */
const NOTCH_OFFSET_LEFT = 20

class SoftShellConstantProvider extends Blockly.zelos.ConstantProvider {
  constructor() {
    super()

    // ---- Roundness -------------------------------------------------------
    // Zelos ships 4, which reads as a soft rectangle. 12 is the MakeCode
    // roundness, and it is what makes a block look like a thing you pick up.
    this.CORNER_RADIUS = CORNER_RADIUS
    this.NOTCH_OFFSET_LEFT = NOTCH_OFFSET_LEFT // Zelos: 12 — too close to the arc above.
    // A true pill: half of FIELD_BORDER_RECT_HEIGHT. Zelos ships 4, a rounded
    // rectangle; a pill reads as something you press rather than type into.
    this.FIELD_BORDER_RECT_RADIUS = 16

    // ---- Room ------------------------------------------------------------
    // Zelos's 4 is tight against a 12px corner — the text starts before the
    // arc has finished. 8 gives the arc somewhere to land.
    this.TOP_ROW_MIN_HEIGHT = 8 // Zelos: 4
    this.BOTTOM_ROW_MIN_HEIGHT = 8 // Zelos: 4
    // A hair over Zelos's 48, so a one-field block clears its own corners.
    this.MIN_BLOCK_HEIGHT = 52 // Zelos: 48
    // The indent of a C-block's mouth, which has to grow with the corner radius
    // or the inner blocks tuck under the rounding.
    this.STATEMENT_INPUT_PADDING_LEFT = 20 // Zelos: 16

    // Everything else is Zelos's own: FIELD_BORDER_RECT_HEIGHT (32),
    // EMPTY_INLINE_INPUT_HEIGHT (32), DUMMY_INPUT_MIN_HEIGHT (32) and the
    // padding scale are all derived from its 4px GRID_UNIT and are already
    // roomier than anything this file used to set by hand. The TEXT SIZE is not
    // here either: Blockly copies it out of the theme's `fontStyle` into
    // `FIELD_TEXT_FONTSIZE` when the theme is applied, so a value set here would
    // be silently overwritten — it lives in `theme.ts`.
  }
}

class SoftShellRenderer extends Blockly.zelos.Renderer {
  protected override makeConstants_(): Blockly.zelos.ConstantProvider {
    return new SoftShellConstantProvider()
  }
}

/**
 * Teach Blockly the Soft Shell shape. Idempotent — Blockly's registry throws on
 * a duplicate name, and the canvas can be mounted more than once a session.
 */
export function installSoftShellRenderer(): void {
  if (Blockly.registry.hasItem(Blockly.registry.Type.RENDERER, SOFT_SHELL_RENDERER)) return
  Blockly.blockRendering.register(SOFT_SHELL_RENDERER, SoftShellRenderer)
}
