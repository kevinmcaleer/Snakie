import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { connectorGlyph, PAD_FILL } from '../src/renderer/src/components/part-body'
import { connectorFit } from '../src/renderer/src/components/cable'
import type { PartConnector } from '../src/shared/part'

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

/** Labels resolve in BOARD space, not the rotated body's frame (#670). */
describe('a rotated header keeps its labels pointing off the board (#670)', () => {
  const at = (rotation: number, y: number): PartConnector =>
    ({ ...header(), rotation, y }) as unknown as PartConnector
  /** The label anchor the glyph emits (the only <text> once V+/GND are hidden). */
  const anchor = (c: PartConnector): { x: number; y: number; rot: number } => {
    const html = renderToStaticMarkup(connectorGlyph(50, 50, c, false, 10))
    const m = /<text[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*transform="rotate\(([-\d.]+)/.exec(html)!
    return { x: Number(m[1]), y: Number(m[2]), rot: Number(m[3]) }
  }

  it('offsets ALONG the housing for an upright header (unrotated)', () => {
    // Body horizontal: outward is board-y, so the label sits above the contact.
    expect(anchor(at(0, 0.2)).y).toBeLessThan(50)
    expect(anchor(at(0, 0.8)).y).toBeGreaterThan(50)
  })

  it('offsets ACROSS the housing for a vertical header, so it clears its neighbour', () => {
    // Body turned 90°, so "off the board" is local -x. Before this fix the label
    // kept its local -y offset and swung onto the next header along.
    const top = anchor(at(90, 0.2))
    expect(top.x).toBeLessThan(50)
    expect(top.y).toBeCloseTo(50, 5)
    const bottom = anchor(at(90, 0.8))
    expect(bottom.x).toBeGreaterThan(50)
  })

  it('counter-rotates the text so it reads the same however the body is turned', () => {
    // local label rotation + body rotation is constant in board space.
    expect(anchor(at(0, 0.2)).rot + 0).toBe(-90)
    expect(anchor(at(90, 0.2)).rot + 90).toBe(-90)
    expect(anchor(at(180, 0.2)).rot + 180).toBe(-90)
  })
})
