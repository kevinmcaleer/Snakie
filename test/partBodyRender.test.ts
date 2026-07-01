import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartBody, capabilityChipsAt } from '../src/renderer/src/components/part-body'
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
