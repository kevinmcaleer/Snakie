import { describe, it, expect } from 'vitest'
import * as Blockly from 'blockly/core'
import { installSoftShellRenderers, softShellConstants } from '../src/renderer/src/lib/blocks/renderer'
import {
  DEFAULT_BLOCK_SHAPE,
  SOFT_SHELL_RENDERER,
  SOFT_SHELL_RENDERERS
} from '../src/renderer/src/lib/blocks/theme'

/**
 * SOFT SHELL IS A SKIN, NOT A GEOMETRY.
 * =============================================================================
 *
 * The canvas rendered on Zelos for a while, tuned by hand — a rounder corner, a
 * taller row, roomier fields — and each of those numbers cost something
 * somewhere it was not being looked at:
 *
 *  - #1158, twice over: `CORNER_RADIUS` raised to 12 while Zelos's own rows
 *    stayed measured for 4, so the drawer walked arcs bigger than the space the
 *    layout had reserved. A hairline off every block's bottom-right corner, and
 *    a sliver of canvas under every C-block's mouth.
 *  - And then the height: a 52px floor on every block, with 16px of inline padding compounding
 *    at each level of an expression, so `pwm.duty_u16(int(50 * 65535 / 100))`
 *    rendered about 90px tall.
 *
 * So the geometry is now Blockly's own, and this suite is what keeps it that
 * way: the constants the renderer hands the drawer must be the constants
 * Blockly ships, measurement for measurement. A future override has to delete a
 * test to land, which is the point — the numbers are derived from each other,
 * and changing one silently is what both bugs above were.
 */

/**
 * The geometry as the drawer sees it. `init()` is the shape pass Blockly runs
 * on a live renderer — it turns the numbers into the corner, notch and tab
 * PATHS. Pure arithmetic, unlike `setTheme` (which measures a font) and
 * `createDom`, so it needs no canvas and no DOM.
 */
function geometry(): Blockly.blockRendering.ConstantProvider {
  const constants = softShellConstants()
  constants.init()
  return constants
}

/** A fresh stock provider to measure ours against. */
function stock(): Blockly.blockRendering.ConstantProvider {
  const constants = new Blockly.blockRendering.ConstantProvider()
  constants.init()
  return constants
}

describe('the Soft Shell geometry is standard Blockly', () => {
  it('changes no measurement Blockly ships', () => {
    const ours = geometry() as unknown as Record<string, unknown>
    const theirs = stock() as unknown as Record<string, unknown>
    // Every numeric constant, whatever it is called — so a measurement added by
    // a future Blockly is covered the day it arrives rather than the day
    // somebody remembers to list it here.
    const numbers = Object.keys(theirs).filter((key) => typeof theirs[key] === 'number')
    expect(numbers.length).toBeGreaterThan(20)
    for (const key of numbers) expect([key, ours[key]]).toEqual([key, theirs[key]])
  })

  it('registers every shape Settings can ask for, under the names it asks by', () => {
    installSoftShellRenderers()
    // ALL THREE, not just the one in use: Settings can switch shape at any
    // moment, and injecting against a renderer Blockly has never heard of
    // throws.
    for (const name of Object.values(SOFT_SHELL_RENDERERS)) {
      expect([name, Blockly.registry.hasItem(Blockly.registry.Type.RENDERER, name)]).toEqual([
        name,
        true
      ])
    }
    // Idempotent: Blockly's registry throws on a duplicate name, and the canvas
    // can be mounted more than once a session — and now re-mounts on a shape
    // change as well.
    expect(() => installSoftShellRenderers()).not.toThrow()
  })

  it('keeps the bare renderer name for the default shape', () => {
    // It is in screenshots, in `docs/` and in the habit of anybody who has read
    // `renderer.ts`; a rename would be churn with no reader.
    expect(SOFT_SHELL_RENDERER).toBe('snakie-soft-shell')
    expect(SOFT_SHELL_RENDERERS[DEFAULT_BLOCK_SHAPE]).toBe(SOFT_SHELL_RENDERER)
  })
})

describe('the invariants a rounder corner used to break (#1158)', () => {
  /**
   * #1158's own assertion — that the bottom row reserves what the bottom-right
   * arc consumes — is NOT repeated here, and the absence is deliberate. It was
   * arithmetic out of `zelos/drawer.ts`, which walks the edge down to
   * `baseline - OUTSIDE_CORNERS.rightHeight` and arcs away from there; the
   * standard drawer does not, and on stock constants the two numbers do not
   * compare. Asserting it against a drawer that never reads it would be a test
   * that passes or fails for reasons unrelated to the bug it names.
   *
   * What actually retires #1158 is the first suite above: the radius is
   * Blockly's own, so no row can be measured for one corner and drawn with
   * another. The invariant below survives because it is the drawer-independent
   * half — a notch and a corner competing for the same stretch of top edge.
   */
  it('starts the notch clear of the corner arc beside it', () => {
    const c = geometry()
    // The notch is drawn along the top edge from `NOTCH_OFFSET_LEFT`, and the
    // corner arc eats the first `CORNER_RADIUS` pixels of that edge. A corner
    // rounder than the offset cuts into the notch, and two blocks stop looking
    // like they fit together.
    expect(c.NOTCH_OFFSET_LEFT).toBeGreaterThanOrEqual(c.CORNER_RADIUS)
  })
})

describe('an expression does not grow with its nesting', () => {
  it('pads an inline socket by less than a row, so four levels is not four rows', () => {
    const c = geometry()
    // Zelos padded an inline input by 16 on each side — half a row per level,
    // and an arithmetic chain four deep is four of those. The standard
    // constants pad by a fraction of the row they sit on, so a nested
    // expression stays the height of the row it is written on.
    expect(c.EMPTY_INLINE_INPUT_PADDING).toBeLessThan(c.MIN_BLOCK_HEIGHT)
  })
})
