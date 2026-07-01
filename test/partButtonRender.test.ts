import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartBody } from '../src/renderer/src/components/part-body'
import { blankPart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * On-board buttons (#130) must render in the shared PartBody scene (used by the
 * Part Editor's life-like layer AND, read-only, by the Board Views). Server-render
 * the SVG (no DOM needed) and assert the button glyph + silk label appear.
 */
const box = { x: 0, y: 0, w: 100, h: 100 }
const render = (part: PartDefinition): string =>
  renderToStaticMarkup(createElement(PartBody, { part, box }))

describe('PartBody on-board buttons (#130)', () => {
  it('draws each button (glyph + silk label)', () => {
    const part: PartDefinition = {
      ...blankPart(),
      buttons: [{ label: 'BOOT', x: 0.5, y: 0.5 }]
    }
    const html = render(part)
    expect(html).toContain('BOOT')
    // The tactile-switch glyph draws a pressable cap (<circle>).
    expect(html).toContain('<circle')
  })

  it('renders nothing button-ish when there are no buttons', () => {
    expect(render(blankPart())).not.toContain('BOOT')
  })

  it('hides buttons when the components layer is hidden', () => {
    const part: PartDefinition = {
      ...blankPart(),
      buttons: [{ label: 'BOOT', x: 0.5, y: 0.5 }],
      layerVisibility: { pcb: true, image: true, holes: true, pins: true, components: false }
    }
    expect(render(part)).not.toContain('BOOT')
  })
})
