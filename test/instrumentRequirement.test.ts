import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Oscilloscope } from '../src/renderer/src/components/Oscilloscope'
import { Multimeter } from '../src/renderer/src/components/Multimeter'
import { EnvInstrument } from '../src/renderer/src/components/EnvInstrument'
import { ImuInstrument } from '../src/renderer/src/components/ImuInstrument'
import { RangeInstrument } from '../src/renderer/src/components/RangeInstrument'
import { INSTRUMENTS } from '../src/renderer/src/components/instruments-registry'
import { WorkspaceProvider } from '../src/renderer/src/store/workspace'
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

// Increment 2 (#257): the telemetry singletons show the same requirement panel
// (instead of a dead dial / frozen pose / empty gauge) until their SNK data
// arrives. First render = no telemetry, so the panel must be what's drawn.
const defOf = (id: string) => INSTRUMENTS.find((d) => d.id === id)!

describe('Barometer requirement panel (no ENV telemetry yet)', () => {
  it('shows the how-to panel instead of the dials', () => {
    const html = renderToStaticMarkup(createElement(EnvInstrument, { def: defOf('env') }))
    expect(html).toContain('instr-req')
    expect(html).toContain('No sensor readings yet')
    expect(html).toContain('inst.watch(env=bme)')
    expect(html).not.toContain('envbaro__dial') // the aneroid face is NOT drawn
  })
})

describe('IMU requirement panel (no IMU telemetry yet)', () => {
  it('shows the how-to panel instead of the frozen neutral pose', () => {
    const html = renderToStaticMarkup(createElement(ImuInstrument, { def: defOf('imu') }))
    expect(html).toContain('instr-req')
    expect(html).toContain('No orientation data yet')
    expect(html).toContain('inst.watch(imu=imu)')
    expect(html).not.toContain('imu__model') // the 3-D board is NOT drawn
  })
})

describe('Range requirement panel (no DIST telemetry yet)', () => {
  it('replaces only the screen — the wiring footer stays reachable', () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceProvider, undefined, createElement(RangeInstrument, { def: defOf('range') }))
    )
    expect(html).toContain('instr-req')
    expect(html).toContain('No distance readings yet')
    expect(html).not.toContain('range__svg') // the radar screen is NOT drawn…
    expect(html).toContain('range__wiring') // …but the TRIG/ECHO pickers remain
  })
})
