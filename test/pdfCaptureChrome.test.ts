// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CHROME_SELECTORS } from '../src/renderer/src/lib/pdf/capture'
import { serializeLiveSvg } from '../src/renderer/src/components/svg-export'

/**
 * THE DESCRIPTION BUBBLE DOES NOT GO INTO THE PDF (#1147).
 * =============================================================================
 *
 * A `def` block's description is the speech bubble the `?` opens, and the blocks
 * pages already print it as the caption under the function's name. Left open on
 * the canvas it went into the picture as WELL — and mislocated, because
 * `serializeLiveSvg` drops the pan/zoom transform from the block canvas only, so
 * the bubble layer kept its own and the bubble landed wherever the canvas
 * happened to be scrolled to.
 *
 * Built by hand rather than by injecting a real workspace: what is under test is
 * which parts of the tree the capture keeps, and jsdom has no layout engine to
 * render Blockly into.
 */

const NS = 'http://www.w3.org/2000/svg'

/** A stand-in for Blockly's workspace SVG: a block canvas, and a bubble over it. */
function workspaceSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement
  const canvas = document.createElementNS(NS, 'g')
  canvas.setAttribute('class', 'blocklyBlockCanvas')
  canvas.setAttribute('data-snakie-pdf-capture', '')
  canvas.setAttribute('transform', 'translate(120, 340) scale(0.8)')
  const block = document.createElementNS(NS, 'g')
  block.setAttribute('data-id', 'the-def-block')
  canvas.appendChild(block)

  const bubbles = document.createElementNS(NS, 'g')
  bubbles.setAttribute('class', 'blocklyBubbleCanvas')
  bubbles.setAttribute('transform', 'translate(120, 340) scale(0.8)')
  const bubble = document.createElementNS(NS, 'g')
  bubble.setAttribute('class', 'blocklyBubble blocklyTextInputBubble')
  const text = document.createElementNS(NS, 'text')
  text.textContent = 'Returns the distance.'
  bubble.appendChild(text)
  bubbles.appendChild(bubble)

  const flyout = document.createElementNS(NS, 'g')
  flyout.setAttribute('class', 'blocklyFlyout')

  svg.append(canvas, bubbles, flyout)
  return svg
}

/** The capture the blocks pages take of one stack. */
function capture(svg: SVGSVGElement): string {
  const out = serializeLiveSvg(svg, '[data-snakie-pdf-capture]', {
    frame: { x: 0, y: 0, width: 200, height: 120 },
    margin: 8,
    exclude: CHROME_SELECTORS
  })
  if (!out) throw new Error('nothing serialised')
  return out.svg
}

describe('what a blocks capture leaves behind', () => {
  it('drops an open description bubble', () => {
    const svg = capture(workspaceSvg())
    expect(svg).not.toContain('blocklyBubble')
    expect(svg).not.toContain('Returns the distance.')
  })

  it('keeps the block the page is actually about', () => {
    expect(capture(workspaceSvg())).toContain('the-def-block')
  })

  it('leaves the live workspace untouched — the bubble stays open on screen', () => {
    const svg = workspaceSvg()
    capture(svg)
    expect(svg.querySelector('.blocklyBubbleCanvas')).not.toBeNull()
    expect(svg.querySelector('.blocklyBubble')).not.toBeNull()
  })

  it('names the bubble layer, not just the bubbles on it', () => {
    // The layer carries the pan/zoom the capture strips from the block canvas,
    // so an emptied-but-present layer would still shift what is inside it.
    expect(CHROME_SELECTORS).toContain('.blocklyBubbleCanvas')
  })

  it('still drops the chrome it always dropped', () => {
    expect(capture(workspaceSvg())).not.toContain('blocklyFlyout')
  })
})
