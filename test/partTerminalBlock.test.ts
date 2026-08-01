import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { connectorGlyph } from '../src/renderer/src/components/part-body'
import { resizeTerminals, terminalPins } from '../src/renderer/src/components/part-editor.util'
import { PART_CONNECTOR_KINDS, TERMINAL_MAX, TERMINAL_MIN, coerceConnectorKind } from '../src/shared/part'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition, PartPin } from '../src/shared/part'

/** The green screw-terminal block (#662) — a connector KIND, so it inherits body
 *  placement, rotation, silk label, contacts-as-real-pins and the layer tree. */
describe('terminal block is a first-class connector kind (#662)', () => {
  it('is in the kind list and survives coercion from untrusted YAML', () => {
    expect(PART_CONNECTOR_KINDS).toContain('terminal')
    expect(coerceConnectorKind('terminal')).toBe('terminal')
    expect(coerceConnectorKind('nonsense')).toBe('qwiic')
  })
})

describe('terminalPins (#662)', () => {
  it('names contacts T1..Tn', () => {
    expect(terminalPins(3).map((p) => p.name)).toEqual(['T1', 'T2', 'T3'])
    expect(terminalPins(2).every((p) => p.type === 'io')).toBe(true)
  })

  it('clamps to the allowed range', () => {
    expect(terminalPins(0)).toHaveLength(TERMINAL_MIN)
    expect(terminalPins(1)).toHaveLength(TERMINAL_MIN)
    expect(terminalPins(999)).toHaveLength(TERMINAL_MAX)
  })
})

describe('resizeTerminals (#662)', () => {
  const configured: PartPin[] = [
    { name: 'M1A', type: 'io', gpio: 4 },
    { name: 'M1B', type: 'io', gpio: 5 }
  ]

  it('grows without disturbing the contacts already configured', () => {
    const out = resizeTerminals(configured, 4)
    expect(out.map((p) => p.name)).toEqual(['M1A', 'M1B', 'T3', 'T4'])
    expect(out[0].gpio).toBe(4) // the author's work survives
  })

  it('shrinks from the END, so what is lost is predictable', () => {
    expect(resizeTerminals(configured, 2)).toEqual(configured)
    expect(resizeTerminals([...configured, { name: 'T3', type: 'io' }], 2).map((p) => p.name)).toEqual(['M1A', 'M1B'])
  })

  it('clamps rather than letting a slip in the number field run away', () => {
    expect(resizeTerminals(configured, 0)).toHaveLength(TERMINAL_MIN)
    expect(resizeTerminals(configured, 10_000)).toHaveLength(TERMINAL_MAX)
  })

  it('is pure — the source array is untouched', () => {
    const before = JSON.stringify(configured)
    resizeTerminals(configured, 6)
    expect(JSON.stringify(configured)).toBe(before)
  })
})

describe('a terminal block round-trips through parts.yml (#662)', () => {
  it('keeps its kind, contacts and body placement', () => {
    const part = normalisePart({
      id: 'motor-driver',
      name: 'Motor driver',
      headers: [],
      connectors: [
        { kind: 'terminal', x: 0.3, y: 0.5, rotation: 90, label: 'MOTOR A', pins: terminalPins(4) }
      ]
    } as unknown as PartDefinition)
    const back = partFromYaml(partToYaml(part))
    const c = back.connectors?.[0]
    expect(c?.kind).toBe('terminal')
    expect(c?.pins.map((p) => p.name)).toEqual(['T1', 'T2', 'T3', 'T4'])
    expect(c?.rotation).toBe(90)
    expect(c?.label).toBe('MOTOR A')
    expect(normalisePart(back)).toEqual(part)
  })
})

describe('terminal contact labels match ordinary pin labels (#662)', () => {
  const conn = (kind: string, n: number): Parameters<typeof connectorGlyph>[2] =>
    ({ kind, x: 0.5, y: 0.5, pins: terminalPins(n) }) as unknown as Parameters<typeof connectorGlyph>[2]

  it('uses the shared .pcv__pin-label style, rotated 90 anticlockwise', () => {
    const html = renderToStaticMarkup(connectorGlyph(50, 50, conn('terminal', 4)))
    expect(html).toContain('pcv__pin-label')
    expect(html).not.toContain('pb__conn-pinlabel')
    // Reads bottom-to-top, over its own way.
    expect(html).toContain('rotate(-90')
    // ...but WITHOUT the halo/bold/scaled-font treatment that made these look
    // unlike every other pin label. Styling comes from the class, not inline.
    expect(html).not.toContain('paint-order')
    expect(html).not.toContain('font-weight')
    // Anchored on the glyph centre, so the label's centre line sits on the
    // terminal's — rotating about the baseline hangs it off to one side.
    expect(html).toContain('dominant-baseline="central"')
    expect(html).toContain('T1')
    expect(html).toContain('T4')
  })

  it('leaves the tight-pitch sockets on their rotated, haloed labels', () => {
    const html = renderToStaticMarkup(connectorGlyph(50, 50, conn('qwiic', 4)))
    expect(html).toContain('pb__conn-pinlabel')
    expect(html).toContain('rotate(-90')
    expect(html).toContain('paint-order') // the halo they need at a 2mm pitch
  })

  it('centres EVERY connector kind on its contact, not just the terminal', () => {
    // Geometry is shared by construction; only the paint differs per kind.
    for (const kind of ['terminal', 'qwiic', 'grove', 'jst', 'dupont']) {
      const html = renderToStaticMarkup(connectorGlyph(50, 50, conn(kind, 4)))
      expect(html).toContain('dominant-baseline="central"')
    }
  })
})

/** Connector contact labels sit on the side nearest the board edge (#663). */
describe('connector labels follow the nearest board edge (#663)', () => {
  const at = (kind: string, y: number): Parameters<typeof connectorGlyph>[2] =>
    ({ kind, x: 0.5, y, pins: terminalPins(4) }) as unknown as Parameters<typeof connectorGlyph>[2]

  it('reads upward for a connector in the TOP half', () => {
    for (const kind of ['terminal', 'dupont']) {
      const html = renderToStaticMarkup(connectorGlyph(50, 50, at(kind, 0.2)))
      expect(html).toContain('rotate(-90')
      expect(html).not.toContain('rotate(90')
    }
  })

  it('reads downward for a connector in the BOTTOM half', () => {
    // The reported case: servo headers along the bottom edge threw their signal
    // labels back across the board.
    for (const kind of ['terminal', 'dupont']) {
      const html = renderToStaticMarkup(connectorGlyph(50, 50, at(kind, 0.8)))
      expect(html).toContain('rotate(90')
      expect(html).not.toContain('rotate(-90')
    }
  })

  it('places the label clear of the housing on the side it reads toward', () => {
    const top = renderToStaticMarkup(connectorGlyph(50, 50, at('dupont', 0.2)))
    const bottom = renderToStaticMarkup(connectorGlyph(50, 50, at('dupont', 0.8)))
    const yOf = (h: string): number => Number(/<text[^>]*\sy="([-\d.]+)"/.exec(h)![1])
    // Housing is centred on cy=50, so above < 50 < below.
    expect(yOf(top)).toBeLessThan(50)
    expect(yOf(bottom)).toBeGreaterThan(50)
  })
})

/** Servo headers show only their signal label (#666). */
describe('servo header power/ground labels are hidden by default (#666)', () => {
  const servo = (over: Record<string, unknown> = {}): Parameters<typeof connectorGlyph>[2] =>
    ({
      kind: 'dupont',
      x: 0.5,
      y: 0.3,
      pins: [
        { name: 'SIG', type: 'io', capabilities: ['pwm'] },
        { name: 'V+', type: 'pwr', ...over },
        { name: 'GND', type: 'gnd', ...over }
      ]
    }) as unknown as Parameters<typeof connectorGlyph>[2]

  // pxPerMm > 0 so the 3-way housing is wide enough for labels to draw at all
  // (they are gated on width, and a 3-pin block at the fallback scale is 21px).
  it('draws the signal label and drops V+ / GND', () => {
    const html = renderToStaticMarkup(connectorGlyph(50, 50, servo(), false, 10))
    expect(html).toContain('SIG')
    expect(html).not.toContain('V+')
    expect(html).not.toContain('GND')
  })

  it('an explicit labelHidden:false still wins, so the default is overridable', () => {
    const html = renderToStaticMarkup(connectorGlyph(50, 50, servo({ labelHidden: false }), false, 10))
    expect(html).toContain('V+')
    expect(html).toContain('GND')
  })

  it('leaves other connector kinds showing every contact', () => {
    // A QWIIC's GND/3V3 are worth printing — you wire to them.
    const qwiic = {
      kind: 'qwiic',
      x: 0.5,
      y: 0.3,
      pins: [
        { name: 'GND', type: 'gnd' },
        { name: 'VCC', type: 'pwr' },
        { name: 'SDA', type: 'io' },
        { name: 'SCL', type: 'io' }
      ]
    } as unknown as Parameters<typeof connectorGlyph>[2]
    const html = renderToStaticMarkup(connectorGlyph(50, 50, qwiic, false, 10))
    expect(html).toContain('GND')
    expect(html).toContain('VCC')
  })
})
