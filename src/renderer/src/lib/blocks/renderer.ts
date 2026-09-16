import * as Blockly from 'blockly/core'
import { SOFT_SHELL_RENDERER } from './theme'

/**
 * THE SOFT SHELL BLOCK GEOMETRY (#573's design direction, epic #1007).
 * =============================================================================
 *
 * Blockly's theme decides what a block is COLOURED. Its renderer decides what a
 * block is SHAPED — the corner radius, the padding around a field, how tall an
 * empty socket is — and none of that is reachable from a theme. So the shape is
 * its own small subclass, registered once and named in the workspace options.
 *
 * WHY THESE NUMBERS. Blockly's stock geometry is drawn for an adult IDE: 8px
 * corners, 5px of padding either side of a field, a 16px field box holding 11px
 * text. Next to MakeCode or Scratch, both of which this app's users arrive
 * from, it reads as cramped and sharp — the blocks look like form controls
 * rather than like things you pick up. Rounder and roomier is not decoration
 * here, it is the same argument as the hats and the parchment: the canvas has to
 * look like somewhere a child can put their hands.
 *
 * THE ONE CONSTRAINT THAT IS NOT TASTE: `NOTCH_OFFSET_LEFT` must stay clear of
 * `CORNER_RADIUS`. The notch is drawn along the top edge starting at that
 * offset, and the corner arc eats the first `CORNER_RADIUS` pixels of it — so a
 * corner rounder than the notch's offset cuts into the notch and the two blocks
 * stop looking like they fit together. Every rounding below is bounded by that.
 *
 * `thrasos` stays the base renderer: it is the one with external value inputs
 * laid out in rows, which is what keeps a `set x to (…)` reading as a sentence.
 * Zelos (Scratch's shape) would round things far more, and would also throw away
 * that row layout along with the pin dropdowns' sizing — a much bigger change
 * than the one being asked for.
 */

/** Corner rounding, in px. Bounded by {@link NOTCH_OFFSET_LEFT} — see above. */
const CORNER_RADIUS = 12

/** Where the top notch starts, in px. Must leave the corner arc room. */
const NOTCH_OFFSET_LEFT = 20

class SoftShellConstantProvider extends Blockly.blockRendering.ConstantProvider {
  constructor() {
    super()

    // ---- Roundness -------------------------------------------------------
    this.CORNER_RADIUS = CORNER_RADIUS
    this.NOTCH_OFFSET_LEFT = NOTCH_OFFSET_LEFT
    // The rounded box behind a dropdown or a number field. Near-pill, so a field
    // reads as a thing you can press rather than as a text input.
    this.FIELD_BORDER_RECT_RADIUS = 10

    // ---- Room ------------------------------------------------------------
    // The three paddings Blockly spaces rows and columns with. Each is bumped
    // by roughly half, which is enough to feel different and small enough that
    // a full program still fits the canvas at the default 0.9 zoom.
    this.SMALL_PADDING = 5
    this.MEDIUM_PADDING = 8
    this.MEDIUM_LARGE_PADDING = 11
    this.LARGE_PADDING = 14
    // A one-field block, and an empty socket inside a loop. Both were 24 — the
    // height of the text plus almost nothing.
    this.MIN_BLOCK_HEIGHT = 32
    this.EMPTY_STATEMENT_INPUT_HEIGHT = 32
    this.DUMMY_INPUT_MIN_HEIGHT = 20
    this.EMPTY_INLINE_INPUT_HEIGHT = 32
    // The strip of block above the first row and below the last. This is most of
    // what "cramped" was: text sitting 5px from the block's edge.
    this.TOP_ROW_MIN_HEIGHT = 8
    this.BOTTOM_ROW_MIN_HEIGHT = 8
    // The indent of a C-block's mouth, which has to grow with the corner radius
    // or the inner blocks tuck under the rounding.
    this.STATEMENT_INPUT_PADDING_LEFT = 24

    // ---- Fields ----------------------------------------------------------
    // A 22px box gives a dropdown arrow and a pin number somewhere to sit.
    // The TEXT SIZE is not here: Blockly copies it out of the theme's
    // `fontStyle` into `FIELD_TEXT_FONTSIZE` when the theme is applied, so a
    // value set here would be silently overwritten — it lives in `theme.ts`.
    this.FIELD_BORDER_RECT_HEIGHT = 22
    this.FIELD_DROPDOWN_BORDER_RECT_HEIGHT = 22
    this.FIELD_BORDER_RECT_X_PADDING = 9
    this.FIELD_BORDER_RECT_Y_PADDING = 5
  }
}

class SoftShellRenderer extends Blockly.thrasos.Renderer {
  protected override makeConstants_(): Blockly.blockRendering.ConstantProvider {
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
