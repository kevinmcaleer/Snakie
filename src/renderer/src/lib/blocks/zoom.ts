import * as Blockly from 'blockly/core'

/**
 * ZOOM IS ABOUT THE CANVAS, NOT THE SHELF (#1150, epic #1007).
 * =============================================================================
 *
 * Two halves of one complaint, and they share a file because they are the same
 * sentence said twice: the zoom control should move the PROGRAM, and it should
 * be easy to get back.
 *
 * THE SHELF USED TO ZOOM TOO. Blockly's flyout — the drawer of blocks a
 * category opens, which is the "shelf" a learner reaches into — is a workspace
 * of its own, and its default scale is `targetWorkspace.scale`. So `setScale`
 * reflows the flyout, the reflow re-reads that scale, and zooming in to look at
 * a stack also blew the shelf up to three times its size, pushing half the
 * category off the bottom and moving every block out from under the hand that
 * was about to grab it. The shelf is a MENU: it is chrome, it should hold still
 * while the thing it feeds moves, exactly as the toolbox's own category list
 * already does.
 *
 * `getFlyoutScale` is Blockly's own extension point for this ("by default this
 * matches the target workspace scale, but this can be overridden"), so the fix
 * is that one method and nothing else — no patching of `setScale`, no listener
 * racing the reflow.
 *
 * AND THE WAY BACK. Blockly ships a third control under the `+` and `-`, its
 * "reset zoom" target icon, which returns to `startScale` and re-centres. That
 * is one destination, and the one a learner asks for by name is the other:
 * "show me all of it". So the control keeps its place in the column and gets
 * both, on a toggle — 100% ⇄ zoom to fit — behind the corner-bracket icon that
 * means "fit" everywhere else a child has seen it.
 *
 * The control is Blockly's, not ours: re-using it keeps the positioning, the
 * focus ring, the tab order and the grey it shares with `+`, `-` and the
 * trashcan, none of which we would get right by hand from a React overlay. Only
 * the glyph and the action are swapped. If a future Blockly renames the class
 * we look for, {@link installZoomReset} finds nothing and leaves the stock
 * reset control working — the canvas never loses a button over this.
 *
 * AND THE BUTTON IS THE WHOLE BUTTON (#1160). Swapping the sprite for a stroked
 * path swapped the hit area with it: `+` and `-` are 32x32 `<image>`s, which are
 * hit-testable across the whole square, and a path with `fill: none` is
 * hit-testable only where the ink is. So the control answered a press on the
 * four corner brackets — four 2px strokes, about a tenth of the square — and
 * ignored the middle, which is exactly where anybody aims. {@link HIT_CLASS}
 * puts the square back: an invisible 32x32 rect under the glyph, the same size
 * as the sprite it replaced, so the press target and the hover are the control
 * and not the drawing on it.
 *
 * AND "FIT" MEANS ALL OF IT (#1160). Blockly's own `zoomToFit` is a two-line
 * ratio into `setScale`, and `setScale` CLAMPS to `minScale` — so a program
 * taller than about three screens fitted to the floor (0.3) and stopped, with
 * the top and the bottom of it off the canvas. A control labelled "zoom to fit"
 * that shows two thirds of the program is worse than no control, because the
 * learner has no way of knowing what it did not show them. {@link fitScale}
 * works the scale out for real and {@link fitAll} lowers the floor to reach it:
 * a floor is a sensible limit for the wheel and no limit at all on an explicit
 * "show me everything".
 */

/** A scale counts as "100%" within this much — `setScale` rounds to 1/1000. */
const AT_ACTUAL_SIZE = 0.005

/** What pressing the zoom-reset control should do next. */
export type ZoomAction = 'fit' | 'actual-size'

/**
 * The toggle, as a decision about numbers so it can be tested without a canvas.
 *
 * At 100% the only useful move is "fit"; from anywhere else — zoomed in with
 * `+`, zoomed out with the wheel, or fitted a moment ago — it is "back to
 * 100%". That makes the button a true toggle at rest and a way home from
 * everywhere else, which is the pair of jobs it is being asked to do.
 *
 * AN EMPTY CANVAS IS THE EXCEPTION, and not a hypothetical one: Blockly's
 * `zoomToFit` fits the bounding box of the blocks plus a 40px margin, and with
 * no blocks that is a 40px box — so "fit" on a blank canvas means zoom to the
 * maximum, 300%, onto nothing. There is nothing to fit, so the answer is the
 * size a new program starts at.
 */
export function nextZoomAction(scale: number, hasBlocks: boolean): ZoomAction {
  if (!hasBlocks) return 'actual-size'
  return Math.abs(scale - 1) < AT_ACTUAL_SIZE ? 'fit' : 'actual-size'
}

/**
 * THE SHELF HOLDS STILL.
 *
 * Pinned to `startScale` rather than to 1 so the shelf keeps the size it has on
 * open — the learner's "normal", and the one every screenshot and every lesson
 * was written against.
 */
class ShelfFlyout extends Blockly.VerticalFlyout {
  override getFlyoutScale(): number {
    return this.targetWorkspace?.options.zoomOptions.startScale ?? 1
  }
}

/**
 * Use {@link ShelfFlyout} for every vertical toolbox from here on.
 *
 * Overwrites the registry's default entry (Blockly's own way of swapping a
 * flyout, and what `plugins: { flyoutsVerticalToolbox }` reaches), so it must
 * run before `Blockly.inject`. Idempotent: re-registering the same class over
 * itself is exactly what mounting a second canvas should do.
 */
export function installShelfFlyout(): void {
  Blockly.registry.register(
    Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX,
    Blockly.registry.DEFAULT,
    ShelfFlyout,
    true
  )
}

/**
 * The corner-bracket "fit" glyph, drawn in Blockly's 32×32 control box.
 *
 * Four Ls, stroked rather than filled, so it carries no weight of its own next
 * to the sprite's hairline `+` and `-`. Painted by `BlocksCanvas.css`, which
 * gives it the same ink and the same resting/hover/press opacities the sprite
 * icons above it already wear.
 */
const FIT_ICON_PATH = 'M7 13V7h6M19 7h6v6M25 19v6h-6M13 25H7v-6'

/** The class the stylesheet paints, and the marker that says we did this. */
const FIT_ICON_CLASS = 'blocks-zoom-fit'

/** What the control announces to a screen reader, in place of "Reset zoom". */
const FIT_LABEL = 'Zoom to fit, or back to 100%'

/** Blockly's canvas transition is 500ms of CSS; end it once it has run. */
const TRANSITION_MS = 500

/**
 * The invisible square that makes the control a button (#1160).
 *
 * 32x32 at the origin, which is the sprite's own box — the same target `+` and
 * `-` have, so the four controls in that corner are pressed the same way as
 * well as drawn the same way. `BlocksCanvas.css` gives it `pointer-events: all`,
 * which is what makes an unpainted rect answer a press at all.
 */
const HIT_CLASS = 'blocks-zoom-hit'

/** The sprite's box, and so the control's. */
const CONTROL_SIZE = 32

/**
 * Clear space in SCREEN PIXELS between the blocks and the edge of the canvas
 * after a fit.
 *
 * Pixels rather than workspace units because it is about the view: Blockly's
 * own margin is 40 workspace units, which is 36px at 90% and 4px on the
 * five-screen program that needs the room most.
 */
const FIT_PADDING = 24

/**
 * THE SCALE THAT SHOWS ALL OF IT, as arithmetic so it can be tested without a
 * canvas.
 *
 * `view` is the visible canvas in pixels (Blockly's view metrics already have
 * the toolbox taken off), `content` the blocks' bounding box in workspace
 * units; the answer is px-per-unit, which is what `setScale` takes.
 *
 * Capped at the workspace's own `maxScale` — fitting a single small block would
 * otherwise blow it up to fill the screen — and NOT floored: see the header.
 */
export function fitScale(
  view: { width: number; height: number },
  content: { width: number; height: number },
  padding: number,
  maxScale: number
): number {
  const room = (extent: number): number => Math.max(extent - 2 * padding, 1)
  const fits = (extent: number, of: number): number => room(extent) / Math.max(of, 1)
  return Math.min(fits(view.width, content.width), fits(view.height, content.height), maxScale)
}

/**
 * Show every block at once, however many there are.
 *
 * Blockly's `zoomToFit` in longhand, with the two differences the header
 * explains: a padding in pixels, and a floor that gives way. Lowering
 * `minScale` STAYS lowered on purpose — put it back and the next notch of
 * wheel-zoom-out would clamp up to 0.3, so scrolling out would zoom the canvas
 * in. Having seen the whole program at this scale, the learner is allowed back
 * to it.
 */
function fitAll(ws: Blockly.WorkspaceSvg): void {
  const box = ws.getBlocksBoundingBox()
  const view = ws.getMetricsManager().getViewMetrics()
  const zoom = ws.options.zoomOptions
  const scale = fitScale(
    view,
    { width: box.right - box.left, height: box.bottom - box.top },
    FIT_PADDING,
    zoom.maxScale
  )
  if (scale < zoom.minScale) zoom.minScale = scale
  ws.setScale(scale)
  ws.scrollCenter()
}

/** Apply {@link nextZoomAction} to a live workspace. */
function toggleZoom(ws: Blockly.WorkspaceSvg): void {
  const action = nextZoomAction(ws.getScale(), ws.getTopBlocks(false).length > 0)
  // Blockly animates the canvas between the two scales for its own reset
  // control; a jump cut here and a glide there would read as two different
  // buttons.
  ws.beginCanvasTransition()
  if (action === 'fit') {
    fitAll(ws)
  } else {
    ws.setScale(1)
    ws.scrollCenter()
  }
  setTimeout(() => ws.endCanvasTransition(), TRANSITION_MS)
}

/**
 * Re-glyph and re-wire the zoom-reset control of an injected workspace.
 *
 * Returns the undo, which the canvas calls on unmount. The listeners sit on the
 * injection div in the CAPTURE phase deliberately: Blockly binds its own
 * `pointerdown` on the control itself, and a capture listener on an ancestor is
 * the one place a `stopPropagation` can still keep that handler from running —
 * a second listener on the control would be queued behind Blockly's, and both
 * actions would fire.
 */
export function installZoomReset(ws: Blockly.WorkspaceSvg): () => void {
  const root = ws.getInjectionDiv()
  const control = root.querySelector<SVGGElement>('.blocklyZoomReset')
  // No reset control: the workspace is not movable, or Blockly has moved on.
  // Either way there is nothing of ours to put here.
  if (!control) return () => {}

  control.querySelector('image')?.remove()
  // BEFORE the glyph, so the glyph is what a hover paints and this is only what
  // a press lands on.
  const hit = Blockly.utils.dom.createSvgElement(
    Blockly.utils.Svg.RECT,
    { width: CONTROL_SIZE, height: CONTROL_SIZE, x: 0, y: 0, class: HIT_CLASS },
    control
  )
  const icon = Blockly.utils.dom.createSvgElement(
    Blockly.utils.Svg.PATH,
    { d: FIT_ICON_PATH, class: FIT_ICON_CLASS },
    control
  )
  const stockLabel = control.getAttribute('aria-label')
  control.setAttribute('aria-label', FIT_LABEL)

  const activate = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element) || !target.closest('.blocklyZoomReset')) return
    // Blockly's control answers Enter and Space as well as a press; match it,
    // and let every other key through to the navigation that owns it.
    if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return
    event.stopPropagation()
    event.preventDefault()
    toggleZoom(ws)
  }
  root.addEventListener('pointerdown', activate, true)
  root.addEventListener('keydown', activate, true)

  return () => {
    root.removeEventListener('pointerdown', activate, true)
    root.removeEventListener('keydown', activate, true)
    icon.remove()
    hit.remove()
    if (stockLabel !== null) control.setAttribute('aria-label', stockLabel)
  }
}
