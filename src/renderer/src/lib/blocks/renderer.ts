import * as Blockly from 'blockly/core'
import { BLOCK_TEXT_VAR, SOFT_SHELL_RENDERER, inkForBlock } from './theme'

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
 * THE CONSTRAINTS THAT ARE NOT TASTE. A rounder corner is not free: Zelos sizes
 * three things off `CORNER_RADIUS` and then draws arcs of exactly that radius
 * into them, so raising the radius alone leaves the arcs bigger than the space
 * the layout pass reserved. All three are listed here because each one showed
 * up as a different smudge on the canvas (#1158).
 *
 *  1. `NOTCH_OFFSET_LEFT` must stay clear of `CORNER_RADIUS`. The notch is
 *     drawn along the top edge starting at that offset, and the corner arc eats
 *     the first `CORNER_RADIUS` pixels of it — so a corner rounder than the
 *     notch's offset cuts into the notch and the two blocks stop looking like
 *     they fit together.
 *  2. `BOTTOM_ROW_MIN_HEIGHT` must be at least `CORNER_RADIUS` — see the
 *     constant below.
 *  3. A spacer row either side of a C-block's mouth must be at least as tall as
 *     the inside corner drawn into it — see {@link snugStatementSpacers}.
 */

/** Corner rounding, in px. Bounded by {@link NOTCH_OFFSET_LEFT} — see above. */
const CORNER_RADIUS = 12

/** Where the top notch starts, in px. Must leave the corner arc room. */
const NOTCH_OFFSET_LEFT = 20

/**
 * The Soft Shell geometry, un-initialised — `init()` derives the corner, notch
 * and tab PATHS from the numbers below, and Blockly calls it when the renderer
 * starts. Exported so the geometry can be measured without a canvas.
 */
export function softShellConstants(): Blockly.zelos.ConstantProvider {
  return new SoftShellConstantProvider()
}

class SoftShellConstantProvider extends Blockly.zelos.ConstantProvider {
  constructor() {
    super()

    // ---- Roundness -------------------------------------------------------
    // Zelos ships 4, which reads as a soft rectangle. 12 is the MakeCode
    // roundness, and it is what makes a block look like a thing you pick up.
    this.CORNER_RADIUS = CORNER_RADIUS
    this.NOTCH_OFFSET_LEFT = NOTCH_OFFSET_LEFT // Zelos: 12 — too close to the arc above.
    // THE BOTTOM ROW HAS TO BE AS TALL AS THE CORNER DRAWN INTO IT (#1158).
    //
    // Zelos writes `BOTTOM_ROW_MIN_HEIGHT = this.CORNER_RADIUS` in its own
    // constructor, which runs BEFORE the line above — so raising the radius to
    // 12 left this at Zelos's 4, and nothing in Blockly re-derives it.
    //
    // The cost was a HAIRLINE HANGING OFF EVERY BLOCK'S BOTTOM-RIGHT CORNER.
    // Blockly's drawer runs the right-hand edge down to
    // `baseline - OUTSIDE_CORNERS.rightHeight` and then arcs away to the left —
    // rightHeight being the radius, 12. But the bottom row only reserved
    // `max(BOTTOM_ROW_MIN_HEIGHT, CORNER_RADIUS / 2)` = 6 above the baseline,
    // so the edge above it had already been drawn 6px FURTHER DOWN than where
    // the arc departs. The path doubled back up those 6px, and a stroked path
    // paints every segment it walks: a 6px tick sticking out past the corner,
    // on every block with a rounded bottom-right (`v 47 V 41 a 12 12 …`).
    //
    // At `CORNER_RADIUS` the row reserves exactly what the arc consumes, the
    // `V` lands where the edge already is, and the tick has nowhere to come
    // from. It buys 6px of block height, which is what a 12px corner costs.
    //
    // `TOP_ROW_MIN_HEIGHT` IS THE SAME KIND OF STALE AND IS LEFT ALONE, because
    // the top has no equivalent to go wrong: the corner arc is drawn BEFORE the
    // edge below it, so the pen is already past the arc when the edge starts
    // and the absolute `V` that follows only ever moves it down. Raising it
    // would add 4px to every block to fix nothing.
    this.BOTTOM_ROW_MIN_HEIGHT = CORNER_RADIUS // Zelos: CORNER_RADIUS, i.e. its own 4.
    // A true pill: half of FIELD_BORDER_RECT_HEIGHT. Zelos ships 4, a rounded
    // rectangle; a pill reads as something you press rather than type into.
    this.FIELD_BORDER_RECT_RADIUS = 16

    // ---- Room ------------------------------------------------------------
    // ZELOS'S OWN 4, AND IT HAS TO BE. These were 8 for a pass, on the
    // reasoning that a 12px corner needs somewhere to land — and the cost was
    // paid somewhere it was not being looked at.
    //
    // Every block's top and bottom row grows by this, INCLUDING a value block
    // sitting in a socket. So `from (modulino) import (ModulinoMotors)`, whose
    // two slots are FIELDS, drew them at 34px, while `set motors to
    // (ModulinoMotors())`, whose slot is a whole value block, drew it at 48 —
    // the same kind of hole in the same kind of sentence, half again as tall.
    //
    // At 4 the value block is 40 against the field's 34, which is the block's
    // own border round its field and reads as the same thing. Statement blocks
    // barely notice: they are sized by MIN_BLOCK_HEIGHT and their contents, so
    // they go 58 → 56, and the roominess this file exists for is untouched.
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

/**
 * A C-BLOCK'S MOUTH CLOSES ON WHAT IS IN IT (#1158).
 * ---------------------------------------------------------------------------
 *
 * The bug, as it was reported: a block sitting in an `if`'s `do` had a sliver
 * of canvas showing between its bottom edge and the bottom of the mouth, so the
 * two did not look like they fit together.
 *
 * THE MOUTH IS THE RIGHT HEIGHT; IT IS DRAWN 4px TOO LOW. Blockly reserves a
 * SPACER ROW either side of a statement input and draws the mouth's inside
 * corner into it — `max(NOTCH_HEIGHT, INSIDE_CORNERS.rightHeight)`, which on
 * stock Zelos is `max(8, 4)` = 8 for a 4px corner, with room to spare. At a
 * 12px corner it is `max(8, 12)` = 12, with none: and then Zelos's own
 * `finalizeVerticalAlignment_` takes `SMALL_PADDING` back off that spacer when
 * a block is nested tightly, leaving 8px of row for a 12px arc. The arc is
 * drawn at its full radius regardless, so the whole mouth — top edge and bottom
 * edge together — lands 4px below the connection point the child block is
 * actually placed at. The overhang at the top hides behind the child; the one
 * at the bottom is the sliver.
 *
 * So this is not a spacing tweak: it is the floor that makes the drawn mouth
 * agree with the measured one. It runs AFTER Zelos's tight-nesting pass, which
 * is the thing that breaks the floor, and before `finalize_` assigns each row
 * its `yPos` — so the rows it lifts are the ones the layout then lays out.
 *
 * Only the spacers that actually have a corner drawn into them are touched;
 * Blockly marks those with `precedesStatement`/`followsStatement`, which is the
 * same test its drawer uses to decide to draw one.
 */
export function snugStatementSpacers(rows: Blockly.blockRendering.Row[], cornerHeight: number): void {
  for (const row of rows) {
    if (!Blockly.blockRendering.Types.isSpacerRow(row)) continue
    if (!row.precedesStatement && !row.followsStatement) continue
    row.height = Math.max(row.height, cornerHeight)
  }
}

/**
 * Zelos widens `INSIDE_CORNERS` with a right-hand pair — the mouth is arced on
 * both sides, not just the left — but only the base interface is re-exported
 * from `blockly/core`, so the extra field has to be named here. It is Zelos's
 * own shape, not ours: `zelos/drawer.ts` casts to the same thing to read it.
 */
type ZelosInsideCorners = Blockly.blockRendering.InsideCorners & { rightHeight: number }

class SoftShellRenderInfo extends Blockly.zelos.RenderInfo {
  protected override finalizeVerticalAlignment_(): void {
    super.finalizeVerticalAlignment_()
    const corners = this.constants_.INSIDE_CORNERS as ZelosInsideCorners
    snugStatementSpacers(this.rows, corners.rightHeight)
  }
}

/**
 * THE BLOCK'S TEXT COLOUR, FROM THE BLOCK'S OWN FILL (#1099).
 * ---------------------------------------------------------------------------
 *
 * Blockly injects `.blocklyText { fill: #fff }` and a theme cannot override it:
 * `BlockStyle` carries three FILL colours and no text colour at all. So block
 * text was white on every block in both skins, and measured against the
 * categories **eleven of fifteen were below 3.0:1 in the dark skin**, with
 * Variables at 1.51:1 — the one in the screenshot that reported this.
 *
 * READ OFF THE PATH, not off the style, and that is deliberate. By the time
 * `super.applyColour` returns, the fill on the path is what Blockly ACTUALLY
 * decided — after the shadow-block shade, after the disabled pattern, after
 * anything a future Blockly does that this file has never heard of. Asking the
 * element is asking the truth; re-deriving it from `this.style` would be a
 * second copy of Blockly's rules, and the copy is the one that goes stale.
 *
 * WHY A CUSTOM PROPERTY rather than setting `fill` on each text element: a
 * custom property inherits down the SVG tree, so every label on the block picks
 * it up and a nested block overrides it for its own subtree — with no per-block
 * class, no walk of the canvas, and nothing to re-run when Blockly re-renders.
 * It also covers a part's or a plugin's blocks (#1017) for free, which is the
 * acceptance criterion no hand-tuned per-category table could meet.
 */
class SoftShellPathObject extends Blockly.zelos.PathObject {
  override applyColour(block: Blockly.BlockSvg): void {
    super.applyColour(block)
    // A fill this cannot parse — the hatch pattern on a disabled block is a
    // `url(#…)` — falls back to the style's own colour rather than to a guess.
    const painted = this.svgPath.getAttribute('fill') ?? ''
    const fill = painted.startsWith('#') ? painted : this.style.colourPrimary
    // THE STYLE NAME AS WELL AS THE FILL, because one style has an opinion its
    // fill cannot express: a comment wears white in both skins although its
    // grey is a different grey in each. See `inkForBlock`.
    this.svgRoot.style.setProperty(BLOCK_TEXT_VAR, inkForBlock(block.getStyleName(), fill))
  }
}

class SoftShellRenderer extends Blockly.zelos.Renderer {
  protected override makeConstants_(): Blockly.zelos.ConstantProvider {
    return softShellConstants()
  }

  protected override makeRenderInfo_(block: Blockly.BlockSvg): Blockly.zelos.RenderInfo {
    return new SoftShellRenderInfo(this, block)
  }

  override makePathObject(root: SVGElement, style: Blockly.Theme.BlockStyle): Blockly.zelos.PathObject {
    return new SoftShellPathObject(root, style, this.getConstants() as Blockly.zelos.ConstantProvider)
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
