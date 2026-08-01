import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { connectorContactLabels, connectorGlyph, PAD_FILL } from '../src/renderer/src/components/part-body'
import { connectorFit } from '../src/renderer/src/components/cable'
import type { PartConnector, PartDefinition } from '../src/shared/part'

/**
 * The servo header is a real connector (#669), so a servo lead cables all three
 * conductors in one drag — while still reading as the familiar three-pin column,
 * coloured by electrical role.
 */
const header = (n = 1): PartConnector =>
  ({
    kind: 'dupont',
    x: 0.5,
    y: 0.5,
    rotation: 90,
    pins: [
      { name: `S${n}`, type: 'io', capabilities: ['digital', 'pwm'], signals: { pwm: 'A' } },
      { name: `V${n}`, type: 'pwr' },
      { name: `G${n}`, type: 'gnd' }
    ]
  }) as unknown as PartConnector

/** What a servo's own lead looks like, once the part carries a connector. */
const servoLead = (): PartConnector =>
  ({
    kind: 'dupont',
    x: 0.5,
    y: 0.5,
    pins: [
      { name: 'Signal', type: 'io', capabilities: ['pwm'] },
      { name: 'VCC', type: 'pwr' },
      { name: 'GND', type: 'gnd' }
    ]
  }) as unknown as PartConnector

describe('a servo lead cables to a servo header (#669)', () => {
  it('joins all three conductors in one gesture', () => {
    const fit = connectorFit(servoLead(), header())
    expect(fit.ok).toBe(true)
    expect(fit.pairs).toEqual([
      [0, 0],
      [1, 1],
      [2, 2]
    ])
  })

  it('pairs by position, so DIFFERENT contact names still line up', () => {
    // Signal->S1, VCC->V1, GND->G1. This is why renaming is never needed to cable.
    const fit = connectorFit(servoLead(), header(7))
    expect(fit.ok).toBe(true)
    expect(fit.pairs).toHaveLength(3)
  })

  it('lands the right way round even dragged backwards', () => {
    expect(connectorFit(header(), servoLead()).pairs).toEqual(connectorFit(servoLead(), header()).pairs)
  })
})

describe('a servo header reads by electrical role (#669)', () => {
  it('draws signal amber, V+ red and ground dark', () => {
    const html = renderToStaticMarkup(connectorGlyph(50, 50, header(), false, 10))
    expect(html).toContain(PAD_FILL.io)
    expect(html).toContain(PAD_FILL.pwr)
    expect(html).toContain(PAD_FILL.gnd)
  })

  it('leaves shelled sockets one gold colour — they are metal in a housing', () => {
    const qwiic = {
      kind: 'qwiic',
      x: 0.5,
      y: 0.5,
      pins: [
        { name: 'GND', type: 'gnd' },
        { name: 'VCC', type: 'pwr' },
        { name: 'SDA', type: 'io' },
        { name: 'SCL', type: 'io' }
      ]
    } as unknown as PartConnector
    const html = renderToStaticMarkup(connectorGlyph(50, 50, qwiic, false, 10))
    expect(html).not.toContain(PAD_FILL.pwr)
    expect(html).toContain('#e6c34a')
  })
})

/**
 * The #670 counter-rotation is GONE (#672): labels are rendered outside the
 * housing's rotation transform, at resolved positions that already account for
 * it. So a rotated header's labels simply follow its contacts.
 */
describe('a rotated header labels its contacts where they actually are (#672)', () => {
  const BOX = { x: 0, y: 0, w: 400, h: 200 }
  const part = (rotation: number): PartDefinition =>
    ({
      id: 'p',
      name: 'P',
      dimensions: { width: 40, height: 20 },
      headers: [],
      // A terminal block, so every contact labels — a servo header hides its
      // power and ground, leaving one label and nothing to measure.
      connectors: [
        {
          kind: 'terminal',
          x: 0.5,
          y: 0.3,
          rotation,
          pins: [
            { name: 'T1', type: 'io' },
            { name: 'T2', type: 'io' },
            { name: 'T3', type: 'io' }
          ]
        }
      ]
    }) as unknown as PartDefinition
  const xs = (rotation: number): number[] => {
    const p = part(rotation)
    const html = renderToStaticMarkup(<>{connectorContactLabels(p, p.connectors![0], BOX, 'k')}</>)
    return [...html.matchAll(/<text[^>]*\sx="([-\d.]+)"/g)].map((m) => Number(m[1]))
  }

  it('spreads labels ALONG the row when the housing is upright', () => {
    const all = xs(0)
    expect(all).toHaveLength(3)
    expect(Math.max(...all) - Math.min(...all)).toBeGreaterThan(0)
  })

  it('stacks them when the housing is turned 90 degrees', () => {
    // Contacts now share an x, so their labels do too — they follow the pins.
    const all = xs(90)
    expect(Math.max(...all) - Math.min(...all)).toBeCloseTo(0, 6)
  })
})
