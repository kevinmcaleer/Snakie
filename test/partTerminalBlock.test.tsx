import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { connectorContactLabels, connectorGlyph } from '../src/renderer/src/components/part-body'
import { resizeContacts, resizeTerminals, terminalPins } from '../src/renderer/src/components/part-editor.util'
import { PART_CONNECTOR_KINDS, TERMINAL_MAX, TERMINAL_MIN, coerceConnectorKind } from '../src/shared/part'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartConnector, PartDefinition, PartPin } from '../src/shared/part'

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


/** Connector contact labels sit on the side nearest the board edge (#663). */

/** Servo headers show only their signal label (#666). */

/**
 * Contact labels now come from the SHARED pin-label path (#672), not from
 * `connectorGlyph`. These carry forward the coverage the glyph's own label tests
 * used to hold: which side they read toward, that power/ground are dropped on a
 * servo header, and that the glyph no longer draws them at all.
 */
describe('contact labels go through the shared pin-label path (#672)', () => {
  const BOX = { x: 0, y: 0, w: 400, h: 200 }
  const conn = (kind: string, n: number, over: Record<string, unknown> = {}): PartConnector =>
    ({ kind, x: 0.5, y: 0.3, pins: terminalPins(n), ...over }) as unknown as PartConnector
  const part = (c: PartConnector): PartDefinition =>
    ({ id: 'p', name: 'P', dimensions: { width: 40, height: 20 }, headers: [], connectors: [c] }) as unknown as PartDefinition
  const html = (c: PartConnector): string =>
    renderToStaticMarkup(<>{connectorContactLabels(part(c), c, BOX, 'k')}</>)

  it('the glyph itself no longer draws any label', () => {
    const g = renderToStaticMarkup(connectorGlyph(50, 50, conn('terminal', 4), false, 10))
    expect(g).not.toContain('<text')
  })

  it('labels in the ordinary pin style, so every pin on the board matches', () => {
    const out = html(conn('terminal', 4))
    expect(out).toContain('pcv__pin-label')
    expect(out).not.toContain('pb__conn-pinlabel')
    expect(out).toContain('T1')
    expect(out).toContain('T4')
  })

  it('reads toward the nearest board edge', () => {
    // Top half -> label above the board box; bottom half -> below it.
    const top = html(conn('terminal', 3, { y: 0.2 }))
    const bottom = html(conn('terminal', 3, { y: 0.9 }))
    const firstY = (h: string): number => Number(/<text[^>]*\sy="([-\d.]+)"/.exec(h)![1])
    expect(firstY(top)).toBeLessThan(firstY(bottom))
  })

  it('drops V+ / GND on a servo header, keeping the signal', () => {
    const servo = {
      kind: 'dupont',
      x: 0.5,
      y: 0.3,
      pins: [
        { name: 'SIG', type: 'io' },
        { name: 'V+', type: 'pwr' },
        { name: 'GND', type: 'gnd' }
      ]
    } as unknown as PartConnector
    const out = html(servo)
    expect(out).toContain('SIG')
    expect(out).not.toContain('V+')
    expect(out).not.toContain('GND')
  })

  it('no number and no GPIO means no empty number chip', () => {
    expect(html(conn('terminal', 3))).not.toContain('pcv__pin-numbox')
  })
})

/** Any variable-width connector can be resized, not just a terminal block (#694). */
describe('resizeContacts (#694)', () => {
  const jst = [
    { name: 'VBAT', type: 'pwr' },
    { name: 'GND', type: 'gnd' }
  ] as unknown as PartPin[]

  it('grows with a per-kind prefix, keeping what is configured', () => {
    const out = resizeContacts(jst, 4, 'P')
    expect(out.map((p) => p.name)).toEqual(['VBAT', 'GND', 'P3', 'P4'])
    expect(out[0].type).toBe('pwr')
  })

  it('shrinks from the END, so what is lost is predictable', () => {
    expect(resizeContacts(resizeContacts(jst, 4, 'P'), 2, 'P').map((p) => p.name)).toEqual(['VBAT', 'GND'])
  })

  it('clamps to the allowed range', () => {
    expect(resizeContacts(jst, 0, 'P')).toHaveLength(TERMINAL_MIN)
    expect(resizeContacts(jst, 9999, 'P')).toHaveLength(TERMINAL_MAX)
  })

  it('resizeTerminals is the same thing with the T prefix', () => {
    expect(resizeTerminals(jst, 3).map((p) => p.name)).toEqual(['VBAT', 'GND', 'T3'])
  })

  it('is pure', () => {
    const before = JSON.stringify(jst)
    resizeContacts(jst, 6, 'P')
    expect(JSON.stringify(jst)).toBe(before)
  })
})
