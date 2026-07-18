import { describe, it, expect } from 'vitest'
import { orderedItems, nextItemZ, applyItemOrder } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/** Unified component z-order (#130). */
describe('orderedItems', () => {
  const base = (): PartDefinition =>
    ({
      id: 'x', name: 'X',
      shapes: [{ kind: 'rect', x: 0.1, y: 0.1 }],
      labels: [{ text: 'L', x: 0.5, y: 0.5 }],
      buttons: [{ x: 0.2, y: 0.2 }],
      onboardLeds: [{ kind: 'single', gpio: 1, x: 0.3, y: 0.3 }],
      connectors: [{ kind: 'qwiic', x: 0.4, y: 0.4 }]
    }) as unknown as PartDefinition

  it('legacy defaults keep todays stacking: shape < label < button < led < connector', () => {
    const ord = orderedItems(base())
    expect(ord.map((o) => o.kind)).toEqual(['shape', 'label', 'button', 'led', 'connector'])
  })

  it('explicit z overrides — an LED can drop below a shape', () => {
    const p = base()
    ;(p.onboardLeds![0] as { z?: number }).z = -5 // send the LED to the very bottom
    ;(p.shapes![0] as { z?: number }).z = 0
    const ord = orderedItems(p)
    expect(ord[0]).toMatchObject({ kind: 'led', index: 0 })
  })

  it('nextItemZ lands a new item on top', () => {
    const p = base()
    const z = nextItemZ(p)
    ;(p.connectors![0] as { z?: number }).z = z - 1 // current top
    expect(z).toBeGreaterThan(orderedItems(p).at(-1)!.z - 1)
  })

  it('applyItemOrder rewrites every z so a drag-reorder sticks (#132)', () => {
    const p = base()
    // Drag the bottom shape to the very top of the list (top-first order).
    const topFirst = orderedItems(p).slice().reverse() // [connector, led, button, label, shape]
    const [shape] = topFirst.splice(topFirst.length - 1, 1)
    topFirst.unshift(shape) // [shape, connector, led, button, label]
    const next = { ...p, ...applyItemOrder(p, topFirst) }
    // Bottom → top now ends with the shape, and every kind carries an explicit z.
    expect(orderedItems(next).map((o) => o.kind)).toEqual(['label', 'button', 'led', 'connector', 'shape'])
    expect(next.shapes![0].z).toBe(4) // top of a 5-item stack
    expect(next.labels![0].z).toBe(0) // bottom
  })
})
