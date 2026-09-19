// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import * as Blockly from 'blockly/core'
import {
  centredScroll,
  installShelfFlyout,
  installZoomReset,
  nextZoomAction
} from '../src/renderer/src/lib/blocks/zoom'

/**
 * The zoom control moves the CANVAS (#1150).
 *
 * Both halves of the issue are decisions about numbers, which is why they can
 * be checked here rather than only by zooming a real canvas by hand.
 */
describe('the shelf does not zoom with the canvas (#1150)', () => {
  it('pins the flyout to the start scale however far the canvas is zoomed', () => {
    installShelfFlyout()
    const Flyout = Blockly.registry.getClass(
      Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX,
      Blockly.registry.DEFAULT
    ) as unknown as { prototype: { getFlyoutScale: () => number } }

    // The bug, exactly: the canvas is at 250%, and the shelf used to follow it
    // there because Blockly's default answer is `targetWorkspace.scale`.
    const shelf = Flyout.prototype.getFlyoutScale.call({
      targetWorkspace: { scale: 2.5, options: { zoomOptions: { startScale: 0.9 } } }
    })
    expect(shelf).toBe(0.9)
  })

  it('falls back to 1 when no start scale was configured', () => {
    installShelfFlyout()
    const Flyout = Blockly.registry.getClass(
      Blockly.registry.Type.FLYOUTS_VERTICAL_TOOLBOX,
      Blockly.registry.DEFAULT
    ) as unknown as { prototype: { getFlyoutScale: () => number } }

    expect(
      Flyout.prototype.getFlyoutScale.call({
        targetWorkspace: { scale: 2, options: { zoomOptions: {} } }
      })
    ).toBe(1)
  })
})

describe('nextZoomAction (#1150)', () => {
  it('fits from 100%', () => {
    expect(nextZoomAction(1, true)).toBe('fit')
  })

  it('comes home from anywhere else', () => {
    expect(nextZoomAction(3, true)).toBe('actual-size')
    expect(nextZoomAction(0.3, true)).toBe('actual-size')
    // The scale a "fit" lands on is almost never exactly 1, so the next press
    // is the way back — which is what makes the control a toggle.
    expect(nextZoomAction(0.62, true)).toBe('actual-size')
  })

  it('treats a rounded 100% as 100%', () => {
    // `setScale` rounds to a thousandth, so a click on `+` then `-` can land a
    // hair off 1 and must not feel like a different button.
    expect(nextZoomAction(0.999, true)).toBe('fit')
    expect(nextZoomAction(1.001, true)).toBe('fit')
  })

  it('never fits an empty canvas', () => {
    // Blockly would fit the 40px margin around no blocks at all — i.e. zoom to
    // the maximum onto nothing. 100% is the only sane answer.
    expect(nextZoomAction(1, false)).toBe('actual-size')
    expect(nextZoomAction(2, false)).toBe('actual-size')
  })
})

/**
 * THE BUTTON IS THE BOX, NOT THE INK.
 *
 * Blockly's control held an `<image>` — a rectangle, hit-tested as one. Swapping
 * it for the corner-bracket path swapped the hit region for four 2px strokes
 * with nothing in between, so a press in the MIDDLE of the button did nothing
 * while the control still looked and hovered like a button. Reported against
 * #1150 as "only the corners of the zoom icon respond".
 */
describe('the fit control answers a press anywhere in its box', () => {
  /** Blockly's reset control as it is actually built: a `<g>` holding an image. */
  function control(): { root: HTMLElement; group: SVGGElement } {
    const root = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'blocklyZoom blocklyZoomReset')
    group.setAttribute('aria-label', 'Reset zoom')
    group.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'image'))
    svg.appendChild(group)
    root.appendChild(svg)
    document.body.appendChild(root)
    return { root, group }
  }

  /** Enough of a workspace for the control to act on, and a record of what it did. */
  function workspace(root: HTMLElement): {
    ws: Blockly.WorkspaceSvg
    scales: number[]
    scrolls: { x: number; y: number }[]
  } {
    const scales: number[] = []
    const scrolls: { x: number; y: number }[] = []
    const ws = {
      options: {},
      getInjectionDiv: () => root,
      // What `Blockly.svgResize` reads to re-measure the host before a fit.
      getParentSvg: () => root.querySelector('svg'),
      getCachedParentSvgSize: () => ({ width: 0, height: 0 }),
      setCachedParentSvgSize: () => {},
      resize: () => {},
      getScale: () => 1,
      getTopBlocks: () => [{}],
      beginCanvasTransition: () => {},
      endCanvasTransition: () => {},
      zoomToFit: () => scales.push(-1),
      setScale: (s: number) => scales.push(s),
      scrollCenter: () => {},
      // A 800×500 view looking at a 200×200 box whose centre is (200, 300).
      getMetrics: () => ({ viewWidth: 800, viewHeight: 500 }),
      getBlocksBoundingBox: () => ({ left: 100, top: 200, right: 300, bottom: 400 }),
      scroll: (x: number, y: number) => scrolls.push({ x, y })
    }
    return { ws: ws as unknown as Blockly.WorkspaceSvg, scales, scrolls }
  }

  it('puts a full-size target under the glyph, and the glyph on top of it', () => {
    const { root, group } = control()
    installZoomReset(workspace(root).ws)

    const target = group.querySelector('.blocks-zoom-target')
    expect(target).not.toBeNull()
    // The control box Blockly clips `+`, `-` and the reset sprite to, so the
    // four controls end up with the same hit area as well as the same look.
    expect(target?.getAttribute('width')).toBe('32')
    expect(target?.getAttribute('height')).toBe('32')
    // Before the glyph in the DOM: painted under it, so the brackets still read
    // as brackets. (`pointer-events: all` on the rect is `BlocksCanvas.css`.)
    const kids = [...group.children].map((el) => el.getAttribute('class'))
    expect(kids.indexOf('blocks-zoom-target')).toBeLessThan(kids.indexOf('blocks-zoom-fit'))
    // And the image it replaced is gone, or the sprite would show through.
    expect(group.querySelector('image')).toBeNull()
  })

  it('zooms when the target is pressed — the middle of the button, not a bracket', () => {
    const { root, group } = control()
    const { ws, scales } = workspace(root)
    installZoomReset(ws)

    const target = group.querySelector('.blocks-zoom-target') as Element
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    // At 100% with blocks on the canvas, the next action is "fit".
    expect(scales).toEqual([-1])
  })

  it('centres the blocks after the fit, not wherever Blockly left them', () => {
    const { root, group } = control()
    const { ws, scrolls } = workspace(root)
    installZoomReset(ws)

    const target = group.querySelector('.blocks-zoom-target') as Element
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    // The box centre (200, 300) lands on the view centre (400, 250).
    expect(scrolls).toEqual([{ x: 200, y: -50 }])
  })

  it('takes the target away again with the rest of it', () => {
    const { root, group } = control()
    installZoomReset(workspace(root).ws)()

    expect(group.querySelector('.blocks-zoom-target')).toBeNull()
    expect(group.querySelector('.blocks-zoom-fit')).toBeNull()
    expect(group.getAttribute('aria-label')).toBe('Reset zoom')
  })
})

/**
 * The arithmetic behind that centring, on its own: Blockly's `scrollX`/`scrollY`
 * are the pixel position of the workspace origin from the view's top-left, so
 * the offset is half the view minus the scaled centre of the box.
 */
describe('centredScroll', () => {
  it('scales the box before centring it', () => {
    const box = { left: 0, top: 0, right: 200, bottom: 100 }
    // At 50% the box centre (100, 50) is at (50, 25) px.
    expect(centredScroll(box, { width: 400, height: 300 }, 0.5)).toEqual({ x: 150, y: 125 })
  })

  it('handles a box above and left of the origin', () => {
    const box = { left: -50, top: -50, right: 50, bottom: 50 }
    expect(centredScroll(box, { width: 200, height: 200 }, 2)).toEqual({ x: 100, y: 100 })
  })
})
