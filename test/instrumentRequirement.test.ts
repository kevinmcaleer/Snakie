import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Oscilloscope } from '../src/renderer/src/components/Oscilloscope'
import { Multimeter } from '../src/renderer/src/components/Multimeter'
import type { UsedPins } from '../src/renderer/src/components/parse-pins'

const pwmPlaceholder: UsedPins = { type: 'pwm', pins: [], variable: '', constructor: '' }
const pwmReal: UsedPins = { type: 'pwm', pins: ['0'], variable: 'led', constructor: 'PWM(Pin(0))' }
const adcPlaceholder: UsedPins = { type: 'adc', pins: [], variable: '', constructor: '' }
const adcReal: UsedPins = { type: 'adc', pins: ['26'], variable: 'pot', constructor: 'ADC(Pin(26))' }

describe('Oscilloscope open-anytime requirement panel', () => {
  it('shows the requirement help when opened with no PWM source', () => {
    const html = renderToStaticMarkup(
      createElement(Oscilloscope, { conn: pwmPlaceholder, sources: [], fileSource: '' })
    )
    expect(html).toContain('instr-req')
    expect(html).toContain('No PWM signal yet')
    expect(html).toContain('inst.watch(scope=pwm)') // the runnable hint
    expect(html).not.toContain('osc__svg') // the live screen is NOT drawn
  })

  it('draws the normal scope once a real PWM connection is present', () => {
    const html = renderToStaticMarkup(
      createElement(Oscilloscope, { conn: pwmReal, sources: [pwmReal], fileSource: '' })
    )
    expect(html).toContain('osc__svg')
    expect(html).not.toContain('No PWM signal yet')
  })

  it('draws the normal scope for a placeholder once live SNK SCOPE samples arrive', () => {
    const html = renderToStaticMarkup(
      createElement(Oscilloscope, { conn: pwmPlaceholder, sources: [], fileSource: '', samples: [0, 0.5, 1] })
    )
    expect(html).toContain('osc__svg')
    expect(html).not.toContain('No PWM signal yet')
  })
})

describe('Multimeter open-anytime requirement panel', () => {
  it('shows the requirement help when opened with no ADC source', () => {
    const html = renderToStaticMarkup(
      createElement(Multimeter, { conn: adcPlaceholder, sources: [] })
    )
    expect(html).toContain('instr-req')
    expect(html).toContain('No ADC input yet')
    expect(html).toContain('inst.watch(meter=adc)')
    expect(html).not.toContain('dmm__body')
  })

  it('draws the normal meter once a real ADC connection is present', () => {
    const html = renderToStaticMarkup(createElement(Multimeter, { conn: adcReal, sources: [adcReal] }))
    expect(html).toContain('dmm')
    expect(html).not.toContain('No ADC input yet')
  })
})
