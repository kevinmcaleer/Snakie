import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartBody, capabilityChipsAt, connectorSize } from '../src/renderer/src/components/part-body'
import { blankPart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * Server-render the shared PartBody scene + the pin-anchored capability chips
 * (used by the breadboard hover) and assert the new elements draw with the right
 * signal/bus text.
 */
const box = { x: 0, y: 0, w: 100, h: 100 }
const render = (part: PartDefinition): string =>
  renderToStaticMarkup(createElement(PartBody, { part, box }))

describe('capabilityChipsAt (breadboard hover chips)', () => {
  it('renders signal + bus refined chips', () => {
    const html = renderToStaticMarkup(
      capabilityChipsAt(
        50,
        50,
        'right',
        ['pwm', 'adc', 'spi', 'i2c', 'uart'],
        { pwm: 'A', spi: 'SCK', i2c: 'SDA', uart: 'TX' },
        { spi: 1, i2c: 0, adc: 2, uart: 0 }
      ) ?? createElement('g')
    )
    expect(html).toContain('PWM A')
    expect(html).toContain('ADC2')
    expect(html).toContain('SPI1 SCK')
    expect(html).toContain('I2C0 SDA')
    expect(html).toContain('UART0 TX')
  })

  it('is null when the pin has no chip-worthy capabilities', () => {
    expect(capabilityChipsAt(0, 0, 'left', ['digital'])).toBeNull()
    expect(capabilityChipsAt(0, 0, 'left', undefined)).toBeNull()
  })
})

describe('PartBody onboard LEDs + connectors', () => {
  it('draws single / RGB / NeoPixel LEDs with their GPIO labels', () => {
    const part: PartDefinition = {
      ...blankPart(),
      onboardLeds: [
        { kind: 'single', gpio: 25, x: 0.3, y: 0.3 },
        { kind: 'rgb', rgb: { r: 18, g: 19, b: 20 }, x: 0.5, y: 0.5 },
        { kind: 'neopixel', gpio: 22, power: 23, x: 0.7, y: 0.7 }
      ]
    }
    const html = render(part)
    expect(html).toContain('LED · GP25')
    expect(html).toContain('RGB · GP18 GP19 GP20')
    expect(html).toContain('NeoPixel · GP22 · PWR GP23')
  })

  it('draws capability chips inside the body only when capsPins is set', () => {
    const part: PartDefinition = {
      ...blankPart(),
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'GP4', type: 'io', gpio: 4, capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 0 }, x: 0.1, y: 0.5 }
          ]
        }
      ]
    }
    // No caps prop → no chips.
    expect(renderToStaticMarkup(createElement(PartBody, { part, box }))).not.toContain('I2C0 SDA')
    // capsPins 'all' → the chip renders (box-relative, inside the body).
    const html = renderToStaticMarkup(createElement(PartBody, { part, box, boxedPins: true, capsPins: 'all' }))
    expect(html).toContain('I2C0 SDA')
    expect(html).toContain('pcv__caps-hover')
  })

  it('draws a QWIIC connector summarising its signal pins', () => {
    const part: PartDefinition = {
      ...blankPart(),
      connectors: [
        {
          kind: 'qwiic',
          x: 0.5,
          y: 0.9,
          pins: [
            { name: 'GND', type: 'gnd' },
            { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c'], signals: { i2c: 'SDA' } }
          ]
        }
      ]
    }
    expect(render(part)).toContain('QWIIC · SDA GP4')
  })
})

describe('connectorSize (mm-accurate connector scaling)', () => {
  const conn4 = { kind: 'qwiic' as const, x: 0.5, y: 0.5, pins: [{ name: 'A', type: 'io' as const }, { name: 'B', type: 'io' as const }, { name: 'C', type: 'io' as const }, { name: 'D', type: 'io' as const }] }

  it('falls back to the legacy fixed size when there are no mm dimensions (pxPerMm = 0)', () => {
    const s = connectorSize(conn4, 0)
    // Legacy: w = max(18, n*5+6) = 26, h = 11 for a 4-pin connector.
    expect(s).toEqual({ n: 4, w: 26, h: 11 })
  })

  it('scales the housing to the board when given px-per-mm (a QWIIC ≈ 4.5mm wide)', () => {
    const pxPerMm = 15 // e.g. the Tiny 2350 (18mm wide) drawn ~267px in the editor
    const s = connectorSize(conn4, pxPerMm)
    // QWIIC/JST-SH: (n-1)*1.0 + 2*0.75 = 4.5mm wide, 2.9mm deep → to px.
    expect(s.w).toBeCloseTo(4.5 * pxPerMm, 5)
    expect(s.h).toBeCloseTo(2.9 * pxPerMm, 5)
    // Much larger than the tiny legacy size — the reported "really small" bug.
    expect(s.w).toBeGreaterThan(connectorSize(conn4, 0).w * 2)
  })

  it('a 2.0mm-pitch JST is wider than a 1.0mm-pitch QWIIC with the same pin count', () => {
    const jst = { ...conn4, kind: 'jst' as const }
    expect(connectorSize(jst, 15).w).toBeGreaterThan(connectorSize(conn4, 15).w)
  })

  it('scales linearly with px-per-mm', () => {
    expect(connectorSize(conn4, 20).w).toBeCloseTo(connectorSize(conn4, 10).w * 2, 5)
  })
})
