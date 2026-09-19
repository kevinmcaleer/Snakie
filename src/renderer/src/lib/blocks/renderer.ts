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
 * STANDARD BLOCKLY IS THE BASE, and that is the whole of this file's argument.
 *
 * It was Zelos for a while — Blockly's port of `scratch-blocks` — on the
 * reasoning that a child arrives already knowing the Scratch vocabulary: pill
 * reporters, hexagon booleans, everything inline. What that bought in
 * familiarity it spent in HEIGHT, and on a real MicroPython file the bill came
 * due all at once (#1170):
 *
 *  - **Zelos's floor is twice standard Blockly's.** `MIN_BLOCK_HEIGHT` is 48
 *    against 24, and this file used to raise it again to 52. A four-line
 *    program looked generous; a forty-line one looked like it had been left in
 *    the rain.
 *  - **Nesting COMPOUNDS.** Every inline socket pads its child by
 *    `EMPTY_INLINE_INPUT_PADDING` (16) on each side, so each level of an
 *    expression adds height to the row it sits on. `pwm.duty_u16(int(50 *
 *    65535 / 100))` is four levels deep and rendered about 90px tall — one
 *    statement, taller than three. The standard renderers do not do this, which
 *    is why an expression written in blocks can look like the expression it is.
 *  - **The rounder it got, the more it had to be re-derived.** #1158 is the
 *    record of that: raising `CORNER_RADIUS` to 12 left Zelos's own rows
 *    measured for 4, and the difference came out as a hairline hanging off
 *    every block and a sliver under every C-block's mouth. Two bugs to buy back
 *    what a bigger number broke.
 *
 * So the geometry is Blockly's own, unmodified — `thrasos`, which is the
 * standard row layout with a flat outline rather than `geras`'s bevel, and the
 * one that sits under the Soft Shell palette without arguing with it. The SKIN
 * is still entirely ours: the colours, the fonts and the lettering come from
 * `theme.ts` and from the one override below, and none of them touch a
 * measurement.
 *
 * WHAT IS OVERRIDDEN. One thing, and it is not a size: the colour of the text
 * on a block. See {@link SoftShellPathObject}.
 *
 * NOTHING ELSE SHOULD BE. Every constant Blockly ships is derived from the
 * others — a corner radius is also a notch offset, a bottom-row height and the
 * arc a drawer walks — so a number raised here is a number three other places
 * have already been measured against. That is what #1158 was, twice. If the
 * blocks need more room, the answer is the font and the padding in `theme.ts`,
 * which nothing measures against.
 */

/**
 * The Soft Shell geometry, un-initialised — `init()` derives the corner, notch
 * and tab PATHS from Blockly's numbers, and Blockly calls it when the renderer
 * starts. Exported so the geometry can be measured without a canvas.
 */
export function softShellConstants(): Blockly.blockRendering.ConstantProvider {
  return new Blockly.blockRendering.ConstantProvider()
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
class SoftShellPathObject extends Blockly.blockRendering.PathObject {
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

class SoftShellRenderer extends Blockly.thrasos.Renderer {
  override makePathObject(
    root: SVGElement,
    style: Blockly.Theme.BlockStyle
  ): Blockly.blockRendering.PathObject {
    return new SoftShellPathObject(root, style, this.getConstants())
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
