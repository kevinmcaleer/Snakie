import { describe, it, expect } from 'vitest'
import * as Blockly from 'blockly/core'
import { fitScale, installShelfFlyout, nextZoomAction } from '../src/renderer/src/lib/blocks/zoom'

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

describe('fitScale — "fit" means all of it (#1160)', () => {
  /** The canvas in the bug report: 1100x531 of visible workspace. */
  const view = { width: 1100, height: 531 }

  it('takes whichever of the two directions runs out first', () => {
    // A tall program is limited by the height, a wide one by the width, and the
    // padding comes off both ends of each.
    expect(fitScale(view, { width: 400, height: 2000 }, 24, 3)).toBeCloseTo(483 / 2000, 5)
    expect(fitScale(view, { width: 4000, height: 200 }, 24, 3)).toBeCloseTo(1052 / 4000, 5)
  })

  it('goes below Blockly\u2019s zoom floor rather than showing two thirds of a program', () => {
    // THE BUG. A six-function program is about 3,300 units tall; `zoomToFit`
    // clamped at minScale 0.3 and left five of its eight roots off the canvas.
    const scale = fitScale(view, { width: 700, height: 3300 }, 24, 3)
    expect(scale).toBeLessThan(0.3)
    // And what it does give back really does fit.
    expect(3300 * scale).toBeLessThanOrEqual(view.height)
  })

  it('leaves the padding clear on both sides', () => {
    const content = { width: 700, height: 3300 }
    const scale = fitScale(view, content, 24, 3)
    expect(content.height * scale).toBeCloseTo(view.height - 48, 5)
  })

  it('never blows one small block up past the workspace maximum', () => {
    // Without the cap, fitting a single `print` block would be a canvas of one
    // block ten times life size.
    expect(fitScale(view, { width: 120, height: 48 }, 24, 3)).toBe(3)
  })

  it('does not divide by nothing on an empty box', () => {
    // `nextZoomAction` keeps an empty canvas away from here, but a program of
    // one zero-height block should not produce Infinity either.
    expect(Number.isFinite(fitScale(view, { width: 0, height: 0 }, 24, 3))).toBe(true)
  })

  it('survives a canvas smaller than its own padding', () => {
    // A pane dragged almost shut. Any positive scale will do; NaN or a negative
    // one would throw inside `setScale`.
    const scale = fitScale({ width: 30, height: 10 }, { width: 400, height: 400 }, 24, 3)
    expect(scale).toBeGreaterThan(0)
  })
})
